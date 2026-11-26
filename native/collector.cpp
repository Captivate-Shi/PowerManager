#include "hid.hpp"
#include "hid_batches.hpp"
#include "discovery_job.hpp"
#include "discovery_scope.hpp"
#include "diagnostic_scope.hpp"
#include "razer_pro_receiver.hpp"
#include "peripheral_protocol.hpp"
#include "device_search.hpp"
#include "ble_battery.hpp"
#include "battery_fallback.hpp"
#include "gamepad_battery.hpp"
#include "rfcomm_battery_transport.hpp"
#include "device_identity.hpp"
#include "json.hpp"

#include <windows.h>
#include <bluetoothapis.h>
#include <psapi.h>
#include <dwmapi.h>
#include <shellapi.h>
#include <wtsapi32.h>
#include <roapi.h>
#include <winstring.h>
#include <algorithm>
#include <chrono>
#include <iostream>
#include <deque>
#include <future>
#include <memory>
#include <tuple>
#include <cstdint>
#include <utility>
#include <stdexcept>
#include <set>
#include <cwctype>

using nlohmann::json;
using namespace pm;
using namespace std::chrono_literals;

// WinRT ABI declarations from windows.ui.notifications.h. Keep external linkage
// for these COM interfaces so GCC emits virtual calls to the Windows implementation.
namespace notification_abi {
struct ToastManagerStatics5 : IInspectable {
    virtual HRESULT STDMETHODCALLTYPE GetDefault(IInspectable**) = 0;
};
enum class NotificationMode : int { unrestricted = 0 };
struct ToastManagerForUser3 : IInspectable {
    virtual HRESULT STDMETHODCALLTYPE get_NotificationMode(NotificationMode*) = 0;
};
constexpr GUID staticsId{0xd6f5f569, 0xd40d, 0x407c, {0x89,0x89,0x88,0xca,0xb4,0x2c,0xfd,0x14}};
constexpr GUID modeId{0x3efcb176, 0x6cc1, 0x56dc, {0x97,0x3b,0x25,0x1f,0x7a,0xac,0xb1,0xc5}};
}

namespace {
std::string utf8(std::wstring_view value)
{
    if (value.empty()) return {};
    const int size = WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()),
                                         nullptr, 0, nullptr, nullptr);
    std::string text(size, '\0');
    WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), text.data(), size, nullptr, nullptr);
    return text;
}

std::wstring wide(const std::string& text)
{
    if (text.empty()) return {};
    const int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(), static_cast<int>(text.size()),
                                         nullptr, 0);
    if (!size) throw std::runtime_error("Invalid UTF-8");
    std::wstring value(size, L'\0');
    MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(), static_cast<int>(text.size()), value.data(), size);
    return value;
}

json reading(const std::optional<Reading>& value)
{
    if (!value) return nullptr;
    const char* power[] = {"discharging", "charging", "full", "unknown"};
    return {{"low", value->low}, {"high", value->high}, {"raw", value->raw},
            {"power", power[static_cast<int>(value->power)]},
            {"source", value->source == ReadingSource::hid ? "hid" : value->source == ReadingSource::ble ? "ble" :
                value->source == ReadingSource::hid_voltage ? "hid_voltage" :
                value->source == ReadingSource::bluetooth_vendor ? "bluetooth_vendor" : "windows"}};
}

json sample(const Sample& value)
{
    const char* status[] = {"current", "offline", "no_radio_reply", "busy", "timeout", "bad_report",
                            "unavailable", "basic_bluetooth", "charging_error"};
    return {{"status", status[static_cast<int>(value.status)]}, {"reading", reading(value.reading)},
            {"reason", value.millivolts && !value.reading ? "仅上报电压，暂无可靠百分比" :
                value.status == Status::unavailable &&
                ((value.feature == 0x1000 && (value.detail == 1 || value.detail == 2 || value.detail == 4)) ||
                 (value.feature == 0x0a && value.report == 6 && value.detail == 255) ||
                 (value.feature == 0x30 && value.report == 0x30 && value.detail == 1)) ?
                "设备充电中，未上报实时百分比" : utf8(statusName(value.status))},
            {"reportId", value.report}, {"detail", value.detail}, {"feature", value.feature},
            {"millivolts", value.millivolts ? json(*value.millivolts) : json(nullptr)}};
}

template<class T> struct Com {
    T* value{};
    ~Com() { if (value) value->Release(); }
};

std::optional<bool> desktopNotificationsAllowed()
{
    using namespace notification_abi;
    constexpr wchar_t className[] = L"Windows.UI.Notifications.ToastNotificationManager";
    HSTRING_HEADER header{};
    HSTRING name{};
    Com<ToastManagerStatics5> factory;
    Com<IInspectable> manager;
    Com<ToastManagerForUser3> mode;
    NotificationMode result{};
    if (FAILED(WindowsCreateStringReference(className, ARRAYSIZE(className) - 1, &header, &name)) ||
        FAILED(RoGetActivationFactory(name, staticsId, reinterpret_cast<void**>(&factory.value))) || !factory.value ||
        FAILED(factory.value->GetDefault(&manager.value)) || !manager.value ||
        FAILED(manager.value->QueryInterface(modeId, reinterpret_cast<void**>(&mode.value))) || !mode.value ||
        FAILED(mode.value->get_NotificationMode(&result))) return std::nullopt;
    return result == NotificationMode::unrestricted;
}

bool lockedSession()
{
    WTSINFOEXW* data{};
    DWORD bytes{};
    const bool available = WTSQuerySessionInformationW(WTS_CURRENT_SERVER_HANDLE, WTS_CURRENT_SESSION,
        WTSSessionInfoEx, reinterpret_cast<LPWSTR*>(&data), &bytes);
    const bool locked = available && bytes >= sizeof(*data) && data->Level == 1 &&
        data->Data.WTSInfoExLevel1.SessionFlags == WTS_SESSIONSTATE_LOCK;
    if (data) WTSFreeMemory(data);
    return locked;
}

bool fullScreen(HWND window, const MONITORINFO& monitor)
{
    if (!window || window == GetDesktopWindow() || window == GetShellWindow() ||
        !IsWindowVisible(window) || IsIconic(window)) return false;
    wchar_t className[64]{};
    GetClassNameW(window, className, 64);
    const std::wstring_view name(className);
    if (name == L"WorkerW" || name == L"Progman" || name == L"Shell_TrayWnd" ||
        name == L"Shell_SecondaryTrayWnd") return false;
    const auto style = GetWindowLongPtrW(window, GWL_STYLE);
    if (IsZoomed(window) && ((style & WS_CAPTION) == WS_CAPTION || (style & WS_THICKFRAME))) return false;
    RECT bounds{};
    if (FAILED(DwmGetWindowAttribute(window, DWMWA_EXTENDED_FRAME_BOUNDS, &bounds, sizeof(bounds))) &&
        !GetWindowRect(window, &bounds)) return false;
    const auto& screen = monitor.rcMonitor;
    return std::abs(bounds.left - screen.left) <= 2 && std::abs(bounds.right - screen.right) <= 2 &&
        std::abs(bounds.top - screen.top) <= 2 && std::abs(bounds.bottom - screen.bottom) <= 2;
}

json scene()
{
    QUERY_USER_NOTIFICATION_STATE shellState{};
    const bool shellKnown = SUCCEEDED(SHQueryUserNotificationState(&shellState));
    const HWND window = GetForegroundWindow();
    MONITORINFO monitor{sizeof(monitor), {}, {}, 0};
    const bool hasMonitor = window && GetMonitorInfoW(MonitorFromWindow(window, MONITOR_DEFAULTTONULL), &monitor);
    const auto allowed = desktopNotificationsAllowed();
    // The legacy BUSY state can persist on an ordinary desktop. Prefer an explicit
    // WinRT notification mode and use the foreground window to detect fullscreen.
    const bool quiet = lockedSession() || (shellKnown && (shellState == QUNS_NOT_PRESENT ||
        shellState == QUNS_PRESENTATION_MODE || shellState == QUNS_QUIET_TIME ||
        (shellState == QUNS_BUSY && !allowed.value_or(false))));
    const bool fullscreen = (shellKnown && shellState == QUNS_RUNNING_D3D_FULL_SCREEN) ||
        (hasMonitor && fullScreen(window, monitor));
    json point = nullptr;
    if (hasMonitor) point = {{"x", (monitor.rcMonitor.left + monitor.rcMonitor.right) / 2},
                             {"y", (monitor.rcMonitor.top + monitor.rcMonitor.bottom) / 2}};
    return {{"mode", quiet ? "quiet" : fullscreen ? "fullscreen" : "desktop"},
            {"allowed", allowed ? json(*allowed) : json(nullptr)}, {"point", point},
            {"shellAccepts", shellKnown && shellState == QUNS_ACCEPTS_NOTIFICATIONS}};
}

// Use the Windows Bluetooth cache. Polling does not start an active radio inquiry.
std::map<unsigned long long, bool> bluetoothConnections()
{
    BLUETOOTH_DEVICE_SEARCH_PARAMS options{};
    options.dwSize = sizeof(options);
    options.fReturnConnected = TRUE;
    options.fReturnRemembered = TRUE;
    options.fReturnAuthenticated = TRUE;
    BLUETOOTH_DEVICE_INFO info{};
    info.dwSize = sizeof(info);
    std::map<unsigned long long, bool> result;
    const auto search = BluetoothFindFirstDevice(&options, &info);
    if (!search) return result;
    do {
        auto& connected = result[info.Address.ullLong];
        connected = connected || info.fConnected;
    } while (BluetoothFindNextDevice(search, &info));
    BluetoothFindDeviceClose(search);
    return result;
}

bool bluetoothDisconnected(const Device& device, const std::map<unsigned long long, bool>& links)
{
    if (device.transport != Transport::dualsense_bluetooth || !device.key.starts_with(L"dualsense:")) return false;
    const auto address = std::stoull(device.key.substr(10), nullptr, 16);
    const auto found = links.find(address);
    return found != links.end() && !found->second;
}

unsigned long long ticks(const FILETIME& value)
{
    return (static_cast<unsigned long long>(value.dwHighDateTime) << 32) | value.dwLowDateTime;
}

json processMetrics()
{
    const auto process = GetCurrentProcess();
    FILETIME created{}, exited{}, kernel{}, user{};
    DWORD handles{};
    PROCESS_MEMORY_COUNTERS_EX memory{};
    memory.cb = sizeof(memory);
    const auto haveMemory = GetProcessMemoryInfo(process, reinterpret_cast<PROCESS_MEMORY_COUNTERS*>(&memory), sizeof(memory));
    const auto haveTimes = GetProcessTimes(process, &created, &exited, &kernel, &user);
    const auto haveHandles = GetProcessHandleCount(process, &handles);
    return {{"pid", GetCurrentProcessId()},
        {"cpuSeconds", haveTimes ? json((ticks(kernel) + ticks(user)) / 10000000.0) : json(nullptr)},
        {"rssBytes", haveMemory ? json(memory.WorkingSetSize) : json(nullptr)},
        {"privateBytes", haveMemory ? json(memory.PrivateUsage) : json(nullptr)},
        {"handles", haveHandles ? json(handles) : json(nullptr)}};
}

bool genericDeviceLabel(std::string_view name)
{
    return name.starts_with("兼容") || name == "Logitech HID++ 外设" || name == "HID 键盘" ||
        name == "HID Keyboard Device" || name == "HID-compliant mouse" || name == "USB Input Device" ||
        name == "HID-compliant device" || name == "USB 输入设备" || name == "符合 HID 标准的鼠标";
}

std::wstring endpointContainer(std::wstring_view value)
{
    const auto colon = value.find(L':');
    if (colon == std::wstring_view::npos || colon == 0 ||
        !std::ranges::all_of(value.substr(0, colon), [](wchar_t c) { return c >= L'0' && c <= L'9'; })) return {};
    const auto guid = value.substr(colon + 1);
    if (guid.size() != 38 || guid.front() != L'{' || guid.back() != L'}') return {};
    std::wstring result(guid);
    std::ranges::transform(result, result.begin(), [](wchar_t c) { return std::towlower(c); });
    return result;
}

std::set<std::wstring> claimedContainers(const std::vector<Device>& endpoints)
{
    std::set<std::wstring> seen;
    for (const auto& endpoint : endpoints) {
        auto id = endpointContainer(endpoint.endpointKey);
        if (id.empty()) id = endpointContainer(endpoint.parentEndpoint);
        if (!id.empty()) seen.insert(std::move(id));
    }
    return seen;
}

// Only an endpoint's own container can provide a Windows/BAS fallback.
// Shared receiver parents cannot attribute battery to an individual child.
std::map<std::wstring, std::wstring> nativeContainerOwners(const std::vector<Device>& endpoints)
{
    std::map<std::wstring, std::wstring> owners;
    for (const auto& endpoint : endpoints) {
        const auto container = endpointContainer(endpoint.endpointKey);
        if (container.empty()) continue;
        auto [it, inserted] = owners.try_emplace(container, endpoint.key);
        if (!inserted && it->second != endpoint.key) it->second.clear();
    }
    return owners;
}

using ReportTargets = std::map<std::wstring, std::string>;

std::string reportTarget(ReportTargets& targets, const std::wstring& id)
{
    const auto found = targets.find(id);
    if (found != targets.end()) return found->second;
    if (targets.size() >= 512) return {};
    const auto value = "W" + std::to_string(targets.size() + 1);
    targets.emplace(id, value);
    return value;
}

json gamepadInventory()
{
    const auto pads = inspectGamepadBatteries();
    const auto serialize = [](const auto& source) {
        json rows = json::array();
        for (const auto& value : source) {
            const char* power[] = {"discharging", "charging", "full", "unknown"};
            rows.push_back({{"slot", value.slot}, {"vid", value.vid}, {"pid", value.pid},
                {"detail", value.detail}, {"status", gamepadBatteryStatusName(value.status)},
                {"level", gamepadBatteryLevelName(value.level)}, {"power", power[static_cast<int>(value.power)]},
                {"percent", value.percent ? json(*value.percent) : json(nullptr)},
                {"remainingMwh", value.remainingMwh ? json(*value.remainingMwh) : json(nullptr)},
                {"fullMwh", value.fullMwh ? json(*value.fullMwh) : json(nullptr)}});
        }
        return rows;
    };
    return {{"wgiStatus", pads.wgiStatus}, {"xinputStatus", pads.xinputStatus},
        {"windowsGamingInput", serialize(pads.windowsGamingInput)}, {"xinput", serialize(pads.xinput)}};
}

json inventory(ReportTargets& targets, const std::vector<Device>& endpoints = {})
{
    std::vector<HidInterface> descriptors;
    HidMonitor monitor;
    monitor.enumerate(false, &descriptors);
    const auto devices = findWindowsDevices();
    const auto owners = nativeContainerOwners(endpoints);
    std::set<std::wstring> sharedReceivers;
    for (const auto& endpoint : endpoints) {
        const auto id = endpointContainer(endpoint.parentEndpoint);
        if (!id.empty()) sharedReceivers.insert(id);
    }
    std::set<std::wstring> discovered;
    if (devices) for (const auto& device : *devices) discovered.insert(device.id);
    const auto scopedTarget = [&](const std::wstring& id) -> std::string {
        const auto key = diagnosticScopeKey(id, owners, sharedReceivers, discovered);
        return key.empty() ? std::string{} : reportTarget(targets, key);
    };
    json hid = json::array();
    for (const auto& item : descriptors) {
        const auto descriptorState = !item.descriptorAvailable ? "unavailable" :
            item.provider ? "candidate" : item.providerRecognized ? "descriptor_mismatch" : "no_provider";
        hid.push_back({{"target", scopedTarget(item.physicalContainer)}, {"vid", item.vid}, {"pid", item.pid},
            {"revision", item.revision}, {"interfaceNumber", item.interfaceNumber},
            {"usagePage", item.page}, {"usage", item.usage},
            {"inputBytes", item.inputLength}, {"outputBytes", item.outputLength}, {"featureBytes", item.featureLength},
            {"descriptorAvailable", item.descriptorAvailable}, {"descriptorState", descriptorState},
            {"candidateProvider", item.provider ? json(utf8(providerName(*item.provider))) : json(nullptr)}});
    }
    const auto ble = inspectBleBatteryServices();
    json windows = json::array();
    if (devices) {
        for (const auto& device : *devices) {
            if (windows.size() >= 256) break;
            const Sample observed{Status::unavailable, device.battery, 0, static_cast<unsigned>(device.batteryDetail)};
            const auto found = ble.counts.find(device.id);
            const auto services = found == ble.counts.end() ? 0u : found->second;
            const bool bleScoped = ble.canAssess(device.id);
            windows.push_back({{"target", scopedTarget(device.id)}, {"connection", utf8(device.connection)},
                {"connected", device.connected}, {"battery", reading(device.battery)},
                {"inputOrHeadset", device.inputOrHeadset}, {"knownBluetooth", device.knownBluetooth},
                {"reasonCode", windowsBatteryReason(observed)},
                {"bleBasListed", bleScoped && services == 1},
                {"bleServiceCount", bleScoped && device.knownBluetooth ? json(services) : json(nullptr)},
                {"bleReasonCode", !bleScoped ? "ble_interface_enumeration_failed" :
                    services > 1 ? "ble_multiple_battery_services" : services == 1 ? "ble_candidate" :
                    device.connection == L"蓝牙" ? "ble_no_battery_service" : "ble_not_bluetooth"}});
        }
    }
    return {{"schemaVersion", 3}, {"hidInterfaces", hid}, {"windowsDevices", windows},
        {"bleQuerySucceeded", ble.complete},
        {"windowsQuerySucceeded", devices.has_value()}, {"bleEnumerationError", ble.error}, {"gamepads", gamepadInventory()}};
}

const wchar_t* label(const Device& device)
{
    return device.label.empty() ? deviceName(device.transport) : device.label.c_str();
}

const char* art(const Device& device)
{
    if (isDualSense(device.transport)) return "dualsense";
    if (device.transport == Transport::sony_gamepad_usb || device.transport == Transport::sony_gamepad_bluetooth)
        return device.pid == 0x0df2 ? "dualsense" : "controller";
    if (isEightBitDoHid(device.transport) || isSwitchHid(device.transport) ||
        device.transport == Transport::gamesir_super_nova_receiver || device.transport == Transport::gamepad_flydigi ||
        device.transport == Transport::gamepad_nova2_lite_usb) return "controller";
    if (isVgn(device.transport) || device.transport == Transport::razer_shared_keyboard ||
        device.transport == Transport::aula_f87v2d_receiver || device.transport == Transport::langtu_t98_receiver || device.transport == Transport::atk_v75x_usb ||
        device.transport == Transport::rog_keyboard_receiver) return "keyboard";
    if (device.transport == Transport::razer_pro_receiver && razerKeyboardReceiver(device.vid, device.pid)) return "keyboard";
    if (device.transport == Transport::usb_wireless_headset) return "headset";
    if (device.transport == Transport::razer_receiver || device.transport == Transport::razer_pro_receiver ||
        device.transport == Transport::rapoo_receiver ||
        device.transport == Transport::logitech_usb || device.transport == Transport::supported_mouse_receiver ||
        device.transport == Transport::mchose_g3v2_receiver || device.transport == Transport::mchose_a7v2pro_usb ||
        device.transport == Transport::aula_sc580_receiver || device.transport==Transport::verified_mouse_usb ||
        device.transport==Transport::verified_mouse_receiver) return "mouse";
    if (device.transport == Transport::logitech_receiver) {
        if (device.kind == 0 || device.kind == 2) return "keyboard";
        if (device.kind >= 3 && device.kind <= 5) return "mouse";
    }
    return "unknown";
}

std::optional<rfcomm_battery::Model> vendorHeadphone(const FoundDevice& device)
{
    if (!device.connected || !device.knownBluetooth) return {};
    return rfcomm_battery::matchModel(device.name);
}

class Collector {
public:
    json execute(const json& request)
    {
        const auto action = request.at("action").get<std::string>();
        if (action == "hello") return {{"protocol", 1}, {"doubleClickMs", GetDoubleClickTime()}};
        if (action == "scene") return scene();
        if (action == "metrics") return processMetrics();
        if (action == "tone") return {{"played", Beep(880, 145) != FALSE}};
        if (action == "discover") return discover();
        if (action == "compatibility") return compatibility();
        if (action == "diagnostic_devices") return diagnosticDevices();
        if (action == "diagnostic_firmware") return diagnosticFirmware(wide(request.at("deviceId").get<std::string>()));
        if (action == "poll") {
            const auto now = std::chrono::steady_clock::now();
            const bool vendorExpired = vendorTask_ && now - vendorTask_->started >= 5min &&
                vendorTask_->result.wait_for(0ms) != std::future_status::ready;
            if (request.contains("generation") &&
                (hasExpiredHidWork(now) || hasExpiredDiscovery(now) || vendorExpired || bleBatteryWorkExpired(5min))) {
                return {{"restartRequired", true}};
            }
            auto rows = poll(request);
            if (!request.contains("generation")) return rows;
            const bool hidPending = std::ranges::any_of(hidLanes_, [](const auto& entry) {
                const auto& task = entry.second.task;
                return task.valid() && task.wait_for(0ms) != std::future_status::ready;
            });
            const bool vendorPending = vendorTask_ &&
                vendorTask_->result.wait_for(0ms) != std::future_status::ready;
            json absent = json::array();
            for (const auto& id : discoveryOmissions_.absent) absent.push_back(utf8(id));
            return {{"rows", std::move(rows)}, {"discoveryPending", discoveryPending_},
                {"discoveryAbsent", std::move(absent)},
                {"workPending", hidPending || vendorPending || hasOutstandingDiscovery() ||
                bleBatteryWorkExpired(std::chrono::steady_clock::duration::zero())}};
        }
        throw std::runtime_error("Unknown action");
    }

private:
    HidMonitor monitor_;
    std::deque<json> recent_;
    std::deque<json> collectionAttempts_;
    ReportTargets targets_;
    std::set<std::wstring> bleContainers_;
    std::chrono::steady_clock::time_point bleRefresh_{};
    std::chrono::steady_clock::time_point windowsRefresh_{};
    std::vector<FoundDevice> windowsDevices_;
    std::map<std::wstring, std::wstring> diagnosticFirmwareTargets_;
    using Time = std::chrono::steady_clock::time_point;
    struct VendorAttempt {
        rfcomm_battery::Result result;
        Time started;
        Time finished;
    };
    struct VendorTask {
        std::wstring container;
        rfcomm_battery::Model model;
        std::future<VendorAttempt> result;
        std::int64_t generation;
        std::optional<std::int64_t> regularSequence;
        Time started;
        bool stillConnected{true};
    };
    std::optional<VendorTask> vendorTask_;
    std::map<std::wstring, Time> vendorDue_;

    const std::vector<FoundDevice>& defaultWindowsDevices(bool force)
    {
        const auto now = std::chrono::steady_clock::now();
        if (force || now >= windowsRefresh_) {
            if (auto observed = findWindowsDevices()) windowsDevices_ = std::move(*observed);
            windowsRefresh_ = now + 30s;
        }
        return windowsDevices_;
    }

    json diagnosticDevices()
    {
        json result = json::array();
        std::set<std::wstring> seen;
        diagnosticFirmwareTargets_.clear();
        const auto firmwareServices = bleFirmwareContainers();
        auto firmwareCandidate = [&](const std::wstring& id, const std::wstring& container) {
            if (container.empty() || !firmwareServices.contains(container)) return false;
            diagnosticFirmwareTargets_.try_emplace(id, container);
            return true;
        };
        for (const auto& endpoint : endpoints_) {
            if (result.size() >= 128) break;
            if (!seen.insert(endpoint.key).second) continue;
            // Shared protocol fallback labels are not exact model names.
            const auto name = utf8(label(endpoint));
            const bool generic = genericDeviceLabel(name);
            const bool canReadFirmware = endpoint.transport == Transport::dualsense_bluetooth &&
                firmwareCandidate(endpoint.key, endpointContainer(endpoint.endpointKey));
            result.push_back({{"id", utf8(endpoint.key)}, {"target", reportTarget(targets_, endpoint.key)},
                {"label", name}, {"model", generic ? json(nullptr) : json(name)},
                {"connection", utf8(transportName(endpoint.transport))}, {"revision", endpoint.revision},
                {"connected", true}, {"firmwareReadable", canReadFirmware}});
        }
        const auto claimed = claimedContainers(endpoints_);
        std::set<std::wstring> logitechReceivers;
        for (const auto& attempt : receiverAttempts()) {
            if (auto receiver = endpointContainer(attempt.receiverEndpoint); !receiver.empty())
                logitechReceivers.insert(std::move(receiver));
        }
        for (const auto& device : defaultWindowsDevices(true)) {
            if (result.size() >= 128) break;
            // A selected receiver can explain a failed slot search even when
            // another child on that receiver already has a monitored row.
            if ((claimed.contains(device.id) && !logitechReceivers.contains(device.id)) ||
                !seen.insert(device.id).second) continue;
            const bool canReadFirmware = device.connected && device.knownBluetooth &&
                firmwareCandidate(device.id, device.id);
            const auto name = utf8(device.name);
            result.push_back({{"id", utf8(device.id)}, {"target", reportTarget(targets_, device.id)},
                {"label", name}, {"model", genericDeviceLabel(name) ? json(nullptr) : json(name)}, {"connection", utf8(device.connection)},
                {"connected", device.connected}, {"firmwareReadable", canReadFirmware}});
        }
        return result;
    }

    json diagnosticFirmware(const std::wstring& id)
    {
        const auto found = diagnosticFirmwareTargets_.find(id);
        if (found == diagnosticFirmwareTargets_.end()) return {{"status", "unavailable"}};
        const auto connection = readWindowsDevice(found->second);
        const auto detail = static_cast<WindowsBatteryDetail>(connection.detail);
        if (!connection.reading && detail != WindowsBatteryDetail::missingProperty &&
            detail != WindowsBatteryDetail::invalidPercent) return {{"status", "unavailable"}};
        const auto result = readBleFirmware(found->second);
        switch (result.status) {
        case BleFirmwareStatus::pending: return {{"status", "pending"}};
        case BleFirmwareStatus::busy: return {{"status", "busy"}};
        case BleFirmwareStatus::ready: return {{"status", "ready"}, {"firmware", result.revision}};
        default: return {{"status", "unavailable"}};
        }
    }

    const std::set<std::wstring>& refreshBleCandidates(bool force = false)
    {
        const auto now = std::chrono::steady_clock::now();
        if (force || now >= bleRefresh_) {
            bleContainers_ = bleBatteryContainers();
            bleRefresh_ = now + 30s;
        }
        return bleContainers_;
    }

    json compatibility()
    {
        auto report = inventory(targets_, endpoints_);
        json scans = json::array();
        // Only attribute a slot probe to a child when the probe proved its
        // identity and the current receiver/slot binding is still unambiguous.
        std::map<std::wstring, DiagnosticReceiverSlot> children;
        for (const auto& device : endpoints_) {
            if (device.transport != Transport::logitech_receiver || device.parentEndpoint.empty()) continue;
            const auto [entry, inserted] = children.try_emplace(device.key, DiagnosticReceiverSlot{device.parentEndpoint, device.slot});
            if (!inserted) entry->second.receiver.clear();
        }
        for (const auto& attempt : receiverAttempts()) {
            auto probe = json{{"vid", attempt.vid}, {"pid", attempt.pid}, {"slot", attempt.slot},
                {"unixSeconds", attempt.unixSeconds}, {"identityAvailable", attempt.identityAvailable},
                {"provider", "logitech-hidpp"}, {"stage", "identity"}, {"outcome", sample(attempt.outcome)}};
            if (matchesReceiverProbe(children, attempt.provenChild, attempt.receiverEndpoint, attempt.slot)) {
                probe["target"] = reportTarget(targets_, attempt.provenChild);
            }
            // Windows may expose the receiver even when no child was found.
            // This is a separate scope, not evidence of the child's identity.
            const auto receiver = endpointContainer(attempt.receiverEndpoint);
            if (!receiver.empty()) probe["receiverTarget"] = reportTarget(targets_, receiver);
            scans.push_back(std::move(probe));
        }
        json native = json::array();
        std::set<std::wstring> seen;
        for (const auto& device : endpoints_) {
            if (native.size() >= 128) break;
            if (!seen.insert(device.key).second) continue;
            native.push_back({{"target", reportTarget(targets_, device.key)}, {"vid", device.vid}, {"pid", device.pid},
                {"revision", device.revision}, {"slot", device.slot}, {"provider", utf8(providerName(device.transport))},
                {"transport", utf8(transportName(device.transport))}});
        }
        report["nativeDevices"] = std::move(native);
        report["logitechSlotAttempts"] = std::move(scans);
        report["recentSamples"] = recent_;
        report["providerAttempts"] = collectionAttempts_;
        return report;
    }

    void record(const Device& device, const json& measured, std::chrono::steady_clock::time_point start,
        const std::string& target = {}, const char* route = nullptr, const std::string& reason = {},
        std::optional<Time> finish = {})
    {
        if (recent_.size() == 160) recent_.pop_front();
        const auto now = std::chrono::system_clock::now().time_since_epoch();
        const auto routeName = route ? std::string_view(route) : std::string_view{};
        const char* stage = "sample";
        if (routeName == "ble-bas")
            stage = "ble-level";
        else if (reason.starts_with("windows_"))
            stage = "windows-property";
        else if (reason.find("identity") != std::string::npos || reason.find("mismatch") != std::string::npos)
            stage = "identity";
        else if (reason == "receiver_no_battery_message")
            stage = "reply";
        else if (reason == "receiver_protocol_invalid")
            stage = "decode";
        else if (reason == "receiver_service_unavailable")
            stage = "service";
        else if (reason == "receiver_unknown_endpoint" || reason == "receiver_ambiguous" || reason == "receiver_disconnected")
            stage = "identity";
        recent_.push_back({{"unixMs", std::chrono::duration_cast<std::chrono::milliseconds>(now).count()},
            {"vid", device.vid}, {"pid", device.pid}, {"revision", device.revision}, {"slot", device.slot},
            {"transport", utf8(transportName(device.transport))},
            {"provider", route ? std::string(route) : utf8(providerName(device.transport))},
            {"target", target}, {"stage", stage},
            {"reasonCode", !reason.empty() ? reason : "hid_" + measured.value("status", std::string("unavailable"))},
            {"elapsedMs", std::chrono::duration_cast<std::chrono::milliseconds>(finish.value_or(std::chrono::steady_clock::now()) - start).count()},
            {"outcome", measured}});
    }
    struct DiscoveryInventory {
        std::vector<Device> passive;
        std::vector<Device> active;
        std::map<unsigned long long, bool> links;
        bool complete{true};
    };
    struct DiscoveryProbe {
        std::vector<Device> endpoints;
        std::vector<ReceiverAttempt> attempts;
        Time nextProbe{};
        bool complete{};
    };
    struct DiscoveryLane {
        explicit DiscoveryLane(const Device& value) : parent(value) {}
        Device parent;
        std::shared_ptr<HidMonitor> reader = std::make_shared<HidMonitor>();
        DiscoveryJob<std::optional<DiscoveryProbe>> task;
        std::vector<Device> endpoints;
        std::set<std::wstring> resources;
        Time due{};
        std::int64_t applied{-1};
        std::int64_t requested{-1};
    };
    DiscoveryJob<std::optional<DiscoveryInventory>> discoveryScan_;
    std::map<std::wstring, DiscoveryLane> discoveryLanes_;
    DiscoveryInventory inventoryCache_;
    std::deque<ReceiverAttempt> discoveryAttempts_;
    std::int64_t discoveryRequested_{-1};
    std::int64_t discoveryApplied_{-1};
    bool discoveryPending_{};
    HidDiscoveryScope discoveryScope_;
    HidDiscoveryScope::Omissions discoveryOmissions_;
    std::wstring nextDiscovery_;
    bool asyncMode_{};

    std::vector<ReceiverAttempt> receiverAttempts() const
    {
        auto attempts = monitor_.receiverAttempts();
        attempts.insert(attempts.end(), discoveryAttempts_.begin(), discoveryAttempts_.end());
        return attempts;
    }

    bool hasExpiredDiscovery(Time now) const
    {
        return discoveryScan_.expired(now, 5min) || std::ranges::any_of(discoveryLanes_, [&](const auto& entry) {
            return entry.second.task.expired(now, 5min);
        });
    }

    bool hasOutstandingDiscovery() const
    {
        return discoveryScan_.outstanding() || std::ranges::any_of(discoveryLanes_, [](const auto& entry) {
            return entry.second.task.outstanding();
        });
    }

    static const std::wstring& physicalKey(const Device& endpoint)
    {
        return endpoint.parentEndpoint.empty()
            ? (endpoint.endpointKey.empty() ? endpoint.key : endpoint.endpointKey) : endpoint.parentEndpoint;
    }

    static std::set<std::wstring> physicalResources(const Device& endpoint)
    {
        std::set<std::wstring> resources{physicalKey(endpoint)};
        for (const auto& collection : endpoint.collections) resources.insert(collection.path);
        return resources;
    }

    static bool sameParent(const Device& a, const Device& b)
    {
        return a.vid == b.vid && a.pid == b.pid && a.revision == b.revision && a.transport == b.transport &&
            a.endpointKey == b.endpointKey && a.collections == b.collections;
    }

    void refreshDiscovery(Time now, std::int64_t generation, std::set<std::wstring>& busy)
    {
        constexpr auto interval = 4s;
        asyncMode_ = true;
        if (discoveryRequested_ != generation) {
            discoveryRequested_ = generation;
            scanDue_ = {};
        }
        if (auto done = discoveryScan_.take()) {
            if (done->value && done->generation == generation) {
                inventoryCache_ = std::move(*done->value);
                discoveryApplied_ = generation;
            }
        }
        if (!discoveryScan_.outstanding() && now >= scanDue_) {
            scanDue_ = now + interval;
            const auto hints = monitor_.verifiedMouseHints();
            discoveryScan_.start(now, generation, [hints]() -> std::optional<DiscoveryInventory> {
                try {
                    DiscoveryInventory result;
                    HidMonitor reader;
                    reader.seedVerifiedMouseHints(hints);
                    result.passive = reader.enumerate(false, nullptr, {}, &result.active, &result.complete);
                    if (std::ranges::any_of(result.passive, [](const auto& endpoint) {
                        return endpoint.transport == Transport::dualsense_bluetooth;
                    })) result.links = bluetoothConnections();
                    return result;
                } catch (...) {
                    // Incomplete inventory does not prove disconnection.
                    return std::nullopt;
                }
            });
        }

        // Active protocols are isolated per physical receiver, after passive
        // inventory is available. A pending probe owns only its receiver/HID
        // paths, leaving completed and unrelated sample lanes usable.
        unsigned active = 0;
        for (auto& [key, lane] : discoveryLanes_) {
            if (auto done = lane.task.take()) {
                const auto current = std::ranges::find(inventoryCache_.active, key, &Device::key);
                if (done->generation == generation && done->value && current != inventoryCache_.active.end() &&
                    sameParent(lane.parent, *current)) {
                    lane.endpoints = std::move(done->value->endpoints);
                    for (auto& attempt : done->value->attempts) {
                        if (discoveryAttempts_.size() == 96) discoveryAttempts_.pop_front();
                        discoveryAttempts_.push_back(std::move(attempt));
                    }
                    if (done->value->complete) lane.applied = done->generation;
                    if (done->value->complete) lane.due = std::max(lane.due, done->value->nextProbe);
                    else lane.due = now; // Continue a budget-limited cold Logitech sweep.
                } else {
                    // Do not let an obsolete probe seed the next generation's identity state.
                    lane.reader = std::make_shared<HidMonitor>();
                }
                // Leave an interval for battery reads even if a probe itself took longer.
                lane.due = std::max(lane.due, now + 1s);
            }
            if (lane.task.outstanding()) {
                ++active;
                busy.insert(lane.resources.begin(), lane.resources.end());
            }
        }
        std::erase_if(discoveryLanes_, [&](const auto& entry) {
            return inventoryCache_.complete && !entry.second.task.outstanding() &&
                std::ranges::find(inventoryCache_.active, entry.first, &Device::key) == inventoryCache_.active.end();
        });
        std::vector<const Device*> order;
        for (const auto& parent : inventoryCache_.active) order.push_back(&parent);
        std::rotate(order.begin(), std::ranges::upper_bound(order, nextDiscovery_, {}, [](const Device* parent) -> const std::wstring& {
            return parent->key;
        }), order.end());

        const bool completeInventory = discoveryApplied_ == generation && inventoryCache_.complete;
        discoveryPending_ = !completeInventory;
        endpoints_ = inventoryCache_.passive;
        std::set<std::wstring> presentParents;
        std::set<std::wstring> resolvedParents;
        for (const auto& endpoint : inventoryCache_.passive) {
            presentParents.insert(physicalKey(endpoint));
            resolvedParents.insert(physicalKey(endpoint));
        }
        for (const auto* found : order) {
            presentParents.insert(physicalKey(*found));
            auto it = discoveryLanes_.try_emplace(found->key, *found).first;
            auto& lane = it->second;
            if (!sameParent(lane.parent, *found) && !lane.task.outstanding()) lane = DiscoveryLane{*found};
            const bool match = sameParent(lane.parent, *found);
            if (match) endpoints_.insert(endpoints_.end(), lane.endpoints.begin(), lane.endpoints.end());
            if (!match || lane.applied != generation) discoveryPending_ = true;
            else resolvedParents.insert(physicalKey(*found));
            if (!match || lane.task.outstanding() || discoveryApplied_ != generation || active >= 4 ||
                (lane.requested == generation && now < lane.due)) continue;

            auto resources = physicalResources(*found);
            if (!hidResourcesAvailable(resources, busy)) continue;
            lane.task.start(now, generation, [reader = lane.reader, parent = *found]() mutable
                -> std::optional<DiscoveryProbe> {
                try {
                    DiscoveryProbe result;
                    auto budget = LogitechReceiverScan::Clock::duration(LogitechReceiverScan::sweepBudget);
                    reader->resolveDevice(parent, false, budget, result.endpoints);
                    result.complete = reader->initialDiscoveryComplete(parent);
                    result.nextProbe = reader->nextDiscoveryProbe(parent);
                    result.attempts = reader->takeReceiverAttempts();
                    return result;
                } catch (...) {
                    return std::nullopt;
                }
            });
            lane.requested = generation;
            lane.due = now + interval;
            lane.resources = std::move(resources);
            busy.insert(lane.resources.begin(), lane.resources.end());
            ++active;
            nextDiscovery_ = found->key;
        }
        // Dispatch rotation is for fairness, not a change in device identity
        // or the signature used for already in-flight sampling.
        std::ranges::stable_sort(endpoints_, {}, physicalKey);
        HidDiscoveryScope::Parents verified;
        for (const auto& endpoint : endpoints_) verified[endpoint.key].insert(physicalKey(endpoint));
        discoveryOmissions_ = discoveryScope_.observe(verified, presentParents, resolvedParents, completeInventory);
        if (completeInventory && discoveryOmissions_.uncertain.empty()) monitor_.forgetOffline(endpoints_);
    }

    std::vector<Device> endpoints_;
    std::chrono::steady_clock::time_point scanDue_{};
    std::map<std::wstring, std::pair<std::chrono::steady_clock::time_point, Transport>> voltageTimes_;
    std::set<std::wstring> deferredBasTargets_;

    json discover()
    {
        const auto found = findWindowsDevices();
        if (!found) throw std::runtime_error("Windows device enumeration failed");
        const auto& bleCandidates = refreshBleCandidates(true);
        std::set<std::wstring> busy;
        for (const auto& [key, lane] : hidLanes_)
            if (lane.task.valid()) busy.insert(lane.resources.begin(), lane.resources.end());
        const auto endpoints = asyncMode_ ? endpoints_ : monitor_.enumerate(false, nullptr, busy);
        const auto claimed = claimedContainers(endpoints);
        json result = json::array();
        for (const auto& device : *found) {
            if (claimed.contains(device.id)) continue;
            const bool bas = device.knownBluetooth && bleCandidates.contains(device.id);
            result.push_back({{"id", utf8(device.id)}, {"name", utf8(device.name)}, {"connection", utf8(device.connection)},
                {"connected", device.connected}, {"automatic", defaultPeripheralMonitoring(device, false) || vendorHeadphone(device).has_value()},
                {"reading", reading(device.battery)}, {"offerBluetooth", device.offerBluetoothReading},
                {"batteryCandidate", device.connected && device.inputOrHeadset && !device.battery && bas ?
                    json("ble_bas") : json(nullptr)}});
        }
        std::map<std::wstring, const Device*> byDevice;
        for (const auto& endpoint : endpoints) {
            if (!byDevice.contains(endpoint.key) || endpoint.transport == Transport::dualsense_usb) {
                byDevice[endpoint.key] = &endpoint;
            }
        }
        for (const auto& [key, endpoint] : byDevice) {
            result.push_back({{"id", utf8(key)}, {"name", utf8(label(*endpoint))},
                {"connection", utf8(transportName(endpoint->transport))}, {"connected", true},
                {"automatic", true}, {"reading", nullptr},
                {"offerBluetooth", false}});
        }
        return result;
    }

    // Each powered device has one in-flight reading at most. Receiver
    // siblings share a lane because a single HID pipe carries their replies.
    struct HidResult {
        std::size_t source{};
        Sample measured{Status::unavailable};
        std::vector<std::tuple<std::size_t, Sample, Time>> attempts;
        std::optional<VoltageSample> voltage;
        std::vector<std::pair<std::size_t, std::vector<HidCollectionAttempt>>> collections{};
    };
    struct HidLane {
        std::shared_ptr<HidMonitor> reader = std::make_shared<HidMonitor>();
        std::future<std::vector<HidResult>> task;
        std::map<std::wstring, HidResult> completed;
        std::map<std::wstring, json> readyRows;
        Time started{};
        std::vector<std::wstring> resources;
        std::vector<std::wstring> members;
        std::vector<std::wstring> signature;
        std::int64_t generation{-1};
        std::optional<std::int64_t> regularSequence;
    };
    std::map<std::wstring, HidLane> hidLanes_;
    std::wstring lastDispatch_;

    bool hasExpiredHidWork(Time now) const
    {
        return std::ranges::any_of(hidLanes_, [&](const auto& entry) {
            const auto& lane = entry.second;
            return lane.task.valid() && now - lane.started >= 5min &&
                lane.task.wait_for(0ms) != std::future_status::ready;
        });
    }

    struct HidRead {
        std::vector<Device> devices;
        std::vector<bool> linksDown;
        std::size_t preferred{};
        std::optional<std::pair<Time, Transport>> lastVoltage;
    };

    static HidResult readHidGroup(HidMonitor& monitor, const std::vector<Device>& group,
        const std::vector<bool>& disconnected, std::size_t preferred, bool voltageEnabled,
        std::optional<std::pair<Time, Transport>> lastVoltage)
    {
        HidResult result;
        result.source = preferred;
        const auto read = [&](std::size_t index) {
            const auto started = std::chrono::steady_clock::now();
            std::vector<HidCollectionAttempt> collections;
            const auto measured = disconnected[index] ? Sample{Status::offline} : monitor.sample(group[index], nullptr, &collections);
            result.attempts.emplace_back(index, measured, started);
            if (!collections.empty()) result.collections.emplace_back(index, std::move(collections));
            return measured;
        };
        result.measured = read(preferred);
        for (std::size_t index = 0; index < group.size() && !hasBatteryReading(result.measured); ++index) {
            if (index == preferred || disconnected[index]) continue;
            const auto alternate = read(index);
            if (hasBatteryReading(alternate) ||
                (result.measured.status == Status::offline && alternate.status != Status::offline)) result.source = index;
            result.measured = batteryFallback(result.measured, alternate);
        }
        const auto& source = group[result.source];
        if (voltageEnabled && result.measured.status != Status::offline && isDualSense(source.transport) &&
            (!lastVoltage || lastVoltage->second != source.transport ||
             std::chrono::steady_clock::now() - lastVoltage->first >= 59s)) {
            result.voltage = monitor.sampleVoltage(source, result.measured);
        }
        return result;
    }

    json poll(const json& request)
    {
        const auto scanTime = std::chrono::steady_clock::now();
        const auto generation = request.value("generation", std::int64_t{-1});
        const auto sequence = request.value("sequence", std::int64_t{0});
        const bool async = generation >= 0;
        std::set<std::wstring> busy;
        for (const auto& [_, lane] : hidLanes_) {
            if (!lane.task.valid()) continue;
            // Finished lanes are also reserved until their result is consumed.
            busy.insert(lane.resources.begin(), lane.resources.end());
        }
        if (async || asyncMode_) {
            if (async) refreshDiscovery(scanTime, generation, busy);
        } else if (request.value("force", false) || scanTime >= scanDue_) {
            endpoints_ = monitor_.enumerate(false, nullptr, busy);
            monitor_.forgetOffline(endpoints_);
            scanDue_ = scanTime + 4s;
        }
        const auto& endpoints = endpoints_;
        const auto hasBluetooth = std::ranges::any_of(endpoints, [](const auto& endpoint) {
            return endpoint.transport == Transport::dualsense_bluetooth;
        });
        const auto links = asyncMode_ ? inventoryCache_.links :
            hasBluetooth ? bluetoothConnections() : std::map<unsigned long long, bool>{};
        const auto disconnected = [&](const Device& device) { return bluetoothDisconnected(device, links); };
        std::map<std::wstring, std::vector<const Device*>> groups;
        for (const auto& endpoint : endpoints) groups[endpoint.key].push_back(&endpoint);
        const bool voltageEnabled = request.value("voltage", false);
        std::erase_if(voltageTimes_, [&](const auto& item) { return !voltageEnabled || !groups.contains(item.first); });
        const auto& due = request.at("due");
        const auto deferredBas = std::exchange(deferredBasTargets_, {});
        const auto shouldRead = [&](const std::string& key) {
            return request.value("force", false) || deferredBas.contains(wide(key)) || !due.contains(key) || due.at(key) == true;
        };
        const bool force = request.value("force", false);
        const auto& basCandidates = refreshBleCandidates(force);
        const auto& windows = defaultWindowsDevices(force);
        const auto containerOwners = nativeContainerOwners(endpoints);
        unsigned basBudget = 2;
        struct StandardBatteryResult {
            Sample sample;
            std::optional<std::int64_t> regularSequence;
        };
        // A null result is pending work, not failure. Suppress failure backoff
        // and recheck on the next poll, even if a manual read started early.
        const auto standardBattery = [&](const std::wstring& container, const std::wstring& deviceKey,
            std::optional<std::int64_t> regularSequence, bool vendorReady = false) -> std::optional<StandardBatteryResult> {
            const auto started = std::chrono::steady_clock::now();
            const auto measured = readWindowsDevice(container);
            const auto target = reportTarget(targets_, deviceKey);
            const Device diagnostic{{}, Transport::windows_battery, 0, {}, {}};
            record(diagnostic, sample(measured), started, target, nullptr, windowsBatteryReason(measured));
            const auto detail = static_cast<WindowsBatteryDetail>(measured.detail);
            const bool useBas = !hasBatteryReading(measured) && basCandidates.contains(container) && permitsBleBatteryFallback(detail);
            if (!useBas) {
                if (basCandidates.contains(container) || detail == WindowsBatteryDetail::disconnected)
                    discardBleBatteryResult(container);
                return StandardBatteryResult{measured, regularSequence};
            }

            const auto defer = [&]() -> std::optional<StandardBatteryResult> {
                deferredBasTargets_.insert(deviceKey);
                return std::nullopt;
            };
            const auto attempt = std::chrono::steady_clock::now();
            const BleBatteryOrigin origin{generation, deviceKey, regularSequence, needsIndependentBleConnection(detail)};
            auto ble = takeBleBatteryResult(container, origin);
            if (!ble) {
                // Never start another GATT operation just to pick up a vendor
                // reply that was already earned after a previous terminal BAS result.
                if (vendorReady) return StandardBatteryResult{measured, regularSequence};
                if (basBudget == 0) return defer();
                --basBudget;
                ble = readBleBattery(container, origin);
            }
            const auto& bleSample = ble->sample;
            auto report = sample(bleSample);
            report.erase("reportId");
            if (bleSample.report) report["errorCode"] = bleSample.report;
            record(diagnostic, report, attempt, target, "ble-bas", "ble_" + std::string(bleBatteryReason(bleSample.detail)));
            if (bleBatteryReadDeferred(bleSample)) return defer();
            if (bleSample.status == Status::offline &&
                bleSample.detail == static_cast<unsigned>(BleBatteryDetail::connection_unverified))
                return StandardBatteryResult{{Status::offline, {}, 0, static_cast<unsigned>(WindowsBatteryDetail::disconnected)},
                    ble->origin.regularSequence};
            return StandardBatteryResult{batteryFallback(measured, bleSample),
                hasBatteryReading(bleSample) ? ble->origin.regularSequence : regularSequence};
        };
        json rows = json::array();
        constexpr std::size_t workerLimit = 4;
        std::map<std::wstring, std::set<std::wstring>> logicalResources;
        std::map<std::wstring, std::vector<std::wstring>> logicalSignatures;
        for (const auto& [key, group] : groups) {
            auto& resources = logicalResources[key];
            auto& signature = logicalSignatures[key];
            signature.push_back(key);
            for (const auto* item : group) {
                const auto& resource = item->parentEndpoint.empty()
                    ? (item->endpointKey.empty() ? item->key : item->endpointKey) : item->parentEndpoint;
                resources.insert(resource);
                signature.push_back(resource);
                signature.push_back(std::to_wstring(static_cast<int>(item->transport)));
                signature.push_back(std::to_wstring(item->vid));
                signature.push_back(std::to_wstring(item->pid));
                signature.push_back(std::to_wstring(item->slot));
                signature.push_back(std::to_wstring(item->unit));
                signature.push_back(disconnected(*item) ? L"down" : L"up");
                for (const auto& collection : item->collections) {
                    // Path also catches multiple logical aliases sharing the
                    // exact same pipe, even if their parent labels differ.
                    resources.insert(collection.path);
                    signature.push_back(collection.path + L":" + std::to_wstring(collection.inputLength) + L":" +
                        std::to_wstring(collection.outputLength) + L":" + std::to_wstring(collection.featureLength));
                }
            }
        }
        const auto batches = groupHidResources(logicalResources);
        const auto uncertain = [&](const HidLane& lane) {
            return async && std::ranges::any_of(lane.members, [&](const auto& id) {
                return discoveryOmissions_.uncertain.contains(id);
            });
        };
        std::set<std::wstring> unresolvedResources;
        for (auto& [_, lane] : hidLanes_) {
            if (!uncertain(lane)) continue;
            // Do not split/replace a previously proven receiver group merely
            // because a partial scan omitted a member or one of its bindings.
            // Drop pending readings (not the lane) and give it a fresh read
            // once the physical bindings can be confirmed again.
            if (lane.task.valid() && lane.task.wait_for(0ms) == std::future_status::ready) (void)lane.task.get();
            lane.generation = -1;
            lane.completed.clear();
            lane.readyRows.clear();
            unresolvedResources.insert(lane.resources.begin(), lane.resources.end());
        }
        // Only a proven removal retires a ready lane. True in-flight I/O
        // always retains its physical reservation until it has finished.
        std::erase_if(hidLanes_, [&](const auto& entry) {
            return !batches.contains(entry.first) && !uncertain(entry.second) &&
                (!entry.second.task.valid() || entry.second.task.wait_for(0ms) == std::future_status::ready);
        });
        // Retain discovery reservations when rebuilding active sample reservations.
        busy.clear();
        for (const auto& [key, lane] : discoveryLanes_)
            if (lane.task.outstanding()) busy.insert(lane.resources.begin(), lane.resources.end());
        std::size_t active = 0;
        for (const auto& [_, lane] : hidLanes_) {
            if (!lane.task.valid()) continue;
            ++active;
            busy.insert(lane.resources.begin(), lane.resources.end());
        }
        const auto preferredOf = [](const std::vector<const Device*>& group) {
            const auto usb = std::ranges::find_if(group, [](const auto* item) {
                return item->transport == Transport::dualsense_usb || item->transport == Transport::logitech_usb;
            });
            return usb == group.end() ? std::size_t{0} : static_cast<std::size_t>(usb - group.begin());
        };
        const auto makeRead = [&](const std::wstring& key) {
            const auto& group = groups.at(key);
            HidRead read;
            read.preferred = preferredOf(group);
            if (const auto found = voltageTimes_.find(key); found != voltageTimes_.end()) read.lastVoltage = found->second;
            for (const auto* endpoint : group) {
                read.devices.push_back(*endpoint);
                read.linksDown.push_back(disconnected(*endpoint));
            }
            return read;
        };
        const auto readBatch = [voltageEnabled](HidMonitor& reader, const std::vector<HidRead>& work) {
            std::vector<HidResult> result;
            result.reserve(work.size());
            for (const auto& read : work) {
                try {
                    result.push_back(readHidGroup(reader, read.devices, read.linksDown, read.preferred,
                        voltageEnabled, read.lastVoltage));
                } catch (...) {
                    result.push_back(HidResult{read.preferred, Sample{Status::unavailable}, {}, {}});
                }
            }
            return result;
        };
        const auto makeRow = [&](const std::wstring& key, const HidResult* completed,
            std::optional<std::int64_t> regularSequence) -> std::optional<json> {
            const auto& group = groups.at(key);
            const auto id = utf8(key);
            auto* source = group[preferredOf(group)];
            json aliases = json::array();
            for (const auto* item : group) {
                if (!item->endpointKey.empty() && item->endpointKey != key) aliases.push_back(utf8(item->endpointKey));
                // Windows can have published this direct device by container
                // before the native provider was ready. Merge only a unique exact
                // owner, never the receiver container of a paired child.
                if (item->transport == Transport::logitech_usb ||
                    (item->transport == Transport::dualsense_bluetooth && verifiedDualSenseAddressKey(key))) {
                    const auto container = endpointContainer(item->endpointKey);
                    const auto owner = containerOwners.find(container);
                    if (owner != containerOwners.end() && owner->second == key) aliases.push_back(utf8(container));
                }
            }
            json value = nullptr;
            json voltage = nullptr;
            json sampleSequence = regularSequence ? json(*regularSequence) : json(nullptr);
            if (completed) {
                auto measured = completed->measured;
                source = group[completed->source];
                bool deferred = false;
                if (!hasBatteryReading(measured)) {
                    std::set<std::wstring> tried;
                    for (const auto* endpoint : group) {
                        if (disconnected(*endpoint)) continue;
                        const auto container = endpointContainer(endpoint->endpointKey);
                        const auto owner = containerOwners.find(container);
                        if (owner == containerOwners.end() || owner->second != key || !tried.insert(container).second) continue;
                        const auto fallback = standardBattery(container, key, regularSequence);
                        if (!fallback) { deferred = true; continue; }
                        if (hasBatteryReading(fallback->sample)) {
                            source = endpoint;
                            sampleSequence = fallback->regularSequence ? json(*fallback->regularSequence) : json(nullptr);
                        }
                        measured = batteryFallback(measured, fallback->sample);
                        if (hasBatteryReading(measured)) break;
                    }
                }
                if (deferred && !hasBatteryReading(measured)) return std::nullopt;
                for (const auto& [index, reading, started] : completed->attempts) {
                    record(*group[index], sample(reading), started, reportTarget(targets_, key));
                    if (async) monitor_.rememberVerifiedMouse(*group[index], reading);
                }
                for (const auto& [index, attempts] : completed->collections) {
                    const auto& device = *group[index];
                    const auto target = reportTarget(targets_, key);
                    const auto timestamp = std::chrono::duration_cast<std::chrono::milliseconds>(
                        std::chrono::system_clock::now().time_since_epoch()).count();
                    for (const auto& attempt : attempts) {
                        if (collectionAttempts_.size() == 160) collectionAttempts_.pop_front();
                        auto row = json{{"target", target}, {"provider", utf8(providerName(device.transport))},
                            {"transport", utf8(transportName(device.transport))}, {"vid", device.vid}, {"pid", device.pid},
                            {"revision", device.revision}, {"stage", "read"}, {"unixMs", timestamp},
                            {"collectionOrdinal", attempt.ordinal}, {"usagePage", attempt.usagePage},
                            {"usage", attempt.usage}, {"inputBytes", attempt.inputBytes}, {"outputBytes", attempt.outputBytes},
                            {"featureBytes", attempt.featureBytes}, {"selected", attempt.selected},
                            {"outcome", sample(attempt.outcome)}};
                        if (attempt.interfaceNumber) row["interfaceNumber"] = *attempt.interfaceNumber;
                        if (attempt.collectionNumber) row["collectionNumber"] = *attempt.collectionNumber;
                        collectionAttempts_.push_back(std::move(row));
                    }
                }
                value = sample(batteryFallback(measured, {Status::offline}));
                if (voltageEnabled && completed->voltage) {
                    const auto& probe = *completed->voltage;
                    const char* status[] = {"ok", "waiting", "missing_hid_reading", "unsupported", "io_error",
                                            "timeout", "invalid_reply"};
                    voltage = {{"millivolts", probe.millivolts ? json(*probe.millivolts) : json(nullptr)},
                               {"status", status[static_cast<int>(probe.status)]}, {"detail", probe.detail}};
                    voltageTimes_[key] = {std::chrono::steady_clock::now(), group[completed->source]->transport};
                }
            }
            json row = {{"id", id}, {"name", utf8(label(*source))},
                {"connection", utf8(transportName(source->transport))}, {"aliases", aliases},
                {"sample", value}, {"art", art(*source)}, {"automatic", true}, {"voltage", voltage}};
            if (async) row["sampleSequence"] = std::move(sampleSequence);
            return row;
        };

        std::vector<std::wstring> order;
        for (const auto& [key, _] : batches) order.push_back(key);
        std::rotate(order.begin(), std::ranges::upper_bound(order, lastDispatch_), order.end());
        for (const auto& batchKey : order) {
            const auto& memberKeys = batches.at(batchKey);
            bool dueForRead = false;
            std::set<std::wstring> resources;
            std::vector<std::wstring> signature;
            for (const auto& key : memberKeys) {
                const auto& group = groups.at(key);
                dueForRead = dueForRead || disconnected(*group[preferredOf(group)]) || shouldRead(utf8(key));
                const auto& resourceSet = logicalResources.at(key);
                resources.insert(resourceSet.begin(), resourceSet.end());
                const auto& memberSignature = logicalSignatures.at(key);
                signature.push_back(std::to_wstring(memberSignature.size()));
                signature.insert(signature.end(), memberSignature.begin(), memberSignature.end());
            }
            const auto publishPending = [&] {
                for (const auto& key : memberKeys) {
                    auto row = *makeRow(key, nullptr, std::nullopt);
                    if (async) row["pending"] = true;
                    rows.push_back(std::move(row));
                }
            };
            if (!async) {
                if (dueForRead && hidResourcesAvailable(resources, busy)) {
                    std::vector<HidRead> work;
                    for (const auto& key : memberKeys) work.push_back(makeRead(key));
                    const auto finished = readBatch(monitor_, work);
                    for (std::size_t i = 0; i < memberKeys.size(); ++i) {
                        auto row = makeRow(memberKeys[i], &finished[i], std::nullopt);
                        rows.push_back(row ? std::move(*row) : *makeRow(memberKeys[i], nullptr, std::nullopt));
                    }
                } else publishPending();
                continue;
            }

            if (!hidResourcesAvailable(resources, unresolvedResources)) {
                publishPending();
                continue;
            }
            auto& lane = hidLanes_[batchKey];
            if (lane.task.valid() && lane.task.wait_for(0ms) == std::future_status::ready) {
                auto finished = lane.task.get();
                --active;
                for (const auto& resource : lane.resources) busy.erase(resource);
                if (lane.generation == generation && lane.signature == signature) {
                    for (std::size_t i = 0; i < memberKeys.size(); ++i)
                        lane.completed.emplace(memberKeys[i], std::move(finished[i]));
                }
            }
            if (!lane.task.valid()) {
                if (lane.signature != signature) {
                    // Do not retain transport state when membership/connection
                    // changes, including devices returning from another port.
                    lane.reader = std::make_shared<HidMonitor>();
                    lane.generation = -1;
                }
                if (lane.generation != generation || lane.signature != signature) {
                    lane.completed.clear();
                    lane.readyRows.clear();
                }
                if (!lane.completed.empty() || !lane.readyRows.empty()) {
                    for (auto it = lane.completed.begin(); it != lane.completed.end();) {
                        auto row = makeRow(it->first, &it->second, lane.regularSequence);
                        if (!row) { ++it; continue; } // A deferred BAS read is not failed HID IO.
                        lane.readyRows.emplace(it->first, std::move(*row));
                        it = lane.completed.erase(it);
                    }
                    if (lane.readyRows.size() == memberKeys.size()) {
                        for (const auto& key : memberKeys) rows.push_back(std::move(lane.readyRows.at(key)));
                        lane.readyRows.clear();
                    } else publishPending();
                    continue;
                }
                if (active < workerLimit && (dueForRead || lane.generation != generation) &&
                    hidResourcesAvailable(resources, busy)) {
                    std::vector<HidRead> work;
                    for (const auto& key : memberKeys) work.push_back(makeRead(key));
                    lane.started = std::chrono::steady_clock::now();
                    lane.task = std::async(std::launch::async, [reader = lane.reader, work = std::move(work), readBatch] {
                        const auto apartment = RoInitialize(RO_INIT_MULTITHREADED);
                        struct ApartmentGuard { HRESULT value; ~ApartmentGuard() { if (SUCCEEDED(value)) RoUninitialize(); } } guard{apartment};
                        return readBatch(*reader, work);
                    });
                    lane.generation = generation;
                    lane.regularSequence = force ? std::nullopt : std::optional<std::int64_t>{sequence};
                    lane.signature = std::move(signature);
                    lane.members = memberKeys;
                    lane.resources.assign(resources.begin(), resources.end());
                    busy.insert(lane.resources.begin(), lane.resources.end());
                    ++active;
                    lastDispatch_ = batchKey;
                }
            }
            if (lane.task.valid() || dueForRead || lane.generation != generation) publishPending();
            else for (const auto& key : memberKeys) rows.push_back(*makeRow(key, nullptr, std::nullopt));
        }

        auto claimed = claimedContainers(endpoints);
        if (asyncMode_) {
            for (const auto& candidate : inventoryCache_.active) {
                if (!reservesWindowsContainerBeforeProbe(candidate.transport)) continue;
                if (auto id = endpointContainer(candidate.endpointKey); !id.empty()) claimed.insert(std::move(id));
            }
        }
        std::map<std::wstring, rfcomm_battery::Model> vendorDevices;
        for (const auto& candidate : windows) {
            if (const auto model = vendorHeadphone(candidate); model && !claimed.contains(candidate.id))
                vendorDevices.try_emplace(candidate.id, *model);
        }
        const auto now = std::chrono::steady_clock::now();
        std::optional<std::pair<std::wstring, VendorAttempt>> vendorCompleted;
        std::optional<std::int64_t> vendorSequence;
        if (vendorTask_) {
            const auto found = vendorDevices.find(vendorTask_->container);
            vendorTask_->stillConnected = vendorTask_->stillConnected &&
                found != vendorDevices.end() && found->second == vendorTask_->model;
            if (vendorTask_->result.wait_for(0ms) == std::future_status::ready) {
                auto attempt = vendorTask_->result.get();
                if (vendorTask_->stillConnected && vendorTask_->generation == generation) {
                    if (now - attempt.finished > 8s) attempt.result = {rfcomm_battery::Status::timeout};
                    vendorCompleted.emplace(vendorTask_->container, std::move(attempt));
                    vendorSequence = vendorTask_->regularSequence;
                } else if (vendorTask_->generation != generation) {
                    vendorDue_.erase(vendorTask_->container);
                }
                vendorTask_.reset();
            }
        }
        std::erase_if(vendorDue_, [&](const auto& entry) { return !vendorDevices.contains(entry.first); });
        struct GenericTarget { std::string id, name, connection; bool automatic; };
        std::map<std::wstring, GenericTarget> targets;
        for (const auto& device : request.at("watched")) {
            const auto id = device.at("id").get<std::string>();
            const auto key = wide(id);
            if (claimed.contains(key) || groups.contains(key)) continue;
            targets.try_emplace(key, GenericTarget{id, device.at("name").get<std::string>(),
                device.at("connection").get<std::string>(), false});
        }
        unsigned automaticCount = 0;
        for (bool vendorPass : {true, false}) {
            for (const auto& device : windows) {
                if (automaticCount >= 32) break;
                const bool vendor = vendorDevices.contains(device.id);
                const bool alreadyClaimed = claimed.contains(device.id);
                // The display property missing is not proof of disconnect.
                // A marked input/headset with an exact BAS can ask the worker
                // to verify its live LE endpoint independently; this does
                // not infer a connection or a battery from the inventory.
                const bool canVerifyBle = !alreadyClaimed && device.knownBluetooth && device.inputOrHeadset &&
                    device.batteryDetail == WindowsBatteryDetail::unknownConnection && basCandidates.contains(device.id);
                if (vendor != vendorPass ||
                    (!vendor && !canVerifyBle && !defaultPeripheralMonitoring(device, alreadyClaimed))) continue;
                targets.insert_or_assign(device.id, GenericTarget{utf8(device.id), utf8(device.name), utf8(device.connection), true});
                ++automaticCount;
            }
        }
        for (const auto& [container, device] : targets) {
            const auto& id = device.id;
            json value = nullptr;
            bool pending = false;
            const auto regularSequence = force ? std::nullopt : std::optional<std::int64_t>{sequence};
            json sampleSequence = regularSequence ? json(*regularSequence) : json(nullptr);
            const auto vendorModel = vendorDevices.find(container);
            const bool sony = vendorModel != vendorDevices.end() &&
                rfcomm_battery::sonyMdrV1ProductId(vendorModel->second) != 0;
            const bool sonyFastPair = vendorModel != vendorDevices.end() &&
                rfcomm_battery::isSonyFastPair(vendorModel->second);
            const bool huawei = vendorModel != vendorDevices.end() &&
                vendorModel->second == rfcomm_battery::Model::huaweiFreeClip2;
            const bool completed = vendorCompleted && vendorCompleted->first == container;
            if (shouldRead(id) || completed) {
                const auto target = reportTarget(targets_, container);
                const Device diagnostic{{}, Transport::windows_battery, 0, {}, {}};
                const auto measured = standardBattery(container, container, regularSequence, completed);
                pending = !measured;
                if (measured) {
                    value = sample(batteryFallback(measured->sample, {Status::offline}));
                    sampleSequence = measured->regularSequence ? json(*measured->regularSequence) : json(nullptr);
                }
                const auto windowsDetail = measured
                    ? static_cast<WindowsBatteryDetail>(measured->sample.detail) : WindowsBatteryDetail::none;
                // Only an eligible local Bluetooth endpoint can reach a
                // vendor service; finish the standard sources first.
                if (vendorModel != vendorDevices.end() && measured && !hasBatteryReading(measured->sample) &&
                    windowsDetail != WindowsBatteryDetail::disconnected) {
                    if (completed) {
                        const auto& attempt = vendorCompleted->second;
                        const auto& fresh = attempt.result;
                        Sample vendor{Status::unavailable};
                        if (fresh.battery) {
                            const int level = static_cast<int>(fresh.battery->percent);
                            vendor = {Status::current, Reading{level, level,
                                fresh.battery->charging.has_value()
                                    ? (*fresh.battery->charging ? Power::charging : Power::discharging) : Power::unknown, level,
                                ReadingSource::bluetooth_vendor}};
                        }
                        value = sample(batteryFallback(measured->sample, vendor));
                        sampleSequence = vendorSequence ? json(*vendorSequence) : json(nullptr);
                        const auto reason = [&] {
                            using R = rfcomm_battery::Status;
                            switch (fresh.status) {
                            case R::success: return "receiver_current";
                            case R::unknown_endpoint: return "receiver_unknown_endpoint";
                            case R::identity_unverified: return "receiver_identity_unverified";
                            case R::disconnected: return "receiver_disconnected";
                            case R::ambiguous: return "receiver_ambiguous";
                            case R::service_unavailable: return "receiver_service_unavailable";
                            case R::busy: return "receiver_busy";
                            case R::timeout: return "receiver_timeout";
                            case R::protocol_invalid: return "receiver_protocol_invalid";
                            case R::no_battery_message: return "receiver_no_battery_message";
                            default: return "receiver_unavailable";
                            }
                        }();
                        record(diagnostic, sample(vendor), attempt.started, target,
                            huawei ? "huawei-spp" : sony ? "sony-mdr-v1" : sonyFastPair ? "sony-fast-pair" : "oppo-elnk",
                            reason, attempt.finished);
                    } else {
                        // Sampling is asynchronous and capped at one private
                        // connection in the process; cached values are never republished.
                        if (!vendorTask_ && (!vendorDue_.contains(container) || now >= vendorDue_.at(container))) {
                            vendorDue_[container] = now + 60s;
                            const auto model = vendorModel->second;
                            vendorTask_.emplace(VendorTask{container, model, std::async(std::launch::async, [container, model] {
                                const auto started = std::chrono::steady_clock::now();
                                auto result = rfcomm_battery::Result{rfcomm_battery::Status::system_error};
                                try { result = rfcomm_battery::read(container, model); } catch (...) {}
                                return VendorAttempt{std::move(result), started, std::chrono::steady_clock::now()};
                            }), generation, force ? std::nullopt : std::optional<std::int64_t>{sequence}, now});
                        }
                        // In flight or deliberately rate-limited is not a
                        // failed read. The completed attempt publishes either
                        // a new value or no data, never a cached sample.
                        value = nullptr;
                    }
                }
            }
            pending = pending || (value.is_null() && vendorTask_ && vendorTask_->container == container);
            json row = {{"id", id}, {"name", device.name}, {"connection", device.connection},
                {"aliases", json::array()}, {"sample", value}, {"automatic", device.automatic},
                {"art", "unknown"}, {"voltage", nullptr}};
            if (pending) row["pending"] = true;
            if (async) row["sampleSequence"] = std::move(sampleSequence);
            rows.push_back(std::move(row));
        }
        return rows;
    }
};
}

int main(int argc, char** argv)
{
    if (argc == 2 && std::string_view(argv[1]) == "--inventory") {
        const auto apartment = RoInitialize(RO_INIT_MULTITHREADED);
        ReportTargets targets;
        std::cout << inventory(targets).dump(2, ' ', false, json::error_handler_t::replace) << '\n';
        if (SUCCEEDED(apartment)) RoUninitialize();
        return 0;
    }
    if (argc != 1) return 2;
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    const auto lock = CreateMutexW(nullptr, FALSE, L"Local\\PowerManager.Win32.Instance");
    if (!lock || GetLastError() == ERROR_ALREADY_EXISTS) {
        if (lock) CloseHandle(lock);
        return lock ? 73 : 74;
    }

    const auto apartment = RoInitialize(RO_INIT_MULTITHREADED);
    {
        Collector collector;
        for (std::string line; std::getline(std::cin, line);) {
            json reply;
            try {
                if (line.size() > 1024 * 1024) throw std::runtime_error("Request too large");
                const auto request = json::parse(line);
                reply["id"] = request.at("id").get<int>();
                reply["result"] = collector.execute(request);
            } catch (const std::exception& error) {
                reply["error"] = error.what();
            }
            std::cout << reply.dump(-1, ' ', false, json::error_handler_t::replace) << std::endl;
        }
    }
    if (SUCCEEDED(apartment)) RoUninitialize();
    CloseHandle(lock);
}
