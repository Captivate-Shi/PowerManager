#pragma once

#include "battery.hpp"

namespace pm {

// Zero is a real reading unless a provider's protocol defines it as a sentinel.
constexpr bool hasBatteryReading(const Sample& value)
{
    return value.status == Status::current && value.reading && value.reading->low >= 0 &&
           value.reading->low <= value.reading->high && value.reading->high <= 100;
}

constexpr Sample batteryFallback(Sample first, const Sample& next)
{
    if (hasBatteryReading(first)) return first;
    if (hasBatteryReading(next)) return next;
    if (first.status == Status::offline && next.status != Status::offline) first = next;
    // A partial response (for instance, charge state without percentage) is
    // useful in diagnostics, but cannot become a live battery measurement.
    if (first.status == Status::current) first.status = Status::unavailable;
    first.reading.reset();
    return first;
}

} // namespace pm
