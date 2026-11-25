#include "headset_battery.hpp"
#include <cassert>

int main()
{
    using namespace pm;
    using namespace pm::headset_battery;
    static_assert(lane(0x0ecb, 0x2126) == Lane::none); // 650 wired
    static_assert(lane(0x0ecb, 0x213b) == Lane::none); // 650X
    static_assert(lane(0x1038, 0x2202) == Lane::none); // earlier, discrete firmware
    static_assert(lane(0x1038, 0x227e) == Lane::none); // Gen 2
    static_assert(collection(Lane::jbl350,3,1,0,16,64,64));
    static_assert(!collection(Lane::jbl350,5,1,0,16,64,64));
    static_assert(!collection(Lane::jbl350,3,0xb,5,16,64,64));
    static_assert(!collection(Lane::jbl610,4,1,0,16,64,64));
    static_assert(!collection(Lane::jbl650,3,1,0,64,64,64));
    static_assert(!collection(Lane::nova7,3,0xffc0,2,64,64,0));
    constexpr std::array<std::uint8_t,2> live{0x68,1};
    constexpr std::array<std::uint8_t,2> pct{0x49,90};
    static_assert(jblByte(live,0x68) == 1);
    static_assert(jblByte(pct,0x49) == 90);
    static_assert(jblByte(pct,0x68) == -1); // fallback or different response
    static_assert(jbl650Request().size() == 64 && jbl650Request()[0] == 0x88 && jbl650Request()[9] == 0x0d);
    std::array<std::uint8_t,16> x{0x86,0,0xdd,1,0,1,0,7,0,0,0,0xd,0,1,0,0x80|40};
    auto r = jbl650Battery(x);
    assert(r.reading && r.reading->low == 40 && r.reading->power == Power::charging);
    x[10] = 0x80;
    assert(jbl650Battery(x).status == Status::no_radio_reply);
    x[11] = 0x12;
    assert(jbl650Battery(x).status == Status::bad_report);
    const std::array<std::uint8_t,5> ss{0,0xb0,3,88,3}, off{0,0xb0,2,88,3},
        zero{0,0xb0,3,0,0}, invalid{0,0xb0,3,101,3}, other{0,0xb1,3,80,3};
    assert(nova7Battery(ss).reading->low == 88);
    assert(nova7Battery(off).status == Status::no_radio_reply);
    assert(nova7Battery(zero).status == Status::no_radio_reply);
    assert(nova7Battery(invalid).status == Status::bad_report);
    assert(nova7Battery(other).status == Status::bad_report);
}
