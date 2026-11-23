#include "hid.hpp"
#include "peripheral_protocol.hpp"
#include "device_search.hpp"
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
#include <stdexcept>

using nlohmann::json;
using namespace pm;
using namespace std::chrono_literals;

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
            {"source", value->source == ReadingSource::hid ? "hid" : "windows"}};
}

json sample(const Sample& value)
{
    const char* status[] = {"current", "offline", "no_radio_reply", "busy", "timeout", "bad_report",
                            "unavailable", "basic_bluetooth", "charging_error"};
    return {{"status", status[static_cast<int>(value.status)]}, {"reading", reading(value.reading)},
            {"reason", value.millivolts && !value.reading ? "仅上报电压，暂无可靠百分比" :
                value.feature == 0x1000 && value.status == Status::unavailable &&
                (value.detail == 1 || value.detail == 2 || value.detail == 4) ?
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
    struct ToastManager : IInspectable {
        virtual HRESULT STDMETHODCALLTYPE GetDefault(IInspectable**) = 0;
    };
    struct ToastMode : IInspectable {
        virtual HRESULT STDMETHODCALLTYPE get_NotificationMode(int*) = 0;
    };
    constexpr GUID managerId{0xd6f5f569, 0xd40d, 0x407c, {0x89,0x89,0x88,0xca,0xb4,0x2c,0xfd,0x14}};
    constexpr GUID modeId{0x3efcb176, 0x6cc1, 0x56dc, {0x97,0x3b,0x25,0x1f,0x7a,0xac,0xb1,0xc5}};
    constexpr wchar_t className[] = L"Windows.UI.Notifications.ToastNotificationManager";
    HSTRING_HEADER header{};
    HSTRING name{};
    Com<ToastManager> factory;
    Com<IInspectable> manager;
    Com<ToastMode> mode;
    int result{};
    if (FAILED(WindowsCreateStringReference(className, ARRAYSIZE(className) - 1, &header, &name)) ||
        FAILED(RoGetActivationFactory(name, managerId, reinterpret_cast<void**>(&factory.value))) || !factory.value ||
        FAILED(factory.value->GetDefault(&manager.value)) || !manager.value ||
        FAILED(manager.value->QueryInterface(modeId, reinterpret_cast<void**>(&mode.value))) || !mode.value ||
        FAILED(mode.value->get_NotificationMode(&result))) return std::nullopt;
    return result == 0;
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
    const bool quiet = lockedSession() || (shellKnown && (shellState == QUNS_NOT_PRESENT ||
        shellState == QUNS_PRESENTATION_MODE || shellState == QUNS_QUIET_TIME || shellState == QUNS_BUSY));
    const bool fullscreen = (shellKnown && shellState == QUNS_RUNNING_D3D_FULL_SCREEN) ||
        (hasMonitor && fullScreen(window, monitor));
    const auto allowed = desktopNotificationsAllowed();
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

json inventory()
{
    std::vector<HidInterface> descriptors;
    HidMonitor monitor;
    monitor.enumerate(false, &descriptors);
    json hid = json::array();
    for (const auto& item : descriptors) {
        hid.push_back({{"vid", item.vid}, {"pid", item.pid}, {"revision", item.revision},
            {"interfaceNumber", item.interfaceNumber}, {"usagePage", item.page}, {"usage", item.usage},
            {"inputBytes", item.inputLength}, {"outputBytes", item.outputLength}, {"featureBytes", item.featureLength},
            {"descriptorAvailable", item.descriptorAvailable},
            {"candidateProvider", item.provider ? json(utf8(providerName(*item.provider))) : json(nullptr)}});
    }
    const auto devices = findWindowsDevices();
    json windows = json::array();
    if (devices) {
        for (const auto& device : *devices) {
            if (windows.size() >= 256) break;
            windows.push_back({{"connection", utf8(device.connection)}, {"connected", device.connected},
                {"battery", reading(device.battery)}});
        }
    }
    return {{"schemaVersion", 1}, {"hidInterfaces", hid}, {"windowsDevices", windows}, {"windowsQuerySucceeded", devices.has_value()}};
}

const wchar_t* label(const Device& device)
{
    return device.label.empty() ? deviceName(device.transport) : device.label.c_str();
}

const char* art(const Device& device)
{
    if (isDualSense(device.transport)) return "dualsense";
    if (isVgn(device.transport) || device.transport == Transport::razer_shared_keyboard) return "keyboard";
    if (device.transport == Transport::razer_receiver) return "mouse";
    if (device.transport == Transport::logitech_receiver) {
        if (device.kind == 0 || device.kind == 2) return "keyboard";
        if (device.kind >= 3 && device.kind <= 5) return "mouse";
    }
    return "unknown";
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
        if (action == "bluetooth") return bluetooth(wide(request.at("key").get<std::string>()));
        if (action == "poll") return poll(request);
        throw std::runtime_error("Unknown action");
    }

private:
    HidMonitor monitor_;
    std::deque<json> recent_;

    json compatibility()
    {
        auto report = inventory();
        json scans = json::array();
        for (const auto& attempt : monitor_.receiverAttempts()) {
            scans.push_back({{"vid", attempt.vid}, {"pid", attempt.pid}, {"slot", attempt.slot},
                {"unixSeconds", attempt.unixSeconds}, {"identityAvailable", attempt.identityAvailable},
                {"outcome", sample(attempt.outcome)}});
        }
        report["logitechSlotAttempts"] = std::move(scans);
        report["recentSamples"] = recent_;
        return report;
    }

    void record(const Device& device, const json& measured, std::chrono::steady_clock::time_point start)
    {
        if (recent_.size() == 160) recent_.pop_front();
        const auto now = std::chrono::system_clock::now().time_since_epoch();
        recent_.push_back({{"unixMs", std::chrono::duration_cast<std::chrono::milliseconds>(now).count()},
            {"vid", device.vid}, {"pid", device.pid}, {"revision", device.revision}, {"slot", device.slot},
            {"transport", utf8(transportName(device.transport))}, {"provider", utf8(providerName(device.transport))},
            {"elapsedMs", std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - start).count()},
            {"outcome", measured}});
    }
    std::vector<Device> endpoints_;
    std::chrono::steady_clock::time_point scanDue_{};
    std::map<std::wstring, std::pair<std::chrono::steady_clock::time_point, Transport>> voltageTimes_;

    json discover()
    {
        const auto found = findWindowsDevices();
        if (!found) throw std::runtime_error("Windows device enumeration failed");
        json result = json::array();
        for (const auto& device : *found) {
            if (device.automaticallyMonitored) continue;
            result.push_back({{"id", utf8(device.id)}, {"name", utf8(device.name)}, {"connection", utf8(device.connection)},
                {"connected", device.connected}, {"automatic", device.automaticallyMonitored},
                {"reading", reading(device.battery)}, {"offerBluetooth", device.offerBluetoothReading}});
        }
        const auto endpoints = monitor_.enumerate();
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
                {"offerBluetooth", endpoint->transport == Transport::dualsense_bluetooth}});
        }
        return result;
    }

    json bluetooth(const std::wstring& key)
    {
        const auto links = bluetoothConnections();
        for (const auto& endpoint : monitor_.enumerate()) {
            if (endpoint.transport == Transport::dualsense_bluetooth &&
                (key == endpoint.key || key == endpoint.endpointKey)) {
                if (bluetoothDisconnected(endpoint, links)) return sample({Status::offline});
                return sample(monitor_.requestBluetoothReadingOnce(endpoint));
            }
        }
        return sample({Status::offline});
    }

    json poll(const json& request)
    {
        const auto scanTime = std::chrono::steady_clock::now();
        if (request.value("force", false) || scanTime >= scanDue_) {
            endpoints_ = monitor_.enumerate();
            monitor_.forgetOffline(endpoints_);
            scanDue_ = scanTime + 4s;
        }
        const auto& endpoints = endpoints_;
        const auto hasBluetooth = std::ranges::any_of(endpoints, [](const auto& endpoint) {
            return endpoint.transport == Transport::dualsense_bluetooth;
        });
        const auto links = hasBluetooth ? bluetoothConnections() : std::map<unsigned long long, bool>{};
        const auto disconnected = [&](const Device& device) { return bluetoothDisconnected(device, links); };
        std::map<std::wstring, std::vector<const Device*>> groups;
        for (const auto& endpoint : endpoints) groups[endpoint.key].push_back(&endpoint);
        const bool voltageEnabled = request.value("voltage", false);
        std::erase_if(voltageTimes_, [&](const auto& item) { return !voltageEnabled || !groups.contains(item.first); });
        const auto& due = request.at("due");
        const auto shouldRead = [&](const std::string& key) {
            return request.value("force", false) || !due.contains(key) || due.at(key) == true;
        };
        json rows = json::array();
        for (const auto& [key, group] : groups) {
            const auto id = utf8(key);
            auto* source = group.front();
            const auto usb = std::ranges::find_if(group, [](const auto* item) {
                return item->transport == Transport::dualsense_usb;
            });
            if (usb != group.end()) source = *usb;
            json aliases = json::array();
            for (const auto* item : group) {
                if (!item->endpointKey.empty() && item->endpointKey != key) aliases.push_back(utf8(item->endpointKey));
            }
            json value = nullptr;
            json voltage = nullptr;
            if (disconnected(*source) || shouldRead(id)) {
                const auto started = std::chrono::steady_clock::now();
                auto measured = disconnected(*source) ? Sample{Status::offline} : monitor_.sample(*source);
                const auto* preferred = source;
                for (const auto* endpoint : group) {
                    if (measured.reading) break;
                    if (endpoint == preferred || disconnected(*endpoint)) continue;
                    const auto alternate = monitor_.sample(*endpoint);
                    if (alternate.reading || (measured.status == Status::offline && alternate.status != Status::offline)) {
                        source = endpoint;
                        measured = alternate;
                    }
                }
                value = sample(measured);
                record(*source, value, started);
                const auto now = std::chrono::steady_clock::now();
                const auto last = voltageTimes_.find(key);
                if (voltageEnabled && measured.status != Status::offline && isDualSense(source->transport) &&
                    (last == voltageTimes_.end() || last->second.second != source->transport ||
                     now - last->second.first >= 59s)) {
                    const auto probe = monitor_.sampleVoltage(*source, measured);
                    const char* status[] = {"ok", "waiting", "missing_hid_reading", "unsupported", "io_error",
                                            "timeout", "invalid_reply"};
                    voltage = {{"millivolts", probe.millivolts ? json(*probe.millivolts) : json(nullptr)},
                               {"status", status[static_cast<int>(probe.status)]}, {"detail", probe.detail}};
                    voltageTimes_[key] = {now, source->transport};
                }
            }
            rows.push_back({{"id", id}, {"name", utf8(label(*source))},
                {"connection", utf8(transportName(source->transport))}, {"aliases", aliases},
                {"sample", value}, {"art", art(*source)}, {"automatic", true}, {"voltage", voltage}});
        }

        for (const auto& device : request.at("watched")) {
            const auto id = device.at("id").get<std::string>();
            json value = nullptr;
            if (shouldRead(id)) {
                const auto started = std::chrono::steady_clock::now();
                value = sample(readWindowsDevice(wide(id)));
                record(Device{{}, Transport::windows_battery, 0, {}, {}}, value, started);
            }
            rows.push_back({{"id", id}, {"name", device.at("name")}, {"connection", device.at("connection")},
                {"aliases", json::array()}, {"sample", value},
                {"art", "unknown"}, {"voltage", nullptr}});
        }
        return rows;
    }
};
}

int main(int argc, char** argv)
{
    if (argc == 2 && std::string_view(argv[1]) == "--inventory") {
        std::cout << inventory().dump(2, ' ', false, json::error_handler_t::replace) << '\n';
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
    if (SUCCEEDED(apartment)) RoUninitialize();
    CloseHandle(lock);
}
