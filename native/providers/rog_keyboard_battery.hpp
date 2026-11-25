#pragma once
#include "battery.hpp"

#include <array>
#include <string_view>

namespace pm::rog_keyboard {
enum class Port { none, azoth, omniIdentity, omniBattery };
constexpr unsigned vendor = 0x0b05;
constexpr unsigned azothReceiver = 0x1a85;
constexpr unsigned omniReceiver = 0x1ace;
constexpr unsigned falchionPaired = 0x1b06;

// These are HIDClass report lengths, including the report-ID slot. A maximum
// report length alone is not sufficient; caller also proves only report ID.
constexpr Port endpoint(unsigned vid, unsigned pid, std::wstring_view product,
                        unsigned iface, unsigned col, unsigned page, unsigned usage,
                        unsigned in, unsigned out)
{
    if (vid != vendor) return Port::none;
    if (pid == azothReceiver && product == L"rog azoth" && iface == 1 &&
        page == 0xff00 && usage == 1 && in == 65 && out == 65)
        return Port::azoth;
    if (pid != omniReceiver || product != L"rog omni receiver" || iface != 2 ||
        in != 64 || out != 64)
        return Port::none;
    if (col == 1 && 0xff00 <= page && page <= 0xffff) return Port::omniIdentity;
    if (col == 2 && page == 0xff00 && usage == 1) return Port::omniBattery;
    return Port::none;
}

constexpr Port pathRole(std::wstring_view path)
{
    constexpr std::wstring_view prefix = LR"(\\?\hid#)";
    if (!path.starts_with(prefix)) return Port::none;
    path.remove_prefix(prefix.size());
    const auto end = path.find(L'#');
    if (end == std::wstring_view::npos || end + 1 == path.size()) return Port::none;
    const auto head = path.substr(0, end);
    constexpr std::wstring_view azoth = L"vid_0b05&pid_1a85&mi_01";
    const auto hex = [](wchar_t c) { return (L'0' <= c && c <= L'9') || (L'a' <= c && c <= L'f'); };
    if (head == azoth ||
        (head.size() == azoth.size() + 6 && head.starts_with(azoth) && head.substr(azoth.size(), 4) == L"&col" &&
         hex(head[azoth.size() + 4]) && hex(head[azoth.size() + 5])))
        return Port::azoth;
    if (head == L"vid_0b05&pid_1ace&mi_02&col01") return Port::omniIdentity;
    if (head == L"vid_0b05&pid_1ace&mi_02&col02") return Port::omniBattery;
    return Port::none;
}

constexpr unsigned reportId(Port port)
{
    return port == Port::omniIdentity ? 1 : port == Port::omniBattery ? 2 : 0;
}

constexpr std::array<std::uint8_t, 65> request(Port port)
{
    std::array<std::uint8_t, 65> bytes{};
    bytes[0] = static_cast<std::uint8_t>(reportId(port));
    if (port == Port::omniIdentity) bytes[1] = 0xa0;
    if (port == Port::azoth || port == Port::omniBattery) {
        bytes[1] = 0x12;
        bytes[2] = 1;
    }
    return bytes;
}

constexpr bool documentedMouse(unsigned pid)
{
    switch (pid) {
    case 0x1c0e: case 0x1a94: case 0x1b68: case 0x1b69: case 0x1b1a:
    case 0x1b18: case 0x1ad7: case 0x1b65: case 0x1a68: case 0x1a6a: case 0x1a72:
        return true;
    default: return false;
    }
}

// The pairing response is [01 A0 ...] and the associated pair list has four
// bytes per device at offset five. A known mouse can share the receiver, but
// require exactly one Falchion and never infer it from the shared USB PID.
constexpr bool falchionPairedOnly(std::span<const std::uint8_t> bytes)
{
    if (bytes.size() != 64 || bytes[0] != 1 || bytes[1] != 0xa0) return false;
    const auto pid = [&](unsigned at) {
        return static_cast<unsigned>(bytes[at]) | (static_cast<unsigned>(bytes[at + 1]) << 8);
    };
    const auto first = pid(5);
    const auto second = pid(9);
    if (pid(13) != 0) return false;
    return (first == falchionPaired && (second == 0 || documentedMouse(second))) ||
        (documentedMouse(first) && second == falchionPaired);
}

// Successful battery page provides the current data. FF AA is the captured
// explicit rejection when Falchion is off, not a cached low percentage.
constexpr Sample read(Port port, std::span<const std::uint8_t> bytes)
{
    if (port != Port::azoth && port != Port::omniBattery) return {Status::unavailable};
    if (bytes.size() != (port == Port::azoth ? 65u : 64u) || bytes[0] != reportId(port))
        return {Status::bad_report};
    if (bytes[1] == 0xff && bytes[2] == 0xaa) return {Status::no_radio_reply};
    if (bytes[1] != 0x12 || bytes[2] != 0x01) return {Status::bad_report};
    const auto level = bytes[port == Port::azoth ? 6 : 11];
    const auto charging = bytes[9];
    if (level == 0) return {Status::no_radio_reply};
    if (level > 100 || charging > 1) return {Status::bad_report};
    return {Status::current, Reading{level, level, charging == 1 ? Power::charging : Power::discharging, level},
            reportId(port)};
}
} // namespace pm::rog_keyboard
