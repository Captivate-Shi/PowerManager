#pragma once

#include <algorithm>
#include <cwctype>
#include <ranges>
#include <span>
#include <string>
#include <string_view>

namespace pm {

enum class WindowsBus { unknown, usb, bluetooth };

// "HID" alone does not identify the transport. These instance IDs
// explicitly contain the Bluetooth Classic HID or HID-over-GATT service.
constexpr bool bluetoothHidInstance(std::wstring_view folded)
{
    return folded.starts_with(L"hid\\{00001124-") ||
        folded.starts_with(L"hid\\{00001812-0000-1000-8000-00805f9b34fb}");
}

constexpr bool windowsKeyboardInstanceCandidate(std::wstring_view folded)
{
    // Only called on a present Windows Keyboard class devnode, not a
    // display name or the generic USB receiver container.
    return folded.starts_with(L"hid\\vid_") || bluetoothHidInstance(folded) ||
        folded.starts_with(L"bthenum\\") || folded.starts_with(L"bthledevice\\") ||
        folded.starts_with(L"bthle\\");
}

inline WindowsBus windowsBus(std::span<const std::wstring_view> methods,
                             std::span<const std::wstring_view> hardwareIds)
{
    const auto fold = [](std::wstring_view input) {
        std::wstring value(input);
        std::ranges::transform(value, value.begin(), [](wchar_t ch) {
            return static_cast<wchar_t>(std::towlower(ch));
        });
        return value;
    };
    bool usb = false;
    for (const auto method : methods) {
        const auto lower = fold(method);
        if (lower.find(L"bluetooth") != std::wstring::npos) return WindowsBus::bluetooth;
        usb = usb || lower == L"usb";
    }
    for (const auto id : hardwareIds) {
        const auto lower = fold(id);
        if (lower.starts_with(L"bthenum\\") || lower.starts_with(L"bthledevice\\") ||
            lower.starts_with(L"bthle\\") || bluetoothHidInstance(lower)) {
            return WindowsBus::bluetooth;
        }
        usb = usb || lower.starts_with(L"usb\\");
    }
    return usb ? WindowsBus::usb : WindowsBus::unknown;
}

inline const wchar_t* windowsConnection(WindowsBus bus)
{
    switch (bus) {
    case WindowsBus::bluetooth: return L"蓝牙";
    case WindowsBus::usb: return L"USB（直连或接收器）";
    default: return L"Windows 外设";
    }
}

} // namespace pm
