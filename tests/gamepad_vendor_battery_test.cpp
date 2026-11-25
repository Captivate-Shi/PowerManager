#include "gamepad_vendor_battery.hpp"

using namespace pm;
using namespace pm::vendor_pad;
constexpr auto makeFly(unsigned id, unsigned link, unsigned battery)
{
    std::array<std::uint8_t, 33> raw{};
    raw[1] = 0x5a;
    raw[2] = 0xa5;
    raw[3] = 1;
    raw[6] = static_cast<std::uint8_t>(id);
    raw[7] = static_cast<std::uint8_t>(link);
    raw[12] = static_cast<std::uint8_t>(battery);
    raw[16] = 0x71;
    raw[17] = 0x54;
    return raw;
}
constexpr auto nova(unsigned level)
{
    std::array<std::uint8_t, 65> raw{};
    raw[1] = 1;
    raw[19] = static_cast<std::uint8_t>(level);
    return raw;
}
static_assert(match(0x37d7, 0x2501) == Model::apex5);
static_assert(!match(0x3537, 0x1098)); // shared receiver is not a model.
static_assert(!match(0x3537, 0x1040));
static_assert(request(Model::vader5)[0] == 0 && request(Model::apex5)[0] == 3);
static_assert(request(Model::apex5,true)[3] == 7 && request(Model::apex5)[3] == 1);
static_assert(request(Model::nova2LiteUsb)[2] == 1);
static_assert(!collection(Model::vader5, 1, 5, 33, 33));
static_assert(parse(Model::vader5, makeFly(130, 2, 2))->reading->high == 60);
static_assert(parse(Model::vader5, makeFly(130, 1, 0x15))->reading->power == Power::charging);
static_assert(parse(Model::apex5, makeFly(135, 1, 0x25), true)->reading->power == Power::full);
static_assert(parse(Model::apex5, makeFly(130, 1, 5), true)->status == Status::bad_report);
static_assert(parse(Model::vader5, makeFly(130, 13, 5))->status == Status::bad_report);
static_assert(parse(Model::vader5, makeFly(130, 2, 6))->status == Status::bad_report);
static_assert(!parse(Model::vader5, std::array<std::uint8_t, 16>{}));
static_assert(parse(Model::nova2LiteUsb, nova(77))->reading->high == 77);
static_assert(!parse(Model::nova2LiteUsb, nova(255))->reading);
static_assert(parse(Model::nova2LiteUsb, nova(101))->status == Status::bad_report);
int main() {}
