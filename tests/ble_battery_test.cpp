#include "ble_battery.hpp"
#include <array>
#include <cassert>

int main()
{
    for (const auto level : {0, 1, 52, 99, 100}) {
        const std::array bytes{static_cast<std::uint8_t>(level)};
        const auto sample = pm::parseBleBatteryLevel(bytes);
        assert(sample.status == pm::Status::current && sample.reading);
        assert(sample.reading->low == level && sample.reading->high == level);
        assert(sample.reading->power == pm::Power::unknown);
        assert(sample.reading->source == pm::ReadingSource::ble);
    }
    for (const auto level : {101, 255}) {
        const std::array bytes{static_cast<std::uint8_t>(level)};
        const auto sample = pm::parseBleBatteryLevel(bytes);
        assert(!sample.reading && sample.status == pm::Status::bad_report);
        assert(sample.detail == static_cast<unsigned>(pm::BleBatteryDetail::invalid_value));
    }
    assert(!pm::parseBleBatteryLevel({}).reading);
    const std::array<std::uint8_t, 2> oversized{80, 0};
    assert(!pm::parseBleBatteryLevel(oversized).reading);
}
