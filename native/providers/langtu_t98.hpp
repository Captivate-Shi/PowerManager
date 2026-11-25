#pragma once
#include "battery.hpp"
namespace pm {

constexpr bool langtuT98Collection(unsigned vid, unsigned pid, unsigned mi, unsigned page,
                                   unsigned usage, unsigned in, unsigned out)
{
    return vid == 0x1a2c && pid == 0x8fff && mi == 0 && page == 0xff02 &&
        usage == 2 && in == 65 && out == 65;
}

// The firmware reports a charge estimate; the fixed byte after it has
// been observed unchanged both on and off cable.
constexpr Sample parseLangtuT98(std::span<const std::uint8_t> frame)
{
    if (frame.size() != 65 || frame[0] != 0 || frame[1] != 0xaa || frame[2] != 0x55 ||
        frame[3] != 0xcc || frame[4] != 0x33 || frame[5] != 0x0e || frame[7] != 1)
        return {Status::bad_report};
    for (auto byte : frame.subspan(8))
        if (byte != 0) return {Status::bad_report};
    const int pct = frame[6];
    if (pct > 100) return {Status::unavailable};
    return {Status::current, Reading{pct, pct, Power::unknown, pct, ReadingSource::hid_voltage}};
}

} // namespace pm
