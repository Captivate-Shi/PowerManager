#pragma once

#include <bit>
#include <cstdint>
#include <span>

namespace pm {

struct LogitechNamedIdentity {
    const wchar_t* label;
    unsigned kind;
    unsigned model;
    unsigned batteryFeatures;
};

constexpr unsigned named_percent_1004 = 1;
constexpr unsigned named_legacy_1000 = 2;
constexpr unsigned named_voltage_1001 = 4;

constexpr unsigned namedBatteryFlag(unsigned feature)
{
    return feature == 0x1004 ? named_percent_1004
        : feature == 0x1000 ? named_legacy_1000
        : feature == 0x1001 ? named_voltage_1001 : 0u;
}

constexpr bool logitechUnifying(unsigned vid, unsigned pid)
{
    return vid == 0x046d && (pid == 0xc52b || pid == 0xc532);
}

constexpr bool logitechBolt(unsigned vid, unsigned pid)
{
    return vid == 0x046d && pid == 0xc548;
}

// DEVICE_FW_VERSION packs the 16-bit application IDs in ascending transport
// bit order. Only an ID labelled for the requested link is accepted.
constexpr unsigned logitechReportedModel(std::span<const std::uint8_t> info, unsigned link)
{
    if (info.size() < 13 || (link != 2 && link != 4) || !(info[6] & link)) return 0;
    const unsigned flags = info[6] & 0x0f;
    const unsigned count = std::popcount(flags);
    if (count > 3) return 0;
    for (unsigned i = 7 + 2 * count; i < 13; ++i)
        if (info[i] != 0) return 0;
    const unsigned start = 7 + 2 * std::popcount(flags & (link - 1));
    const unsigned model = (static_cast<unsigned>(info[start]) << 8) | info[start + 1];
    return model == 0xffff ? 0u : model;
}

} // namespace pm
