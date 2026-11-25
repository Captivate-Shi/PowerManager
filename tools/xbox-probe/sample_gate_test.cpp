#include "sample_gate.hpp"

using namespace pm_xbox_probe;
constexpr Snapshot base{42, 1, true};
static_assert(observe(base, base, true, true, 2, 0).level == Level::empty);
static_assert(observe(base, base, true, true, 2, 1).level == Level::low);
static_assert(observe(base, base, true, true, 3, 2).level == Level::medium);
static_assert(observe(base, base, true, true, 3, 3).level == Level::full);
static_assert(observe(base, base, true, true, 2, 9).result == Result::invalid_level);
static_assert(observe(base, base, true, true, 1, 3).result == Result::unsupported_battery);
static_assert(observe(base, base, true, true, 0xff, 3).result == Result::unsupported_battery);
static_assert(observe(base, base, true, false, 2, 3).result == Result::call_failed);
static_assert(observe(base, {43, 1, true}, true, true, 2, 3).result == Result::changed);
static_assert(observe(base, {42, 2, true}, true, true, 2, 3).result == Result::changed);
static_assert(observe(base, {42, 1, false}, true, true, 2, 3).result == Result::changed);
static_assert(observe(base, base, false, true, 2, 3).result == Result::changed);
static_assert(observe({42, 4, true}, base, true, true, 2, 3).result == Result::no_binding);
static_assert(!observe(base, {43, 1, true}, true, true, 2, 3).level);
int main() {}
