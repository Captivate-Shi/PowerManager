#define INITGUID
#include <winsock2.h>
#include <windows.h>
#include <ws2bth.h>
#include <bluetoothapis.h>
#include <cfgmgr32.h>
#include <devpkey.h>
#include <objbase.h>

#include "rfcomm_battery_transport.hpp"

#include <algorithm>
#include <array>
#include <chrono>
#include <cwchar>
#include <string>
#include <vector>

namespace pm::rfcomm_battery {
namespace {
using Clock = std::chrono::steady_clock;
constexpr GUID sonyMdrV1{0x96cc203e, 0x50f8, 0x4944, {0x9c, 0x22, 0xed, 0xcb, 0x48, 0xf6, 0x21, 0x6f}};

constexpr GUID oppoElnk{0x0000079a, 0xd102, 0x11e1, {0x9b, 0x23, 0x00, 0x02, 0x5b, 0x00, 0xa5, 0xa5}};

constexpr GUID huaweiSerialPort{0x00001101, 0, 0x1000, {0x80,0,0,0x80,0x5f,0x9b,0x34,0xfb}};
constexpr GUID bthIdentity{0x2bd67d8b,0x8beb,0x48d5,{0x87,0xe0,0x6c,0xda,0x34,0x28,0x04,0x0a}};

template<class Value>
bool readBthIdentity(DEVINST node, ULONG field, DEVPROPTYPE expected, Value& value)
{
    const DEVPROPKEY key{bthIdentity, field};
    ULONG size = sizeof(value);
    DEVPROPTYPE type{};
    return CM_Get_DevNode_PropertyW(node, &key, &type, reinterpret_cast<BYTE*>(&value), &size, 0) == CR_SUCCESS &&
        type == expected && size == sizeof(value);
}

bool isHuaweiEndpoint(DEVINST node)
{
    BYTE source{};
    USHORT vid{}, pid{};
    return readBthIdentity(node, 6, DEVPROP_TYPE_BYTE, source) &&
        readBthIdentity(node, 7, DEVPROP_TYPE_UINT16, vid) &&
        readBthIdentity(node, 8, DEVPROP_TYPE_UINT16, pid) &&
        huawei_headphone::matchesIds(source, vid, pid);
}

struct Endpoint {
    Status status;
    BTH_ADDR address{};
};

Endpoint resolve(std::wstring_view containerId, Model model)
{
    if (containerId.size() != 38 || containerId.front() != L'{' || containerId.back() != L'}') {
        return {Status::unknown_endpoint};
    }
    GUID wanted{};
    if (FAILED(CLSIDFromString(std::wstring(containerId).c_str(), &wanted))) return {Status::unknown_endpoint};

    // Windows cache only, no radio inquiry or pairing.
    BLUETOOTH_DEVICE_SEARCH_PARAMS options{};
    options.dwSize = sizeof(options);
    options.fReturnAuthenticated = TRUE;
    options.fReturnConnected = TRUE;
    BLUETOOTH_DEVICE_INFO info{};
    info.dwSize = sizeof(info);
    const auto search = BluetoothFindFirstDevice(&options, &info);
    if (!search) return {Status::unknown_endpoint};
    Endpoint result{Status::unknown_endpoint};
    do {
        const std::wstring_view name(info.szName);
        const bool exact = model == Model::sonyXm4 ? name == sony_headphone::model :
            model == Model::oppoClip2 ? oppo_headphone::isClip2(name) :
            model == Model::oppoX4 ? oppo_headphone::isX4(name) : huawei_headphone::isFreeClip2(name);
        if (!info.fAuthenticated || !exact ||
            info.Address.ullLong == 0 || info.Address.ullLong > 0xffffffffffffull) continue;
        wchar_t devId[32]{};
        if (std::swprintf(devId, std::size(devId), L"BTHENUM\\DEV_%012llX", info.Address.ullLong) < 0) continue;
        // The complete instance ID includes a driver-chosen suffix, so query
        // the enumerator and match only device nodes for the cached address.
        ULONG length{};
        if (CM_Get_Device_ID_List_SizeW(&length, L"BTHENUM", CM_GETIDLIST_FILTER_ENUMERATOR | CM_GETIDLIST_FILTER_PRESENT) != CR_SUCCESS ||
            length < 2 || length > 32768) continue;
        std::vector<wchar_t> ids(length);
        if (CM_Get_Device_ID_ListW(L"BTHENUM", ids.data(), length, CM_GETIDLIST_FILTER_ENUMERATOR | CM_GETIDLIST_FILTER_PRESENT) != CR_SUCCESS) continue;
        const std::wstring prefix = std::wstring(devId) + L"\\";
        for (const auto* id = ids.data(); *id; id += std::wcslen(id) + 1) {
            if (_wcsnicmp(id, prefix.c_str(), prefix.size()) != 0) continue;
            DEVINST node{};
            if (CM_Locate_DevNodeW(&node, const_cast<wchar_t*>(id), CM_LOCATE_DEVNODE_NORMAL) != CR_SUCCESS) continue;
            GUID actual{};
            ULONG size = sizeof(actual);
            DEVPROPTYPE type{};
            if (CM_Get_DevNode_PropertyW(node, &DEVPKEY_Device_ContainerId, &type,
                    reinterpret_cast<BYTE*>(&actual), &size, 0) != CR_SUCCESS || type != DEVPROP_TYPE_GUID ||
                size != sizeof(actual) || !IsEqualGUID(wanted, actual)) continue;
            if (model == Model::huaweiFreeClip2 && !isHuaweiEndpoint(node)) continue;
            if (result.address && result.address != info.Address.ullLong) {
                BluetoothFindDeviceClose(search);
                return {Status::ambiguous};
            }
            result = {info.fConnected || result.status == Status::success ? Status::success : Status::disconnected,
                info.Address.ullLong};
            break;
        }
    } while (BluetoothFindNextDevice(search, &info));
    BluetoothFindDeviceClose(search);
    return result;
}

struct Socket {
    const SOCKET handle;
    ~Socket() { if (handle != INVALID_SOCKET) closesocket(handle); }
};

struct Winsock {
    WSADATA data{};
    const bool initialized = WSAStartup(MAKEWORD(2, 2), &data) == 0;
    ~Winsock() { if (initialized) WSACleanup(); }
};

int waitSocket(SOCKET socket, bool write, Clock::time_point deadline)
{
    const auto remaining = std::chrono::duration_cast<std::chrono::microseconds>(deadline - Clock::now()).count();
    if (remaining <= 0) return 0;
    timeval time{static_cast<long>(remaining / 1000000), static_cast<long>(remaining % 1000000)};
    fd_set ready{}, failed{};
    FD_SET(socket, &ready);
    if (write) FD_SET(socket, &failed);
    return select(0, write ? nullptr : &ready, write ? &ready : nullptr, write ? &failed : nullptr, &time);
}

Status writeAll(SOCKET socket, std::span<const std::uint8_t> data, Clock::time_point deadline)
{
    while (!data.empty()) {
        const auto ready = waitSocket(socket, true, deadline);
        if (ready == 0) return Status::timeout;
        if (ready < 0) return Status::system_error;
        const auto sent = send(socket, reinterpret_cast<const char*>(data.data()), static_cast<int>(data.size()), 0);
        if (sent <= 0) return Status::service_unavailable;
        data = data.subspan(static_cast<std::size_t>(sent));
    }
    return Status::success;
}
} // namespace

Result read(std::wstring_view containerId, Model model)
{
    const auto endpoint = resolve(containerId, model);
    if (endpoint.status != Status::success) return {endpoint.status};
    Winsock wsa;
    if (!wsa.initialized) return {Status::system_error};
    Socket socket{::socket(AF_BTH, SOCK_STREAM, BTHPROTO_RFCOMM)};
    if (socket.handle == INVALID_SOCKET) return {Status::service_unavailable};
    u_long nonblocking = 1;
    if (ioctlsocket(socket.handle, FIONBIO, &nonblocking) == SOCKET_ERROR) return {Status::system_error};

    const auto deadline = Clock::now() + std::chrono::milliseconds(1800);
    SOCKADDR_BTH remote{};
    remote.addressFamily = AF_BTH;
    remote.btAddr = endpoint.address;
    remote.serviceClassId = model == Model::sonyXm4 ? sonyMdrV1 :
        model == Model::huaweiFreeClip2 ? huaweiSerialPort : oppoElnk;
    // Huawei's documented SDP SPP service is only reachable after the exact
    // Windows hardware ID check. No scanning fixed channels or audio APIs.
    remote.port = 0;
    if (connect(socket.handle, reinterpret_cast<const sockaddr*>(&remote), sizeof(remote)) == SOCKET_ERROR) {
        const auto error = WSAGetLastError();
        if (error == WSAEADDRINUSE) return {Status::busy};
        if (error != WSAEWOULDBLOCK && error != WSAEINPROGRESS) return {Status::service_unavailable};
        const int ready = waitSocket(socket.handle, true, deadline);
        if (!ready) return {Status::timeout};
        if (ready < 0) return {Status::service_unavailable};
        int socketError{}, size = sizeof(socketError);
        if (getsockopt(socket.handle, SOL_SOCKET, SO_ERROR, reinterpret_cast<char*>(&socketError), &size) == SOCKET_ERROR)
            return {Status::service_unavailable};
        if (socketError == WSAEADDRINUSE) return {Status::busy};
        if (socketError) return {Status::service_unavailable};
    }
    if (model == Model::huaweiFreeClip2) {
        const auto status = writeAll(socket.handle, huawei_headphone::batteryQuery, deadline);
        if (status != Status::success) return {status};
        huawei_headphone::ReplyStream replies;
        std::array<std::uint8_t, 128> data{};
        for (int i = 0; i < 8; ++i) {
            const auto ready = waitSocket(socket.handle, false, deadline);
            if (!ready) return {Status::timeout};
            if (ready < 0) return {Status::system_error};
            const auto count = recv(socket.handle, reinterpret_cast<char*>(data.data()), static_cast<int>(data.size()), 0);
            if (count <= 0) return {Status::service_unavailable};
            if (const auto level = replies.feed({data.data(), static_cast<std::size_t>(count)}))
                return {Status::success, Battery{*level, std::nullopt}};
        }
        return {Status::protocol_invalid};
    }

    if (model == Model::oppoClip2 || model == Model::oppoX4) {
        using namespace oppo_headphone;
        const auto query = [&](const auto& request, std::vector<std::uint8_t>& payload) {
            const auto status = writeAll(socket.handle, request, deadline);
            if (status != Status::success) return status;
            ReplyStream replies(request);
            std::array<std::uint8_t, 128> data{};
            for (int i = 0; i < 8; ++i) {
                const int ready = waitSocket(socket.handle, false, deadline);
                if (!ready) return Status::timeout;
                if (ready < 0) return Status::system_error;
                const int n = recv(socket.handle, reinterpret_cast<char*>(data.data()), static_cast<int>(data.size()), 0);
                if (n <= 0) return Status::service_unavailable;
                if (auto reply = replies.feed({data.data(), static_cast<std::size_t>(n)})) {
                    payload = std::move(*reply);
                    return Status::success;
                }
                if (replies.invalid()) return Status::protocol_invalid;
            }
            return Status::protocol_invalid;
        };
        std::vector<std::uint8_t> payload;
        if (const auto status = query(productQuery, payload); status != Status::success) return {status};
        const auto productId = model == Model::oppoX4 ? x4ProductId : clip2ProductId;
        if (!matchesProduct(payload, productId)) return {Status::protocol_invalid};
        if (const auto status = query(batteryQuery, payload); status != Status::success) return {status};
        if (const auto battery = parseBattery(payload, productId)) return {Status::success, Battery{battery->percent, battery->charging}};
        return {Status::protocol_invalid};
    }

    if (auto status = writeAll(socket.handle, sony_headphone::request, deadline); status != Status::success) return {status};

    std::array<std::uint8_t, 128> data{};
    sony_headphone::ResponseStream replies;
    for (int i = 0; i < 8; ++i) {
        const auto ready = waitSocket(socket.handle, false, deadline);
        if (!ready) return {Status::timeout};
        if (ready < 0) return {Status::service_unavailable};
        const auto count = recv(socket.handle, reinterpret_cast<char*>(data.data()), static_cast<int>(data.size()), 0);
        if (count <= 0) return {Status::service_unavailable};
        if (const auto reply = replies.feed({data.data(), static_cast<std::size_t>(count)})) {
            if (const auto ack = writeAll(socket.handle, sony_headphone::responseAck(reply->sequence), deadline);
                ack != Status::success) return {ack};
            return {Status::success, Battery{reply->reading.percent, reply->reading.charging}};
        }
    }
    return {Status::protocol_invalid};
}

} // namespace pm::rfcomm_battery
