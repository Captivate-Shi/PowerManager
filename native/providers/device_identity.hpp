#pragma once

#include <algorithm>
#include <cstdint>
#include <span>
#include <string>
#include <string_view>

namespace pm {

inline std::wstring dualSenseAddressKey(std::wstring_view address)
{
    if (address.size() != 12 || !std::ranges::all_of(address, [](wchar_t c) {
            return (c >= L'0' && c <= L'9') || (c >= L'a' && c <= L'f');
        }) || address == L"000000000000" || address == L"ffffffffffff") {
        return {};
    }
    return std::wstring(L"dualsense:") + std::wstring(address);
}

inline std::wstring dualSenseUsbIdentity(std::span<const std::uint8_t> report)
{
    if (report.size() < 7 || report.front() != 0x09) {
        return {};
    }
    constexpr std::wstring_view hex = L"0123456789abcdef";
    std::wstring address;
    for (std::size_t i = 6; i != 0; --i) {
        address += hex[report[i] >> 4];
        address += hex[report[i] & 0xf];
    }
    return dualSenseAddressKey(address);
}

inline std::wstring dualSenseBluetoothIdentity(std::wstring_view node)
{
    constexpr std::wstring_view remote = L"bthenum\\dev_";
    if (node.starts_with(remote)) {
        const auto address = node.substr(remote.size(), node.find(L'\\', remote.size()) - remote.size());
        return dualSenseAddressKey(address);
    }
    if (!node.starts_with(L"bthenum\\{00001124-")) {
        return {};
    }
    // The HID service instance ends in "&<remote address>_C00000000" on Windows.
    const auto delimiter = node.find_last_of(L'&');
    if (delimiter == std::wstring_view::npos) {
        return {};
    }
    const auto addressAndFlags = node.substr(delimiter + 1);
    const auto flags = addressAndFlags.find(L'_');
    return flags == 12 ? dualSenseAddressKey(addressAndFlags.substr(0, flags)) : std::wstring{};
}

} // namespace pm
