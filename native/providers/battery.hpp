#pragma once

#include <array>
#include <cstdint>
#include <optional>
#include <span>

namespace pm {

enum class Power { discharging, charging, full, unknown };
enum class ReadingSource { hid, windows };
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
Sample parseDualSenseReport(std::span<const std::uint8_t> report, bool bluetooth);
std::optional<Reading> windowsReading(std::optional<int> percent, std::optional<int> charging);

} // namespace pm
