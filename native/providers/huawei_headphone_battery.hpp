#pragma once

#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <span>
#include <string_view>
#include <vector>

namespace pm::huawei_headphone {

// BatteryInfo's FreeClip 2 Windows hardware capture; no writes to settings.
constexpr bool isFreeClip2(std::wstring_view name)
{
    return name == L"HUAWEI FreeClip 2" || name == L"Huawei FreeClip 2" || name == L"FreeClip 2";
}
constexpr bool matchesIds(unsigned source, unsigned vid, unsigned pid)
{
    return source == 1 && vid == 0x027d && pid == 0x4113;
}

constexpr std::uint16_t crc(std::span<const std::uint8_t> data)
{
    std::uint16_t value = 0;
    for (const auto byte : data) {
        value ^= static_cast<std::uint16_t>(byte << 8);
        for (unsigned bit = 0; bit < 8; ++bit) {
            const bool top = (value & 0x8000) != 0;
            value = static_cast<std::uint16_t>(value << 1);
            if (top) value ^= 0x1021;
        }
    }
    return value;
}

constexpr std::array<std::uint8_t,10> batteryQuery{0x5a,0,5,0,1,8,1,0,0xf5,0x3d};
static_assert(crc(std::span(batteryQuery).first(8)) == 0xf53d);

inline std::optional<unsigned> parseLevels(std::span<const std::uint8_t> tlvs)
{
    std::optional<unsigned> aggregate, buds;
    bool haveParts = false, haveAggregate = false, haveCode = false;
    while (!tlvs.empty()) {
        if (tlvs.size() < 2) return {};
        const auto type = tlvs.front();
        tlvs = tlvs.subspan(1);
        std::size_t len = 0;
        bool end = false;
        for (unsigned i = 0; i < 2 && !tlvs.empty(); ++i) {
            const auto b = tlvs.front();
            tlvs = tlvs.subspan(1);
            len = (len << 7) | (b & 0x7f);
            if (!(b & 0x80)) { end = true; break; }
        }
        if (!end || len > tlvs.size()) return {};
        const auto v = tlvs.first(len);
        tlvs = tlvs.subspan(len);
        if (type == 1) {
            if (haveAggregate || len != 1) return {};
            haveAggregate = true;
            if (v[0] <= 100) aggregate = v[0];
        } else if (type == 2) {
            if (haveParts || len != 3) return {};
            haveParts = true;
            for (auto level : v.first(2)) {
                if (level <= 100 && (!buds || level < *buds)) buds = level;
            }
        } else if (type == 0x7f) {
            if (haveCode || len != 4 || v[0] != 0 || v[1] != 1 || v[2] != 0x86 || v[3] != 0xa0) return {};
            haveCode = true;
        }
    }
    // Never use the case as a reading for the paired listening device.
    return haveParts ? buds : aggregate;
}

class ReplyStream {
public:
    std::optional<unsigned> feed(std::span<const std::uint8_t> data)
    {
        if (data.size() > 1024 - bytes_.size()) { bytes_.clear(); return {}; }
        bytes_.insert(bytes_.end(), data.begin(), data.end());
        while (!bytes_.empty()) {
            bytes_.erase(bytes_.begin(), std::find(bytes_.begin(), bytes_.end(), 0x5a));
            if (bytes_.size() < 3) return {};
            const std::size_t payload = (static_cast<std::size_t>(bytes_[1]) << 8) | bytes_[2];
            if (payload < 3 || payload > 512) { bytes_.erase(bytes_.begin()); continue; }
            const auto size = payload + 5;
            if (bytes_.size() < size) return {};
            const auto view = std::span(bytes_);
            const auto expected = (static_cast<unsigned>(view[size-2]) << 8) | view[size-1];
            if (crc(view.first(size - 2)) != expected) { bytes_.erase(bytes_.begin()); continue; }
            auto level = view[3] == 0 && view[4] == 1 && view[5] == 8
                ? parseLevels(view.subspan(6, payload - 3)) : std::nullopt;
            bytes_.erase(bytes_.begin(), bytes_.begin() + size);
            if (level) return level;
        }
        return {};
    }

private:
    std::vector<std::uint8_t> bytes_;
};

} // namespace pm::huawei_headphone
