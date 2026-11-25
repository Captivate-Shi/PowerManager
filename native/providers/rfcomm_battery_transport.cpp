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

struct Endpoint {
    Status status;
    BTH_ADDR address{};
};

Endpoint resolve(std::wstring_view containerId)
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
        if (!info.fAuthenticated || std::wstring_view(info.szName) != sony_headphone::model ||
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

Result readSonyXm4(std::wstring_view containerId)
{
    const auto endpoint = resolve(containerId);
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
    remote.serviceClassId = sonyMdrV1;
    // Only the proven, private MDR V1 service; never use a generic Serial
    // Port / HFP UUID, arbitrary channels, or Bluetooth profile changes.
    remote.port = 0;
    if (connect(socket.handle, reinterpret_cast<const sockaddr*>(&remote), sizeof(remote)) == SOCKET_ERROR) {
        const auto error = WSAGetLastError();
        if (error != WSAEWOULDBLOCK && error != WSAEINPROGRESS) return {Status::service_unavailable};
        const int ready = waitSocket(socket.handle, true, deadline);
        if (!ready) return {Status::timeout};
        if (ready < 0) return {Status::service_unavailable};
        int socketError{}, size = sizeof(socketError);
        if (getsockopt(socket.handle, SOL_SOCKET, SO_ERROR, reinterpret_cast<char*>(&socketError), &size) == SOCKET_ERROR ||
            socketError) return {Status::service_unavailable};
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
            return {Status::success, reply->reading};
        }
    }
    return {Status::protocol_invalid};
}

} // namespace pm::rfcomm_battery
