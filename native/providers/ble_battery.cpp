#include "ble_battery.hpp"
#include "device_search.hpp"

#include <windows.h>
#include <setupapi.h>
#include <devpkey.h>
#include <combaseapi.h>
#include <cfgmgr32.h>
#include <bluetoothleapis.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <bit>
#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <cwctype>
#include <map>
#include <memory>
#include <mutex>
#include <string_view>
#include <thread>
#include <vector>

namespace pm {
namespace {

using namespace std::chrono_literals;
using Clock = std::chrono::steady_clock;

// Bluetooth SIG service/characteristic UUIDs in the standard base UUID.
constexpr GUID bluetoothUuid(unsigned shortId)
{
    return {shortId, 0, 0x1000, {0x80, 0, 0, 0x80, 0x5f, 0x9b, 0x34, 0xfb}};
}
constexpr GUID batteryService = bluetoothUuid(0x180f);
constexpr GUID deviceInformationService = bluetoothUuid(0x180a);
constexpr DEVPROPKEY containerIdKey{{0x8c7ed206, 0x3f8a, 0x4827, {0xb3, 0xab, 0xae, 0x9e, 0x1f, 0xae, 0xfc, 0x6c}}, 2};

struct InterfaceList {
    HDEVINFO handle;
    explicit InterfaceList(const GUID& service) : handle(SetupDiGetClassDevsW(&service,
        nullptr, nullptr, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE)) {}
    ~InterfaceList() { if (handle != INVALID_HANDLE_VALUE) SetupDiDestroyDeviceInfoList(handle); }
};

struct ServiceHandle {
    HANDLE handle;
    ~ServiceHandle() { if (handle != INVALID_HANDLE_VALUE) CloseHandle(handle); }
};

struct GattApi {
    HMODULE module = LoadLibraryExW(L"BluetoothApis.dll", nullptr, LOAD_LIBRARY_SEARCH_SYSTEM32);
    decltype(&BluetoothGATTGetCharacteristics) characteristics = module ?
        std::bit_cast<decltype(characteristics)>(GetProcAddress(module, "BluetoothGATTGetCharacteristics")) : nullptr;
    decltype(&BluetoothGATTGetCharacteristicValue) value = module ?
        std::bit_cast<decltype(value)>(GetProcAddress(module, "BluetoothGATTGetCharacteristicValue")) : nullptr;
    ~GattApi() { if (module) FreeLibrary(module); }
};

std::wstring normalized(std::wstring value)
{
    std::ranges::transform(value, value.begin(), [](wchar_t c) { return static_cast<wchar_t>(std::towlower(c)); });
    return value;
}

using InterfacePaths = std::map<std::wstring, std::set<std::wstring>>;
struct Enumeration {
    InterfacePaths paths;
    std::map<std::wstring, unsigned> unresolvedPaths;
    unsigned error{};
};

// A service can lack its own ContainerId. Recover only through its immediate
// physical LE parent. Never walk to the local adapter or use display names.
std::optional<std::wstring> serviceContainer(HDEVINFO list, SP_DEVINFO_DATA& instance)
{
    if (!instance.DevInst) return {};
    GUID guid{};
    DEVPROPTYPE type{};
    DWORD actual{};
    if (!SetupDiGetDevicePropertyW(list, &instance, &containerIdKey, &type,
            reinterpret_cast<PBYTE>(&guid), sizeof(guid), &actual, 0) ||
        type != DEVPROP_TYPE_GUID || actual != sizeof(guid) || IsEqualGUID(guid, GUID{})) {
        DEVINST parent{};
        std::array<wchar_t, MAX_DEVICE_ID_LEN> id{};
        if (CM_Get_Parent(&parent, instance.DevInst, 0) != CR_SUCCESS ||
            CM_Get_Device_IDW(parent, id.data(), static_cast<ULONG>(id.size()), 0) != CR_SUCCESS)
            return {};
        const auto parentId = normalized(id.data());
        constexpr std::wstring_view prefix = L"bthle\\dev_";
        if (!parentId.starts_with(prefix) || parentId.size() <= prefix.size() + 12 ||
            parentId[prefix.size() + 12] != L'\\' ||
            parentId.substr(prefix.size(), 12).find_first_not_of(L"0123456789abcdef") != std::wstring::npos)
            return {};
        ULONG size = sizeof(guid);
        if (CM_Get_DevNode_PropertyW(parent, &containerIdKey, &type, reinterpret_cast<PBYTE>(&guid), &size, 0) != CR_SUCCESS ||
            type != DEVPROP_TYPE_GUID || size != sizeof(guid) || IsEqualGUID(guid, GUID{}))
            return {};
    }
    std::array<wchar_t, 39> id{};
    if (StringFromGUID2(guid, id.data(), static_cast<int>(id.size())) != static_cast<int>(id.size()))
        return {};
    return normalized(id.data());
}

Enumeration enumerate(const GUID& service)
{
    InterfaceList list(service);
    Enumeration candidates;
    if (list.handle == INVALID_HANDLE_VALUE) {
        candidates.error = GetLastError();
        return candidates;
    }
    constexpr DWORD limit = 1024;
    for (DWORD i = 0; i < limit; ++i) {
        SP_DEVICE_INTERFACE_DATA interfaceData{};
        interfaceData.cbSize = sizeof(interfaceData);
        if (!SetupDiEnumDeviceInterfaces(list.handle, nullptr, &service, i, &interfaceData)) {
            const auto error = GetLastError();
            if (error != ERROR_NO_MORE_ITEMS) candidates.error = error;
            return candidates;
        }
        DWORD required = 0;
        SP_DEVINFO_DATA instance{};
        instance.cbSize = sizeof(instance);
        // SetupAPI can fill DeviceInfoData on the size query. If a bad path
        // is known to belong to one exact container, block only that target.
        const auto queried = SetupDiGetDeviceInterfaceDetailW(list.handle, &interfaceData, nullptr, 0, &required, &instance);
        if (queried || GetLastError() != ERROR_INSUFFICIENT_BUFFER ||
            required < sizeof(SP_DEVICE_INTERFACE_DETAIL_DATA_W) || required > 64 * 1024) {
            if (const auto id = serviceContainer(list.handle, instance)) {
                candidates.unresolvedPaths.emplace(*id, ERROR_INVALID_DATA);
                continue;
            }
            candidates.error = ERROR_INVALID_DATA;
            return candidates;
        }
        // Use max_align_t-backed storage for the variable-length SetupAPI structure.
        std::vector<std::max_align_t> storage((required + sizeof(std::max_align_t) - 1) / sizeof(std::max_align_t));
        auto* detail = reinterpret_cast<PSP_DEVICE_INTERFACE_DETAIL_DATA_W>(storage.data());
        detail->cbSize = sizeof(*detail);
        SP_DEVINFO_DATA filled{};
        filled.cbSize = sizeof(filled);
        if (!SetupDiGetDeviceInterfaceDetailW(list.handle, &interfaceData, detail, required, nullptr, &filled)) {
            const auto error = GetLastError();
            if (const auto id = serviceContainer(list.handle, instance)) {
                candidates.unresolvedPaths.emplace(*id, error);
                continue;
            }
            candidates.error = error;
            return candidates;
        }
        const auto id = serviceContainer(list.handle, filled);
        if (!id) {
            // An unresolved owner might be a second service of any target.
            candidates.error = ERROR_NOT_FOUND;
            return candidates;
        }
        candidates.paths[*id].insert(detail->DevicePath);
    }
    // Fail closed if Windows ever enumerates more than our bounded limit.
    candidates.error = ERROR_BUFFER_OVERFLOW;
    return candidates;
}

Status osStatus(unsigned code)
{
    if (code == ERROR_ACCESS_DENIED || code == ERROR_SHARING_VIOLATION ||
        code == ERROR_PRIVILEGE_NOT_HELD || code == ERROR_LOCK_VIOLATION) return Status::busy;
    if (code == ERROR_SEM_TIMEOUT || code == ERROR_TIMEOUT) return Status::timeout;
    if (code == ERROR_DEVICE_NOT_CONNECTED || code == ERROR_NO_SUCH_DEVICE) return Status::offline;
    return Status::unavailable;
}

Sample hresultFailure(BleBatteryDetail stage, HRESULT hr)
{
    const auto code = static_cast<unsigned>(hr);
    const auto status = HRESULT_FACILITY(hr) == FACILITY_WIN32 ? osStatus(HRESULT_CODE(hr)) : Status::unavailable;
    return bleFailure(stage, status, code);
}

Sample readCharacteristic(const std::wstring& id, const GUID& serviceUuid,
    unsigned shortUuid, std::span<std::uint8_t> output, size_t& size)
{
    const GattApi api;
    if (!api.characteristics || !api.value) return bleFailure(BleBatteryDetail::platform_unavailable);
    const auto interfaces = enumerate(serviceUuid);
    if (interfaces.error) {
        return bleFailure(BleBatteryDetail::interface_enumeration_failed,
            osStatus(interfaces.error), interfaces.error);
    }
    if (const auto unresolved = interfaces.unresolvedPaths.find(id); unresolved != interfaces.unresolvedPaths.end())
        return bleFailure(BleBatteryDetail::interface_enumeration_failed, osStatus(unresolved->second), unresolved->second);
    const auto found = interfaces.paths.find(id);
    if (found == interfaces.paths.end()) return bleFailure(BleBatteryDetail::no_service);
    if (found->second.size() != 1) return bleFailure(BleBatteryDetail::multiple_services);
    const ServiceHandle service{CreateFileW(found->second.begin()->c_str(), GENERIC_READ,
        FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr)};
    if (service.handle == INVALID_HANDLE_VALUE) {
        const auto error = GetLastError();
        return bleFailure(BleBatteryDetail::open_service_failed, osStatus(error), error);
    }

    // For a service handle, Windows resolves the implicit parent service.
    std::array<BTH_LE_GATT_CHARACTERISTIC, 48> values{};
    USHORT count = 0;
    const auto result = api.characteristics(service.handle, nullptr, static_cast<USHORT>(values.size()),
        values.data(), &count, BLUETOOTH_GATT_FLAG_NONE);
    if (FAILED(result)) return hresultFailure(BleBatteryDetail::characteristic_query_failed, result);
    if (count > values.size()) return bleFailure(BleBatteryDetail::characteristic_query_failed, Status::bad_report);
    BTH_LE_GATT_CHARACTERISTIC* characteristic = nullptr;
    for (auto& value : std::span(values).first(count)) {
        const auto& uuid = value.CharacteristicUuid;
        const bool matches = uuid.IsShortUuid ? uuid.Value.ShortUuid == shortUuid :
            IsEqualGUID(uuid.Value.LongUuid, bluetoothUuid(shortUuid));
        if (!matches) continue;
        if (characteristic) return bleFailure(BleBatteryDetail::multiple_battery_levels);
        characteristic = &value;
    }
    if (!characteristic) return bleFailure(BleBatteryDetail::no_battery_level);
    if (!characteristic->IsReadable) return bleFailure(BleBatteryDetail::battery_level_not_readable);
    struct ValueBuffer {
        ULONG size;
        UCHAR payload[64];
    };
    static_assert(alignof(ValueBuffer) == alignof(BTH_LE_GATT_CHARACTERISTIC_VALUE));
    static_assert(offsetof(ValueBuffer, payload) == offsetof(BTH_LE_GATT_CHARACTERISTIC_VALUE, Data));
    ValueBuffer value{};
    const auto read = api.value(service.handle, characteristic, sizeof(value),
        reinterpret_cast<PBTH_LE_GATT_CHARACTERISTIC_VALUE>(&value), nullptr,
        BLUETOOTH_GATT_FLAG_FORCE_READ_FROM_DEVICE);
    if (FAILED(read)) return hresultFailure(BleBatteryDetail::read_failed, read);
    if (value.size == 0 || value.size > output.size()) {
        return bleFailure(BleBatteryDetail::invalid_value, Status::bad_report);
    }
    size = value.size;
    std::copy_n(value.payload, size, output.begin());
    return {Status::current};
}

Sample readBatteryNow(const std::wstring& id, bool requireIndependentConnection)
{
    if (requireIndependentConnection) {
        const auto evidence = inspectWindowsBleConnection(id);
        if (evidence != WindowsConnectionEvidence::connected)
            return bleFailure(BleBatteryDetail::connection_unverified,
                evidence == WindowsConnectionEvidence::disconnected ? Status::offline : Status::unavailable);
    }
    std::array<std::uint8_t, 1> bytes{};
    size_t count{};
    const auto outcome = readCharacteristic(id, batteryService, 0x2a19, bytes, count);
    if (outcome.status != Status::current) return outcome;
    return parseBleBatteryLevel(std::span(bytes).first(count));
}

BleFirmwareResult firmwareFailure(Sample sample)
{
    return {sample.status == Status::busy || sample.status == Status::timeout ?
        BleFirmwareStatus::busy : BleFirmwareStatus::unsupported, {}, sample.detail, sample.report};
}

BleFirmwareResult readFirmwareNow(const std::wstring& id)
{
    std::array<std::uint8_t, 64> bytes{};
    size_t count{};
    const auto outcome = readCharacteristic(id, deviceInformationService, 0x2a26, bytes, count);
    if (outcome.status != Status::current) return firmwareFailure(outcome);
    auto revision = parseBleFirmwareRevision(std::span(bytes).first(count));
    if (!revision) return firmwareFailure(bleFailure(BleBatteryDetail::invalid_value));
    return {BleFirmwareStatus::ready, std::move(*revision)};
}

bool validId(const std::wstring& containerId)
{
    GUID guid{};
    return containerId.size() == 38 && containerId.front() == L'{' && containerId.back() == L'}' &&
        SUCCEEDED(CLSIDFromString(containerId.c_str(), &guid)) && !IsEqualGUID(guid, GUID{});
}

template <class Value>
struct Work {
    struct Completed {
        Value value;
        Clock::time_point finished;
    };
    std::mutex mutex;
    std::condition_variable finished;
    std::wstring active;
    bool discardActive{};
    std::map<std::wstring, Completed> completed;
};

// Both operations share one process-wide native radio slot. Blocking Windows
// IO never runs on the collector thread or outlives the worker-owned state.
std::atomic_flag radioInUse = ATOMIC_FLAG_INIT;
std::atomic<Clock::duration::rep> radioStarted{};
constexpr auto waitBudget = 100ms;
constexpr auto batteryResultLifetime = 8s;

template <class Value>
std::shared_ptr<Work<Value>> sharedWork()
{
    static const auto shared = std::make_shared<Work<Value>>();
    return shared;
}

template <class Value>
std::optional<Value> takeCompletedLocked(Work<Value>& work, const std::wstring& id, Clock::duration lifetime)
{
    const auto cutoff = Clock::now() - lifetime;
    std::erase_if(work.completed, [cutoff](const auto& pair) { return pair.second.finished < cutoff; });
    auto ready = work.completed.extract(id);
    if (ready.empty()) return {};
    return std::move(ready.mapped().value);
}

template <class Value, class Read, class Accept>
Value runWorker(const std::wstring& id, Clock::duration lifetime,
    Read read, const Value& pending, const Value& busy, const Value& failure, Accept accept, Clock::duration wait)
{
    auto work = sharedWork<Value>();
    std::unique_lock lock(work->mutex);
    if (auto ready = takeCompletedLocked(*work, id, lifetime); ready && accept(*ready)) return std::move(*ready);
    if (!work->active.empty()) return work->active == id ? pending : busy;
    work->active = id;
    work->discardActive = false;
    if (radioInUse.test_and_set()) {
        work->active.clear();
        return busy;
    }
    radioStarted.store(Clock::now().time_since_epoch().count());
    try {
        std::thread([work, id, read, failure] {
            Value result = failure;
            try { result = read(id); } catch (...) { /* Never unwind a native worker. */ }
            {
                std::scoped_lock lock(work->mutex);
                try {
                    if (!work->discardActive) {
                        if (work->completed.size() >= 16) {
                            const auto oldest = std::ranges::min_element(work->completed, {},
                                [](const auto& pair) { return pair.second.finished; });
                            work->completed.erase(oldest);
                        }
                        work->completed.emplace(id, typename Work<Value>::Completed{std::move(result), Clock::now()});
                    }
                } catch (...) { /* Release the slot even on allocation failure. */ }
                work->active.clear();
                radioStarted.store(0);
                radioInUse.clear();
            }
            work->finished.notify_one();
        }).detach();
    } catch (...) {
        work->active.clear();
        radioStarted.store(0);
        radioInUse.clear();
        return failure;
    }
    if (wait != Clock::duration::zero()) {
        work->finished.wait_for(lock, wait, [&] { return work->active != id; });
        if (auto ready = takeCompletedLocked(*work, id, lifetime); ready && accept(*ready)) return std::move(*ready);
    }
    return pending;
}

} // namespace

BleServiceInventory inspectBleBatteryServices()
{
    const auto interfaces = enumerate(batteryService);
    BleServiceInventory result{interfaces.error == 0, interfaces.error, {}, interfaces.unresolvedPaths};
    for (const auto& [container, paths] : interfaces.paths)
        if (result.canAssess(container)) result.counts.emplace(container, static_cast<unsigned>(paths.size()));
    return result;
}

std::set<std::wstring> bleBatteryContainers()
{
    std::set<std::wstring> result;
    for (const auto& [container, count] : inspectBleBatteryServices().counts) {
        if (count == 1) result.insert(container);
    }
    return result;
}

std::set<std::wstring> bleFirmwareContainers()
{
    std::set<std::wstring> result;
    const auto interfaces = enumerate(deviceInformationService);
    if (interfaces.error != 0) return result;
    for (const auto& [id, paths] : interfaces.paths) {
        if (paths.size() == 1 && !interfaces.unresolvedPaths.contains(id)) result.insert(id);
    }
    return result;
}

BleBatteryResult readBleBattery(const std::wstring& containerId, const BleBatteryOrigin& origin)
{
    if (!validId(containerId)) return {bleFailure(BleBatteryDetail::invalid_container), origin};
    return runWorker(normalized(containerId), batteryResultLifetime,
        [origin](const auto& id) { return BleBatteryResult{readBatteryNow(id, origin.requireIndependentConnection), origin}; },
        BleBatteryResult{bleFailure(BleBatteryDetail::read_pending, Status::busy), origin},
        BleBatteryResult{bleFailure(BleBatteryDetail::worker_busy, Status::busy), origin},
        BleBatteryResult{bleFailure(BleBatteryDetail::read_failed), origin},
        [&](const auto& completed) { return matchesBleBatteryOrigin(completed.origin, origin); },
        origin.generation >= 0 ? Clock::duration::zero() : waitBudget);
}

std::optional<BleBatteryResult> takeBleBatteryResult(const std::wstring& containerId, const BleBatteryOrigin& origin)
{
    if (!validId(containerId)) return {};
    auto work = sharedWork<BleBatteryResult>();
    std::scoped_lock lock(work->mutex);
    auto result = takeCompletedLocked(*work, normalized(containerId), batteryResultLifetime);
    return result && matchesBleBatteryOrigin(result->origin, origin) ? std::move(result) : std::nullopt;
}

void discardBleBatteryResult(const std::wstring& containerId)
{
    auto work = sharedWork<BleBatteryResult>();
    const auto id = normalized(containerId);
    std::scoped_lock lock(work->mutex);
    work->completed.erase(id);
    if (work->active == id) work->discardActive = true;
}

bool bleBatteryWorkExpired(Clock::duration maximumAge)
{
    const auto started = radioStarted.load();
    return started != 0 && Clock::now().time_since_epoch() - Clock::duration(started) >= maximumAge;
}

BleFirmwareResult readBleFirmware(const std::wstring& containerId)
{
    if (!validId(containerId)) return firmwareFailure(bleFailure(BleBatteryDetail::invalid_container));
    return runWorker(normalized(containerId), 24s, readFirmwareNow,
        BleFirmwareResult{BleFirmwareStatus::pending, {}, static_cast<unsigned>(BleBatteryDetail::read_pending)},
        BleFirmwareResult{BleFirmwareStatus::busy, {}, static_cast<unsigned>(BleBatteryDetail::worker_busy)},
        firmwareFailure(bleFailure(BleBatteryDetail::read_failed)), [](const auto&) { return true; }, waitBudget);
}

} // namespace pm
