#pragma once

#include <algorithm>
#include <array>
#include <cstdint>
#include <optional>
#include <span>
#include <string_view>
#include <vector>

// Wire references: EncoDeck PROTOCOL_FINDINGS and QuickBuds PROTOCOL.
// Only the two short, non-mutating GETs are supported.
namespace pm::oppo_headphone {

constexpr bool isClip2(std::wstring_view name)
{
    return name == L"OPPO Enco Clip2" || name == L"OPPO Enco Clip 2";
}

constexpr bool isX4(std::wstring_view name)
{
    return name == L"OPPO Enco X4";
}

constexpr unsigned clip2ProductId = 0x06e010;
constexpr unsigned x4ProductId = 0x06ec10;
constexpr std::array<std::uint8_t, 9> productQuery{0xaa, 7, 0, 0, 3, 1, 1, 0, 0};
constexpr std::array<std::uint8_t, 9> batteryQuery{0xaa, 7, 0, 0, 6, 1, 0xf0, 0, 0};

struct Battery { unsigned percent; bool charging; };

class ReplyStream {
public:
    explicit ReplyStream(const std::array<std::uint8_t, 9>& request)
        : command_(request[4]), sequence_(request[6]) {}

    std::optional<std::vector<std::uint8_t>> feed(std::span<const std::uint8_t> data)
    {
        if (invalid_ || data.size() > 1024 - bytes_.size()) { invalid_ = true; return {}; }
        bytes_.insert(bytes_.end(), data.begin(), data.end());
        while (bytes_.size() >= 2) {
            if (bytes_[0] != 0xaa) { invalid_ = true; return {}; }
            const bool extended = (bytes_[1] & 0x80) != 0;
            const std::size_t start = extended ? 3 : 2;
            if (bytes_.size() < start) return {};
            const unsigned length = (bytes_[1] & 0x7f) + (extended ? (static_cast<unsigned>(bytes_[2]) << 7) : 0);
            if (length < 2 || start + length > 660) { invalid_ = true; return {}; }
            const auto size = start + length;
            if (bytes_.size() < size) return {};
            const auto frame = std::span(bytes_).subspan(start, length);
            if (length >= 7 && frame[0] == 0 && frame[1] == 0 && frame[2] == command_ &&
                frame[3] == 0x81 && frame[4] == sequence_) {
                const auto payloadSize = static_cast<unsigned>(frame[5]) + (static_cast<unsigned>(frame[6]) << 8);
                if (payloadSize != length - 7) { invalid_ = true; return {}; }
                return std::vector<std::uint8_t>(frame.begin() + 7, frame.end());
            }
            // Unrelated events/fragments have their own link frame length.
            bytes_.erase(bytes_.begin(), bytes_.begin() + size);
        }
        return {};
    }
    bool invalid() const { return invalid_; }

private:
    unsigned command_, sequence_;
    bool invalid_{};
    std::vector<std::uint8_t> bytes_;
};

inline bool matchesProduct(std::span<const std::uint8_t> payload, unsigned productId = clip2ProductId)
{
    return payload.size() >= 4 && payload[0] == 0 &&
        (static_cast<unsigned>(payload[1]) | (static_cast<unsigned>(payload[2]) << 8) |
            (static_cast<unsigned>(payload[3]) << 16)) == productId;
}

inline std::optional<Battery> parseBattery(std::span<const std::uint8_t> payload, unsigned productId = clip2ProductId)
{
    // The wire layout may include or omit a zero result byte. Length and
    // count disambiguate; no other status, duplicate ID or invalid level.
    if (payload.empty()) return {};
    if (payload[0] == 0 || (productId == x4ProductId && payload[0] == 1 &&
        payload.size() >= 4 && payload.size() == 2u + 2u * payload[1]))
        payload = payload.subspan(1);
    if (payload.empty() || !payload[0] || payload[0] > 3 ||
        payload.size() != 1u + 2u * payload[0]) return {};
    unsigned seen = 0;
    std::optional<Battery> result;
    for (std::size_t i = 1; i < payload.size(); i += 2) {
        const auto part = payload[i];
        if (part < 1 || part > 3 || (seen & (1u << part))) return {};
        seen |= 1u << part;
        const unsigned level = payload[i + 1] & 0x7fu;
        const bool charging = (payload[i + 1] & 0x80u) != 0;
        if (level > 100) return {};
        // A sleeping/closed component may report 0. The status row reports
        // the lowest available earbud (not case), without inventing a value.
        if (part == 3 || !level) continue;
        if (!result || level < result->percent) result = Battery{level, charging};
        else if (level == result->percent) result->charging = result->charging && charging;
    }
    return result;
}

} // namespace pm::oppo_headphone
