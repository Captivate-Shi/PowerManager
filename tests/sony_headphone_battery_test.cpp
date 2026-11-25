#include "sony_headphone_battery.hpp"

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
