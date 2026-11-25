#include "atk_v75x.hpp"

#include <cassert>

int main()
{
    using namespace pm;
    static_assert(atkV75XProduct(0x320f, 0x5055, L"atk v75x"));
    static_assert(atkV75XProduct(0x320f, 0x5088, L"atk v75x 2.4g dongle"));
    static_assert(atkV75XProduct(0x320f, 0x5088, L"atk v75x dongle"));
    static_assert(!atkV75XProduct(0x320f, 0x5088, L"wireless gaming keyboard"));
    static_assert(!atkV75XProduct(0x320f, 0x5055, L"vgn v98 pro"));
    static_assert(!atkV75XProduct(0x320f, 0x5088, L"atk v75x pro"));
    static_assert(!atkV75XProduct(0x320f, 0x5088, L"atk v75x 2.4g dongle rev2"));
    static_assert(!atkV75XProduct(0x320f, 0x5055, L"atk v75x dongle"));
    static_assert(!atkV75XProduct(0x1234, 0x5055, L"atk v75x"));
    static_assert(atkV75XCollection(0xff1c, 0x92, 32, 32));
    static_assert(!atkV75XCollection(1, 6, 32, 32));
    static_assert(!atkV75XCollection(0xff1c, 0x92, 31, 32));
    static_assert(!atkV75XCollection(0xff1c, 0x92, 32, 65));
    constexpr auto q = makeAtkV75XQuery(0x0105);
    static_assert(q[0] == 4 && q[1] == 5 && q[2] == 1 && q[3] == 0x1a && q[4] == 0);
    assert(!parseAtkV75XReply(q, 0x0105)); // exact echo is not battery telemetry
    auto frame = q;
    frame[8] = 0x5b; // cable capture: 91%, charging
    frame[9] = 1;
    const auto good = parseAtkV75XReply(frame, 0x0105);
    assert(good && good->reading && good->reading->high == 91 && good->reading->power == Power::charging);
    assert(!parseAtkV75XReply(frame, 0x0205)); // mismatched sequence high byte
    assert(!parseAtkV75XReply(frame, 0x0106)); // mismatched sequence low byte
    assert(!parseAtkV75XReply(std::span(frame).first(31), 0x0105));
    assert(parseAtkV75XReply(std::span(frame).first(32), 0x0105));
    frame[5] = 1; assert(!parseAtkV75XReply(frame, 0x0105)); frame[5] = 0;
    frame[8] = 101; assert(!parseAtkV75XReply(frame, 0x0105)); frame[8] = 91;
    frame[9] = 3; assert(!parseAtkV75XReply(frame, 0x0105));
    frame[9] = 2; assert(parseAtkV75XReply(frame, 0x0105)->reading->power == Power::unknown);
    frame[9] = 0; assert(parseAtkV75XReply(frame, 0x0105)->reading->power == Power::discharging);
}
