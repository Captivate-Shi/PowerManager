#include "device_search.hpp"
#include "device_transport.hpp"

#include <windows.h>
#include <wtypes.h>
#include <combaseapi.h>
#include <devpropdef.h>
#include <initguid.h>
#include <devguid.h>
#include <devpkey.h>
#include <propkey.h>
#include <cfgmgr32.h>
#include <setupapi.h>

#include <algorithm>
#include <array>
#include <bit>
#include <cwctype>
#include <map>
#include <span>
#include <set>
#include <string_view>
#include <tuple>

namespace pm {
namespace {

// Windows Device Query ABI. The MinGW SDK used to build this app lacks devquery.h.
struct QueryKey { PROPERTYKEY key; DWORD store; PCWSTR locale; };
struct QueryProperty { QueryKey compoundKey; ULONG type; ULONG size; const void* value; };
struct QueryObject { ULONG type; PCWSTR id; ULONG count; const QueryProperty* properties; };
constexpr ULONG deviceContainerDisplay = 9;
using GetObjects = HRESULT (WINAPI*)(ULONG, ULONG, ULONG, const QueryKey*, ULONG, const void*,
                                     ULONG*, const QueryObject**);
using FreeObjects = void (WINAPI*)(ULONG, const QueryObject*);
using GetProperties = HRESULT (WINAPI*)(ULONG, PCWSTR, ULONG, ULONG, const QueryKey*,
                                        ULONG*, const QueryProperty**);
using FreeProperties = void (WINAPI*)(ULONG, const QueryProperty*);

struct QueryApi {
    HMODULE module = LoadLibraryExW(L"cfgmgr32.dll", nullptr, LOAD_LIBRARY_SEARCH_SYSTEM32);
    GetObjects get = std::bit_cast<GetObjects>(GetProcAddress(module, "DevGetObjects"));
    FreeObjects free = std::bit_cast<FreeObjects>(GetProcAddress(module, "DevFreeObjects"));
    GetProperties getProperties =
        std::bit_cast<GetProperties>(GetProcAddress(module, "DevGetObjectProperties"));
    FreeProperties freeProperties =
        std::bit_cast<FreeProperties>(GetProcAddress(module, "DevFreeObjectProperties"));
    ~QueryApi() { if (module) FreeLibrary(module); }
};

const QueryApi& queryApi()
{
    static const QueryApi api;
    return api;
}

constexpr QueryKey systemKey(const PROPERTYKEY& key) { return {key, 0, nullptr}; }

const std::array batteryKeys{systemKey(PKEY_Devices_Connected), systemKey(PKEY_Devices_BatteryLife),
                             systemKey(PKEY_Devices_ChargingState)};

class Properties {
public:
    explicit Properties(std::span<const QueryProperty> values) : values_(values) {}

    std::optional<int> byte(const PROPERTYKEY& key, ULONG type = DEVPROP_TYPE_BYTE) const
    {
        const auto* value = find(key, type);
        if (!value || value->size != 1) {
            return {};
        }
        return *static_cast<const BYTE*>(value->value);
    }

    bool flag(const PROPERTYKEY& key) const { return byte(key, DEVPROP_TYPE_BOOLEAN).value_or(0) != 0; }

    std::wstring_view string(const PROPERTYKEY& key) const
    {
        const auto values = strings(key, DEVPROP_TYPE_STRING);
        return values.empty() ? std::wstring_view{} : values.front();
    }

    std::vector<std::wstring_view> strings(const PROPERTYKEY& key, ULONG type = DEVPROP_TYPE_STRING_LIST) const
    {
        std::vector<std::wstring_view> result;
        const auto* property = find(key, type);
        if (!property || property->size % sizeof(wchar_t)) {
            return result;
        }
        auto remaining = std::wstring_view(static_cast<PCWSTR>(property->value), property->size / sizeof(wchar_t));
        while (!remaining.empty() && remaining.front()) {
            const auto end = remaining.find(L'\0');
            if (end == std::wstring_view::npos) {
                break;
            }
            result.push_back(remaining.substr(0, end));
            if (type == DEVPROP_TYPE_STRING) {
                break;
            }
            remaining.remove_prefix(end + 1);
        }
        return result;
    }

private:
    const QueryProperty* find(const PROPERTYKEY& key, ULONG type) const
    {
        const auto match = std::ranges::find_if(values_, [&](const auto& value) {
            const auto& other = value.compoundKey.key;
            return value.type == type && value.value && key.pid == other.pid && IsEqualGUID(key.fmtid, other.fmtid);
        });
        return match == values_.end() ? nullptr : &*match;
    }
    std::span<const QueryProperty> values_;
};

std::wstring lower(std::wstring name)
{
    std::ranges::transform(name, name.begin(), [](wchar_t c) { return static_cast<wchar_t>(std::towlower(c)); });
    return name;
}

WindowsBus keyboardBus(DEVINST node)
{
    WindowsBus bus = WindowsBus::unknown;
    for (int depth = 0; depth < 8; ++depth) {
        wchar_t instance[MAX_DEVICE_ID_LEN]{};
        if (CM_Get_Device_IDW(node, instance, MAX_DEVICE_ID_LEN, 0) == CR_SUCCESS) {
            const std::wstring_view identifiers[] = {instance};
            const auto current = windowsBus({}, identifiers);
            if (current == WindowsBus::bluetooth) return current;
            if (current == WindowsBus::usb) bus = current;
        }
        DEVINST parent{};
        if (CM_Get_Parent(&parent, node, 0) != CR_SUCCESS) break;
        node = parent;
    }
    return bus;
}

std::map<std::wstring, FoundDevice> presentKeyboards()
{
    std::map<std::wstring, FoundDevice> keyboards;
    const auto set = SetupDiGetClassDevsW(&GUID_DEVCLASS_KEYBOARD, nullptr, nullptr, DIGCF_PRESENT);
    if (set == INVALID_HANDLE_VALUE) {
        return keyboards;
    }
    for (DWORD index = 0;; ++index) {
        SP_DEVINFO_DATA device{};
        device.cbSize = sizeof(device);
        if (!SetupDiEnumDeviceInfo(set, index, &device)) {
            break;
        }
        wchar_t instance[MAX_DEVICE_ID_LEN]{};
        if (CM_Get_Device_IDW(device.DevInst, instance, MAX_DEVICE_ID_LEN, 0) != CR_SUCCESS) {
            continue;
        }
        const auto hardware = lower(instance);
        if (!hardware.starts_with(L"hid\\vid_") && !hardware.starts_with(L"hid\\{00001124") &&
            !hardware.starts_with(L"bthenum\\") && !hardware.starts_with(L"bthledevice\\")) {
            continue;
        }
        DEVPROPTYPE type{};
        GUID container{};
        ULONG size = sizeof(container);
        if (CM_Get_DevNode_PropertyW(device.DevInst, &DEVPKEY_Device_ContainerId, &type,
                reinterpret_cast<BYTE*>(&container), &size, 0) != CR_SUCCESS ||
            type != DEVPROP_TYPE_GUID || container.Data1 == 0 || container.Data1 == 0xffffffff) {
            continue;
        }
        wchar_t id[40]{};
        if (!StringFromGUID2(container, id, 40)) {
            continue;
        }
        wchar_t label[141]{};
        SetupDiGetDeviceRegistryPropertyW(set, &device, SPDRP_DEVICEDESC, nullptr,
                                  reinterpret_cast<BYTE*>(label), sizeof(label), nullptr);
        const bool razer = hardware.find(L"vid_1532&pid_00b8") != std::wstring::npos;
        const auto key = lower(id);
        keyboards.try_emplace(key, FoundDevice{key, label[0] ? label : L"HID 键盘",
                                               windowsConnection(keyboardBus(device.DevInst)), true, razer, {}});
    }
    SetupDiDestroyDeviceInfoList(set);
    return keyboards;
}

Sample readBattery(const Properties& props)
{
    if (!props.flag(PKEY_Devices_Connected)) {
        return {Status::offline, {}, 0, static_cast<unsigned>(WindowsBatteryDetail::disconnected)};
    }
    const auto percent = props.byte(PKEY_Devices_BatteryLife);
    if (auto reading = windowsReading(percent, props.byte(PKEY_Devices_ChargingState))) {
        return {Status::current, reading};
    }
    return {Status::unavailable, {}, 0, static_cast<unsigned>(
        percent ? WindowsBatteryDetail::invalidPercent : WindowsBatteryDetail::missingProperty)};
}

} // namespace

std::optional<std::vector<FoundDevice>> findWindowsDevices()
{
    const auto& api = queryApi();
    if (!api.get || !api.free) {
        return {};
    }
    const std::array keys{batteryKeys[0], batteryKeys[1], batteryKeys[2], systemKey(PKEY_ItemNameDisplay),
        systemKey(PKEY_Devices_FriendlyName), systemKey(PKEY_Devices_CategoryIds),
        systemKey(PKEY_Devices_Paired), systemKey(PKEY_Devices_LocalMachine),
        systemKey(PKEY_Devices_DiscoveryMethod), systemKey(PKEY_Devices_HardwareIds)};
    ULONG count = 0;
    const QueryObject* objects = nullptr;
    constexpr ULONG localizeDisplayNames = 4;
    if (FAILED(api.get(deviceContainerDisplay, localizeDisplayNames, keys.size(), keys.data(),
                       0, nullptr, &count, &objects))) {
        return {};
    }
    auto keyboards = presentKeyboards();
    const auto cleanup = [&] { if (objects) api.free(count, objects); };
    std::vector<FoundDevice> devices;
    for (const auto& object : std::span(objects, count)) {
        const Properties props({object.properties, object.count});
        const auto sample = readBattery(props);
        if (!object.id || props.flag(PKEY_Devices_LocalMachine) ||
            (sample.status == Status::offline && !props.flag(PKEY_Devices_Paired))) {
            continue;
        }
        auto name = std::wstring(props.string(PKEY_ItemNameDisplay));
        if (name.empty()) {
            name = props.string(PKEY_Devices_FriendlyName);
        }
        if (name.empty()) {
            continue;
        }
        std::replace_if(name.begin(), name.end(), [](wchar_t c) { return c < 32; }, L' ');
        name.resize(std::min<std::size_t>(name.size(), 140));

        // Offer input devices and headsets even when no usable battery property exists.
        const auto categories = props.strings(PKEY_Devices_CategoryIds);
        const auto methods = props.strings(PKEY_Devices_DiscoveryMethod);
        const bool peripheral = std::ranges::any_of(categories, [](std::wstring_view value) {
            return value.starts_with(L"Input.") || value == L"Input" ||
                   value.starts_with(L"Audio.Headphone") || value.starts_with(L"Audio.Headset");
        });
        const auto folded = lower(name);
        const auto hardware = props.strings(PKEY_Devices_HardwareIds);
        const auto bus = windowsBus(methods, hardware);
        const auto hasHardware = [&](std::wstring_view fragment) {
            return std::ranges::any_of(hardware, [&](std::wstring_view id) {
                return lower(std::wstring(id)).find(fragment) != std::wstring::npos;
            });
        };
        const bool razer = folded.find(L"viper v3 hyperspeed") != std::wstring::npos ||
                           hasHardware(L"vid_1532&pid_00b8");
        const bool sony = folded == L"dualsense" || folded == L"dualsense wireless controller" ||
                          hasHardware(L"vid_054c&pid_0ce6") || hasHardware(L"vid&0002054c_pid&0ce6");
        const auto id = lower(object.id);
        if (id.size() != 38 || id.front() != L'{' || id.back() != L'}') {
            continue;
        }
        const auto keyboard = keyboards.extract(id);
        if (!peripheral && bus != WindowsBus::bluetooth && !razer && !sony && keyboard.empty() && !sample.reading) {
            continue;
        }
        const auto connection = bus == WindowsBus::unknown && !keyboard.empty()
            ? keyboard.mapped().connection : std::wstring(windowsConnection(bus));
        devices.push_back({id, std::move(name), connection, sample.status != Status::offline,
                           razer || sony || (!keyboard.empty() && keyboard.mapped().automaticallyMonitored), sample.reading,
                           false, static_cast<WindowsBatteryDetail>(sample.detail)});
    }
    cleanup();
    for (auto& [id, keyboard] : keyboards) {
        keyboard.batteryDetail = WindowsBatteryDetail::missingProperty;
        devices.push_back(std::move(keyboard));
    }
    std::ranges::stable_sort(devices, {}, [](const FoundDevice& candidate) {
        return std::tuple{!candidate.battery.has_value(), !candidate.connected, candidate.name};
    });
    std::set<std::wstring> seen;
    std::erase_if(devices, [&](const FoundDevice& device) { return !seen.insert(device.id).second; });
    return devices;
}

Sample readWindowsDevice(const std::wstring& id)
{
    const auto& api = queryApi();
    if (!api.getProperties || !api.freeProperties) {
        return {Status::unavailable, {}, 0, static_cast<unsigned>(WindowsBatteryDetail::apiUnavailable)};
    }
    ULONG count = 0;
    const QueryProperty* properties = nullptr;
    const auto result = api.getProperties(deviceContainerDisplay, id.c_str(), 0, batteryKeys.size(),
                                          batteryKeys.data(), &count, &properties);
    if (FAILED(result)) {
        return result == HRESULT_FROM_WIN32(ERROR_NOT_FOUND) ?
            Sample{Status::offline, {}, 0, static_cast<unsigned>(WindowsBatteryDetail::notFound)} :
            Sample{Status::unavailable, {}, 0, static_cast<unsigned>(WindowsBatteryDetail::queryFailed)};
    }
    const auto sample = readBattery(Properties({properties, count}));
    if (properties) {
        api.freeProperties(count, properties);
    }
    return sample;
}

const char* windowsBatteryReason(const Sample& sample)
{
    if (sample.reading) return "windows_battery_ok";
    switch (static_cast<WindowsBatteryDetail>(sample.detail)) {
    case WindowsBatteryDetail::disconnected: return "windows_offline";
    case WindowsBatteryDetail::missingProperty: return "windows_no_battery";
    case WindowsBatteryDetail::invalidPercent: return "windows_invalid_percent";
    case WindowsBatteryDetail::apiUnavailable: return "windows_api_unavailable";
    case WindowsBatteryDetail::notFound: return "windows_not_found";
    case WindowsBatteryDetail::queryFailed: return "windows_query_failed";
    default: return "windows_unknown";
    }
}

} // namespace pm
