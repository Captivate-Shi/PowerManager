#include "oppo_headphone_battery.hpp"
#include <cassert>

int main()
{
    using namespace pm::oppo_headphone;
    static_assert(isClip2(L"OPPO Enco Clip2"));
    static_assert(!isClip2(L"OPPO Enco Clip"));
    static_assert(!isClip2(L"Nearby OPPO Enco Clip2"));
    const std::array<std::uint8_t, 13> id{0xaa,11,0,0,3,0x81,1,4,0,0,0x10,0xe0,6};
    ReplyStream identities(productQuery);
    assert(!identities.feed(std::span(id).first(4)));
    const auto payload = identities.feed(std::span(id).subspan(4));
    assert(payload && matchesProduct(*payload));
    assert(!matchesProduct(std::array<std::uint8_t,4>{0,0x10,0xc0,6}));
    assert(!matchesProduct(std::array<std::uint8_t,4>{1,0x10,0xe0,6}));
    assert(!matchesProduct(std::array<std::uint8_t,3>{0,0x10,0xe0}));

    const std::array<std::uint8_t, 17> fresh{0xaa,15,0,0,6,0x81,0xf0,8,0,0,3,1,61,2,0x80+48,3,20};
    auto unrelated = fresh;
    unrelated[6] = 1;
    ReplyStream batteries(batteryQuery);
    assert(!batteries.feed(unrelated));
    assert(!batteries.feed(std::span(fresh).first(1)));
    const auto reply = batteries.feed(std::span(fresh).subspan(1));
    assert(reply);
    const auto value = parseBattery(*reply);
    assert(value && value->percent == 48 && value->charging);
    assert(parseBattery(std::array<std::uint8_t,3>{1,1,95})->percent == 95);
    assert(!parseBattery(std::array<std::uint8_t,3>{1,3,20}));
    assert(!parseBattery(std::array<std::uint8_t,3>{1,1,0}));
    assert(!parseBattery(std::array<std::uint8_t,3>{1,1,101}));
    assert(!parseBattery(std::array<std::uint8_t,5>{2,1,55,1,55}));
    assert(!parseBattery(std::array<std::uint8_t,4>{3,1,30,2}));
    auto bad = fresh;
    bad[7] = 9;
    ReplyStream corrupt(batteryQuery);
    assert(!corrupt.feed(bad) && corrupt.invalid());
}
