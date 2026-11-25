#include "../native/providers/rapoo_battery.hpp"
#include <cassert>

int main()
{
    using namespace pm;
    static_assert(isRapooReceiver(0x24ae, 0x1411));
    static_assert(!isRapooReceiver(0x24ae, 0x1412) && !isRapooReceiver(0x24ae, 0x4611));
    static_assert(isRapooBatteryCollection(0xff00, 2, 19));
    static_assert(!isRapooBatteryCollection(0xff00, 0xe, 19) && !isRapooBatteryCollection(0xff00, 2, 20));
    auto report = std::array<std::uint8_t, 19>{
        0x07,0x10,0x01,0x40,0x06,0x40,0x06,0x01,0x44,0,0x03,0x81,0,0x11,0x46,0x01,0,0x05,0xb1};
    auto sample = parseRapooBatteryReport(report);
    assert(sample.status == Status::current && sample.reading && sample.reading->low == 68
        && sample.reading->high == 68 && sample.reading->power == Power::discharging);
    for (auto state : {2,3}) {
        report[7] = state;
        report[8] = 100;
        assert(parseRapooBatteryReport(report).reading->power == Power::charging);
    }
    report[7] = 0;
    report[8] = 0;
    assert(parseRapooBatteryReport(report).reading->power == Power::unknown);
    assert(parseRapooBatteryReport(report).reading->low == 0);
    report[8] = 101;
    assert(!parseRapooBatteryReport(report).reading);
    report[8] = 68;
    report[0] = 0x06;
    assert(!parseRapooBatteryReport(report).reading);
    report[0] = 0x07;
    assert(!parseRapooBatteryReport(std::span(report).first(18)).reading);
}
