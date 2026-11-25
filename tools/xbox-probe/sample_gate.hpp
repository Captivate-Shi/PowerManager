#pragma once

#include <cstdint>
#include <optional>

namespace pm_xbox_probe {
enum class Level { empty, low, medium, full };
enum class Result { no_binding, changed, call_failed, unsupported_battery, invalid_level, observed };

struct Snapshot {
    std::uint64_t generation{};
    unsigned slot{};
    bool verified{};
};

struct Observation {
    Result result;
    std::optional<Level> level{};
};

constexpr Observation observe(Snapshot before, Snapshot after, bool sameIdentity,
                              bool acceptedCall, unsigned batteryType, unsigned batteryLevel)
{
    if (!before.verified || before.slot >= 4) return {Result::no_binding};
    if (!after.verified || !sameIdentity || before.slot != after.slot ||
        before.generation != after.generation) return {Result::changed};
    if (!acceptedCall) return {Result::call_failed};
    if (batteryType != 2 && batteryType != 3) return {Result::unsupported_battery};
    if (batteryLevel > 3) return {Result::invalid_level};
    return {Result::observed, static_cast<Level>(batteryLevel)};
}
}
