#pragma once

#include "hid.hpp"
#include "logitech_office12.hpp"
#include "lightspeed12.hpp"
#include "supported_mouse_battery.hpp"

#include <algorithm>
#include <cwctype>
#include <string_view>
#include <numeric>

namespace pm {

// Wired identities only. Never infer a mouse model from a receiver PID.
constexpr const wchar_t* logitechUsbName(unsigned vid, unsigned pid)
{
    if (vid != 0x046d) return nullptr;
    switch (pid) {
    case 0xc088: return L"Logitech G PRO Wireless";
    case 0xc08d: return L"G502 LIGHTSPEED Wireless Gaming Mouse";
    case 0xc094: return L"Logitech PRO X SUPERLIGHT";
    case 0xc095: return L"Logitech G502 X PLUS";
    case 0xc098: return L"Logitech G502 X LIGHTSPEED";
    case 0xc09b: return L"Logitech PRO X SUPERLIGHT 2";
    default: return nullptr;
    }
}

inline std::optional<Transport> peripheralTransport(unsigned vid, unsigned pid)
{
    if (logitechUsbName(vid, pid)) return Transport::logitech_usb;
    if (supportedMouse(vid, pid)) return Transport::supported_mouse_receiver;
    if (isRapooReceiver(vid, pid)) return Transport::rapoo_receiver;
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

// Weisheng's VID/PID are shared by VGN and ATK. Use a product string
// allowlist instead of assigning the protocol vendor as the product brand.
inline const wchar_t* sharedKeyboardLabel(Transport transport, std::wstring_view product)
{
    std::wstring name(product);
    std::ranges::transform(name, name.begin(), [](wchar_t c) { return std::towlower(c); });
    const bool receiver = transport == Transport::vgn_receiver;
    if (name == L"atk v75x" || (receiver && name == L"atk v75x dongle"))
        return receiver ? L"ATK V75X 接收器" : L"ATK V75X";
    if (name == L"vgn v98 pro" || name == L"vgn v98 pro v2" ||
        (receiver && name == L"vgn v98 pro dongle"))
        return receiver ? L"VGN V98 Pro / V2 接收器" : L"VGN V98 Pro / V2";
    return receiver ? L"兼容键盘接收器" : L"兼容 USB 键盘";
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
    unsigned errorFrame{};
};

inline std::optional<LogitechReply> parseLogitechReply(std::span<const std::uint8_t> bytes,
                                                       unsigned slot, unsigned index, unsigned function)
{
    if (bytes.empty()) return {};
    const auto length = bytes[0] == 0x10 ? 7u : bytes[0] == 0x11 ? 20u : 0u;
    if (!length || bytes.size() < length || bytes[1] != slot) return {};
    // HIDClass can pad a short reply to the collection's maximum length.
    bytes = bytes.first(length);
    if ((bytes[2] == 0x8f || bytes[2] == 0xff) &&
        bytes[3] == index && bytes[4] == function) return LogitechReply{{}, bytes[5], bytes[2]};
    if (bytes[2] == index && bytes[3] == function) return LogitechReply{bytes.subspan(4)};
    return {};
}

// Error values overlap across HID++ generations; the response frame decides
// whether the slot is gone (1.0 UnknownDevice) or only busy (2.0 Busy).
constexpr Status logitechErrorStatus(unsigned errorFrame, unsigned error)
{
    if (errorFrame == 0x8f) {
        if (error == 8) return Status::offline;
        if (error == 7) return Status::busy;
        if (error == 4 || error == 9) return Status::no_radio_reply;
    } else if (errorFrame == 0xff && error == 8) {
        return Status::busy;
    }
    return Status::unavailable;
}

struct BoltOfficeIdentity { const wchar_t* label; unsigned kind; };

inline std::optional<BoltOfficeIdentity> boltOfficeIdentity(unsigned receiverVid, unsigned receiverPid,
                                                           std::wstring_view pairedLabel)
{
    if (receiverVid != 0x046d || receiverPid != 0xc548) return {};
    std::wstring name(pairedLabel);
    std::ranges::transform(name, name.begin(), [](wchar_t c) { return std::towlower(c); });
    if (name == L"mx keys s" || name == L"logitech mx keys s") return BoltOfficeIdentity{L"MX Keys S", 0};
    if (name == L"mx master 3s" || name == L"logitech mx master 3s") return BoltOfficeIdentity{L"MX Master 3S", 3};
    return {};
}

// The first two bytes of the six-byte HID++ Device FW Version model ID
// distinguish these Bolt models. They all report four trailing zero bytes.
inline unsigned boltOfficeModel(std::span<const std::uint8_t> deviceInfo)
{
    if (deviceInfo.size() < 13 || (deviceInfo[6] & 0x07) != 0x02 ||
        !std::ranges::all_of(deviceInfo.subspan(9, 4), [](auto b) { return b == 0; })) return 0;
    return (static_cast<unsigned>(deviceInfo[7]) << 8) | deviceInfo[8];
}

inline std::optional<BoltOfficeIdentity> boltBatch11Identity(unsigned receiverVid, unsigned receiverPid,
                                                              unsigned model, std::wstring_view pairedLabel,
                                                              unsigned kind)
{
    if (receiverVid != 0x046d || receiverPid != 0xc548) return {};
    std::wstring name(pairedLabel);
    std::ranges::transform(name, name.begin(), [](wchar_t c) { return std::towlower(c); });
    if (model == 0xb369 && (kind == 0 || kind == 255) && name == L"mx keys mini")
        return BoltOfficeIdentity{L"MX Keys Mini", 0};
    if (kind != 3 && kind != 255) return {};
    if (model == 0xb042 && name == L"mx master 4") return BoltOfficeIdentity{L"MX Master 4", 3};
    if (model == 0xb037 && name == L"mx anywhere 3s") return BoltOfficeIdentity{L"MX Anywhere 3S", 3};
    if (model == 0xb031 && name == L"lift vertical ergonomic mouse")
        return BoltOfficeIdentity{L"Lift Vertical Ergonomic Mouse", 3};
    // The M650 and M650 L can share the model ID. Only the plain unit's
    // DEVICE NAME value counts here; neither the codename nor a prefix does.
    if (model == 0xb02a && name == L"signature m650 mouse")
        return BoltOfficeIdentity{L"Signature M650", 3};
    return {};
}

inline std::optional<LogitechNamedIdentity> logitechNamedIdentity(unsigned vid, unsigned pid,
                                                                 unsigned model, std::wstring_view label,
                                                                 unsigned kind)
{
    if (logitechBolt(vid, pid) && model == 0xb36f && (kind == 0 || kind == 255)) {
        std::wstring name(label);
        std::ranges::transform(name, name.begin(), [](wchar_t c) { return std::towlower(c); });
        if (name == L"signature k650" || name == L"signature k650 keyboard")
            return LogitechNamedIdentity{L"Signature K650", 0, model, named_percent_1004 | named_legacy_1000};
    }
    if (auto office = office12Identity(vid, pid, model, label, kind)) return office;
    if (auto lightspeed = lightspeed12Identity(vid, pid, model, label, kind)) return lightspeed;
    if (const auto bolt = boltBatch11Identity(vid, pid, model, label, kind))
        return LogitechNamedIdentity{bolt->label, bolt->kind, model, named_percent_1004};
    return {};
}

// Restrict the empirical 0x1001 curve to the paired product name, not the
// receiver PID (the same receiver may serve multiple devices). Never apply it
// to ADC features, keyboards or unverified generations.
inline bool logitechVoltageProfile(std::wstring_view label)
{
    std::wstring name(label);
    std::ranges::transform(name, name.begin(), [](wchar_t c) { return std::towlower(c); });
    return name == L"g502 lightspeed wireless gaming mouse" || name == L"g502 lightspeed" ||
        name == L"g pro wireless gaming mouse" || name == L"logitech g pro wireless";
}

inline std::optional<bool> namedLegacyCoarse(std::span<const std::uint8_t> capabilities)
{
    if (capabilities.size() < 2 || capabilities[0] < 2 || capabilities[0] > 100) return {};
    // The draft HID++ 0x1000 specification assigns four ranges if the
    // firmware exposes fewer than ten levels or disables the mileage bit.
    return capabilities[0] < 10 || !(capabilities[1] & 2);
}

inline Sample logitechBattery(unsigned feature, bool percentage, std::span<const std::uint8_t> data,
                              bool coarse = false, bool estimateVoltage = false)
{
    if (data.size() < 3) return {Status::bad_report, {}, 0x11, 0, feature};
    if (feature == 0x1001) {
        const unsigned millivolts = (data[0] << 8) | data[1];
        if (millivolts < 2000 || millivolts > 5000) return {Status::bad_report, {}, 0x11, data[2], feature};
        const auto unavailable = Sample{Status::unavailable, {}, 0x11, data[2], feature, millivolts};
        if (!estimateVoltage || millivolts < 3500 || millivolts > 4400) return unavailable;
        // Prefer the explicit charge-complete bit. While attached otherwise,
        // voltage is not comparable to the on-battery curve: keep the last
        // valid reading and do not trigger a new low-power notification.
        const auto flags = data[2];
        if (flags & 0x80) {
            if ((flags & 7) == 1) return {Status::current,
                Reading{100, 100, Power::full, static_cast<int>(millivolts), ReadingSource::hid_voltage},
                0x11, flags, feature, millivolts};
            return unavailable;
        }
        // Ten-point cuts from the public Logitech/Linux 0x1001 reference
        // curve. Expose bands, not one-percent precision; real discharge
        // varies by load and battery condition.
        constexpr std::array decadeCuts{3671u, 3717u, 3751u, 3778u, 3811u,
                                        3859u, 3922u, 3989u, 4067u};
        const int low = 10 * static_cast<int>(std::upper_bound(decadeCuts.begin(), decadeCuts.end(), millivolts)
            - decadeCuts.begin());
        return {Status::current, Reading{low, low + 10, Power::discharging,
                    static_cast<int>(millivolts), ReadingSource::hid_voltage}, 0x11, flags, feature, millivolts};
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
