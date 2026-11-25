#include "rfcomm_battery_transport.hpp"

#include <array>
#include <cassert>
#include <vector>

using namespace pm::sony_headphone;

static std::vector<std::uint8_t> reply(std::uint8_t sequence, unsigned level,
                                        unsigned charging, std::uint8_t payloadType = 0x11)
{
    std::array<std::uint8_t, 11> body{0x0c, sequence, 0, 0, 0, 4, payloadType, 0,
        static_cast<std::uint8_t>(level), static_cast<std::uint8_t>(charging), 0};
    for (unsigned i = 0; i < body.size() - 1; ++i) body.back() += body[i];
    std::vector<std::uint8_t> result{0x3e};
    for (auto byte : body) {
        if (byte >= 0x3c && byte <= 0x3e) {
            result.push_back(0x3d);
            result.push_back(byte - 0x10);
        } else result.push_back(byte);
    }
    result.push_back(0x3c);
    return result;
}

int main()
{
    using pm::rfcomm_battery::matchModel;
    using pm::rfcomm_battery::Model;
    using pm::rfcomm_battery::sonyMdrV1ProductId;
    static_assert(matchModel(L"WH-1000XM3") == Model::sonyXm3);
    static_assert(matchModel(L"WH-1000XM4") == Model::sonyXm4);
    static_assert(matchModel(L"WH-1000XM5") == Model::sonyXm5FastPair);
    static_assert(matchModel(L"WH-1000XM6") == Model::sonyWhFastPair);
    static_assert(matchModel(L"WH-CH720N") == Model::sonyWhFastPair);
    static_assert(!matchModel(L"WH-NAME"));
    static_assert(!matchModel(L"WF-1000XM3"));
    static_assert(!matchModel(L"LE_WH-1000XM3"));
    static_assert(!matchModel(L"WH-1000XM3 copy"));
    static_assert(mdrV1SdpIdentity(sonyMdrV1ProductId(*matchModel(L"WH-1000XM3")), 2, 0x054c, 0x0cd3));
    static_assert(mdrV1SdpIdentity(sonyMdrV1ProductId(*matchModel(L"WH-1000XM4")), 2, 0x054c, 0x0d58));
    static_assert(!mdrV1SdpIdentity(xm3ProductId, 2, 0x054c, 0x0d58));
    static_assert(!mdrV1SdpIdentity(xm4ProductId, 2, 0x054c, 0x0cd3));
    static_assert(!mdrV1SdpIdentity(xm3ProductId, 1, 0x054c, 0x0cd3));
    static_assert(!mdrV1SdpIdentity(xm3ProductId, 2, 0x0000, 0x0cd3));
    static_assert(!mdrV1SdpIdentity(sonyMdrV1ProductId(Model::sonyXm5FastPair), 2, 0x054c, 0x0df0));
    static_assert(xm5SdpIdentity(2, 0x054c, 0x0df0));
    using pm::rfcomm_battery::sonyFastPairIdentity;
    static_assert(sonyFastPairIdentity(Model::sonyWhFastPair, 2, 0x054c, 0x0e00));
    static_assert(!sonyFastPairIdentity(Model::sonyWhFastPair, 1, 0x054c, 0x0e00));
    static_assert(!sonyFastPairIdentity(Model::sonyWhFastPair, 2, 0x046d, 0x0e00));
    static_assert(!sonyFastPairIdentity(Model::sonyWhFastPair, 2, 0x054c, 0));
    static_assert(!sonyFastPairIdentity(Model::sonyWhFastPair, 2, 0x054c, 0xffff));
    static_assert(!sonyFastPairIdentity(Model::sonyXm5FastPair, 2, 0x054c, 0x0e00));
    static_assert(!sonyFastPairIdentity(Model::sonyXm3, 2, 0x054c, 0x0cd3));
    static_assert(!xm5SdpIdentity(1, 0x054c, 0x0df0));
    static_assert(!xm5SdpIdentity(2, 0x054c, 0x0d58)); // XM4
    Xm5FastPairStream fastPair;
    const std::array<std::uint8_t, 12> frames{3,1,0,3,0x10,0x20,0x30,3,3,0,1,0xd0};
    assert(!fastPair.feed(std::span(frames).first(2)));
    assert(!fastPair.feed(std::span(frames).subspan(2,7)));
    assert((fastPair.feed(std::span(frames).subspan(9)) == Battery{80, true}));
    Xm5FastPairStream wrongShape;
    const std::array<std::uint8_t, 7> earbuds{3,3,0,3,15,10,23};
    assert(!wrongShape.feed(earbuds) && wrongShape.invalid());
    Xm5FastPairStream unknown;
    const std::array<std::uint8_t, 10> unknownFirst{3,3,0,1,0x7f,3,3,0,1,0x32};
    assert((unknown.feed(unknownFirst) == Battery{50, false}));
    Xm5FastPairStream oversize;
    assert(!oversize.feed(std::array<std::uint8_t,4>{3,3,1,0}) && oversize.invalid());

    static_assert(request[7] == 0x10 && request[8] == 0);
    static_assert(responseAck(1)[2] == 0 && responseAck(0)[2] == 1);
    for (const auto level : {0, 50, 60, 61, 62, 100}) {
        for (const auto charging : {0, 1}) {
            const Battery expected{static_cast<unsigned>(level), charging == 1};
            for (std::size_t cut = 1; cut < 12; ++cut) {
                ResponseStream stream;
                const auto encoded = reply(1, level, charging);
                assert(!stream.feed(std::span(encoded).first(cut)));
                const auto decoded = stream.feed(std::span(encoded).subspan(cut));
                assert(decoded && decoded->reading == expected && decoded->sequence == 1);
            }
        }
    }
    ResponseStream stream;
    for (const auto& invalid : {reply(1, 101, 0), reply(1, 255, 0), reply(1, 91, 2), reply(2, 91, 0), reply(1, 91, 0, 0x22)}) {
        assert(!stream.feed(invalid));
    }
    auto invalid = reply(1, 67, 0);
    invalid[8] ^= 1;
    assert(!stream.feed(invalid));
    const std::vector<std::uint8_t> arbitrary(293, 0xff);
    assert(!stream.feed(arbitrary));
    auto recovered = reply(0, 88, 1);
    recovered.insert(recovered.begin(), {0x3e, 0x3d, 0x00, 0x3c, 0xff, 0x3e, 0x11});
    const auto good = stream.feed(recovered);
    const Battery expected{88, true};
    assert(good && good->reading == expected);
}
