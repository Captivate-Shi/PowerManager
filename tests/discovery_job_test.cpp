#include "discovery_job.hpp"
#include "hid_batches.hpp"

#include <cassert>
#include <chrono>
#include <future>
#include <set>
#include <string>
#include <thread>

using namespace pm;
using namespace std::chrono_literals;

int main()
{
    DiscoveryJob<int> stuck;
    DiscoveryJob<int> healthy;
    std::promise<void> release;
    auto wait = release.get_future().share();
    const auto now = DiscoveryJob<int>::Clock::now();
    stuck.start(now, 3, [wait] { wait.wait(); return 12; });

    // This is the same nonblocking test used before harvesting device readings.
    assert(stuck.outstanding() && !stuck.take());
    assert(!stuck.expired(now + 299s, 5min));
    assert(stuck.expired(now + 5min, 5min));
    const std::set<std::wstring> held{L"receiver-1", L"receiver-1/input"};
    assert(!hidResourcesAvailable({L"receiver-1", L"receiver-1/extra"}, held));
    assert(!hidResourcesAvailable({L"other-label", L"receiver-1/input"}, held));
    assert(hidResourcesAvailable({L"receiver-2", L"receiver-2/input"}, held));

    healthy.start(now, 4, [] { return 80; });
    const auto until = DiscoveryJob<int>::Clock::now() + 2s;
    auto result = healthy.take();
    while (!result && DiscoveryJob<int>::Clock::now() < until) {
        std::this_thread::yield();
        result = healthy.take();
    }
    assert(result && result->generation == 4 && result->value == 80);
    assert(!stuck.take());

    release.set_value();
    const auto finalDeadline = DiscoveryJob<int>::Clock::now() + 2s;
    result = stuck.take();
    while (!result && DiscoveryJob<int>::Clock::now() < finalDeadline) {
        std::this_thread::yield();
        result = stuck.take();
    }
    // Old results keep their actual origin; a newer refresh can discard this.
    assert(result && result->generation == 3 && result->generation != 4);
}
