#include "../native/providers/cn_tail_codecs.hpp"

#include <cassert>

int main()
{
    using namespace pm;
    constexpr auto product = L"AULA F87ProV2D Dongle";
    static_assert(aulaF87ProV2DCollection(0xc45, 0xfefe, 3, 0xff60, 0x61, 33, 33, product, true));
    static_assert(!aulaF87ProV2DCollection(0xc46, 0xfefe, 3, 0xff60, 0x61, 33, 33, product, true));
    static_assert(!aulaF87ProV2DCollection(0xc45, 0xfdfd, 3, 0xff60, 0x61, 33, 33, product, true));
    static_assert(!aulaF87ProV2DCollection(0xc45, 0xfefe, 2, 0xff60, 0x61, 33, 33, product, true));
    static_assert(!aulaF87ProV2DCollection(0xc45, 0xfefe, 3, 0xff02, 0x61, 33, 33, product, true));
    static_assert(!aulaF87ProV2DCollection(0xc45, 0xfefe, 3, 0xff60, 0x62, 33, 33, product, true));
    static_assert(!aulaF87ProV2DCollection(0xc45, 0xfefe, 3, 0xff60, 0x61, 32, 33, product, true));
    static_assert(!aulaF87ProV2DCollection(0xc45, 0xfefe, 3, 0xff60, 0x61, 33, 65, product, true));
    static_assert(!aulaF87ProV2DCollection(0xc45, 0xfefe, 3, 0xff60, 0x61, 33, 33, product, false));
    static_assert(!aulaF87ProV2DCollection(0xc45, 0xfefe, 3, 0xff60, 0x61, 33, 33, L"", true));
    static_assert(!aulaF87ProV2DCollection(0xc45, 0xfefe, 3, 0xff60, 0x61, 33, 33, L"2.4G Dongle", true));
    static_assert(!aulaF87ProV2DCollection(0xc45, 0xfefe, 3, 0xff60, 0x61, 33, 33, L"AULA F87ProV2D", true));
    static_assert(!aulaF87ProV2DCollection(0xc45, 0xfefe, 3, 0xff60, 0x61, 33, 33, L"MINI 60 HE PRO Dongle", true));

    constexpr AulaF87ProV2DReport expectedQuery{0, 0xaa, 0x10, 0x18, 0};
    static_assert(makeAulaF87ProV2DQuery() == expectedQuery);

    // Published hardware capture, with the leading Win32 report-ID byte.
    constexpr AulaF87ProV2DReport capture{
        0, 0x55, 0x10, 0x18, 0, 0, 0, 0, 0, 0, 0, 0, 0x12, 0xa6, 0x38, 0x11, 0x27,
        0x66, 1, 0, 0, 0x66, 1, 0, 0, 2, 0x30, 0, 0, 0, 0, 0, 0,
    };
    const auto sample = parseAulaF87ProV2DReply(capture);
    assert(sample.status == Status::current && sample.reading);
    assert(sample.reading->low == 48 && sample.reading->high == 48);
    assert(sample.reading->power == Power::unknown);
    for (const auto badIndex : {0, 1, 2, 3, 4, 26}) {
        auto malformed = capture;
        malformed[badIndex] = 0xff;
        const auto invalid = parseAulaF87ProV2DReply(malformed);
        assert(invalid.status == Status::bad_report && !invalid.reading);
    }
    auto otherPage = capture;
    otherPage[4] = 0x18;
    assert(!parseAulaF87ProV2DReply(otherPage).reading);
    auto levelBoundary = capture;
    for (const auto percent : {0, 100}) {
        levelBoundary[26] = static_cast<std::uint8_t>(percent);
        const auto parsed = parseAulaF87ProV2DReply(levelBoundary);
        assert(parsed.reading && parsed.reading->midpoint() == percent);
        assert(parsed.reading->power == Power::unknown);
    }
    assert(!parseAulaF87ProV2DReply(std::span(capture).first(32)).reading);
    assert(!parseAulaF87ProV2DReply(std::span(capture).subspan(1)).reading);

    static_assert(isDareuEm901xReceiver(0x260d, 0x1074));
    static_assert(!isDareuEm901xReceiver(0x260d, 0x1090)); // Cable is a separate SKU/transport path.
    static_assert(!isDareuEm901xReceiver(0x260d, 0x1125)); // Sharkoon, not DAREU EM901X.
    static_assert(!isDareuEm901xReceiver(0xc45, 0x1074));
}
