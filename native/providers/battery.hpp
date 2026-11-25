#pragma once

#include <array>
#include <cstdint>
#include <optional>
#include <span>

namespace pm {

enum class Power { discharging, charging, full, unknown };
enum class ReadingSource { hid, windows, ble, hid_voltage, bluetooth_vendor };
enum class Status {
    current, offline, no_radio_reply, busy, timeout, bad_report, unavailable,
    basic_bluetooth, charging_error
};

struct Reading {
    int low;
    int high;
    Power power;
    int raw;
    ReadingSource source = ReadingSource::hid;
    constexpr int midpoint() const { return low + (high - low + 1) / 2; }
    friend bool operator==(const Reading&, const Reading&) = default;
};

struct Sample {
    Status status;
    std::optional<Reading> reading{};
    unsigned report{};
    unsigned detail{};
    unsigned feature{};
    std::optional<unsigned> millivolts{};
};

enum class VoltageStatus { ok, waiting, missing_hid_reading, unsupported, io_error, timeout, invalid_reply };

struct VoltageSample {
    VoltageStatus status;
    std::optional<unsigned> millivolts{};
    unsigned detail{};
};

using DualSenseFullReportRequest = std::array<std::uint8_t, 78>;
DualSenseFullReportRequest makeDualSenseFullReportRequest();
inline constexpr unsigned dualSenseMaxHostOutputLength = 1024;
constexpr bool dualSenseValidHostOutputLength(unsigned length)
{
    return length >= DualSenseFullReportRequest{}.size() && length <= dualSenseMaxHostOutputLength;
}
bool encodeDualSenseHostOutput(std::span<std::uint8_t> output);

constexpr bool dualSenseFullReportEligible(unsigned vid, unsigned pid, bool bluetooth,
    unsigned page, unsigned usage, unsigned input, unsigned output, const Sample& observed)
{
    return bluetooth && vid == 0x054c && (pid == 0x0ce6 || pid == 0x0df2) &&
        page == 1 && usage == 5 && input >= 78 && dualSenseValidHostOutputLength(output) &&
        observed.status == Status::basic_bluetooth && observed.report == 0x01 && !observed.reading;
}

using DualSenseVoltageReport = std::array<std::uint8_t, 64>;
DualSenseVoltageReport makeDualSenseVoltageQuery(bool bluetooth);
VoltageSample parseDualSenseVoltageReply(std::span<const std::uint8_t> report);

struct Thresholds {
    int low = 20;
    int critical = 10;
    bool valid() const { return 1 <= critical && critical < low && low <= 95; }
};

enum class Alert { none, low, critical };

struct AlertState {
    bool lowSent{};
    bool criticalSent{};
    int recoverySamples{};

    Alert observe(const Sample& sample, Thresholds levels, bool enabled);
    void markSent(Alert alert);
};

using RazerReport = std::array<std::uint8_t, 91>;
enum class RazerQuery { mouseBattery, pairedDevices, keyboardBattery, keyboardCharging };
RazerReport makeRazerQuery(RazerQuery query = RazerQuery::mouseBattery);
Sample parseRazerReport(std::span<const std::uint8_t> report, RazerQuery query = RazerQuery::mouseBattery);
Sample parseSwitchProBluetoothReport(std::span<const std::uint8_t> report);
Sample parse8BitDoBatteryReport(std::span<const std::uint8_t> report, unsigned reportId);
Sample parse8BitDoPro3BluetoothReport(std::span<const std::uint8_t> report);
Sample parseDualShock4Report(std::span<const std::uint8_t> report, bool bluetooth);
Sample parseDualSenseReport(std::span<const std::uint8_t> report, bool bluetooth);
std::optional<Reading> windowsReading(std::optional<int> percent, std::optional<int> charging);

} // namespace pm
