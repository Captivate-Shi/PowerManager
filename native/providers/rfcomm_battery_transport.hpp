#pragma once

#include "huawei_headphone_battery.hpp"
#include "oppo_headphone_battery.hpp"
#include "sony_headphone_battery.hpp"

#include <string_view>

namespace pm::rfcomm_battery {

enum class Status { success, unknown_endpoint, disconnected, ambiguous, service_unavailable, busy, timeout, protocol_invalid, system_error, identity_unverified, no_battery_message };

enum class Model { sonyXm4, oppoClip2, oppoX4, huaweiFreeClip2, oppoX3, oppoAir3Pro, oppoBuds3Pro, sonyXm5FastPair, sonyXm3, sonyWhFastPair };

constexpr bool isSonyFastPair(Model model)
{
    return model == Model::sonyXm5FastPair || model == Model::sonyWhFastPair;
}

// Name is only a cheap candidate filter. The passive family path requires
// Sony's SDP vendor ID on the exact paired Windows physical container.
constexpr bool sonyWhCandidate(std::wstring_view name)
{
    if (!name.starts_with(L"WH-") || name.size() < 6 || name.size() > 24) return false;
    bool digit = false;
    for (const auto ch : name.substr(3)) {
        if (ch >= L'0' && ch <= L'9') digit = true;
        else if (ch < L'A' || ch > L'Z') return false;
    }
    return digit;
}

// Restrict command-based reads to exact profiles. Other WH models can try
// the passive, standardized transport, never the proprietary MDR command.
constexpr std::optional<Model> matchModel(std::wstring_view name)
{
    using namespace oppo_headphone;
    if (name == sony_headphone::xm3Name) return Model::sonyXm3;
    if (name == sony_headphone::xm4Name) return Model::sonyXm4;
    if (name == L"WH-1000XM5") return Model::sonyXm5FastPair;
    if (isClip2(name)) return Model::oppoClip2;
    if (isX4(name)) return Model::oppoX4;
    if (huawei_headphone::isFreeClip2(name)) return Model::huaweiFreeClip2;
    if (isX3(name)) return Model::oppoX3;
    if (isAir3Pro(name)) return Model::oppoAir3Pro;
    if (isBuds3Pro(name)) return Model::oppoBuds3Pro;
    if (sonyWhCandidate(name)) return Model::sonyWhFastPair;
    return {};
}

constexpr unsigned sonyMdrV1ProductId(Model model)
{
    switch (model) {
    case Model::sonyXm3: return sony_headphone::xm3ProductId;
    case Model::sonyXm4: return sony_headphone::xm4ProductId;
    default: return 0;
    }
}

constexpr bool sonyFastPairIdentity(Model model, unsigned source, unsigned vid, unsigned pid)
{
    if (model == Model::sonyXm5FastPair) return sony_headphone::xm5SdpIdentity(source, vid, pid);
    return model == Model::sonyWhFastPair && source == 2 && vid == 0x054c && pid > 0 && pid < 0xffff;
}

constexpr unsigned oppoProductId(Model model)
{
    using namespace oppo_headphone;
    switch (model) {
    case Model::oppoClip2: return clip2ProductId;
    case Model::oppoX4: return x4ProductId;
    case Model::oppoX3: return x3ProductId;
    case Model::oppoAir3Pro: return air3ProProductId;
    case Model::oppoBuds3Pro: return buds3ProProductId;
    default: return 0;
    }
}

struct Battery { unsigned percent; std::optional<bool> charging; };

struct Result {
    Status status;
    std::optional<Battery> battery{};
};

// containerId comes from the selected local Windows device container, never
// from a user-supplied address or an application/advertised display name.
Result read(std::wstring_view containerId, Model model);

} // namespace pm::rfcomm_battery
