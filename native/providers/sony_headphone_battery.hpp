#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <span>
#include <string_view>
#include <vector>

namespace pm::sony_headphone {

// Single-battery MDR V1 interoperability behavior, documented and tested by
// https://github.com/marconvcm/sony-device-center/blob/897022b041b7b312f6ccbd6956e5f0c6e6e76b57/libs/sony-protocol/src/ProtocolV1.cpp
// This intentionally implements no other Sony model, commands or protocol generation.
inline constexpr std::wstring_view model = L"WH-1000XM4";

struct Battery {
    unsigned percent;
    bool charging;
    friend bool operator==(const Battery&, const Battery&) = default;
};

inline constexpr std::uint8_t opener = 0x3e;
inline constexpr std::uint8_t closer = 0x3c;
inline constexpr std::uint8_t escape = 0x3d;
inline constexpr std::uint8_t mdr = 0x0c;
inline constexpr std::uint8_t ack = 0x01;

inline constexpr std::array<std::uint8_t, 11> request{
    opener, mdr, 0, 0, 0, 0, 2, 0x10, 0, 0x1e, closer,
};

inline constexpr auto responseAck(std::uint8_t sequence)
{
    const std::uint8_t next = static_cast<std::uint8_t>(1u - (sequence & 1u));
    return std::array<std::uint8_t, 9>{opener, ack, next, 0, 0, 0, 0,
        static_cast<std::uint8_t>(ack + next), closer};
}

struct BatteryReply {
    std::uint8_t sequence;
    Battery reading;
};

// Parse only a checksum-verified MDR single-battery reply. Ignore unrelated
// notifications and unknown charging values; a bogus 0xFF is not 0%.
inline std::optional<BatteryReply> decode(std::span<const std::uint8_t> encoded)
{
    std::array<std::uint8_t, 11> bytes{};
    std::size_t size = 0;
    for (std::size_t i = 0; i < encoded.size(); ++i) {
        auto byte = encoded[i];
        if (byte == escape) {
            if (++i == encoded.size() || encoded[i] < 0x2c || encoded[i] > 0x2e) return {};
            byte = encoded[i] + 0x10;
        }
        if (size == bytes.size()) return {};
        bytes[size++] = byte;
    }
    if (size != bytes.size() || bytes[0] != mdr || bytes[1] > 1 ||
        bytes[2] || bytes[3] || bytes[4] || bytes[5] != 4 ||
        bytes[6] != 0x11 || bytes[7] != 0 || bytes[8] > 100 || bytes[9] > 1) return {};
    std::uint8_t sum{};
    for (std::size_t i = 0; i != size - 1; ++i) sum += bytes[i];
    if (sum != bytes.back()) return {};
    return BatteryReply{bytes[1], Battery{bytes[8], bytes[9] == 1}};
}

class ResponseStream {
    std::vector<std::uint8_t> frame_;
    bool receiving_{};

public:
    std::optional<BatteryReply> feed(std::span<const std::uint8_t> chunk)
    {
        for (const auto byte : chunk) {
            if (byte == opener) {
                frame_.clear();
                receiving_ = true;
            } else if (receiving_ && byte == closer) {
                receiving_ = false;
                if (auto reply = decode(frame_)) return reply;
            } else if (receiving_) {
                // Battery frame after escaping cannot exceed 22 bytes.
                if (frame_.size() == 22) receiving_ = false;
                else frame_.push_back(byte);
            }
        }
        return {};
    }
};

// XM5 declares the Sony USB VID/PID in SDP PnP ID, not the Sony SIG company ID.
constexpr bool xm5SdpIdentity(unsigned vendorSource, unsigned vid, unsigned pid)
{
    return vendorSource == 2 && vid == 0x054c && pid == 0x0df0;
}

// The paired classic Bluetooth endpoint pushes its single battery (03/03)
// on connection. No subscription, handshake or other packets are sent.
class Xm5FastPairStream {
    std::vector<std::uint8_t> bytes_;
    bool invalid_{};
public:
    bool invalid() const { return invalid_; }

    std::optional<Battery> feed(std::span<const std::uint8_t> chunk)
    {
        if (invalid_ || chunk.size() > 512 - bytes_.size()) { invalid_ = true; return {}; }
        bytes_.insert(bytes_.end(), chunk.begin(), chunk.end());
        while (bytes_.size() >= 4) {
            const auto length = (static_cast<unsigned>(bytes_[2]) << 8) | bytes_[3];
            if (length > 128) { invalid_ = true; return {}; }
            if (bytes_.size() < 4 + length) return {};
            if (bytes_[0] == 3 && bytes_[1] == 3) {
                if (length != 1) { invalid_ = true; return {}; }
                const auto encoded = bytes_[4];
                const auto level = encoded & 0x7fu;
                if (level <= 100) return Battery{level, (encoded & 0x80u) != 0};
                // Values outside the 0..100 range include the unknown sentinel.
            }
            bytes_.erase(bytes_.begin(), bytes_.begin() + 4 + length);
        }
        return {};
    }
};

} // namespace pm::sony_headphone
