#include "hid.hpp"
#include "peripheral_protocol.hpp"
#include "device_identity.hpp"
#include "device_search.hpp"

#include <windows.h>
#include <combaseapi.h>
#include <cfgmgr32.h>
#include <initguid.h>
#include <devpkey.h>
extern "C" {
#include <hidsdi.h>
}
#include <setupapi.h>
#include <winioctl.h>

#include <algorithm>
#include <chrono>
#include <cwctype>
#include <tuple>

namespace pm {
namespace {

constexpr DWORD setFeature = CTL_CODE(FILE_DEVICE_KEYBOARD, 100, METHOD_IN_DIRECT, FILE_ANY_ACCESS);
constexpr DWORD getFeature = CTL_CODE(FILE_DEVICE_KEYBOARD, 100, METHOD_OUT_DIRECT, FILE_ANY_ACCESS);
constexpr DEVPROPKEY batteryLife{{0x49cd1f76, 0x5626, 0x4b17,
    {0xa4, 0xe8, 0x18, 0xb4, 0xaa, 0x1a, 0x22, 0x13}}, 10};
constexpr DWORD sharing = FILE_SHARE_READ | FILE_SHARE_WRITE;
using Clock = std::chrono::steady_clock;
using namespace std::chrono_literals;

struct Handle {
    HANDLE value;
    ~Handle() { if (valid()) CloseHandle(value); }
    bool valid() const { return value && value != INVALID_HANDLE_VALUE; }
    Handle(HANDLE handle) : value(handle) {}
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
};

struct DeviceSet {
    HDEVINFO value;
    ~DeviceSet() { if (value != INVALID_HANDLE_VALUE) SetupDiDestroyDeviceInfoList(value); }
};

std::wstring lower(std::wstring value)
{
    for (auto& c : value) {
        c = static_cast<wchar_t>(std::towlower(c));
    }
    return value;
}

std::wstring nodeId(DEVINST node)
{
    wchar_t value[MAX_DEVICE_ID_LEN]{};
    if (CM_Get_Device_IDW(node, value, MAX_DEVICE_ID_LEN, 0) != CR_SUCCESS) {
        return {};
    }
    return lower(value);
}

std::wstring deviceKey(DEVINST node, Transport transport, const std::wstring& fallback)
{
    DEVPROPTYPE type{};
    GUID container{};
    ULONG size = sizeof(container);
    std::wstring identity;
    if (CM_Get_DevNode_PropertyW(node, &DEVPKEY_Device_ContainerId, &type,
                               reinterpret_cast<PBYTE>(&container), &size, 0) == CR_SUCCESS
        && type == DEVPROP_TYPE_GUID && container.Data1 != 0 && container.Data1 != 0xffffffff) {
        wchar_t value[40]{};
        if (StringFromGUID2(container, value, 40)) {
            identity = value;
        }
    }
    if (identity.empty()) {
        DEVINST ancestor = node;
        for (int depth = 0; depth < 8; ++depth) {
            const auto id = nodeId(ancestor);
            if (identity.empty()) {
                identity = id;
            }
            if (id.starts_with(L"usb\\vid_") && id.find(L"&mi_") == std::wstring::npos) {
                identity = id;
                break;
            }
            if (CM_Get_Parent(&ancestor, ancestor, 0) != CR_SUCCESS) {
                break;
            }
        }
    }
    return std::to_wstring(static_cast<int>(transport)) + L":" +
           (identity.empty() ? fallback : identity);
}

std::optional<int> windowsBattery(DEVINST node)
{
    for (int depth = 0; depth < 8; ++depth) {
        DEVPROPTYPE type{};
        BYTE value{};
        ULONG size = sizeof(value);
        if (CM_Get_DevNode_PropertyW(node, &batteryLife, &type, &value, &size, 0) == CR_SUCCESS
            && type == DEVPROP_TYPE_BYTE && value <= 100) {
            return value;
        }
        if (CM_Get_Parent(&node, node, 0) != CR_SUCCESS) {
            break;
        }
    }
    return {};
}

std::wstring bluetoothIdentity(DEVINST node)
{
    for (int depth = 0; depth < 8; ++depth) {
        if (auto key = dualSenseBluetoothIdentity(nodeId(node)); !key.empty()) {
            return key;
        }
        DEVINST parent{};
        if (CM_Get_Parent(&parent, node, 0) != CR_SUCCESS) {
            break;
        }
        node = parent;
    }
    return {};
}

std::optional<unsigned> hexId(std::wstring_view path, std::wstring_view prefix, unsigned digits)
{
    const auto pos = path.find(prefix);
    if (pos == std::wstring_view::npos || pos + prefix.size() + digits > path.size()) return {};
    unsigned value = 0;
    for (const auto ch : path.substr(pos + prefix.size(), digits)) {
        if (ch >= L'0' && ch <= L'9') value = value * 16 + ch - L'0';
        else if (ch >= L'a' && ch <= L'f') value = value * 16 + ch - L'a' + 10;
        else return {};
    }
    return value;
}

std::optional<Transport> candidate(const std::wstring& path)
{
    if (path.find(L"vid_1532&pid_00b8") != std::wstring::npos &&
        path.find(L"rzvirtual") == std::wstring::npos) {
        return Transport::razer_receiver;
    }
    if (path.find(L"vid_054c&pid_0ce6") != std::wstring::npos) {
        return Transport::dualsense_usb;
    }
    if (path.find(L"vid&0002054c_pid&0ce6") != std::wstring::npos) {
        return Transport::dualsense_bluetooth;
    }
    return peripheralTransport(hexId(path, L"vid_", 4).value_or(0), hexId(path, L"pid_", 4).value_or(0));
}

Sample ioFailure(DWORD error, unsigned report = 0)
{
    switch (error) {
    case ERROR_ACCESS_DENIED:
    case ERROR_SHARING_VIOLATION:
    case ERROR_BUSY: return {Status::busy, {}, report, error};
    case ERROR_DEVICE_NOT_CONNECTED:
    case ERROR_FILE_NOT_FOUND: return {Status::offline, {}, report, error};
    case ERROR_TIMEOUT:
    case ERROR_SEM_TIMEOUT: return {Status::timeout, {}, report, error};
    default: return {Status::unavailable, {}, report, error};
    }
}

template<class StartIo>
DWORD completeIo(HANDLE file, HANDLE event, Clock::time_point deadline, DWORD& bytes, StartIo start)
{
    if (deadline <= Clock::now()) {
        return ERROR_TIMEOUT;
    }
    ResetEvent(event);
    OVERLAPPED io{};
    io.hEvent = event;
    if (start(&io)) {
        return Clock::now() <= deadline ? ERROR_SUCCESS : ERROR_TIMEOUT;
    }
    const DWORD error = GetLastError();
    if (error != ERROR_IO_PENDING) {
        return error;
    }
    const auto remaining = std::max(Clock::duration::zero(), deadline - Clock::now());
    const auto wait = std::chrono::ceil<std::chrono::milliseconds>(remaining);
    if (WaitForSingleObject(event, static_cast<DWORD>(wait.count())) != WAIT_OBJECT_0) {
        CancelIoEx(file, &io);
        // Windows can complete cancellation asynchronously, so keep the buffer alive.
        GetOverlappedResult(file, &io, &bytes, TRUE);
        return ERROR_TIMEOUT;
    }
    if (!GetOverlappedResult(file, &io, &bytes, FALSE)) {
        return GetLastError();
    }
    return Clock::now() <= deadline ? ERROR_SUCCESS : ERROR_TIMEOUT;
}

class HidExchange {
public:
    explicit HidExchange(const Collection& channel, DWORD access = GENERIC_READ | GENERIC_WRITE)
        : input_(channel.inputLength), file_(CreateFileW(channel.path.c_str(), access,
            sharing, nullptr, OPEN_EXISTING, FILE_FLAG_OVERLAPPED, nullptr)),
          openError_(file_.valid() ? 0 : GetLastError()), event_(CreateEventW(nullptr, TRUE, FALSE, nullptr)) {}

    template<class Match>
    DWORD request(std::span<std::uint8_t> query, Clock::time_point end, Match match, HidExchange* alternate = nullptr)
    {
        if (const auto failure = error()) return failure;
        DWORD size = 0;
        const auto write = completeIo(file_.value, event_.value, end, size, [&](OVERLAPPED* io) {
            return WriteFile(file_.value, query.data(), static_cast<DWORD>(query.size()), &size, io);
        });
        if (write) return write;
        if (size != query.size()) return ERROR_INVALID_DATA;
        if (alternate && alternate->error()) alternate = nullptr;
        while (Clock::now() < end) {
            const auto interval = [&] { return alternate ? std::min(end, Clock::now() + 25ms) : end; };
            const auto read = receive(interval(), match);
            if (read == ERROR_SUCCESS) return ERROR_SUCCESS;
            if (read != ERROR_TIMEOUT && read != ERROR_NO_DATA) return read;
            if (!alternate) continue;
            const auto other = alternate->receive(interval(), match);
            if (other == ERROR_SUCCESS) return ERROR_SUCCESS;
            if (other != ERROR_TIMEOUT && other != ERROR_NO_DATA) alternate = nullptr;
        }
        return ERROR_TIMEOUT;
    }

    template<class Match>
    DWORD feature(std::span<std::uint8_t> query, Clock::time_point end, Match match)
    {
        if (const auto failure = error()) return failure;
        DWORD size = 0;
        const auto send = completeIo(file_.value, event_.value, end, size, [&](OVERLAPPED* io) {
            return DeviceIoControl(file_.value, setFeature, nullptr, 0, query.data(),
                static_cast<DWORD>(query.size()), &size, io);
        });
        if (send) return send;
        Sleep(25);
        std::vector<std::uint8_t> response(query.size());
        response[0] = query[0];
        const auto read = completeIo(file_.value, event_.value, end, size, [&](OVERLAPPED* io) {
            return DeviceIoControl(file_.value, getFeature, nullptr, 0, response.data(),
                static_cast<DWORD>(response.size()), &size, io);
        });
        if (read) return read;
        return match(std::span<const std::uint8_t>(response).first(std::min<std::size_t>(size, response.size())))
            ? ERROR_SUCCESS : ERROR_INVALID_DATA;
    }

private:
    template<class Match>
    DWORD receive(Clock::time_point end, Match& match)
    {
        DWORD size = 0;
        const auto read = completeIo(file_.value, event_.value, end, size, [&](OVERLAPPED* io) {
            return ReadFile(file_.value, input_.data(), static_cast<DWORD>(input_.size()), &size, io);
        });
        if (read) return read;
        return match(std::span<const std::uint8_t>(input_).first(std::min<std::size_t>(size, input_.size())))
            ? ERROR_SUCCESS : ERROR_NO_DATA;
    }

    DWORD error() const { return openError_ ? openError_ : event_.valid() ? 0 : ERROR_NOT_ENOUGH_MEMORY; }
    std::vector<std::uint8_t> input_;
    Handle file_;
    const DWORD openError_;
    Handle event_;
};

Sample readVgn(const Device& device)
{
    const auto end = Clock::now() + 1050ms;
    Sample result{Status::unavailable};
    for (const auto& channel : device.collections) {
        auto query = vgnQuery(device.transport, channel);
        if (query.empty() || Clock::now() >= end) continue;
        HidExchange exchange(channel);
        std::optional<Sample> reply;
        const auto match = [&](std::span<const std::uint8_t> frame) {
            reply = parseVgn(device.transport, frame);
            return reply.has_value();
        };
        const auto requestEnd = std::min(end, Clock::now() + 650ms);
        const auto error = device.transport == Transport::vgn_v3_usb
            ? exchange.feature(query, requestEnd, match) : exchange.request(query, requestEnd, match);
        if (!error && reply) return *reply;
        result = ioFailure(error, query[0]);
        if (result.status == Status::timeout &&
            (device.transport == Transport::vgn_receiver || device.transport == Transport::vgn_v3_receiver)) {
            result.status = Status::no_radio_reply;
        }
    }
    return result;
}

class LogitechQuery {
public:
    LogitechQuery(const Collection& channel, const Collection* shortChannel, unsigned slot,
                  unsigned& order, Clock::time_point end)
        : exchange_(channel), end_(end), slot_(slot), order_(order)
    {
        if (shortChannel) short_.emplace(*shortChannel, GENERIC_READ);
    }

    std::vector<std::uint8_t> read(unsigned index, unsigned function, unsigned a = 0, unsigned b = 0)
    {
        const unsigned tagged = function * 16 + 8 + order_++ % 8;
        std::array<std::uint8_t, 20> query{0x11, static_cast<std::uint8_t>(slot_),
            static_cast<std::uint8_t>(index), static_cast<std::uint8_t>(tagged),
            static_cast<std::uint8_t>(a), static_cast<std::uint8_t>(b)};
        protocolError = 0;
        std::vector<std::uint8_t> response;
        winError = exchange_.request(query, std::min(end_, Clock::now() + 330ms), [&](auto bytes) {
            const auto parsed = parseLogitechReply(bytes, slot_, index, tagged);
            if (!parsed) return false;
            protocolError = parsed->error;
            response.assign(parsed->params.begin(), parsed->params.end());
            return true;
        }, short_ ? &*short_ : nullptr);
        return response;
    }

    unsigned feature(unsigned id)
    {
        const auto response = read(0, 0, id >> 8, id & 255);
        return response.empty() ? 0 : response.front();
    }

    std::uint32_t unit()
    {
        const auto index = feature(3);
        if (!index) return 0;
        const auto info = read(index, 0);
        if (info.size() < 5) return 0;
        std::uint32_t identity = 0;
        for (unsigned i = 1; i <= 4; ++i) identity = (identity << 8) | info[i];
        return identity == 0xffffffff ? 0 : identity;
    }

    Sample failure(unsigned feature = 0) const
    {
        if (protocolError) return {protocolError == 8 ? Status::offline :
            (protocolError == 4 || protocolError == 9) ? Status::no_radio_reply : Status::unavailable,
            {}, 0x11, protocolError, feature};
        auto result = winError ? ioFailure(winError, 0x11) : Sample{Status::unavailable, {}, 0x11};
        if (result.status == Status::timeout) result.status = Status::no_radio_reply;
        result.feature = feature;
        return result;
    }

    DWORD winError{};
    unsigned protocolError{};

private:
    HidExchange exchange_;
    std::optional<HidExchange> short_;
    Clock::time_point end_;
    unsigned slot_;
    unsigned& order_;
};

bool logitechChannel(const Collection& channel)
{
    return channel.page == 0xff00 && channel.usage == 2 &&
        channel.inputLength == 20 && channel.outputLength == 20;
}

const Collection* shortLogitechChannel(const Device& device)
{
    const auto match = std::ranges::find_if(device.collections, [](const Collection& channel) {
        return channel.page == 0xff00 && channel.usage == 1 && channel.inputLength == 7;
    });
    return match == device.collections.end() ? nullptr : &*match;
}

std::wstring logitechName(LogitechQuery& query, unsigned index)
{
    if (!index) return {};
    const auto size = query.read(index, 0);
    if (size.empty() || size.front() == 0 || size.front() > 48) return {};
    std::string text;
    while (text.size() < size.front()) {
        const auto part = query.read(index, 1, static_cast<unsigned>(text.size()));
        if (part.empty()) return {};
        const auto count = std::min<std::size_t>(part.size(), size.front() - text.size());
        text.append(reinterpret_cast<const char*>(part.data()), count);
    }
    if (std::ranges::any_of(text, [](unsigned char ch) { return ch < 32 || ch == 127; })) return {};
    const auto length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(), static_cast<int>(text.size()), nullptr, 0);
    if (length <= 0) return {};
    std::wstring label(length, L'\0');
    MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(), static_cast<int>(text.size()), label.data(), length);
    return label;
}

Sample readLogitech(const Device& device, unsigned& order)
{
    const auto channel = std::ranges::find_if(device.collections, logitechChannel);
    if (channel == device.collections.end()) return {Status::unavailable};
    LogitechQuery query(*channel, shortLogitechChannel(device), device.slot, order, Clock::now() + 900ms);
    const auto identity = query.unit();
    if (identity != device.unit) return identity ? Sample{Status::offline} : query.failure(3);
    for (const unsigned feature : {0x1004u, 0x1000u, 0x1001u}) {
        const auto index = query.feature(feature);
        if (!index) {
            if (query.winError || query.protocolError) return query.failure(feature);
            continue;
        }
        if (feature == 0x1004) {
            const auto caps = query.read(index, 0);
            if (caps.size() < 2) return query.failure(feature);
            if (caps[1] & 2) {
                const auto data = query.read(index, 1);
                return data.empty() ? query.failure(feature) : logitechBattery(feature, true, data);
            }
            continue;
        }
        bool coarse = false;
        if (feature == 0x1000) {
            const auto caps = query.read(index, 1);
            coarse = caps.size() >= 2 && caps[0] >= 2 && (caps[0] < 10 || !(caps[1] & 2));
        }
        const auto data = query.read(index, 0);
        return data.empty() ? query.failure(feature) : logitechBattery(feature, true, data, coarse);
    }
    return {Status::unavailable};
}

Sample readRazer(const Collection& collection, Clock::time_point deadline, RazerQuery query)
{
    const auto request = makeRazerQuery(query);
    const auto command = request[8];
    // The receiver exposes its feature report on the Windows-owned mouse collection.
    // Feature IOCTLs use FILE_ANY_ACCESS, so leave pointer input to Windows.
    Handle file(CreateFileW(collection.path.c_str(), 0, sharing,
                            nullptr, OPEN_EXISTING, FILE_FLAG_OVERLAPPED, nullptr));
    if (!file.valid()) {
        return ioFailure(GetLastError(), command);
    }
    Handle event(CreateEventW(nullptr, TRUE, FALSE, nullptr));
    if (!event.valid()) {
        return ioFailure(GetLastError(), command);
    }
    const auto length = std::max<std::size_t>(request.size(), collection.featureLength);
    std::vector<std::uint8_t> buffer(length);
    DWORD count = 0;
    const auto control = [&](DWORD code) {
        return completeIo(file.value, event.value, deadline, count, [&](OVERLAPPED* io) {
            const auto size = static_cast<DWORD>(buffer.size());
            return DeviceIoControl(file.value, code, buffer.data(), size,
                                   code == getFeature ? buffer.data() : nullptr,
                                   code == getFeature ? size : 0, &count, io);
        });
    };
    const auto send = [&] {
        std::fill(buffer.begin(), buffer.end(), 0);
        std::copy(request.begin(), request.end(), buffer.begin());
        return control(setFeature);
    };
    if (const auto error = send()) {
        return ioFailure(error, command);
    }
    Sample result{Status::busy, {}, command};
    for (int attempt = 0; attempt < 5 && Clock::now() + 65ms < deadline; ++attempt) {
        Sleep(65);
        std::fill(buffer.begin(), buffer.end(), 0);
        if (const auto error = control(getFeature)) {
            return ioFailure(error, command);
        }
        // HIDClass may count the payload only when report ID is the implicit zero.
        if (count < request.size() - 1) {
            return {Status::bad_report, {}, command, count};
        }
        result = parseRazerReport(std::span(buffer).first(request.size()), query);
        if (result.status != Status::busy) {
            return result;
        }
        if (attempt == 2 && result.detail == 2) {
            if (const auto error = send()) {
                return ioFailure(error, command);
            }
        }
    }
    return result;
}

Sample readDualSense(const Collection& collection, bool bluetooth)
{
    Handle file(CreateFileW(collection.path.c_str(), GENERIC_READ, sharing, nullptr,
                            OPEN_EXISTING, FILE_FLAG_OVERLAPPED, nullptr));
    if (!file.valid()) {
        return ioFailure(GetLastError());
    }
    Handle event(CreateEventW(nullptr, TRUE, FALSE, nullptr));
    if (!event.valid()) {
        return ioFailure(GetLastError());
    }
    std::vector<std::uint8_t> report(collection.inputLength);
    const auto deadline = Clock::now() + 1200ms;
    Sample result{Status::timeout};
    for (int attempt = 0; attempt < 8 && Clock::now() < deadline; ++attempt) {
        DWORD count = 0;
        const auto error = completeIo(file.value, event.value, deadline, count, [&](OVERLAPPED* io) {
            return ReadFile(file.value, report.data(), static_cast<DWORD>(report.size()), &count, io);
        });
        if (error) {
            return error == ERROR_TIMEOUT && result.report ? result : ioFailure(error);
        }
        result = parseDualSenseReport(std::span(report).first(std::min<std::size_t>(count, report.size())),
                                      bluetooth);
        if (result.status != Status::bad_report && result.status != Status::basic_bluetooth) {
            return result;
        }
    }
    return result;
}

bool gamepad(const Collection& value)
{
    return value.page == 1 && (value.usage == 4 || value.usage == 5);
}

bool hasVoltageReports(HANDLE file)
{
    PHIDP_PREPARSED_DATA data{};
    if (!HidD_GetPreparsedData(file, &data)) {
        return false;
    }
    HIDP_CAPS caps{};
    USHORT count = 0;
    std::vector<HIDP_VALUE_CAPS> fields;
    if (HidP_GetCaps(data, &caps) == HIDP_STATUS_SUCCESS && caps.NumberFeatureValueCaps) {
        count = caps.NumberFeatureValueCaps;
        fields.resize(count);
        if (HidP_GetValueCaps(HidP_Feature, fields.data(), &count, data) != HIDP_STATUS_SUCCESS) {
            count = 0;
        }
    }
    HidD_FreePreparsedData(data);
    const auto flags = std::span(fields).first(count);
    const auto hasReport = [&](unsigned id) {
        return std::ranges::any_of(flags, [id](const auto& field) {
            return field.ReportID == id && field.BitSize == 8 && field.ReportCount == 63;
        });
    };
    return hasReport(0x80) && hasReport(0x81);
}

DWORD readFeature(const Collection& collection, std::span<std::uint8_t> report,
                  DWORD access, std::chrono::milliseconds limit, DWORD& count)
{
    Handle file(CreateFileW(collection.path.c_str(), access, sharing, nullptr, OPEN_EXISTING,
                            FILE_FLAG_OVERLAPPED, nullptr));
    if (!file.valid()) {
        return GetLastError();
    }
    Handle event(CreateEventW(nullptr, TRUE, FALSE, nullptr));
    if (!event.valid()) {
        return GetLastError();
    }
    const auto size = static_cast<DWORD>(report.size());
    return completeIo(file.value, event.value, Clock::now() + limit, count, [&](OVERLAPPED* io) {
        return DeviceIoControl(file.value, getFeature, report.data(), size, report.data(), size, &count, io);
    });
}

std::wstring readUsbIdentity(const Collection& collection)
{
    constexpr std::uint8_t pairingReport = 0x09;
    const auto length = collection.featureLength;
    if (length < 20) {
        return {};
    }
    // This feature report is queried over USB only. On Bluetooth it can change input mode.
    std::vector<std::uint8_t> report(length);
    report.front() = pairingReport;
    DWORD size = 0;
    const auto error = readFeature(collection, report, 0, 300ms, size);
    return error ? std::wstring{} : dualSenseUsbIdentity(std::span(report).first(std::min<std::size_t>(size, length)));
}

void addBluetoothDevnodes(std::map<std::wstring, Device>& devices)
{
    DeviceSet set{SetupDiGetClassDevsW(nullptr, L"BTHENUM", nullptr, DIGCF_PRESENT | DIGCF_ALLCLASSES)};
    if (set.value == INVALID_HANDLE_VALUE) {
        return;
    }
    for (DWORD index = 0;; ++index) {
        SP_DEVINFO_DATA info{};
        info.cbSize = sizeof(info);
        if (!SetupDiEnumDeviceInfo(set.value, index, &info)) {
            break;
        }
        const auto id = nodeId(info.DevInst);
        if (!id.starts_with(L"bthenum\\{00001124") || !candidate(id)) {
            continue;
        }
        constexpr auto transport = Transport::dualsense_bluetooth;
        const auto key = deviceKey(info.DevInst, transport, id);
        const auto identity = bluetoothIdentity(info.DevInst);
        if (!identity.empty() && std::ranges::any_of(devices, [&](const auto& entry) {
            return entry.second.transport == transport && entry.second.key == identity;
        })) {
            continue;
        }
        auto& device = devices.try_emplace(key, Device{
            identity.empty() ? key : identity, transport, 0, {}, {}, key}).first->second;
        if (!device.windowsBattery) {
            device.windowsBattery = windowsBattery(info.DevInst);
        }
    }
}

auto razerRank(const Collection& value)
{
    return std::tuple{value.featureLength != 91, value.page < 0xff00,
                      value.description.find(L"&mi_00") == std::wstring::npos,
                      value.description};
}

} // namespace

const wchar_t* deviceName(Transport transport)
{
    if (transport == Transport::razer_receiver) {
        return L"Razer Viper V3 HyperSpeed";
    }
    if (transport == Transport::razer_shared_keyboard) {
        return L"Razer BlackWidow V4 Low-profile TKL HyperSpeed";
    }
    if (transport == Transport::vgn_usb || transport == Transport::vgn_receiver) return sharedKeyboardLabel(transport, {});
    if (isVgn(transport)) return L"VGN V98 Pro V3";
    if (transport == Transport::logitech_receiver) return L"Logitech HID++ 外设";
    return transport == Transport::windows_battery ? L"Windows 外设" : L"DualSense";
}

const wchar_t* transportName(Transport transport)
{
    switch (transport) {
    case Transport::razer_receiver: return L"2.4 GHz";
    case Transport::razer_shared_keyboard: return L"2.4 GHz 共享接收器";
    case Transport::dualsense_usb: return L"USB";
    case Transport::dualsense_bluetooth: return L"蓝牙";
    case Transport::windows_battery: return L"Windows 电量";
    case Transport::vgn_usb:
    case Transport::vgn_v3_usb: return L"USB";
    case Transport::vgn_receiver:
    case Transport::vgn_v3_receiver:
    case Transport::logitech_receiver: return L"2.4 GHz";
    }
    return L"";
}

const wchar_t* providerName(Transport transport)
{
    switch (transport) {
    case Transport::razer_receiver:
    case Transport::razer_shared_keyboard: return L"razer-1532-00b8";
    case Transport::dualsense_usb: return L"dualsense-usb";
    case Transport::dualsense_bluetooth: return L"dualsense-bluetooth";
    case Transport::windows_battery: return L"windows-property";
    case Transport::vgn_usb:
    case Transport::vgn_receiver: return L"vgn-weisheng";
    case Transport::vgn_v3_usb: return L"vgn-beiying-feature";
    case Transport::vgn_v3_receiver: return L"vgn-beiying-receiver";
    case Transport::logitech_receiver: return L"logitech-hidpp20";
    }
    return L"unknown";
}

const wchar_t* statusName(Status status)
{
    switch (status) {
    case Status::current: return L"当前读数";
    case Status::offline: return L"未连接";
    case Status::no_radio_reply: return L"休眠或关机";
    case Status::busy: return L"接口暂时繁忙";
    case Status::timeout: return L"读取超时";
    case Status::bad_report: return L"报告无法验证";
    case Status::unavailable: return L"暂时无法读取";
    case Status::basic_bluetooth: return L"蓝牙简化报告无电量";
    case Status::charging_error: return L"设备报告充电异常";
    }
    return L"";
}

const wchar_t* powerName(Power power)
{
    switch (power) {
    case Power::discharging: return L"电池供电";
    case Power::charging: return L"充电中";
    case Power::full: return L"已充满";
    case Power::unknown: return L"充电状态未上报";
    }
    return L"";
}

std::wstring formatReading(const Reading& reading)
{
    std::wstring text = std::to_wstring(reading.low);
    if (reading.low != reading.high) {
        text += L"–" + std::to_wstring(reading.high);
    }
    return text + L"%";
}

std::wstring formatEstimatedReading(const Reading& reading)
{
    return (reading.low == reading.high ? L"" : L"约 ") +
           std::to_wstring(reading.midpoint()) + L"%";
}

std::wstring timestamp()
{
    SYSTEMTIME time{};
    GetLocalTime(&time);
    wchar_t value[32]{};
    swprintf(value, 32, L"%04u-%02u-%02u %02u:%02u:%02u", time.wYear, time.wMonth,
             time.wDay, time.wHour, time.wMinute, time.wSecond);
    return value;
}

std::vector<Device> HidMonitor::enumerate(bool includePairedBluetooth, std::vector<HidInterface>* inventory)
{
    GUID hidGuid{};
    HidD_GetHidGuid(&hidGuid);
    DeviceSet set{SetupDiGetClassDevsW(&hidGuid, nullptr, nullptr, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE)};
    if (set.value == INVALID_HANDLE_VALUE) {
        return {};
    }
    std::map<std::wstring, Device> devices;
    for (DWORD index = 0;; ++index) {
        SP_DEVICE_INTERFACE_DATA iface{};
        iface.cbSize = sizeof(iface);
        if (!SetupDiEnumDeviceInterfaces(set.value, nullptr, &hidGuid, index, &iface)) {
            break;
        }
        DWORD bytes = 0;
        SetupDiGetDeviceInterfaceDetailW(set.value, &iface, nullptr, 0, &bytes, nullptr);
        if (bytes < sizeof(SP_DEVICE_INTERFACE_DETAIL_DATA_W)) {
            continue;
        }
        std::vector<std::byte> storage(bytes);
        auto* detail = reinterpret_cast<SP_DEVICE_INTERFACE_DETAIL_DATA_W*>(storage.data());
        detail->cbSize = sizeof(*detail);
        SP_DEVINFO_DATA devInfo{};
        devInfo.cbSize = sizeof(devInfo);
        if (!SetupDiGetDeviceInterfaceDetailW(set.value, &iface, detail, bytes, nullptr, &devInfo)) {
            continue;
        }
        std::wstring path = detail->DevicePath;
        const auto normalized = lower(path);
        const auto transport = candidate(normalized);
        if (!transport && !inventory) continue;
        if (inventory && inventory->size() >= 512) break;
        const auto instance = nodeId(devInfo.DevInst);
        if (instance.starts_with(L"rzvirtual")) {
            continue;
        }
        Handle info(CreateFileW(path.c_str(), 0, sharing, nullptr, OPEN_EXISTING, 0, nullptr));
        HIDD_ATTRIBUTES attributes{};
        attributes.Size = sizeof(attributes);
        HIDP_CAPS caps{};
        bool haveCaps = false;
        if (info.valid()) {
            HidD_GetAttributes(info.value, &attributes);
            PHIDP_PREPARSED_DATA parsed{};
            if (HidD_GetPreparsedData(info.value, &parsed)) {
                haveCaps = HidP_GetCaps(parsed, &caps) == HIDP_STATUS_SUCCESS;
                HidD_FreePreparsedData(parsed);
            }
        }
        const auto vid = attributes.VendorID ? attributes.VendorID : hexId(normalized, L"vid_", 4).value_or(0);
        const auto pid = attributes.ProductID ? attributes.ProductID : hexId(normalized, L"pid_", 4).value_or(0);
        if (inventory) {
            const auto interfaceNumber = hexId(normalized, L"&mi_", 2);
            inventory->push_back({vid, pid, attributes.VersionNumber, caps.UsagePage, caps.Usage,
                caps.InputReportByteLength, caps.OutputReportByteLength, caps.FeatureReportByteLength,
                interfaceNumber ? static_cast<int>(*interfaceNumber) : -1, haveCaps, transport});
            continue;
        }
        if ((isVgn(*transport) || *transport == Transport::logitech_receiver) &&
            (peripheralTransport(vid, pid) != transport || !haveCaps)) continue;
        const bool bluetooth = *transport == Transport::dualsense_bluetooth;
        const auto key = deviceKey(devInfo.DevInst, *transport, normalized);
        auto [it, inserted] = devices.try_emplace(key, Device{key, *transport, attributes.VersionNumber,
                                                               bluetooth ? windowsBattery(devInfo.DevInst)
                                                                         : std::nullopt, {}, key, vid, pid});
        if ((*transport == Transport::vgn_usb || *transport == Transport::vgn_receiver) && info.valid() &&
            (it->second.label.empty() || it->second.label == sharedKeyboardLabel(*transport, {}))) {
            std::array<wchar_t, 126> product{};
            if (HidD_GetProductString(info.value, product.data(), static_cast<ULONG>(sizeof(product)))) {
                product.back() = 0;
                it->second.label = sharedKeyboardLabel(*transport, product.data());
            }
        }
        if (bluetooth && inserted) {
            if (auto identity = bluetoothIdentity(devInfo.DevInst); !identity.empty()) {
                it->second.key = std::move(identity);
            }
        }
        const auto first = normalized.find(L'#');
        const auto second = normalized.find(L'#', first + 1);
        auto description = normalized.substr(first + 1, second - first - 1);
        it->second.collections.push_back({std::move(path), std::move(description),
                                          caps.UsagePage, caps.Usage, caps.InputReportByteLength,
                                          caps.FeatureReportByteLength, caps.OutputReportByteLength});
    }
    if (inventory) return {};
    if (includePairedBluetooth) {
        addBluetoothDevnodes(devices);
    }
    std::erase_if(receivers_, [&](const auto& item) { return !devices.contains(item.first); });
    std::vector<Device> result;
    for (auto& [key, device] : devices) {
        if (device.transport == Transport::logitech_receiver) {
            const auto channel = std::ranges::find_if(device.collections, logitechChannel);
            if (channel == device.collections.end()) continue;
            auto& receiver = receivers_[key];
            const auto now = Clock::now();
            if (now >= receiver.due) {
                const auto slot = receiver.nextSlot;
                receiver.nextSlot = slot % 6 + 1;
                receiver.due = now + 4s;
                LogitechQuery query(*channel, shortLogitechChannel(device), slot, logitechRequestId_, now + 750ms);
                const auto identity = query.unit();
                const auto stamp = std::chrono::duration_cast<std::chrono::seconds>(
                    std::chrono::system_clock::now().time_since_epoch()).count();
                if (receiverAttempts_.size() == 96) receiverAttempts_.erase(receiverAttempts_.begin());
                receiverAttempts_.push_back({device.vid, device.pid, slot, stamp, identity != 0,
                    identity ? Sample{Status::current, {}, 0x11, 0, 3} : query.failure(3)});
                auto child = receiver.children.find(slot);
                if (identity && (child == receiver.children.end() || child->second.unit != identity)) {
                    auto paired = device;
                    paired.key = L"logitech-hidpp:" + std::to_wstring(identity);
                    paired.parentEndpoint = device.endpointKey;
                    paired.endpointKey.clear();
                    paired.slot = slot;
                    paired.unit = identity;
                    const auto nameIndex = query.feature(5);
                    if (nameIndex) {
                        const auto type = query.read(nameIndex, 2);
                        if (!type.empty()) paired.kind = type.front();
                        paired.label = logitechName(query, nameIndex);
                    }
                    receiver.children.insert_or_assign(slot, std::move(paired));
                } else if (query.protocolError == 8) {
                    receiver.children.erase(slot);
                }
            }
            for (auto& [slot, child] : receiver.children) {
                child.collections = device.collections;
                result.push_back(child);
            }
            continue;
        }
        if (device.transport == Transport::razer_receiver) {
            std::ranges::sort(device.collections, {}, razerRank);
            const auto control = std::ranges::find_if(device.collections, [](const Collection& collection) {
                return collection.featureLength == 91 && collection.description.ends_with(L"pid_00b8&mi_00");
            });
            if (control != device.collections.end()) {
                auto& pairing = sharedPairings_[key];
                const auto now = Clock::now();
                if (now >= pairing.nextCheck) {
                    const auto answer = readRazer(*control, now + 500ms, RazerQuery::pairedDevices);
                    if (answer.status == Status::current) {
                        pairing.paired = answer.detail == 1;
                    }
                    pairing.nextCheck = now + (answer.status == Status::current ? 2min : 1min);
                }
                if (pairing.paired) {
                    result.push_back({device.key + L":02d2", Transport::razer_shared_keyboard,
                                      device.revision, {}, {*control}, {}, device.vid, device.pid});
                }
            }
        } else {
            std::ranges::stable_sort(device.collections, {}, [](const Collection& c) { return !gamepad(c); });
            if (device.transport == Transport::dualsense_usb && !device.collections.empty() &&
                gamepad(device.collections.front())) {
                const auto& collection = device.collections.front();
                auto known = usbIdentities_.find(collection.path);
                if (known == usbIdentities_.end()) {
                    if (auto identity = readUsbIdentity(collection); !identity.empty()) {
                        known = usbIdentities_.emplace(collection.path, std::move(identity)).first;
                    }
                }
                if (known != usbIdentities_.end()) {
                    device.key = known->second;
                }
            }
        }
        result.push_back(std::move(device));
    }
    return result;
}

Sample HidMonitor::sample(const Device& device, std::wostream* diagnostics)
{
    if (isVgn(device.transport)) return readVgn(device);
    if (device.transport == Transport::logitech_receiver) return readLogitech(device, logitechRequestId_);
    const bool keyboard = device.transport == Transport::razer_shared_keyboard;
    const bool razer = device.transport == Transport::razer_receiver || keyboard;
    const auto bluetooth = device.transport == Transport::dualsense_bluetooth;
    const auto deadline = Clock::now() + 1800ms;
    const auto cached = razerCollections_.find(device.key);
    const auto attempt = [&](const Collection& collection) {
        auto result = razer ? readRazer(collection, deadline,
                                        keyboard ? RazerQuery::keyboardBattery : RazerQuery::mouseBattery)
                            : readDualSense(collection, bluetooth);
        if (keyboard && result.reading) {
            const auto charging = readRazer(collection, deadline, RazerQuery::keyboardCharging);
            if (charging.status == Status::current) {
                result.reading->power = charging.detail ? Power::charging : Power::discharging;
            }
        }
        if (diagnostics) {
            *diagnostics << L"  " << collection.description << L" usage=" << std::hex
                         << collection.page << L":" << collection.usage << std::dec
                         << L" input=" << collection.inputLength << L" feature=" << collection.featureLength
                         << L" => " << statusName(result.status) << L" report=0x" << std::hex
                         << result.report << L" detail=0x" << result.detail << std::dec << L"\n";
        }
        return result;
    };
    if (cached != razerCollections_.end()) {
        const auto found = std::ranges::find(device.collections, cached->second, &Collection::path);
        if (found != device.collections.end()) {
            return attempt(*found);
        }
        razerCollections_.erase(cached);
    }
    Sample result{Status::unavailable};
    Sample radioSilent{Status::unavailable};
    for (const auto& collection : device.collections) {
        if (!razer && (!gamepad(collection) || collection.inputLength < 10)) {
            continue;
        }
        if (razer && collection.featureLength < 91) {
            continue;
        }
        if (Clock::now() >= deadline) {
            break;
        }
        result = attempt(collection);
        if (result.reading) {
            if (razer) {
                razerCollections_[device.key] = collection.path;
            }
            return result;
        }
        if (result.status == Status::basic_bluetooth || result.status == Status::charging_error) {
            break;
        }
        if (result.status == Status::no_radio_reply) {
            radioSilent = result;
        }
    }
    if (bluetooth && !device.collections.empty() && result.status != Status::offline &&
        result.status != Status::charging_error) {
        const auto container = device.endpointKey.substr(2);
        if (container.size() == 38 && container.front() == L'{' && container.back() == L'}') {
            if (auto windows = readWindowsDevice(container); windows.reading) {
                return windows;
            }
        }
        if (auto reading = windowsReading(device.windowsBattery, {})) {
            return {Status::current, reading};
        }
    }
    return radioSilent.status == Status::no_radio_reply ? radioSilent : result;
}

VoltageSample HidMonitor::sampleVoltage(const Device& device, const Sample& pairedReading)
{
    if (!isDualSense(device.transport)) {
        return {VoltageStatus::unsupported};
    }
    const bool bluetooth = device.transport == Transport::dualsense_bluetooth;
    if (!pairedReading.reading || pairedReading.reading->source != ReadingSource::hid ||
        pairedReading.report != (bluetooth ? 0x31u : 0x01u)) {
        return {VoltageStatus::missing_hid_reading};
    }
    const auto collection = std::ranges::find_if(device.collections, gamepad);
    if (collection == device.collections.end() || collection->featureLength < 64) {
        return {VoltageStatus::unsupported};
    }
    Handle file(CreateFileW(collection->path.c_str(), 0, sharing, nullptr, OPEN_EXISTING,
                            FILE_FLAG_OVERLAPPED, nullptr));
    if (!file.valid()) {
        return {VoltageStatus::io_error, {}, GetLastError()};
    }
    if (!hasVoltageReports(file.value)) {
        return {VoltageStatus::unsupported};
    }
    Handle event(CreateEventW(nullptr, TRUE, FALSE, nullptr));
    if (!event.valid()) {
        return {VoltageStatus::io_error, {}, GetLastError()};
    }
    const auto request = makeDualSenseVoltageQuery(bluetooth);
    std::vector<std::uint8_t> buffer(collection->featureLength);
    std::copy(request.begin(), request.end(), buffer.begin());
    const auto size = static_cast<DWORD>(buffer.size());
    const auto deadline = Clock::now() + 750ms;
    DWORD count = 0;
    const auto exchange = [&](DWORD code) {
        return completeIo(file.value, event.value, deadline, count, [&](OVERLAPPED* io) {
            return DeviceIoControl(file.value, code, buffer.data(), size,
                                   code == getFeature ? buffer.data() : nullptr,
                                   code == getFeature ? size : 0, &count, io);
        });
    };
    const auto failed = [](DWORD error) {
        return VoltageSample{error == ERROR_TIMEOUT ? VoltageStatus::timeout : VoltageStatus::io_error,
                             {}, error};
    };
    if (const auto error = exchange(setFeature)) {
        return failed(error);
    }
    for (int attempt = 0; attempt < 6 && Clock::now() + 35ms < deadline; ++attempt) {
        Sleep(35);
        std::fill(buffer.begin(), buffer.end(), 0);
        buffer.front() = 0x81;
        count = 0;
        if (const auto error = exchange(getFeature)) {
            return failed(error);
        }
        const auto result = parseDualSenseVoltageReply(std::span(buffer).first(std::min<std::size_t>(count, buffer.size())));
        if (result.status != VoltageStatus::waiting) {
            return result;
        }
    }
    return {VoltageStatus::timeout};
}

Sample HidMonitor::requestBluetoothReadingOnce(const Device& device)
{
    auto result = sample(device);
    if (device.transport != Transport::dualsense_bluetooth || result.status != Status::basic_bluetooth) {
        return result;
    }
    const auto collection = std::ranges::find_if(device.collections, gamepad);
    if (collection == device.collections.end()) {
        return result;
    }
    std::array<std::uint8_t, 64> report{};
    report[0] = 0x05;
    DWORD count = 0;
    // The user confirmed a single feature read for this connection. Never retry the mode change.
    const auto error = readFeature(*collection, report, GENERIC_READ, 1500ms, count);
    for (int attempt = 0; attempt < 3; ++attempt) {
        result = sample(device);
        if (result.reading || result.status == Status::offline) {
            return result;
        }
        if (attempt != 2) {
            Sleep(150);
        }
    }
    return error ? ioFailure(error, 0x05) : result;
}

void HidMonitor::forgetOffline(const std::vector<Device>& devices)
{
    std::erase_if(razerCollections_, [&](const auto& entry) {
        return std::ranges::find(devices, entry.first, &Device::key) == devices.end();
    });
    std::erase_if(sharedPairings_, [&](const auto& entry) {
        return std::ranges::find(devices, entry.first, &Device::key) == devices.end();
    });
    std::erase_if(usbIdentities_, [&](const auto& entry) {
        return std::ranges::none_of(devices, [&](const auto& device) {
            return device.transport == Transport::dualsense_usb &&
                std::ranges::find(device.collections, entry.first, &Collection::path) != device.collections.end();
        });
    });
}

} // namespace pm
