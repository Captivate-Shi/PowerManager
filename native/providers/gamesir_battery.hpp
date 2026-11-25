#pragma once

#include "battery.hpp"
#include <algorithm>
#include <string_view>

namespace pm::gamesir_battery {

// Names only identify the tested model within the documented receiver + HID
// collection. A generic GameSir string or shared receiver PID is not enough.
constexpr bool superNovaName(std::wstring_view name)
{
    return name == L"gamesir super nova" || name == L"gamesir-super nova" ||
        name == L"gamesir novapro" || name == L"gamesir-novapro" ||
        name == L"gamesir t4npro" || name == L"gamesir-t4npro" ||
        name == L"super nova" || name == L"novapro" || name == L"t4npro";
}

constexpr bool collection(unsigned vid, unsigned pid, unsigned page, unsigned input,
                          unsigned output, unsigned feature)
{
    return vid == 0x3537 && pid == 0x103e && page == 0xffa0 &&
        input == 64 && output == 32 && feature == 0;
}

constexpr std::array<std::uint8_t,32> deviceInfo{7,3,0x0a,1};

constexpr Sample parseReply(std::span<const std::uint8_t> bytes)
{
    if (bytes.size() != 64 || bytes[0] != 6 || bytes[1] != 14 || bytes[2] != 0x0a || bytes[3] != 1)
        return {Status::bad_report};
    const auto level = bytes[13];
    // 0xff means charging without a usable percent on this device. Do not
    // turn it into 100%, or send a full/low alert using a made-up sample.
    if (level == 0xff) return {Status::unavailable, {}, 6, level, 0x0a};
    if (level > 100) return {Status::bad_report, {}, 6, level, 0x0a};
    return {Status::current, Reading{level, level, Power::discharging, level}, 6, 0, 0x0a};
}

} // namespace pm::gamesir_battery
