#pragma once
#include "battery.hpp"
#include <array>
#include <cstdint>
#include <optional>
#include <span>

namespace pm::verified_mouse {
enum class Kind { keychronM5, haste2, vxeReceiver, vxeCable };
constexpr std::optional<Kind> kind(unsigned vid, unsigned pid) {
    if (vid == 0x3434 && pid == 0xd048) return Kind::keychronM5;
    if (vid == 0x03f0 && pid == 0x0f98) return Kind::haste2;
    if (vid == 0x3554 && pid == 0xf58a) return Kind::vxeReceiver;
    if (vid == 0x3554 && pid == 0xf58c) return Kind::vxeCable;
    return {};
}
constexpr bool wireless(Kind k) { return k == Kind::haste2 || k == Kind::vxeReceiver; }
constexpr const wchar_t* name(Kind k) {
    if (k == Kind::keychronM5) return L"Keychron M5";
    if (k == Kind::haste2) return L"HyperX Pulsefire Haste 2 Wireless";
    return L"VXE R1 Pro Max";
}
constexpr bool collection(Kind k,unsigned mi,unsigned page,unsigned usage,unsigned in,unsigned out) {
    if (k == Kind::keychronM5) return mi == 4 && page >= 0xff00 && page <= 0xffff && in == 64 && out == 64;
    if (k == Kind::haste2) return mi == 2 && page == 0xff00 && usage == 1 && in == 64 && out == 64;
    return mi == 1 && page == 0xff02 && usage == 2 && in >= 17 && in <= 32 && out >= 17 && out <= 32;
}

// Report framing facts verified against csutcliff/keychron-battery-dkms.
constexpr std::array<std::uint8_t,64> keychronQuery() { return {0xb3, 6}; }
constexpr std::optional<Sample> keychronReply(std::span<const std::uint8_t> r) {
    if (r.size()!=64 || r[0]!=0xb4 || r[1]!=6) return {};
    const int percent=r[20]&0x7f;
    if (percent<=0 || percent>100) return {};
    return Sample{Status::current, Reading{percent,percent,r[20]&0x80 ? Power::charging : Power::discharging,percent},0xb4,0,6};
}

// Framing facts documented by the Windows hardware captures for 03F0:0F98.
constexpr std::array<std::uint8_t,64> hasteQuery(bool link) {
    if (link) return {0x52,1};
    return {0x50,2};
}
constexpr std::optional<bool> hasteLink(std::span<const std::uint8_t> r) {
    if (r.size()!=64 || r[0]!=0x53 || r[1]!=1 || r[2]>1) return {};
    return r[2]==1;
}
constexpr std::optional<Sample> hasteReply(std::span<const std::uint8_t> r) {
    if (r.size()!=64 || r[0]!=0x51 || r[1]!=2 || r[2]==0 || r[2]>100 || r[3]>2) return {};
    const int percent=r[2];
    const auto power=r[3]==1 ? Power::charging : (r[3]==2 && percent==100) ? Power::full : Power::unknown;
    return Sample{Status::current,Reading{percent,percent,power,percent},0x51,0,2};
}

// COMPX wire facts: fixed-size, signed by an additive checksum. No settings
// commands are exposed; selection, identity and battery metadata are read-only.
enum class CompxCommand : unsigned { link=0x03, battery=0x04, identity=0x10 };
constexpr std::uint8_t compxChecksum(std::span<const std::uint8_t> r) {
    unsigned sum=0;
    for(auto b:r) sum+=b;
    return static_cast<std::uint8_t>(0x55u-sum);
}
constexpr auto compxQuery(CompxCommand command) {
    std::array<std::uint8_t,17> r{8,static_cast<std::uint8_t>(command)};
    r[16]=compxChecksum(std::span(r).first(16));
    return r;
}
constexpr bool compxHeader(std::span<const std::uint8_t> r, CompxCommand command,unsigned minimum) {
    if (r.size()<17 || r.size()>32) return false;
    for (const auto pad : r.subspan(17)) if (pad!=0) return false;
    return r[0]==8 && r[1]==static_cast<unsigned>(command) &&
        r[2]==0 && r[3]==0 && r[4]==0 && r[5]>=minimum && r[5]<=10 &&
        r[16]==compxChecksum(r.first(16));
}
constexpr bool compxIdentity(std::span<const std::uint8_t> r) {
    return compxHeader(r,CompxCommand::identity,2) && r[6]==2 && r[7]==27;
}
constexpr std::optional<unsigned> compxLink(std::span<const std::uint8_t> r) {
    if (!compxHeader(r,CompxCommand::link,4) || r[6]>1) return {};
    if (r[6]==0) return 0;
    const auto id = static_cast<unsigned>(r[7]) | (static_cast<unsigned>(r[8]) << 8) | (static_cast<unsigned>(r[9]) << 16);
    if (!id || id==0xffffff) return {};
    return id;
}
constexpr std::optional<Sample> compxBattery(std::span<const std::uint8_t> r) {
    if (!compxHeader(r,CompxCommand::battery,4) || r[6]==0 || r[6]>100 || r[7]>1) return {};
    const int percent=r[6];
    // The flag says on cable; it is not a guaranteed charging-current state.
    return Sample{Status::current,Reading{percent,percent,r[7] ? Power::unknown : Power::discharging,percent},8,0,4};
}
} // namespace pm::verified_mouse
