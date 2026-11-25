#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <string_view>

namespace cn_mouse {

enum class Status {
    Unrelated, Invalid, Online, Offline, Retry, ChargingWithoutLevel, Battery
};

struct Result {
    Status status;
    int percent = -1;
    bool charging = false;
    int retryAfterMs = 0;
    bool full = false;
};

inline constexpr unsigned kMchoseDeadlineMs = 550;
inline constexpr unsigned kMchoseMaxUnrelated = 4;
inline constexpr unsigned kAulaDeadlineMs = 1000;
inline constexpr unsigned kAulaMaxAttempts = 3;

// All frames include the implicit zero report ID from Windows ReadFile/WriteFile.
// The collector must also prove a unique collection on the physical USB parent
// and exclude numbered reports before opening its read/write handle.
inline constexpr std::array<std::uint8_t, 65> kMchoseOnlineQuery{0, 0x55, 0xED};
inline constexpr std::array<std::uint8_t, 65> kMchoseBatteryQuery{
    0, 0x55, 0x30, 0xA5, 0x0B, 0x2E, 1, 1, 1
};
inline constexpr std::array<std::uint8_t, 33> kAulaBatteryQuery{0, 0x30, 0, 1};

constexpr bool MatchesMchoseG3(unsigned vid, unsigned pid, unsigned page, unsigned usage,
                               unsigned inputLen, unsigned outputLen, std::wstring_view product) {
    return vid == 0x3837 && pid == 0x4245 && page == 0xFF01 && usage == 0x0010 &&
           inputLen == kMchoseOnlineQuery.size() && outputLen == kMchoseOnlineQuery.size() &&
           product == L"MCHOSE G3 V2";
}

constexpr bool MatchesAulaSc580(unsigned vid, unsigned pid, unsigned page, unsigned usage,
                                unsigned inputLen, unsigned outputLen) {
    return vid == 0x089D && pid == 0x062F && page == 0xFF02 && usage == 0 &&
           inputLen == kAulaBatteryQuery.size() && outputLen == kAulaBatteryQuery.size();
}

// Evidence: official M HUB gmouse battery chunk, described in the MyFinder
// protocol notes at 7b4131b29709f79c833d5fb39db52656265ce9d1. The collector
// must flush queued input and fetch this status in the same bounded exchange.
constexpr Result ParseMchoseOnline(const std::uint8_t* frame, std::size_t length) {
    if (!frame || length != kMchoseOnlineQuery.size() || frame[0] != 0) return {Status::Invalid};
    if (frame[1] != 0xAA || frame[2] != 0xED) return {Status::Unrelated};
    if (frame[9] == 0 || frame[9] == 2) return {Status::Online};
    if (frame[9] == 1) return {Status::Offline};
    return {Status::Invalid};
}

constexpr Result ParseMchoseBattery(const std::uint8_t* frame, std::size_t length, bool freshOnline) {
    if (!frame || length != kMchoseBatteryQuery.size() || frame[0] != 0) return {Status::Invalid};
    if (frame[1] != 0xAA || frame[2] != 0x30) return {Status::Unrelated};
    if (!freshOnline || frame[9] == 0 || frame[9] > 100 || frame[10] > 1) return {Status::Invalid};
    const int band = ((frame[9] + 5) / 10) * 10;
    return {Status::Battery, band == 0 ? 10 : band, frame[10] == 1};
}

// Evidence: omarchy-aula-SC580 PROTOCOL.md, 2e25aa5b7a8d099e6262ca6dc054cc0774d92d31;
// receiver sleep and charging placeholder independently explained by WDBM's aula.cpp.
// The official GetDeviceInfo reader uses the fixed 27-byte reply area rather than
// a declared size. A zero packet/length header is allowed as a whole header for
// these legacy replies, but identity and checksum are always required for a level.
constexpr Result ParseAulaBattery(const std::uint8_t* frame, std::size_t length) {
    if (!frame || length != kAulaBatteryQuery.size() || frame[0] != 0) return {Status::Invalid};
    if (frame[1] != 0x30) return {Status::Unrelated}; // includes D1/D2 push or a previous command
    const unsigned declared = frame[4];
    if (!((frame[3] == 0 && declared == 0) || (frame[3] == 1 && declared <= 27)))
        return {Status::Invalid};
    unsigned checksum = 0;
    for (std::size_t i = 5; i < 32; ++i) checksum += frame[i];
    if ((checksum & 0xff) != frame[32]) return {Status::Invalid};
    switch (frame[2]) {
        case 0: break;
        case 1: return {Status::Retry, -1, false, 300};
        case 2: return {Status::Offline};
        case 3: return {Status::Retry, -1, false, 100};
        default: return {Status::Invalid};
    }
    if ((declared != 0 && declared < 11) ||
        frame[5] != 0x4D || frame[6] != 0x31 || frame[7] != 0x33 || frame[8] != 0x37 ||
        frame[15] > 1) return {Status::Invalid};
    if (frame[15] == 0) return {Status::Offline};
    if (frame[13] > 2 || frame[14] > 100) return {Status::Invalid};
    // A charging-state packet can contain an artificial 100 instead of a level.
    if (frame[13] == 1) return {Status::ChargingWithoutLevel, -1, true};
    if (frame[13] == 2 && frame[14] != 100) return {Status::Invalid};
    return {Status::Battery, frame[14], false, 0, frame[13] == 2};
}

} // namespace cn_mouse
