#include "../native/providers/supported_mouse_battery.hpp"

#include <cassert>

int main()
{
    using namespace pm;
    constexpr auto aerox = SupportedMouse::aerox9;
    constexpr auto aula = SupportedMouse::aulaV9;
    static_assert(supportedMouse(0x1038, 0x1858) == aerox);
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
