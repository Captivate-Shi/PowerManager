#pragma once

#include "battery.hpp"
#include <string>

namespace pm {

enum class SupportedMouse { aerox9, aulaV9 };
enum class SupportedMouseReason : unsigned { descriptor = 1, open, write, silent, invalidReply, read };

constexpr std::optional<SupportedMouse> supportedMouse(unsigned vid, unsigned pid)
{
    if (vid == 0x1038 && pid == 0x1858) return SupportedMouse::aerox9;
    if (vid == 0x320f && pid == 0x22ba) return SupportedMouse::aulaV9;
    return {};
}

constexpr bool supportedMouseCollection(SupportedMouse kind, int iface, unsigned page, unsigned usage)
{
    if (kind == SupportedMouse::aerox9) return iface == 3 && page == 0xffc0 && usage == 1;
    return iface == 1 && page == 0xff1c && usage == 0x92;
}

constexpr std::array<std::uint8_t, 64> supportedMouseQuery(SupportedMouse kind)
{
    if (kind == SupportedMouse::aerox9) return {0x00, 0xd2};
    return {0x04, 0x00, 0x00, 0x1a};
}

constexpr Sample parseSupportedMouseReply(SupportedMouse kind, std::span<const std::uint8_t> bytes)
{
    if (kind == SupportedMouse::aerox9) {
        // ReadFile preserves the unnumbered Windows report ID slot. Test the
        // payload separately from report length validation in the transport.
        if (bytes.size() < 3 || bytes[0] != 0 || bytes[1] != 0xd2)
            return {Status::bad_report};
        const auto raw = bytes[2] & 0x7f;
        if (!raw) return {Status::no_radio_reply, {}, 0xd2};
        if (raw > 21) return {Status::bad_report};
        // Native 5% levels only; charging bit lacks a physical test here.
        const auto level = (raw - 1) * 5;
        return {Status::current, Reading{level, level, Power::unknown, bytes[2]}, 0xd2};
    }
    if (bytes.size() != 64 || bytes[0] != 4 || bytes[1] != 0 || bytes[2] != 0
        || bytes[3] != 0x1a || bytes[4] != 0 || bytes[5] != 0 || bytes[6] != 0
        || bytes[7] != 0 || bytes[8] > 100)
        return {Status::bad_report};
    // A byte-for-byte request echo is not a measurement. No independent empty
    // battery packet establishes that exactly 0 is a real sample on this lane.
    if (!bytes[8]) return {Status::no_radio_reply, {}, 0x1a};
    return {Status::current, Reading{bytes[8], bytes[8], Power::unknown, bytes[8]}, 0x1a};
}

// Caller must prove the physical USB parent and a unique matching collection
// within it. Interface number is from the Windows USB topology, not a guess.
Sample readSupportedMouseBattery(SupportedMouse kind, int iface, const std::wstring& path);

} // namespace pm
