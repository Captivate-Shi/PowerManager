#include "../native/providers/rapoo_battery.hpp"
#include <cassert>
#include <string_view>

int main()
{
    using namespace pm;
    static_assert(isRapooReceiver(0x24ae, 0x1411));
    static_assert(isRapooReceiver(0x24ae, 0x1412) && isRapooReceiver(0x24ae, 0x14a1));
    static_assert(!isRapooReceiver(0x24ae, 0x4611) && !isRapooReceiver(0x24ae, 0x14a9));
    static_assert(!isRapooReceiver(0x1234, 0x1412));
    static_assert(isRapooReceiver(0x24ae, 0x1b13));
    static_assert(isRapooReceiver(0x24ae, 0x1421));
    static_assert(std::wstring_view(rapooReceiverName(0x24ae, 0x1421)) == L"Rapoo VT3S MAX");
    static_assert(!isRapooReceiver(0x24ae, 0x4621) && !isRapooReceiver(0x24ae, 0x144b));
    static_assert(!isRapooReceiver(0x24ae, 0x4b13) && !isRapooReceiver(0x24ae, 0x4827));
    static_assert(isRapooBatteryCollection(0xff00, 2, 19));
    static_assert(!isRapooBatteryCollection(0xff00, 0xe, 19) && !isRapooBatteryCollection(0xff00, 2, 20));
    auto report = std::array<std::uint8_t, 19>{
        0x07,0x10,0x01,0x40,0x06,0x40,0x06,0x01,0x44,0,0x03,0x81,0,0x11,0x46,0x01,0,0x05,0xb1};
    auto sample = parseRapooBatteryReport(report, 0x1411);
    assert(sample.status == Status::current && sample.reading && sample.reading->low == 68
        && sample.reading->high == 68 && sample.reading->power == Power::discharging);
    for (auto state : {2,3}) {
        report[7] = state;
        report[8] = 100;
        assert(parseRapooBatteryReport(report, 0x1411).reading->power == Power::charging);
    }
    report[7] = 0;
    report[8] = 0;
    assert(parseRapooBatteryReport(report, 0x1411).reading->power == Power::unknown);
    assert(parseRapooBatteryReport(report, 0x1411).reading->low == 0);
    report[8] = 101;
    assert(!parseRapooBatteryReport(report, 0x1411).reading);
    report[8] = 68;
    report[0] = 0x06;
    assert(!parseRapooBatteryReport(report, 0x1411).reading);
    report[0] = 0x07;
    assert(!parseRapooBatteryReport(std::span(report).first(18), 0x1411).reading);
    assert(parseRapooBatteryReport(report, 0x14a1).reading->low == 68);
    assert(parseRapooBatteryReport(report, 0x1b13).reading->low == 68);
    report[7] = 1;
    report[18] = 0x7f;
    const auto dropped = parseRapooBatteryReport(report, 0x1412);
    assert(!dropped.reading && dropped.status == Status::offline);
    assert(parseRapooBatteryReport(report, 0x1411).reading->low == 68);
    report[18] = 0xd2;
    assert(parseRapooBatteryReport(report, 0x1412).reading->low == 68);
    report[1] = 0x12;
    report[18] = 0;
    report[7] = 2;
    assert(parseRapooBatteryReport(report, 0x1412).reading->power == Power::charging);
    // Synthetic 1421 fixtures follow the A HUB Input 07 layout; these are not
    // hardware captures for this exact model.
    assert(!parseRapooBatteryReport(report, 0x1421).reading); // wired mode
    report[1] = 0x10;
    report[18] = 0xd2;
    assert(parseRapooBatteryReport(report, 0x1421).reading->power == Power::charging);
    report[7] = 1;
    assert(parseRapooBatteryReport(report, 0x1421).reading->low == 68);
    assert(!parseRapooBatteryReport(std::span(report).first(18), 0x1421).reading);
    report[7] = 0;
    assert(parseRapooBatteryReport(report, 0x1421).status == Status::unavailable);
    report[7] = 4;
    assert(!parseRapooBatteryReport(report, 0x1421).reading);
    report[7] = 1;
    report[8] = 101;
    assert(parseRapooBatteryReport(report, 0x1421).status == Status::bad_report);
    report[1] = 0x10;
    report[8] = 68;
    report[18] = 0x7f;
    const auto ambiguous = parseRapooBatteryReport(report, 0x1421);
    report[18] = 0x33; // RF link bit still low, not a fresh sample
    assert(!parseRapooBatteryReport(report, 0x1421).reading);
    assert(ambiguous.status == Status::unavailable && !ambiguous.reading);
}
