#pragma once

#include <algorithm>
#include <map>
#include <set>
#include <string>
#include <vector>

namespace pm {

inline bool hidResourcesAvailable(const std::set<std::wstring>& resources, const std::set<std::wstring>& busy)
{
    return std::ranges::none_of(resources, [&](const auto& resource) { return busy.contains(resource); });
}

// Logical devices with any overlapping physical channel belong to a single
// batch. Conversely, a device with two transports joins both resources, so
// the receiver lock also covers a fallback to that device's other transport.
inline std::map<std::wstring, std::vector<std::wstring>> groupHidResources(
    const std::map<std::wstring, std::set<std::wstring>>& logicalResources)
{
    std::map<std::wstring, std::wstring> parents;
    std::map<std::wstring, std::wstring> owners;
    const auto root = [&](std::wstring id) {
        while (parents.at(id) != id) id = parents.at(id);
        return id;
    };
    for (const auto& [id, resources] : logicalResources) {
        parents.emplace(id, id);
        for (const auto& resource : resources) {
            const auto [owner, inserted] = owners.try_emplace(resource, id);
            if (inserted) continue;
            const auto a = root(id);
            const auto b = root(owner->second);
            if (a < b) parents.at(b) = a;
            else if (b < a) parents.at(a) = b;
        }
    }
    std::map<std::wstring, std::vector<std::wstring>> result;
    for (const auto& [id, _] : logicalResources) result[root(id)].push_back(id);
    return result;
}

} // namespace pm
