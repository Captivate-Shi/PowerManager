#pragma once

#include <map>
#include <set>
#include <string>

namespace pm {

// Exact container links only. Neither a receiver parent nor a container with
// multiple native owners can safely identify a selected peripheral.
inline std::wstring diagnosticScopeKey(const std::wstring& container,
                                       const std::map<std::wstring, std::wstring>& owners,
                                       const std::set<std::wstring>& sharedReceivers,
                                       const std::set<std::wstring>& windows)
{
    if (container.empty() || sharedReceivers.contains(container)) return {};
    const auto owner = owners.find(container);
    if (owner != owners.end()) return owner->second;
    return windows.contains(container) ? container : std::wstring{};
}

} // namespace pm
