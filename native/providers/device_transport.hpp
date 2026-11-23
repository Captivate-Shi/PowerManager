#pragma once

#include <algorithm>
#include <cwctype>
#include <ranges>
#include <span>
#include <string>
#include <string_view>

namespace pm {

enum class WindowsBus { unknown, usb, bluetooth };

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
            lower.starts_with(L"bthle\\") || lower.starts_with(L"hid\\{00001124-")) {
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
