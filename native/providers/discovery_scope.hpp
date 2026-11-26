#pragma once

#include <algorithm>
#include <map>
#include <set>
#include <string>

namespace pm {

// A logical device can be seen on several physical parents. Keep prior
// bindings until there is confirmed evidence against each of them.
class HidDiscoveryScope {
public:
    using Parents = std::map<std::wstring, std::set<std::wstring>>;

    struct Omissions {
        std::set<std::wstring> absent;
        std::set<std::wstring> uncertain;
    };

    Omissions observe(const Parents& verified, const std::set<std::wstring>& present,
        const std::set<std::wstring>& resolved, bool completeInventory)
    {
        Omissions omissions;
        for (auto it = known_.begin(); it != known_.end();) {
            const auto current = verified.find(it->first);
            auto& parents = it->second;
            const auto observed = [&](const std::wstring& parent) {
                return current != verified.end() && current->second.contains(parent);
            };
            std::erase_if(parents, [&](const auto& parent) {
                // A partial snapshot proves positive matches only. A complete
                // snapshot can prove the parent disappeared, and a resolved
                // active parent can prove a previously identified child left.
                return !observed(parent) && completeInventory &&
                    (!present.contains(parent) || resolved.contains(parent));
            });
            if (parents.empty() && current == verified.end()) {
                omissions.absent.insert(it->first);
                it = known_.erase(it);
            } else {
                if (std::ranges::any_of(parents, [&](const auto& parent) { return !observed(parent); }))
                    omissions.uncertain.insert(it->first);
                ++it;
            }
        }
        for (const auto& [logical, parents] : verified)
            known_[logical].insert(parents.begin(), parents.end());
        return omissions;
    }

private:
    Parents known_; // Logical identity -> last-known physical bindings.
};

} // namespace pm
