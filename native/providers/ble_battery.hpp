#pragma once

#include "battery.hpp"

#include <chrono>
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

// Scheduler signals, not final GATT errors. Some actual Win32 failures also
// map to Status::busy; their stage is open/query/read rather than these two.
inline constexpr bool bleBatteryReadDeferred(const Sample& value)
{
    const auto detail = static_cast<BleBatteryDetail>(value.detail);
    return value.status == Status::busy &&
        (detail == BleBatteryDetail::read_pending || detail == BleBatteryDetail::worker_busy);
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
// Harvest a completed sample only: this never opens the service or waits for
// an active operation. It may be called even after the per-poll budget ran out.
std::optional<Sample> takeBleBatteryResult(const std::wstring& containerId);
// Battery and firmware share the radio. Idle/completed work is never expired.
bool bleBatteryWorkExpired(std::chrono::steady_clock::duration maximumAge);

enum class BleFirmwareStatus { pending, unsupported, busy, ready };
struct BleFirmwareResult {
    BleFirmwareStatus status;
    std::string revision{};
    unsigned detail{};
    unsigned error{};
};

// Conservative ASCII subset of the Bluetooth SIG UTF-8 string; do not
// export controls, paths, identifiers with ':'/@, or malformed/truncated values.
inline std::optional<std::string> parseBleFirmwareRevision(std::span<const std::uint8_t> bytes)
{
    if (bytes.empty() || bytes.size() > 64) return {};
    bool alphanumeric = false;
    for (auto c : bytes) {
        const bool alphaNum = (c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');
        if (!alphaNum && c != ' ' && c != '.' && c != '_' && c != '-' && c != '+' &&
            c != '(' && c != ')') return {};
        alphanumeric = alphanumeric || alphaNum;
    }
    if (!alphanumeric) return {};
    while (bytes.front() == ' ') bytes = bytes.subspan(1);
    while (bytes.back() == ' ') bytes = bytes.first(bytes.size() - 1);
    return std::string(reinterpret_cast<const char*>(bytes.data()), bytes.size());
}

inline const char* bleFirmwareReason(unsigned detail)
{
    switch (static_cast<BleBatteryDetail>(detail)) {
    case BleBatteryDetail::no_service: return "no_device_information_service";
    case BleBatteryDetail::multiple_services: return "multiple_device_information_services";
    case BleBatteryDetail::no_battery_level: return "no_firmware_revision_characteristic";
    case BleBatteryDetail::multiple_battery_levels: return "multiple_firmware_revision_characteristics";
    case BleBatteryDetail::battery_level_not_readable: return "firmware_revision_not_readable";
    case BleBatteryDetail::invalid_value: return "invalid_firmware_revision";
    default: return bleBatteryReason(detail);
    }
}

// Explicit live DIS read for one user-selected, connected device only. Calling
// again while pending retrieves the single in-flight result; inventory does
// not call this function. Does not read or infer firmware from USB revisions.
BleFirmwareResult readBleFirmware(const std::wstring& containerId);
// SetupAPI-only indication of unique DIS candidate; not proof of 0x2A26.
std::set<std::wstring> bleFirmwareContainers();

} // namespace pm
