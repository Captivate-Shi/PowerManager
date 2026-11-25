#pragma once

#include "battery.hpp"

#include <string_view>

namespace pm {

// AULA F87ProV2D 2.4 GHz receiver only. The PID/usage is shared across vendors;
// both the exact HID product string and descriptor proof are required.
// The caller must separately resolve the physical USB parent and reject ambiguity.
constexpr bool aulaF87ProV2DCollection(unsigned vid, unsigned pid, int iface,
    unsigned page, unsigned usage, unsigned inputLength, unsigned outputLength,
    std::wstring_view product, bool unnumberedIoProven)
{
    return vid == 0x0c45 && pid == 0xfefe && iface == 3 &&
        page == 0xff60 && usage == 0x61 && inputLength == 33 && outputLength == 33 &&
        product == L"AULA F87ProV2D Dongle" && unnumberedIoProven;
}

// Vendor app's status-page query independently documented by MyFinder
// (engine/upstream-protocols.md, "AULA F87ProV2"). These are Win32 HID
// buffers, including the leading zero for the unnumbered report.
using AulaF87ProV2DReport = std::array<std::uint8_t, 33>;
constexpr AulaF87ProV2DReport makeAulaF87ProV2DQuery()
{
    return {0, 0xaa, 0x10, 0x18, 0x00};
}

constexpr Sample parseAulaF87ProV2DReply(std::span<const std::uint8_t> report)
{
    if (report.size() != AulaF87ProV2DReport{}.size() || report[0] != 0 ||
        report[1] != 0x55 || report[2] != 0x10 || report[3] != 0x18 ||
        report[4] != 0x00 || report[26] > 100)
        return {Status::bad_report};

    const int percent = report[26];
    return {Status::current, Reading{percent, percent, Power::unknown, percent}};
}

// Inventory label only. The receiver can answer successfully with a cached
// level after the mouse is turned off. A matching report is not live evidence.
constexpr bool isDareuEm901xReceiver(unsigned vid, unsigned pid)
{
    return vid == 0x260d && pid == 0x1074;
}

} // namespace pm
