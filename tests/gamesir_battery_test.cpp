#include "gamesir_battery.hpp"
#include <cassert>

int main()
{
    using namespace pm;
    using namespace gamesir_battery;
    static_assert(superNovaName(L"gamesir-super nova"));
    static_assert(superNovaName(L"novapro"));
    static_assert(!superNovaName(L"gamesir receiver"));
    static_assert(!superNovaName(L"gamesir tarantula pro"));
    static_assert(!superNovaName(L"gamesir nova 2 pro"));
    static_assert(collection(0x3537,0x103e,0xffa0,64,32,0));
    static_assert(!collection(0x3537,0x100e,0xffa0,64,32,0));
    static_assert(!collection(0x3537,0x103e,0xff7a,64,32,0));
    static_assert(!collection(0x3537,0x103e,0xffa0,64,32,16));
    static_assert(deviceInfo[0]==7 && deviceInfo[1]==3 && deviceInfo[2]==0x0a && deviceInfo[3]==1);
    std::array<std::uint8_t,64> reply{6,14,0x0a,1};
    reply[13] = 96;
    const auto measured = parseReply(reply);
    assert(measured.reading && measured.reading->low == 96 && measured.reading->power == Power::discharging);
    reply[13] = 255;
    const auto charging = parseReply(reply);
    assert(charging.status == Status::unavailable && !charging.reading && charging.detail == 255);
    reply[13] = 101;
    assert(parseReply(reply).status == Status::bad_report);
    reply[13] = 0;
    assert(parseReply(reply).reading->high == 0);
    assert(!parseReply(std::span(reply).first(14)).reading);
    reply[3] = 2;
    assert(!parseReply(reply).reading);
    reply[3] = 1;
    reply[1] = 13;
    assert(!parseReply(reply).reading);
}
