#include "langtu_t98.hpp"
#include <cassert>

int main()
{
    using namespace pm;
    static_assert(langtuT98Collection(0x1a2c, 0x8fff, 0, 0xff02, 2, 65, 65));
    static_assert(!langtuT98Collection(0x1a2c, 0x8fff, 3, 0xff02, 2, 65, 65));
    static_assert(!langtuT98Collection(0x1a2c, 0x8fff, 0, 0xff01, 2, 65, 65));
    auto report = std::array<std::uint8_t, 65>{0,0xaa,0x55,0xcc,0x33,0x0e,78,1};
    assert((parseLangtuT98(report).reading == Reading{78,78,Power::unknown,78,ReadingSource::hid_voltage}));
    report[6] = 87;
    assert(parseLangtuT98(report).reading->power == Power::unknown);
    report[6] = 0xff;
    assert(!parseLangtuT98(report).reading);
    report[6] = 0;
    assert(parseLangtuT98(report).reading->low == 0);
    report[64] = 1;
    assert(!parseLangtuT98(report).reading);
    assert(!parseLangtuT98(std::span(report).first(8)).reading);
}
