#include "../native/providers/cn_tail_codecs.hpp"

#include <cassert>

int main()
{
    using namespace pm;
    static_assert(mchoseG87CandidateCollection(0x41e4, 0x2001, 1, 0xff02, 2, 20, 20));
    static_assert(!mchoseG87CandidateCollection(0x41e4, 0x2001, 1, 0xff04, 2, 20, 20));
    static_assert(!mchoseG87CandidateCollection(0x41e4, 0x2001, 0, 0xff02, 2, 20, 20));
    static_assert(!mchoseG87CandidateCollection(0x41e4, 0x2001, 1, 0xff02, 2, 20, 0));
    static_assert(!mchoseG87CandidateCollection(0x3837, 0x3033, 1, 0xff02, 2, 20, 20));
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

    static_assert(mchoseA7V2ProCollection(0x3837, 0x4018, 2, 0xff01, 1, 21));
    static_assert(mchoseA7V2ProCollection(0x3837, 0x4018, 2, 0xff01, 1, 65));
    static_assert(!mchoseA7V2ProCollection(0x3837, 0x100b, 2, 0xff01, 1, 65));
    static_assert(!mchoseA7V2ProCollection(0x3837, 0x4019, 2, 0xff01, 1, 65));
    static_assert(!mchoseA7V2ProCollection(0x3837, 0x4018, 1, 0xff01, 1, 65));
    static_assert(!mchoseA7V2ProCollection(0x3837, 0x4018, 2, 0xff0b, 0x104, 65));
    static_assert(!mchoseA7V2ProCollection(0x3837, 0x4018, 2, 0xff01, 1, 22));
    constexpr auto mRequest = makeMchoseA7V2ProQuery();
    static_assert(mRequest[0] == 0x11 && mRequest[1] == 0xf9 &&
        mRequest[20] == 0xff && mRequest[21] == 0 && mRequest[64] == 0);
    assert(!parseMchoseA7V2ProReply(mRequest).reading);
    // Synthetic from the published byte layout, not a captured A7 frame.
    auto mchose = mRequest;
    mchose[2] = 0xc8; mchose[3] = 0xc7; mchose[4] = 0xe7; mchose[5] = 0xbf;
    mchose[11] = 76 ^ 0xff; mchose[12] = 1 ^ 0xff;
    auto m = parseMchoseA7V2ProReply(mchose);
    assert(m.reading && m.reading->midpoint() == 76 && m.reading->power == Power::charging);
    m = parseMchoseA7V2ProReply(std::span(mchose).first(21));
    assert(m.reading && m.reading->midpoint() == 76);
    assert(!parseMchoseA7V2ProReply(std::span(mchose).first(20)).reading);
    mchose[4] = 0xe6; // A7 Ultra is a different logical product.
    assert(!parseMchoseA7V2ProReply(mchose).reading);
    mchose[4] = 0xe7;
    mchose[11] = 101 ^ 0xff;
    assert(!parseMchoseA7V2ProReply(mchose).reading);

    constexpr auto hs = L"HS USB Dongle";
    static_assert(ajazzMk87ProCollection(0x0c45, 0xfefc, 0xff80, 1, 33, 33, hs));
    static_assert(ajazzMk87ProCollection(0x0c45, 0xfefc, 0xff80, 1, 65, 65, hs));
    static_assert(!ajazzMk87ProCollection(0x0c45, 0xfefe, 0xff80, 1, 33, 33, hs));
    static_assert(!ajazzMk87ProCollection(0x0c45, 0x8802, 0xff80, 1, 33, 33, hs));
    static_assert(!ajazzMk87ProCollection(0x0c45, 0xfefc, 0xff60, 1, 33, 33, hs));
    static_assert(!ajazzMk87ProCollection(0x0c45, 0xfefc, 0xff80, 1, 33, 65, hs));
    static_assert(!ajazzMk87ProCollection(0x0c45, 0xfefc, 0xff80, 1, 33, 33, L"USB Dongle"));
    static_assert(isDareuEm901xReceiver(0x260d, 0x1074));
    static_assert(!isDareuEm901xReceiver(0x260d, 0x1090)); // Cable is a separate SKU/transport path.
    static_assert(!isDareuEm901xReceiver(0x260d, 0x1125)); // Sharkoon, not DAREU EM901X.
    static_assert(!isDareuEm901xReceiver(0xc45, 0x1074));
}
