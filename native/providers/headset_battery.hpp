#pragma once

#include "battery.hpp"

namespace pm::headset_battery {

enum class Lane { none, jbl350, jbl610, jbl650, nova7 };

constexpr Lane lane(unsigned vid, unsigned pid)
{
    if (vid == 0x0ecb) {
        if (pid == 0x206b) return Lane::jbl350;
        if (pid == 0x205c) return Lane::jbl610;
        if (pid == 0x2125) return Lane::jbl650;
    }
    return vid == 0x1038 && pid == 0x22a1 ? Lane::nova7 : Lane::none;
}

constexpr const wchar_t* name(Lane type)
{
    switch (type) {
    case Lane::jbl350: return L"JBL Quantum 350 Wireless";
    case Lane::jbl610: return L"JBL Quantum 610 Wireless";
    case Lane::jbl650: return L"JBL Quantum 650 Wireless";
    case Lane::nova7: return L"SteelSeries Arctis Nova 7";
    default: return L"";
    }
}

constexpr bool collection(Lane type, unsigned mi, unsigned page, unsigned usage,
                          unsigned in, unsigned out, unsigned feat)
{
    switch (type) {
    case Lane::jbl350: return mi == 3 && page == 1 && usage == 0 && feat == 64;
    case Lane::jbl610: return mi == 5 && out <= 64 && feat >= 17 && feat <= 64;
    case Lane::jbl650: return page == 0xff12 && feat == 64 && in == 64;
    case Lane::nova7: return mi == 3 && page == 0xffc0 && usage == 1 && in >= 4 && in <= 65 && out >= 2 && out <= 65;
    default: return false;
    }
}

constexpr int jblByte(std::span<const std::uint8_t> frame, std::uint8_t id)
{
    return frame.size() >= 2 && frame[0] == id ? frame[1] : -1;
}

constexpr std::array<std::uint8_t, 64> jbl650Request()
{
    // Numbered HIDV3 feature GET device-info for battery subfeature 000d.
    return {0x88, 0x00, 0xdd, 0x01, 0x00, 1, 0, 2, 0, 0x0d, 0};
}

constexpr Sample jbl650Battery(std::span<const std::uint8_t> x)
{
    if (x.size() < 16 || x[0] != 0x86 || x[1] != 0 || x[2] != 0xdd || x[3] != 1 ||
        x[4] != 0 || x[5] != 1 || x[6] != 0 || x[11] != 0x0d || x[12] != 0 || x[13] != 1 || x[14] != 0)
        return {Status::bad_report};
    if (x[10] & 0x80) return {Status::no_radio_reply};
    const int n = x[15] & 0x7f;
    if (n > 100) return {Status::bad_report};
    return {Status::current, Reading{n,n,(x[15] & 0x80) ? Power::charging : Power::discharging,n},0x86};
}

constexpr Sample nova7Battery(std::span<const std::uint8_t> x)
{
    if (!x.empty() && x[0] == 0) x = x.subspan(1); // optional Win32 unnumbered ID
    if (x.size() < 4 || x[0] != 0xb0 || (x[1] != 2 && x[1] != 3))
        return {Status::bad_report};
    if (x[1] == 2 || x[3] == 0) return {Status::no_radio_reply};
    if (x[2] > 100 || x[3] > 3) return {Status::bad_report};
    const int n = x[2];
    return {Status::current, Reading{n,n,x[3] == 3 ? Power::discharging : Power::charging,n},0xb0};
}

}
