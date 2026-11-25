#pragma once

#include "battery.hpp"

#include <cstdint>
#include <optional>
#include <vector>

namespace pm {

// These snapshots describe Windows input API endpoints, not physical PnP
// devices. XInput slot numbers and WGI enumeration indexes can be reused.
enum class GamepadBatteryStatus {
    ok, disconnected, wired, not_present, unsupported, invalid_report, api_error
};
enum class GamepadBatteryLevel { unknown, empty, low, medium, full };

struct GamepadBatteryObservation {
    unsigned slot{};
    unsigned vid{};
    unsigned pid{};
    unsigned detail{};
    GamepadBatteryStatus status{GamepadBatteryStatus::unsupported};
    GamepadBatteryLevel level{GamepadBatteryLevel::unknown};
    std::optional<int> percent{};
    Power power{Power::unknown};
    std::optional<int> remainingMwh{}, fullMwh{};
};

struct GamepadBatteryInventory {
    const char* wgiStatus{"not_available"};
    const char* xinputStatus{"not_available"};
    std::vector<GamepadBatteryObservation> windowsGamingInput;
    std::vector<GamepadBatteryObservation> xinput;
};

constexpr const char* gamepadBatteryStatusName(GamepadBatteryStatus status)
{
    switch (status) {
    case GamepadBatteryStatus::ok: return "ok";
    case GamepadBatteryStatus::disconnected: return "disconnected";
    case GamepadBatteryStatus::wired: return "wired";
    case GamepadBatteryStatus::not_present: return "no_battery";
    case GamepadBatteryStatus::unsupported: return "not_reported";
    case GamepadBatteryStatus::invalid_report: return "invalid_report";
    case GamepadBatteryStatus::api_error: return "api_error";
    }
    return "not_reported";
}

constexpr const char* gamepadBatteryLevelName(GamepadBatteryLevel level)
{
    switch (level) {
    case GamepadBatteryLevel::empty: return "empty";
    case GamepadBatteryLevel::low: return "low";
    case GamepadBatteryLevel::medium: return "medium";
    case GamepadBatteryLevel::full: return "full";
    default: return "unknown";
    }
}

// XInput's BatteryLevel is valid only when BatteryType is alkaline or NiMH.
// Do not convert the bins to inferred percentages or a charging state.
constexpr GamepadBatteryObservation classifyXInputBattery(
    unsigned slot, unsigned type, unsigned level)
{
    GamepadBatteryObservation result{.slot = slot};
    if (type == 0) result.status = GamepadBatteryStatus::disconnected;
    else if (type == 1) result.status = GamepadBatteryStatus::wired;
    else if (type == 2 || type == 3) {
        if (level > 3) result.status = GamepadBatteryStatus::invalid_report;
        else {
            result.status = GamepadBatteryStatus::ok;
            result.level = static_cast<GamepadBatteryLevel>(level + 1);
        }
    }
    return result;
}

// Windows.Devices.Power.BatteryReport provides nullable capacity values in
// mWh. Use *full-charge*, not design capacity. Status alone is not a reading.
constexpr void applyGamingInputBattery(GamepadBatteryObservation& out, unsigned status,
    std::optional<int> remaining, std::optional<int> full)
{
    if (status == 0) {
        out.status = GamepadBatteryStatus::not_present;
        return;
    }
    if (status > 3) {
        out.status = GamepadBatteryStatus::invalid_report;
        return;
    }
    out.power = status == 1 ? Power::discharging : status == 3 ? Power::charging : Power::unknown;
    if (!remaining || !full) return;
    if (*full <= 0 || *remaining < 0 || *remaining > *full) {
        out.status = GamepadBatteryStatus::invalid_report;
        return;
    }
    out.remainingMwh = remaining;
    out.fullMwh = full;
    // Avoid rounding a valid nonzero sample to empty or a partly filled one to full.
    const auto rounded = (100LL * *remaining + *full / 2) / *full;
    out.percent = *remaining == 0 ? 0 : *remaining == *full ? 100 :
        static_cast<int>(rounded < 1 ? 1 : rounded > 99 ? 99 : rounded);
    if (status == 2 && *remaining == *full) out.power = Power::full;
    out.status = GamepadBatteryStatus::ok;
}

// Must run on a thread initialized with RoInitialize for the WGI portion.
// Only performs bounded, on-demand read queries. No input state is captured.
GamepadBatteryInventory inspectGamepadBatteries();

} // namespace pm
