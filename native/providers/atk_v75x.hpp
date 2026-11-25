#pragma once

#include "battery.hpp"

#include <array>
#include <cstdint>
#include <span>
#include <string_view>

namespace pm {

constexpr bool atkV75XProduct(unsigned vid, unsigned pid, std::wstring_view productLower)
{
    if (vid != 0x320f) return false;
    if (pid == 0x5055) return productLower == L"atk v75x";
    if (pid == 0x5088)
        return productLower == L"atk v75x 2.4g dongle" || productLower == L"atk v75x dongle" ||
            productLower == L"atk v75x";
    return false;
}

constexpr bool atkV75XCollection(unsigned page, unsigned usage, unsigned input, unsigned output)
{
    return page == 0xff1c && usage == 0x0092 && input >= 32 && input <= 64 && output >= 32 && output <= 64;
}

// ATK HUB Evision status query as observed against a stock V75X. No
// configuration-session or mode-switch writes. Windows may pad the report
// to the collection's max report size; the 32-byte payload is otherwise fixed.
constexpr std::array<std::uint8_t, 64> makeAtkV75XQuery(unsigned sequence)
{
    return {0x04, static_cast<std::uint8_t>(sequence & 0xff),
        static_cast<std::uint8_t>((sequence >> 8) & 0xff), 0x1a};
}

constexpr std::optional<Sample> parseAtkV75XReply(std::span<const std::uint8_t> report, unsigned sequence)
{
    if (!sequence || sequence > 0xffff || report.size() < 32 || report.size() > 64 ||
        report[0] != 4 || report[1] != (sequence & 0xff) || report[2] != (sequence >> 8) ||
        report[3] != 0x1a || report[5] != 0 || report[6] != 0)
        return {};

    const int level = report[8];
    const auto charge = report[9];
    // An all-zero data area is also what a mere query echo would carry.
    if (level == 0 || level > 100 || charge > 2) return {};
    const auto power = charge == 1 ? Power::charging : charge == 0 ? Power::discharging : Power::unknown;
    return Sample{Status::current, Reading{level, level, power, level}, 4, charge, 0x1a};
}

} // namespace pm
