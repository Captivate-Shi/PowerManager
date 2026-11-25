#pragma once

#include "battery.hpp"

namespace pm::vendor_pad {
enum class Model { apex5, vader5, nova2LiteUsb };
enum class Link { usb, receiver };

constexpr std::optional<Model> match(unsigned vid, unsigned pid)
{
    if (vid == 0x37d7 && pid == 0x2501) return Model::apex5;
    if (vid == 0x37d7 && pid == 0x2401) return Model::vader5;
    if (vid == 0x3537 && pid == 0x100f) return Model::nova2LiteUsb;
    return {};
}

constexpr const wchar_t* name(Model model)
{
    switch (model) {
    case Model::apex5: return L"Flydigi Apex 5";
    case Model::vader5: return L"Flydigi Vader 5 Pro";
    case Model::nova2LiteUsb: return L"GameSir Nova 2 Lite";
    }
    return L"";
}

constexpr bool collection(Model model, unsigned page, unsigned usage, unsigned in, unsigned out)
{
    if (model == Model::nova2LiteUsb)
        return page == 0xff7a && usage != 0 && in == 65 && out == 65;
    return page == 0xffa0 && usage == 1 && (in == 33 || in == 65) && (out == 33 || out == 65);
}

constexpr unsigned outputId(Model model)
{
    return model == Model::apex5 ? 3u : 0u;
}

constexpr std::array<std::uint8_t, 65> request(Model model, bool architecture = false)
{
    if (model == Model::nova2LiteUsb) return {0, 1, 1};
    return {static_cast<std::uint8_t>(outputId(model)), 0x5a, 0xa5,
            static_cast<std::uint8_t>(architecture ? 7 : 1),
            static_cast<std::uint8_t>(architecture ? 0 : 2), 0};
}

constexpr bool flydigiModel(Model model, unsigned id)
{
    if (model == Model::vader5) return id == 130;
    if (model == Model::apex5) return id == 128 || id == 129 || id == 133 || id == 134 || id == 135;
    return false;
}

constexpr std::span<const std::uint8_t> flydigiBody(std::span<const std::uint8_t> bytes, unsigned cmd)
{
    // Win32 keeps the leading byte (zero for an unnumbered HID report).
    if ((bytes.size() != 33 && bytes.size() != 65) || (bytes[0] != 0 && bytes[0] != 4) ||
        bytes[1] != 0x5a || bytes[2] != 0xa5 || bytes[3] != cmd) return {};
    return bytes.subspan(1);
}

constexpr std::optional<bool> architecture(std::span<const std::uint8_t> bytes)
{
    const auto data = flydigiBody(bytes, 7);
    if (data.size() < 5) return {};
    return data[3] == 1 && data[4] == 0;
}

constexpr std::optional<Link> link(unsigned raw, bool modern)
{
    if (raw == (modern ? 0u : 1u)) return Link::usb;
    if (raw == (modern ? 1u : 2u)) return Link::receiver;
    return {};
}

constexpr std::optional<Sample> parse(Model model, std::span<const std::uint8_t> bytes, bool modern = false)
{
    if (model == Model::nova2LiteUsb) {
        // 01 = reply, followed by receiver identity/firmware fields. Ignore F4 input.
        if (bytes.size() != 65 || bytes[0] != 0 || bytes[1] != 1) return {};
        const auto raw = bytes[19];
        if (raw == 255) return Sample{Status::unavailable, {}, 1, raw}; // charging without level
        if (raw > 100) return Sample{Status::bad_report, {}, 1, raw};
        return Sample{Status::current, Reading{raw, raw, Power::unknown, raw}, 1, raw};
    }
    const auto data = flydigiBody(bytes, 1);
    if (data.size() < 17) return {};
    const auto battery = data[11];
    const auto state = static_cast<unsigned>(battery >> 4), step = battery & 15u;
    const auto firmware = static_cast<unsigned>(data[15]) * 256u + data[16];
    if (!flydigiModel(model, data[5]) || !link(data[6], modern) ||
        firmware < (model == Model::apex5 ? 0x7031u : 0x7141u) || state > 2 || step > 5)
        return Sample{Status::bad_report, {}, 1, battery};
    if (state == 2) return Sample{Status::current, Reading{100, 100, Power::full, battery}, 1, battery};
    // This is a 20-point device indicator, not calibrated state of charge.
    // Give it a conservative interval so alerts do not treat x20 as a measured percent.
    const int centre = static_cast<int>(step) * 20;
    return Sample{Status::current, Reading{centre <= 20 ? 0 : centre - 20, centre >= 80 ? 100 : centre + 20,
        state == 1 ? Power::charging : Power::discharging, battery}, 1, battery};
}
}
