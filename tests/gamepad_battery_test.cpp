#include "gamepad_battery.hpp"

#include <cassert>
#include <climits>

int main()
{
    using namespace pm;
    for (unsigned type : {2u, 3u}) {
        for (unsigned level = 0; level < 4; ++level) {
            const auto item = classifyXInputBattery(3, type, level);
            assert(item.slot == 3 && item.status == GamepadBatteryStatus::ok);
            assert(static_cast<unsigned>(item.level) == level + 1);
            assert(!item.percent && item.power == Power::unknown);
        }
    }
    assert(classifyXInputBattery(0, 0, 3).status == GamepadBatteryStatus::disconnected);
    assert(classifyXInputBattery(0, 1, 3).status == GamepadBatteryStatus::wired);
    assert(classifyXInputBattery(0, 255, 3).status == GamepadBatteryStatus::unsupported);
    assert(classifyXInputBattery(0, 2, 255).status == GamepadBatteryStatus::invalid_report);

    auto report = [](unsigned status, std::optional<int> remaining, std::optional<int> full) {
        GamepadBatteryObservation item;
        applyGamingInputBattery(item, status, remaining, full);
        return item;
    };
    assert(report(0, 750, 1000).status == GamepadBatteryStatus::not_present);
    assert(!report(0, 750, 1000).percent);
    assert(report(2, {}, 1000).status == GamepadBatteryStatus::unsupported);
    assert(report(1, 10, {}).status == GamepadBatteryStatus::unsupported);
    assert(report(3, {}, {}).power == Power::charging && !report(3, {}, {}).percent);
    assert(report(1, 0, 100).percent == 0);
    assert(report(1, 1, 1000).percent == 1);
    assert(report(1, 999, 1000).percent == 99);
    assert(report(2, INT_MAX, INT_MAX).percent == 100);
    assert(report(2, 1000, 1000).power == Power::full);
    assert(report(2, 500, 1000).power == Power::unknown);
    assert(report(3, 700, 1000).power == Power::charging);
    assert(report(1, 700, 1000).power == Power::discharging);
    assert(report(1, -1, 1000).status == GamepadBatteryStatus::invalid_report);
    assert(report(1, 1001, 1000).status == GamepadBatteryStatus::invalid_report);
    assert(report(1, 0, 0).status == GamepadBatteryStatus::invalid_report);
    assert(report(255, 0, 1000).status == GamepadBatteryStatus::invalid_report);
}
