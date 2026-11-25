#include "../native/providers/supported_mouse_battery.hpp"

#include <cassert>
#include <string_view>

int main()
{
    using namespace pm;
    constexpr auto aerox = SupportedMouse::aerox9;
    constexpr auto aula = SupportedMouse::aulaV9;
    constexpr auto aerox3 = SupportedMouse::aerox3;
    constexpr auto aerox5 = SupportedMouse::aerox5;
    static_assert(supportedMouse(0x1038, 0x1838) == aerox3);
    static_assert(supportedMouse(0x1038, 0x1852) == aerox5);
    static_assert(supportedMouse(0x1038, 0x1858) == aerox);
    static_assert(!supportedMouse(0xffff, 0x1838));
    static_assert(!supportedMouse(0x1038, 0x183a) && !supportedMouse(0x1038, 0x1854));
    static_assert(!supportedMouse(0x1038, 0x1878) && !supportedMouse(0x1038, 0x1890));
    static_assert(!supportedMouse(0x1038, 0x185c) && !supportedMouse(0x1038, 0x1860));
    static_assert(std::wstring_view(supportedMouseName(aerox3)) == L"SteelSeries Aerox 3 Wireless");
    static_assert(std::wstring_view(supportedMouseName(aerox5)) == L"SteelSeries Aerox 5 Wireless");
    static_assert(!supportedMouse(0x1038, 0x1874) && !supportedMouse(0x1038, 0x185a));
    static_assert(supportedMouseCollection(aerox, 3, 0xffc0, 1));
    static_assert(!supportedMouseCollection(aerox, 4, 0xffc0, 1));
    static_assert(supportedMouse(0x320f, 0x22ba) == aula && !supportedMouse(0x320f, 0x5088));
    static_assert(supportedMouseCollection(aula, 1, 0xff1c, 0x92));
    static_assert(supportedMouseQuery(aerox)[1] == 0xd2 && supportedMouseQuery(aula)[3] == 0x1a);

    // Hardware-reported prefix from HaloBattery #79, prepended with the
    // unnumbered Windows report ID slot and padded to the native buffer size.
    std::array<std::uint8_t, 65> steel{0, 0xd2, 0x04, 0x00, 0x2e, 0x34, 0, 0, 0};
    assert(parseSupportedMouseReply(aerox, steel).reading->low == 15);
    assert(parseSupportedMouseReply(aerox, steel).reading->power == Power::unknown);
    steel[2] = 0;
    assert(parseSupportedMouseReply(aerox, steel).status == Status::no_radio_reply);
    steel[2] = 0x80;
    assert(!parseSupportedMouseReply(aerox, steel).reading);
    steel[2] = 21;
    assert(parseSupportedMouseReply(aerox, steel).reading->high == 100);
    steel[2] = 22;
    assert(!parseSupportedMouseReply(aerox, steel).reading);
    steel[2] = 1;
    assert(parseSupportedMouseReply(aerox, steel).reading->low == 0);
    steel[1] = 0x92;
    assert(!parseSupportedMouseReply(aerox, steel).reading);

    for (auto kind : {aerox3, aerox5}) {
        assert(supportedMouseCollection(kind, 3, 0xffc0, 1));
        assert(!supportedMouseCollection(kind, 3, 0xffc0, 2));
        assert(!supportedMouseCollection(kind, 1, 0x0001, 6));
        assert(!supportedMouseCollection(kind, 4, 0xffc1, 1));
        assert((supportedMouseQuery(kind) == std::array<std::uint8_t, 64>{0x00, 0xd2}));
        // alloyctl capture d2 14 -> 95%; 1852 implements the same step layout.
        const std::array<std::uint8_t, 65> full{0, 0xd2, 0x14};
        assert(parseSupportedMouseReply(kind, full).reading->high == 95);
        assert(parseSupportedMouseReply(kind, std::span(full).first(2)).status == Status::bad_report);
        const std::array<std::uint8_t, 65> idle{0, 0x40, 0xff};
        assert(parseSupportedMouseReply(kind, idle).status == Status::no_radio_reply);
        auto echo = supportedMouseQuery(kind);
        assert(parseSupportedMouseReply(kind, echo).status == Status::no_radio_reply);
        echo[2] = 0x80; // status bit without any valid level
        assert(parseSupportedMouseReply(kind, echo).status == Status::no_radio_reply);
        echo[2] = 0xff;
        assert(parseSupportedMouseReply(kind, echo).status == Status::bad_report);
        echo[2] = 1;
        assert(parseSupportedMouseReply(kind, echo).reading->low == 0);
        echo[0] = 0x04; // wrong report ID
        assert(parseSupportedMouseReply(kind, echo).status == Status::bad_report);
    }

    auto v9 = supportedMouseQuery(aula);
    assert(!parseSupportedMouseReply(aula, v9).reading);
    v9[8] = 0x50;
    assert(parseSupportedMouseReply(aula, v9).reading->low == 80);
    v9[8] = 0x30;
    assert(parseSupportedMouseReply(aula, v9).reading->low == 48);
    assert(!parseSupportedMouseReply(aula, std::span(v9).first(63)).reading);
    v9[8] = 101;
    assert(!parseSupportedMouseReply(aula, v9).reading);
    v9[8] = 80;
    v9[3] = 0x1b;
    assert(!parseSupportedMouseReply(aula, v9).reading);
}
