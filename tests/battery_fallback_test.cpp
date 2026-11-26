#include "battery_fallback.hpp"
#include "razer_collection_fallback.hpp"

#include <cstdlib>
#include <iostream>
#include <vector>

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
static void require(bool ok, const char* message)
{
    if (!ok) {
        std::cerr << message << '\n';
        std::exit(1);
    }
}

void testRazerCollectionFallback()
{
    using namespace std::chrono_literals;
    using Clock = std::chrono::steady_clock;
    struct Lane { std::wstring_view path; unsigned featureLength; };
    const std::array lanes{Lane{L"preferred-by-rank", 91}, Lane{L"cached", 91}, Lane{L"too-short", 90}};
    auto time = Clock::time_point{};
    const auto deadline = time + 1800ms;
    std::vector<std::wstring_view> visited;
    const auto now = [&] { return time; };

    auto [fresh, winner] = readRazerCollections(lanes, L"cached", deadline, now,
        [&](const Lane& lane, auto cutoff) {
            visited.push_back(lane.path);
            require(cutoff <= deadline, "No Razer lane can exceed the original scan deadline");
            if (lane.path == L"cached") {
                require(cutoff < deadline, "A stale cached lane must leave budget for its sibling");
                time = cutoff; // Windows exhausted this lane's allotted time
                return Sample{Status::timeout};
            }
            require(time + 65ms < cutoff, "Remaining lane has time to receive a reply");
            return Sample{Status::current, Reading{42, 42, Power::unknown, 107}};
        });
    require(visited == std::vector<std::wstring_view>{L"cached", L"preferred-by-rank"} &&
        winner == &lanes[0] && fresh.reading && fresh.reading->low == 42,
        "Stale cached Razer lane falls back and the successful lane becomes the new cache");

    visited.clear();
    auto [cachedReading, cachedWinner] = readRazerCollections(lanes, winner->path, deadline, now,
        [&](const Lane& lane, auto) { visited.push_back(lane.path); return Sample{Status::current, Reading{42, 42, Power::unknown, 107}}; });
    require(visited == std::vector<std::wstring_view>{L"preferred-by-rank"} &&
        cachedWinner == winner && cachedReading.reading, "Healthy cache skips unnecessary feature requests");

    visited.clear();
    auto [empty, failed] = readRazerCollections(lanes, L"too-short", deadline, now,
        [&](const Lane& lane, auto) {
            visited.push_back(lane.path);
            return Sample{lane.path == L"preferred-by-rank" ? Status::no_radio_reply : Status::bad_report};
        });
    require(visited == std::vector<std::wstring_view>{L"preferred-by-rank", L"cached"} &&
        failed == nullptr && empty.status == Status::no_radio_reply && !empty.reading,
        "An invalid cached descriptor is skipped and total failure preserves no-radio diagnostics");

    time = deadline;
    visited.clear();
    auto [expired, expiredWinner] = readRazerCollections(lanes, L"cached", deadline, now,
        [&](const Lane& lane, auto) { visited.push_back(lane.path); return Sample{Status::current, Reading{42, 42, Power::unknown, 107}}; });
    require(visited.empty() && !expiredWinner && !expired.reading, "Expired scan cannot send a feature request");
}

int main() { testRazerCollectionFallback(); }
