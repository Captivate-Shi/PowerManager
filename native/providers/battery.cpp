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

DualSenseFullReportRequest makeDualSenseFullReportRequest()
{
    DualSenseFullReportRequest packet{};
    packet[0] = 0x31;
    packet[1] = packet[2] = 0x10;
    // All effect-valid flags remain unset. Only request the full BT stream.
    const auto crc = dualSenseCrc(0xa2, std::span(packet).first(74));
    for (unsigned i = 0; i < 4; ++i) packet[74 + i] = static_cast<std::uint8_t>(crc >> (8 * i));
    return packet;
}

bool encodeDualSenseHostOutput(std::span<std::uint8_t> output)
{
    if (output.size() > dualSenseMaxHostOutputLength ||
        !dualSenseValidHostOutputLength(static_cast<unsigned>(output.size()))) return false;
    const auto report = makeDualSenseFullReportRequest();
    std::ranges::fill(output, std::uint8_t{});
    std::ranges::copy(report, output.begin());
    return true;
}

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

Sample parseSwitchProBluetoothReport(std::span<const std::uint8_t> report)
{
    if (report.empty()) return {Status::bad_report};
    if (report[0] == 0x3f) return {Status::basic_bluetooth, {}, 0x3f};
    // Only the full input-state report, never command response or NFC data.
    // HidClass can pad this 49-byte Bluetooth report to the largest report.
    if (report[0] != 0x30 || report.size() < 49)
        return {Status::bad_report, {}, report[0], static_cast<unsigned>(report.size())};
    const unsigned state = report[2];
    const unsigned level = state >> 5;
    if (level > 4) return {Status::bad_report, {}, 0x30, state};
    const auto power = state & 0x10 ? Power::charging : Power::discharging;
    // UI bands for the five discrete levels; not a calibrated percentage.
    const int upper = static_cast<int>(level) * 25;
    return {Status::current, Reading{upper ? upper - 24 : 0, upper, power, static_cast<int>(level)},
        0x30, state};
}

Sample parse8BitDoBatteryReport(std::span<const std::uint8_t> report, unsigned reportId)
{
    if ((reportId != 1 && reportId != 4) || report.size() < 15 || report[0] != reportId) {
        return {Status::bad_report, {}, report.empty() ? 0u : unsigned(report[0]), unsigned(report.size())};
    }
    // Verified by HaloBattery on real Pro 3 DInput Bluetooth with Steam closed.
    // Refuse zero to avoid turning a padded/incomplete packet into a low alert.
    const int encoded = report[14];
    const int percent = encoded & 0x7f;
    if (percent == 0 || percent > 100) return {Status::bad_report, {}, reportId, unsigned(encoded)};
    return {Status::current, Reading{percent, percent, encoded & 0x80 ? Power::charging : Power::discharging,
                                    percent}, reportId, unsigned(encoded)};
}

Sample parse8BitDoPro3BluetoothReport(std::span<const std::uint8_t> report)
{
    return parse8BitDoBatteryReport(report, 4);
}

Sample parseDualShock4Report(std::span<const std::uint8_t> report, bool bluetooth)
{
    // DS4 CUH-ZCT1/ZCT2 full input layout, as documented by Linux hid-playstation.
    // A Windows Bluetooth basic (0x01) frame may be zero-padded; never sample it.
    if (report.empty()) return {Status::bad_report};
    const auto id = report.front();
    if (bluetooth && id == 1) return {Status::basic_bluetooth, {}, id};
    const unsigned length = bluetooth ? 78 : 64;
    if (id != (bluetooth ? 0x11 : 1) || report.size() < length) {
        return {Status::bad_report, {}, id, static_cast<unsigned>(report.size())};
    }
    if (bluetooth) {
        std::uint32_t crc = 0;
        for (unsigned i = 0; i < 4; ++i) {
            crc |= static_cast<std::uint32_t>(report[length - 4 + i]) << (8 * i);
        }
        if (dualSenseCrc(0xa1, report.first(length - 4)) != crc) return {Status::bad_report, {}, id};
    }
    const unsigned status = report[bluetooth ? 32 : 30];
    const int level = status & 0x0f;
    const bool cable = (status & 0x10) != 0;
    if (cable && level == 11) return {Status::current, Reading{100, 100, Power::full, level}, id, status};
    if (cable && level >= 14) return {Status::charging_error, {}, id, status};
    if (level > 10) return {Status::bad_report, {}, id, status};
    return {Status::current, Reading{10 * level, std::min(10 * level + 9, 100),
                                    cable ? Power::charging : Power::discharging, level}, id, status};
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
