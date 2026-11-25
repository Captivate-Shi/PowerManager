#include "../native/providers/cn_mouse_codecs.hpp"

#include <cassert>

namespace {

using namespace cn_mouse;

constexpr std::array<std::uint8_t, 65> g3Frame(std::uint8_t command, std::uint8_t value,
                                               std::uint8_t charging = 0) {
    std::array<std::uint8_t, 65> out{0, 0xAA, command};
    out[9] = value;
    out[10] = charging;
    return out;
}

constexpr auto sc580Frame(std::uint8_t state, std::uint8_t level, std::uint8_t online) {
    std::array<std::uint8_t, 33> out{0, 0x30, 0, 1, 11,
        0x4D, 0x31, 0x33, 0x37, 0x01, 0x16, 0x11, 0xAA, state, level, online};
    for (std::size_t i = 5; i < 32; ++i) out[32] += out[i];
    return out;
}

void testMchose() {
    static_assert(MatchesMchoseG3(0x3837, 0x4245, 0xff01, 0x10, 65, 65, L"MCHOSE G3 V2"));
    static_assert(!MatchesMchoseG3(0x3837, 0x418c, 0xff01, 0x10, 65, 65, L"MCHOSE G3 V2"));
    static_assert(!MatchesMchoseG3(0x3837, 0x4245, 0xff01, 0x10, 65, 65, L"MCHOSE G3 V2 Pro"));
    static_assert(!MatchesMchoseG3(0x3837, 0x4245, 0xff01, 0x10, 66, 65, L"MCHOSE G3 V2"));
    static_assert(!MatchesMchoseG3(0x3837, 0x4245, 0xff01, 0x11, 65, 65, L"MCHOSE G3 V2"));
    assert((kMchoseOnlineQuery == std::array<std::uint8_t, 65>{0, 0x55, 0xED}));
    assert((kMchoseBatteryQuery == std::array<std::uint8_t, 65>{0, 0x55, 0x30, 0xA5, 0x0B, 0x2E, 1, 1, 1}));
    auto f = g3Frame(0xED, 0);
    assert(ParseMchoseOnline(f.data(), f.size()).status == Status::Online);
    f[9] = 2;
    assert(ParseMchoseOnline(f.data(), f.size()).status == Status::Online);
    f[9] = 1;
    assert(ParseMchoseOnline(f.data(), f.size()).status == Status::Offline);
    f[9] = 3;
    assert(ParseMchoseOnline(f.data(), f.size()).status == Status::Invalid);
    f = g3Frame(0x30, 86, 1);
    assert(ParseMchoseOnline(f.data(), f.size()).status == Status::Unrelated);
    assert(ParseMchoseBattery(f.data(), f.size(), false).status == Status::Invalid);
    auto reading = ParseMchoseBattery(f.data(), f.size(), true);
    assert(reading.status == Status::Battery && reading.percent == 90 && reading.charging);
    f[10] = 2;
    assert(ParseMchoseBattery(f.data(), f.size(), true).status == Status::Invalid);
    f[10] = 0;
    for (const auto amount : {0, 101, 255}) {
        f[9] = amount;
        assert(ParseMchoseBattery(f.data(), f.size(), true).status == Status::Invalid);
    }
    f[9] = 1;
    assert(ParseMchoseBattery(f.data(), f.size(), true).percent == 10);
    f[9] = 94;
    assert(ParseMchoseBattery(f.data(), f.size(), true).percent == 90);
    f[9] = 95;
    assert(ParseMchoseBattery(f.data(), f.size(), true).percent == 100);
    assert(ParseMchoseBattery(f.data(), f.size() - 1, true).status == Status::Invalid);
    f[0] = 1;
    assert(ParseMchoseBattery(f.data(), f.size(), true).status == Status::Invalid);
}

void testAula() {
    static_assert(MatchesAulaSc580(0x089d, 0x062f, 0xff02, 0, 33, 33));
    static_assert(!MatchesAulaSc580(0x088d, 0x062e, 0xff02, 0, 33, 33));
    static_assert(!MatchesAulaSc580(0x089d, 0x062f, 0xff02, 1, 33, 33));
    static_assert(!MatchesAulaSc580(0x089d, 0x062f, 0xff02, 0, 33, 34));
    assert((kAulaBatteryQuery == std::array<std::uint8_t, 33>{0, 0x30, 0, 1}));
    assert(ParseAulaBattery(kAulaBatteryQuery.data(), kAulaBatteryQuery.size()).status == Status::Invalid);
    auto f = sc580Frame(0, 47, 1);
    auto reading = ParseAulaBattery(f.data(), f.size());
    assert(reading.status == Status::Battery && reading.percent == 47 && !reading.charging);
    f[3] = f[4] = 0; // legacy fixed reply area, validated by identity and checksum
    assert(ParseAulaBattery(f.data(), f.size()).percent == 47);
    f = sc580Frame(0, 0, 1);
    assert(ParseAulaBattery(f.data(), f.size()).percent == 0);
    f = sc580Frame(1, 100, 1);
    reading = ParseAulaBattery(f.data(), f.size());
    assert(reading.status == Status::ChargingWithoutLevel && reading.percent == -1 && reading.charging);
    f = sc580Frame(2, 100, 1);
    reading = ParseAulaBattery(f.data(), f.size());
    assert(reading.status == Status::Battery && reading.percent == 100 && reading.full && !reading.charging);
    f = sc580Frame(0, 100, 1);
    assert(!ParseAulaBattery(f.data(), f.size()).full);
    f = sc580Frame(2, 90, 1);
    assert(ParseAulaBattery(f.data(), f.size()).status == Status::Invalid);
    f = sc580Frame(0, 80, 0);
    assert(ParseAulaBattery(f.data(), f.size()).status == Status::Offline);
    f = sc580Frame(0, 80, 2);
    assert(ParseAulaBattery(f.data(), f.size()).status == Status::Invalid);
    f = sc580Frame(0, 101, 1);
    assert(ParseAulaBattery(f.data(), f.size()).status == Status::Invalid);
    f = sc580Frame(3, 80, 1);
    assert(ParseAulaBattery(f.data(), f.size()).status == Status::Invalid);
    f = sc580Frame(0, 80, 1);
    f[5] += 1;
    f[32] += 1;
    assert(ParseAulaBattery(f.data(), f.size()).status == Status::Invalid);
    f = sc580Frame(0, 80, 1);
    f[32] ^= 1;
    assert(ParseAulaBattery(f.data(), f.size()).status == Status::Invalid);
    f = sc580Frame(0, 80, 1);
    f[4] = 10;
    assert(ParseAulaBattery(f.data(), f.size()).status == Status::Invalid);
    f[4] = 28;
    assert(ParseAulaBattery(f.data(), f.size()).status == Status::Invalid);
    f[4] = 11;
    f[3] = 2;
    assert(ParseAulaBattery(f.data(), f.size()).status == Status::Invalid);
    f = {0, 0x30, 1, 1};
    reading = ParseAulaBattery(f.data(), f.size());
    assert(reading.status == Status::Retry && reading.retryAfterMs == 300);
    f[2] = 3;
    reading = ParseAulaBattery(f.data(), f.size());
    assert(reading.status == Status::Retry && reading.retryAfterMs == 100);
    f[2] = 2;
    assert(ParseAulaBattery(f.data(), f.size()).status == Status::Offline);
    f[1] = 0xD1;
    assert(ParseAulaBattery(f.data(), f.size()).status == Status::Unrelated);
    f[1] = 0x13;
    assert(ParseAulaBattery(f.data(), f.size()).status == Status::Unrelated);
    assert(ParseAulaBattery(f.data(), f.size() - 1).status == Status::Invalid);
    assert(ParseAulaBattery(nullptr, f.size()).status == Status::Invalid);
}

} // namespace

int main() {
    testMchose();
    testAula();
}
