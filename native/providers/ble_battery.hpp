#pragma once

#include "battery.hpp"

#include <map>
#include <set>
#include <string>

namespace pm {

// Stable diagnostic stage codes; OS errors are in Sample::report, not device data.
enum class BleBatteryDetail : unsigned {
    invalid_container = 1,
    platform_unavailable,
    interface_enumeration_failed,
    no_service,
    multiple_services,
    open_service_failed,
    characteristic_query_failed,
    no_battery_level,
    multiple_battery_levels,
    battery_level_not_readable,
    read_failed,
    invalid_value,
    read_pending,
    worker_busy
};

inline const char* bleBatteryReason(unsigned detail)
{
    switch (static_cast<BleBatteryDetail>(detail)) {
    case BleBatteryDetail::invalid_container: return "invalid_container";
    case BleBatteryDetail::platform_unavailable: return "platform_unavailable";
    case BleBatteryDetail::interface_enumeration_failed: return "interface_enumeration_failed";
    case BleBatteryDetail::no_service: return "no_battery_service";
    case BleBatteryDetail::multiple_services: return "multiple_battery_services";
    case BleBatteryDetail::open_service_failed: return "open_service_failed";
    case BleBatteryDetail::characteristic_query_failed: return "characteristic_query_failed";
    case BleBatteryDetail::no_battery_level: return "no_battery_level";
    case BleBatteryDetail::multiple_battery_levels: return "multiple_battery_levels";
    case BleBatteryDetail::battery_level_not_readable: return "battery_level_not_readable";
    case BleBatteryDetail::read_failed: return "gatt_read_failed";
    case BleBatteryDetail::invalid_value: return "invalid_battery_level";
    case BleBatteryDetail::read_pending: return "read_pending";
    case BleBatteryDetail::worker_busy: return "worker_busy";
    default: return detail == 0 ? "ok" : "unknown";
    }
}

inline Sample bleFailure(BleBatteryDetail stage, Status status = Status::unavailable,
    unsigned error = 0)
{
    return {status, {}, error, static_cast<unsigned>(stage)};
}

inline Sample parseBleBatteryLevel(std::span<const std::uint8_t> data)
{
    if (data.size() != 1 || data.front() > 100) {
        return bleFailure(BleBatteryDetail::invalid_value, Status::bad_report);
    }
    const int level = data.front();
    // BAS 1.0 Battery Level alone cannot determine the charging state.
    return {Status::current, Reading{level, level, Power::unknown, level, ReadingSource::ble}};
}

// The inventory is SetupAPI-only: no active scan, connection or GATT IO.
// Unique-service containers only; multi-BAS devices have no safe single reading.
struct BleServiceInventory {
    bool complete{};
    unsigned error{};
    std::map<std::wstring, unsigned> counts;
};
BleServiceInventory inspectBleBatteryServices();
std::set<std::wstring> bleBatteryContainers();

// Call only for a user-watched device Windows reports connected. A single
// process-wide worker bounds collector latency and keeps the legacy fallbacks
// responsive. A completed live read may be returned once on a later poll.
Sample readBleBattery(const std::wstring& containerId);

} // namespace pm
