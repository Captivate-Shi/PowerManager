#include "logitech_receiver_scan.hpp"
#include <cassert>

using namespace std::chrono_literals;
using Scan = pm::LogitechReceiverScan;
using Time = Scan::Clock::time_point;

int main()
{
    const Time start{};
    const auto deadline = start + Scan::sweepBudget;
    Scan cold;
    for (unsigned slot = 1; slot <= Scan::slotCount; ++slot) {
        // Worst-case no-response first request, followed by a possible two-request
        // identity on the last slot, fits one cold receiver pass.
        const auto now = start + (slot - 1) * Scan::queryBudget;
        assert(!cold.canProbe(now, deadline, true));
        assert(cold.canProbe(now, deadline, false));
        assert(cold.nextSlot() == slot);
        cold.probed(now);
    }
    assert(cold.nextSlot() == 1);
    assert(!cold.canProbe(start + 2s, deadline, false));
    assert(!cold.canProbe(start + 5s, start + 8s, false));
    assert(cold.canProbe(start + 6s, start + 8s, false));
    cold.probed(start + 6s);
    assert(cold.nextSlot() == 2);
    assert(!cold.canProbe(start + 7s, start + 10s, false));

    Scan resume;
    resume.probed(start);
    assert(!resume.canProbe(deadline - Scan::minIdentityBudget + 1ms, deadline, false));
    assert(resume.nextSlot() == 2);
    assert(resume.canProbe(start + 4s, start + 4s + Scan::sweepBudget, false));
    assert(resume.nextSlot() == 2);

    Scan restart;
    assert(restart.nextSlot() == 1);
    assert(restart.canProbe(start, deadline, false));
}
