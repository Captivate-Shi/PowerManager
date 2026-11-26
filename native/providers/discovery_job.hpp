#pragma once

#include <chrono>
#include <cstdint>
#include <stdexcept>
#include <future>
#include <optional>
#include <utility>

namespace pm {

// Only the collector thread inspects a job. Workers own their captured
// state; a slow driver call cannot require the collector's IPC thread.
template<class Result>
class DiscoveryJob {
public:
    using Clock = std::chrono::steady_clock;
    using Time = Clock::time_point;

    struct Completion {
        std::int64_t generation;
        Result value;
    };

    bool outstanding() const { return future_.valid(); }

    template<class Work>
    void start(Time now, std::int64_t generation, Work&& work)
    {
        if (outstanding()) throw std::logic_error("Discovery job already active");
        future_ = std::async(std::launch::async, std::forward<Work>(work));
        started_ = now;
        generation_ = generation;
    }

    bool expired(Time now, Clock::duration limit) const
    {
        return outstanding() && now - started_ >= limit &&
            future_.wait_for(Clock::duration::zero()) != std::future_status::ready;
    }

    std::optional<Completion> take()
    {
        if (!outstanding() || future_.wait_for(Clock::duration::zero()) != std::future_status::ready)
            return std::nullopt;
        return Completion{generation_, future_.get()};
    }

private:
    Time started_{};
    std::int64_t generation_{};
    std::future<Result> future_;
};

} // namespace pm
