#pragma once

#include "battery_fallback.hpp"

#include <algorithm>
#include <chrono>
#include <string_view>
#include <utility>

namespace pm {

// Shared receiver collections are already identity-checked/ranked by enumeration.
// A cached path is a priority hint, not permission to skip the live descriptor
// gate or monopolize the scan budget.
template<class Collections, class TimePoint, class Now, class Read>
auto readRazerCollections(const Collections& collections, std::wstring_view preferred,
                          TimePoint deadline, Now now, Read read)
    -> std::pair<Sample, const typename Collections::value_type*>
{
    using Collection = typename Collections::value_type;
    using namespace std::chrono_literals;
    const auto eligible = [](const Collection& collection) { return collection.featureLength >= 91; };
    const auto cached = std::ranges::find_if(collections, [&](const Collection& collection) {
        return !preferred.empty() && collection.path == preferred && eligible(collection);
    });
    auto remaining = std::ranges::count_if(collections, eligible);
    Sample result{Status::unavailable};
    Sample radioSilent{Status::unavailable};
    const auto attempt = [&](const Collection& collection) -> bool {
        const auto start = now();
        if (start + 65ms >= deadline) return false; // no time for a feature reply
        const auto minimum = std::chrono::ceil<typename TimePoint::duration>(70ms);
        const auto laneBudget = std::max(minimum, (deadline - start) / remaining--);
        const auto sample = read(collection, std::min(deadline, start + laneBudget));
        result = batteryFallback(sample, {Status::offline});
        if (result.status == Status::no_radio_reply) radioSilent = result;
        return hasBatteryReading(result);
    };
    if (cached != collections.end() && attempt(*cached)) return {result, &*cached};
    for (auto it = collections.begin(); it != collections.end(); ++it) {
        if (it != cached && eligible(*it) && attempt(*it)) return {result, &*it};
    }
    return {radioSilent.status == Status::no_radio_reply ? radioSilent : result, nullptr};
}

} // namespace pm
