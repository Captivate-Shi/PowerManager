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

struct DiagnosticReceiverSlot {
    std::wstring receiver;
    unsigned slot;
};

// A shared slot is never a device identity. Only the child proved by this
// attempt is eligible, and its current binding must still be unique.
inline bool matchesReceiverProbe(const std::map<std::wstring, DiagnosticReceiverSlot>& children,
                                 const std::wstring& child, const std::wstring& receiver, unsigned slot)
{
    if (child.empty() || receiver.empty() || !slot) return false;
    const auto found = children.find(child);
    return found != children.end() && found->second.receiver == receiver && found->second.slot == slot;
}

} // namespace pm
