#include "oppo_headphone_battery.hpp"
#include "rfcomm_battery_transport.hpp"
#include <cassert>

int main()
{
    using namespace pm::oppo_headphone;
    static_assert(isClip2(L"OPPO Enco Clip2"));
    static_assert(!isClip2(L"OPPO Enco Clip"));
    static_assert(!isClip2(L"Nearby OPPO Enco Clip2"));
    static_assert(isX4(L"OPPO Enco X4"));
    static_assert(!isX4(L"OPPO Enco X4s"));
    const std::array<std::uint8_t,4> x4id{0,0x10,0xec,6};
    assert(matchesProduct(x4id, x4ProductId));
    assert(!matchesProduct(x4id, clip2ProductId));
    const std::array<std::uint8_t,8> x4Charging{0,3,1,0xc6,2,0xc6,3,0x46};
    const auto charging = parseBattery(x4Charging, x4ProductId);
    assert(charging && charging->percent == 70 && charging->charging);
    const std::array<std::uint8_t,6> x4OutOfCase{1,2,1,0x5a,2,0x5a};
    assert(parseBattery(x4OutOfCase, x4ProductId)->percent == 90);
    assert(!parseBattery(x4OutOfCase, clip2ProductId));
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
    using pm::rfcomm_battery::matchModel;
    using pm::rfcomm_battery::Model;
    using pm::rfcomm_battery::oppoProductId;
    static_assert(matchModel(L"OPPO Enco Air3 Pro") == Model::oppoAir3Pro);
    static_assert(matchModel(L"OPPO Enco X3") == Model::oppoX3);
    static_assert(!matchModel(L"OPPO Enco Air3"));
    static_assert(!matchModel(L"OPPO Enco X3s"));
    static_assert(matchModel(L"OPPO Enco Buds3 Pro") == Model::oppoBuds3Pro);
    static_assert(!matchModel(L"OPPO Enco Buds3 Pro+"));
    assert(matchesProduct(std::array<std::uint8_t,4>{0,0x50,0xa8,6}, oppoProductId(Model::oppoBuds3Pro)));
    assert(!matchesProduct(std::array<std::uint8_t,4>{0,0x10,0xa0,6}, oppoProductId(Model::oppoBuds3Pro)));
    const std::array<std::uint8_t, 13> air3Identification{0xaa,11,0,0,3,0x81,1,4,0,0,0x10,0x5c,6};
    ReplyStream air3Identity(productQuery);
    const auto air3Product = air3Identity.feed(air3Identification);
    assert(air3Product && matchesProduct(*air3Product, oppoProductId(Model::oppoAir3Pro)));
    assert(!matchesProduct(*air3Product, oppoProductId(Model::oppoX3)));
    const std::array<std::uint8_t,15> air3Capture{0xaa,0x0d,0,0,6,0x81,3,6,0,0,2,1,0x50,2,0x50};
    ReplyStream air3Battery(air3ProBatteryQuery);
    const auto air3Payload = air3Battery.feed(air3Capture);
    assert(air3Payload);
    const auto air3Reading = parseBattery(*air3Payload, air3ProProductId);
    assert(air3Reading && air3Reading->percent == 80 && !air3Reading->charging);
    ReplyStream rejectWrongSequence(batteryQuery);
    assert(!rejectWrongSequence.feed(air3Capture));
    assert(matchesProduct(std::array<std::uint8_t,4>{0,0x10,0x74,6}, oppoProductId(Model::oppoX3)));
    assert(!matchesProduct(std::array<std::uint8_t,4>{1,0x10,0x74,6}, oppoProductId(Model::oppoX3)));

    auto bad = fresh;
    bad[7] = 9;
    ReplyStream corrupt(batteryQuery);
    assert(!corrupt.feed(bad) && corrupt.invalid());
}
