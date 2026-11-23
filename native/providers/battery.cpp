#include "battery.hpp"

#include <algorithm>

namespace pm {
namespace {

struct RazerCommand {
    std::uint8_t transaction;
    std::uint8_t category;
    std::uint8_t id;
    std::uint8_t length;
};

constexpr std::array razerCommands{
    RazerCommand{0x1f, 0x07, 0x80, 2}, RazerCommand{0x1f, 0x00, 0xbf, 31},
    RazerCommand{0x9f, 0x07, 0x80, 2}, RazerCommand{0x9f, 0x07, 0x84, 2},
};

std::uint8_t razerChecksum(std::span<const std::uint8_t> report)
{
    std::uint8_t checksum = 0;
    for (auto byte : report.subspan(3, 86)) {
        checksum ^= byte;
    }
    return checksum;
}

std::uint32_t dualSenseCrc(std::uint8_t prefix, std::span<const std::uint8_t> report)
{
    std::uint32_t crc = ~0u;
    const auto update = [&crc](std::uint8_t value) {
        crc ^= value;
        for (int bit = 0; bit < 8; ++bit) {
            crc = (crc >> 1) ^ ((crc & 1) ? 0xedb88320u : 0u);
        }
    };
    update(prefix);
    for (auto byte : report) {
        update(byte);
    }
    return ~crc;
}

} // namespace

DualSenseVoltageReport makeDualSenseVoltageQuery(bool bluetooth)
{
    // Only the read-only ANALOG_DATA/BATTERY factory command is supported.
    DualSenseVoltageReport report{0x80, 0x04, 0x03};
    if (bluetooth) {
        const auto payloadLength = report.size() - 4;
        const auto crc = dualSenseCrc(0x53, std::span(report).first(payloadLength));
        for (unsigned i = 0; i < 4; ++i) {
            report[payloadLength + i] = static_cast<std::uint8_t>(crc >> (8 * i));
        }
    }
    return report;
}

VoltageSample parseDualSenseVoltageReply(std::span<const std::uint8_t> report)
{
    if (report.size() < 4 || report[0] != 0x81) {
        return {VoltageStatus::invalid_reply, {}, static_cast<unsigned>(report.size())};
    }
    if (report[1] != 0x04 || report[2] != 0x03) {
        return {VoltageStatus::waiting};
    }
    if (report[3] < 2) {
        return {VoltageStatus::waiting, {}, report[3]};
    }
    if (report[3] != 2 || report.size() < 8) {
        return {VoltageStatus::invalid_reply, {}, report[3]};
    }
    const unsigned mv = report[4] | (static_cast<unsigned>(report[5]) << 8);
    if (mv < 2500 || mv > 4500) {
        return {VoltageStatus::invalid_reply, {}, mv};
    }
    return {VoltageStatus::ok, mv, report[3]};
}

RazerReport makeRazerQuery(RazerQuery query)
{
    const auto command = razerCommands[static_cast<std::size_t>(query)];
    RazerReport report{};
    report[2] = command.transaction;
    report[6] = command.length;
    report[7] = command.category;
    report[8] = command.id;
    report[89] = razerChecksum(report);
    return report;
}

Sample parseRazerReport(std::span<const std::uint8_t> report, RazerQuery query)
{
    const auto command = razerCommands[static_cast<std::size_t>(query)];
    if (report.size() != 91 || report[0] != 0) {
        return {Status::bad_report, {}, command.id};
    }
    const auto status = report[1];
    if (report[2] != command.transaction || report[7] != command.category || report[8] != command.id) {
        return {Status::busy, {}, command.id, status};
    }
    if (status == 1) {
        return {Status::busy, {}, command.id, status};
    }
    if (status == 4) {
        return {Status::no_radio_reply, {}, command.id, status};
    }
    if (status != 2 || report[3] != 0 || report[4] != 0 || report[5] != 0 ||
        report[6] != command.length || report[89] != razerChecksum(report)) {
        return {Status::bad_report, {}, command.id, status};
    }
    if (query == RazerQuery::pairedDevices) {
        const bool knownPair = report[9] == 2 && report[11] == 0x00 && report[12] == 0xb8 &&
                               report[14] == 0x02 && report[15] == 0xd2;
        return {Status::current, {}, command.id, knownPair ? 1u : 0u};
    }
    if (query == RazerQuery::keyboardCharging) {
        return report[10] <= 1 ? Sample{Status::current, {}, command.id, report[10]}
                               : Sample{Status::bad_report, {}, command.id, report[10]};
    }
    const int raw = report[10];
    const int percent = (100 * raw + 127) / 255;
    const auto power = query == RazerQuery::keyboardBattery ? Power::unknown : Power::discharging;
    return {Status::current, Reading{percent, percent, power, raw}, command.id, status};
}

Sample parseDualSenseReport(std::span<const std::uint8_t> report, bool bluetooth)
{
    if (report.empty()) {
        return {Status::bad_report};
    }
    const auto id = report.front();
    if (bluetooth && id == 1) {
        return {Status::basic_bluetooth, {}, id};
    }
    if (bluetooth) {
        // Windows may pad a short report to the collection's maximum report size.
        constexpr auto length = 78u;
        if (id != 0x31 || report.size() < length) {
            return {Status::bad_report, {}, id, static_cast<unsigned>(report.size())};
        }
        std::uint32_t crc = 0;
        for (unsigned i = 0; i < 4; ++i) {
            crc |= static_cast<std::uint32_t>(report[length - 4 + i]) << (8 * i);
        }
        if (dualSenseCrc(0xa1, report.first(length - 4)) != crc) {
            return {Status::bad_report, {}, id};
        }
    } else if (id != 1 || report.size() < 64) {
        return {Status::bad_report, {}, id, static_cast<unsigned>(report.size())};
    }
    const auto status = report[bluetooth ? 54 : 53];
    const int level = status & 0x0f;
    const int charge = status >> 4;
    if (charge > 2) {
        return {Status::charging_error, {}, id, status};
    }
    if (level > 10) {
        return {Status::bad_report, {}, id, status};
    }
    // A charge-complete flag and a below-maximum gauge bucket can arrive together.
    const auto power = charge == 2 ? Power::full
        : charge == 1 ? Power::charging : Power::discharging;
    return {Status::current, Reading{10 * level, std::min(10 * level + 9, 100), power, level},
            id, status};
}

std::optional<Reading> windowsReading(std::optional<int> percent, std::optional<int> charging)
{
    if (!percent || *percent < 0 || *percent > 100) {
        return {};
    }
    const auto power = charging == 1 ? Power::charging
        : charging == 0 ? Power::discharging : Power::unknown;
    return Reading{*percent, *percent, power, *percent, ReadingSource::windows};
}

Alert AlertState::observe(const Sample& sample, Thresholds levels, bool enabled)
{
    if (sample.status != Status::current || !sample.reading) {
        recoverySamples = 0;
        return Alert::none;
    }
    const auto& reading = *sample.reading;
    if (reading.power == Power::full || reading.low >= levels.low + 5) {
        if (++recoverySamples == 2) {
            lowSent = false;
            criticalSent = false;
        }
        recoverySamples = std::min(recoverySamples, 2);
    } else {
        recoverySamples = 0;
    }
    if (!enabled || reading.power == Power::charging || reading.power == Power::full) {
        return Alert::none;
    }
    if (reading.high <= levels.critical) {
        return criticalSent ? Alert::none : Alert::critical;
    }
    if (reading.high <= levels.low && !lowSent) {
        return Alert::low;
    }
    return Alert::none;
}

void AlertState::markSent(Alert alert)
{
    if (alert != Alert::none) {
        lowSent = true;
        criticalSent = criticalSent || alert == Alert::critical;
    }
}

} // namespace pm
