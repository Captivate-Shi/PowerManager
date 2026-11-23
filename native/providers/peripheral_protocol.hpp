#pragma once

#include "hid.hpp"

#include <algorithm>
#include <numeric>

namespace pm {

inline std::optional<Transport> peripheralTransport(unsigned vid, unsigned pid)
{
    if (vid == 0x320f && pid == 0x5055) return Transport::vgn_usb;
    if (vid == 0x320f && pid == 0x5088) return Transport::vgn_receiver;
    if (vid == 0x258a && pid == 0x024e) return Transport::vgn_v3_usb;
    if (vid == 0x258a && pid == 0x024f) return Transport::vgn_v3_receiver;
    constexpr unsigned receivers[]{0xc548,0xc52b,0xc532,0xc52f,0xc518,0xc51a,0xc51b,0xc521,0xc525,0xc526,
        0xc52e,0xc531,0xc534,0xc535,0xc537,0xc539,0xc53a,0xc53d,0xc53f,0xc541,0xc545,0xc547,0xc54d};
    if (vid == 0x046d && std::ranges::find(receivers, pid) != std::ranges::end(receivers)) {
        return Transport::logitech_receiver;
    }
    return {};
}

inline bool isVgn(Transport transport)
{
    return transport == Transport::vgn_usb || transport == Transport::vgn_receiver ||
        transport == Transport::vgn_v3_usb || transport == Transport::vgn_v3_receiver;
}

inline bool vgnChannel(Transport transport, const Collection& channel)
{
    if (channel.page < 0xff00 || channel.page > 0xffff) return false;
    if (transport == Transport::vgn_v3_usb) return channel.featureLength == 521;
    if (transport == Transport::vgn_v3_receiver) {
        return channel.page == 0xff02 && channel.usage == 2 && channel.inputLength >= 7 &&
            channel.inputLength <= 64 && (channel.outputLength == 19 || channel.outputLength == 20);
    }
    return channel.inputLength >= 10 && channel.inputLength <= 128 &&
        channel.outputLength >= 8 && channel.outputLength <= 128;
}

inline std::vector<std::uint8_t> vgnQuery(Transport transport, const Collection& channel)
{
    if (!vgnChannel(transport, channel)) return {};
    if (transport == Transport::vgn_v3_usb) {
        std::vector<std::uint8_t> command(channel.featureLength);
        command[0] = 9;
        command[1] = 0x87;
        command[4] = 1;
        command[6] = 2;
        return command;
    }

    std::vector<std::uint8_t> command(channel.outputLength);
    if (transport == Transport::vgn_v3_receiver) {
        command[0] = 0x13;
        command[1] = 0x4a;
        command[2] = 1;
        // The 20-byte layout has the checksum at byte 19; the 19-byte capture has no such byte.
        if (command.size() == 20) command.back() = static_cast<std::uint8_t>(std::accumulate(command.begin(), command.end(), 0));
    } else {
        command[0] = 4;
        command[3] = 0x1a;
        command[4] = 6;
    }
    return command;
}

inline std::optional<Sample> parseVgn(Transport transport, std::span<const std::uint8_t> bytes)
{
    unsigned percent, flags, report, feature;
    if (transport == Transport::vgn_v3_receiver) {
        if (bytes.size() < 7 || bytes[0] != 0x13 || bytes[1] != 0x4a || bytes[2] != 1) return {};
        if (bytes[4] != 2) return Sample{Status::no_radio_reply, {}, 0x13, bytes[4], 0x4a};
        percent = bytes[5]; flags = bytes[6]; report = 0x13; feature = 0x4a;
        if (percent == 0) return Sample{Status::unavailable, {}, report, flags, feature};
    } else if (transport == Transport::vgn_v3_usb) {
        if (bytes.size() < 11 || bytes[0] != 9 || bytes[1] != 0x87) return {};
        percent = bytes[9]; flags = bytes[10]; report = 9; feature = 0x87;
    } else {
        if (bytes.size() < 10 || bytes[0] != 4 || bytes[3] != 0x1a) return {};
        percent = bytes[8]; flags = bytes[9]; report = 4; feature = 0x1a;
        if (flags > 1) return Sample{Status::bad_report, {}, report, flags, feature};
    }
    if (percent > 100) return Sample{Status::bad_report, {}, report, percent, feature};
    const auto charging = report == 4 ? flags == 1 : (flags & 0xf0) == 0x10;
    const auto knownDischarge = report == 4 || (flags & 0xf0) == 0;
    const int level = static_cast<int>(percent);
    return Sample{Status::current, Reading{level, level, charging ? Power::charging :
        knownDischarge ? Power::discharging : Power::unknown, level}, report, flags, feature};
}

struct LogitechReply {
    std::span<const std::uint8_t> params;
    unsigned error{};
};

inline std::optional<LogitechReply> parseLogitechReply(std::span<const std::uint8_t> bytes,
                                                       unsigned slot, unsigned index, unsigned function)
{
    if (bytes.size() < 4 || (bytes[0] != 0x10 && bytes[0] != 0x11) || bytes[1] != slot) return {};
    if (bytes.size() >= 6 && (bytes[2] == 0x8f || bytes[2] == 0xff) &&
        bytes[3] == index && bytes[4] == function) return LogitechReply{{}, bytes[5]};
    if (bytes[2] == index && bytes[3] == function) return LogitechReply{bytes.subspan(4)};
    return {};
}

inline Sample logitechBattery(unsigned feature, bool percentage, std::span<const std::uint8_t> data, bool coarse = false)
{
    if (data.size() < 3) return {Status::bad_report, {}, 0x11, 0, feature};
    if (feature == 0x1001) {
        const unsigned millivolts = (data[0] << 8) | data[1];
        if (millivolts < 2000 || millivolts > 5000) return {Status::bad_report, {}, 0x11, data[2], feature};
        return {Status::unavailable, {}, 0x11, data[2], feature, millivolts};
    }
    if (!percentage) return {Status::unavailable, {}, 0x11, data[1], feature};
    if (data[0] > 100) return {Status::bad_report, {}, 0x11, data[0], feature};
    const auto status = data[2];
    const bool legacy = feature == 0x1000;
    if (status > (legacy ? 7 : 4)) return {Status::bad_report, {}, 0x11, status, feature};
    if ((legacy && status >= 5) || (!legacy && status == 4)) {
        return {Status::charging_error, {}, 0x11, status, feature};
    }
    const auto power = status == 0 ? Power::discharging : status == 3 ? Power::full : Power::charging;
    const int raw = data[0];
    if (legacy && status == 3) return {Status::current, Reading{100, 100, power, raw}, 0x11, status, feature};
    if (legacy && (status != 0 || raw == 0)) return {Status::unavailable, {}, 0x11, status, feature};
    int low = raw, high = raw;
    if (legacy && coarse) {
        if (raw <= 10) { low = 0; high = 10; }
        else if (raw <= 30) { low = 11; high = 30; }
        else if (raw <= 80) { low = 31; high = 80; }
        else { low = 81; high = 100; }
    }
    return {Status::current, Reading{low, high, power, raw}, 0x11, status, feature};
}

} // namespace pm
