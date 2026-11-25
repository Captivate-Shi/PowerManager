#include "battery_fallback.hpp"

using namespace pm;
constexpr Sample absent{Status::unavailable};
constexpr Sample disconnected{Status::offline};
constexpr Sample partial{Status::current, {}, 0x80};
constexpr Sample malformed{Status::current, Reading{30, 101, Power::unknown, 130}};
constexpr Sample zero{Status::current, Reading{0, 0, Power::unknown, 0, ReadingSource::windows}};
constexpr Sample ble{Status::current, Reading{20, 20, Power::unknown, 20, ReadingSource::ble}};
constexpr Sample hid{Status::current, Reading{25, 25, Power::discharging, 25}};
static_assert(batteryFallback(hid, ble).reading == hid.reading);
static_assert(batteryFallback(zero, ble).reading == zero.reading);
static_assert(batteryFallback(partial, zero).reading == zero.reading);
static_assert(batteryFallback(malformed, ble).reading == ble.reading);
static_assert(!batteryFallback(malformed, absent).reading);
static_assert(batteryFallback(partial, absent).status == Status::unavailable);
static_assert(batteryFallback(disconnected, absent).status == Status::unavailable);
static_assert(batteryFallback(disconnected, disconnected).status == Status::offline);
int main() {}
