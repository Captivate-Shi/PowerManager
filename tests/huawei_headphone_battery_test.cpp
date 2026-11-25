#include "huawei_headphone_battery.hpp"
#include <cassert>

int main()
{
    using namespace pm::huawei_headphone;
    static_assert(isFreeClip2(L"HUAWEI FreeClip 2"));
    static_assert(!isFreeClip2(L"HUAWEI FreeClip"));
    static_assert(matchesIds(1, 0x027d, 0x4113));
    static_assert(!matchesIds(2, 0x027d, 0x4113));
    static_assert(!matchesIds(1, 0x027d, 0x4112));
    const std::array<std::uint8_t,32> capture{
        0x5a,0,0x1b,0,1,8,1,1,0x4b,2,3,0x4c,0x4b,0x64,3,3,0,0,0,
        4,2,0x14,0x0a,5,2,0,0,6,1,0x0a,0xab,0x24};
    const std::array<std::uint8_t,8> noise{0x5a,0,3,0,1,6,0x3e,0xbd};
    ReplyStream stream;
    assert(!stream.feed(noise));
    assert(!stream.feed(std::span(capture).first(11)));
    assert(stream.feed(std::span(capture).subspan(11)) == 75);
    auto bad = capture;
    bad[14] ^= 1;
    assert(!stream.feed(bad));
    assert(stream.feed(capture) == 75);
    assert(parseLevels(std::array<std::uint8_t,8>{1,1,80,2,3,200,90,20}) == 90);
    assert(!parseLevels(std::array<std::uint8_t,8>{1,1,80,2,3,255,255,20}));
    assert(!parseLevels(std::array<std::uint8_t,6>{1,1,80,1,1,90}));
    assert(!parseLevels(std::array<std::uint8_t,4>{2,3,80,40}));
    assert(!parseLevels(std::array<std::uint8_t,9>{1,1,73,0x7f,4,0,0,1,1}));
    assert(parseLevels(std::array<std::uint8_t,3>{1,1,0}) == 0);
}
