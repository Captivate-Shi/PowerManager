#pragma once

#include <chrono>

namespace pm {

struct LogitechReceiverScan {
    using Clock = std::chrono::steady_clock;

    static constexpr unsigned slotCount = 6;
    static constexpr auto queryBudget = std::chrono::milliseconds(330);
    static constexpr auto minIdentityBudget = 2 * queryBudget;
    static constexpr auto slotBudget = std::chrono::milliseconds(750);
    static constexpr auto sweepBudget = std::chrono::milliseconds(2500);
    static constexpr auto interval = std::chrono::seconds(4);

    bool canProbe(Clock::time_point now, Clock::time_point relayDeadline, bool receiverBusy) const
    {
        return !receiverBusy && now >= due_ && relayDeadline - now >= minIdentityBudget;
    }

    unsigned nextSlot() const { return nextSlot_; }
    bool initialSweepComplete() const { return !firstPass_; }

    // Do not advance a skipped slot. After the first complete pass, return
    // to one slot per tick to avoid continuously probing sleeping devices.
    void probed(Clock::time_point now)
    {
        if (nextSlot_ == slotCount) {
            nextSlot_ = 1;
            firstPass_ = false;
        } else {
            ++nextSlot_;
        }
        if (!firstPass_) due_ = now + interval;
    }

private:
    Clock::time_point due_{};
    unsigned nextSlot_{1};
    bool firstPass_{true};
};

} // namespace pm
