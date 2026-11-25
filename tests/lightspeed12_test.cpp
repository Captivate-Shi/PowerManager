#include "lightspeed12.hpp"

#include <array>
#include <cassert>

int main()
{
    using namespace pm;
    struct Sample { unsigned pid, model, kind, flags; const wchar_t* name; };
    const std::array cases{
        Sample{0xc547, 0x4099, 3, named_percent_1004, L"G502 X PLUS"},
        Sample{0xc545, 0x4093, 3, named_percent_1004, L"PRO X Wireless"},
        Sample{0xc53f, 0x4074, 3, named_legacy_1000, L"G305 Lightspeed Wireless Gaming Mouse"},
        Sample{0xc53d, 0x4065, 0, named_legacy_1000, L"G613 Wireless Mechanical Gaming Keyboard"},
    };
    for (const auto& c : cases) {
        const auto r = lightspeed12Identity(0x046d, c.pid, c.model, c.name, c.kind);
        assert(r && r->model == c.model && r->kind == c.kind && r->batteryFeatures == c.flags);
        assert(!lightspeed12Identity(0x046d, c.pid, c.model, c.name, c.kind == 3 ? 0 : 3));
        assert(!lightspeed12Identity(0x046d, c.pid, c.model, c.name, 255));
        assert(!lightspeed12Identity(0x046d, c.pid, c.model, L"", c.kind));
        assert(!lightspeed12Identity(0x046d, 0xc52b, c.model, c.name, c.kind));
        assert(!lightspeed12Identity(0x046d, 0xc548, c.model, c.name, c.kind));
        assert(!lightspeed12Identity(0x1abc, c.pid, c.model, c.name, c.kind));
    }
    // Device Information feature words taken from the above models' HID++
    // reports. Bluetooth LE and USB occupy different advertised slots.
    constexpr std::array<std::uint8_t, 13> g502Info{0, 1, 2, 3, 4, 0, 0x0c, 0x40, 0x99, 0xc0, 0x95, 0, 0};
    constexpr std::array<std::uint8_t, 13> g613Info{0, 1, 2, 3, 4, 0, 0x06, 0xb3, 0x4f, 0x40, 0x65, 0, 0};
    static_assert(logitechReportedModel(g502Info, 4) == 0x4099);
    static_assert(logitechReportedModel(g502Info, 2) == 0);
    static_assert(logitechReportedModel(g613Info, 4) == 0x4065);
    static_assert(logitechReportedModel(g613Info, 2) == 0xb34f);
    assert(!lightspeed12Identity(0x046d, 0xc53d, logitechReportedModel(g613Info, 2),
        L"G613 Wireless Mechanical Gaming Keyboard", 0));
    assert(!lightspeed12Identity(0x046d, 0xc547, 0x409a, L"G502 X PLUS", 3));
    assert(!lightspeed12Identity(0x046d, 0xc547, 0x4099, L"G502 X LIGHTSPEED", 3));
    assert(!lightspeed12Identity(0x046d, 0xc547, 0x40a9, L"PRO X Wireless", 3));
    assert(!lightspeed12Identity(0x046d, 0xc53f, 0x40bc, L"G305 Lightspeed Wireless Gaming Mouse", 3));
    assert(!lightspeed12Identity(0x046d, 0xc541, 0x407c, L"G915 WIRELESS RGB MECHANICAL GAMING KEYBOARD", 0));
    assert(!lightspeed12Identity(0x046d, 0xc545, 0x408e, L"G915 TKL LIGHTSPEED Wireless RGB Mechanical Gaming Keyboard", 0));
}
