#pragma once

#include "huawei_headphone_battery.hpp"
#include "oppo_headphone_battery.hpp"
#include "sony_headphone_battery.hpp"

#include <string_view>

namespace pm::rfcomm_battery {

enum class Status { success, unknown_endpoint, disconnected, ambiguous, service_unavailable, busy, timeout, protocol_invalid, system_error };

enum class Model { sonyXm4, oppoClip2, oppoX4, huaweiFreeClip2, oppoX3, oppoAir3Pro, oppoBuds3Pro, sonyXm5FastPair };

// One exact-name classifier for discovery and the second OS identity check.
constexpr std::optional<Model> matchModel(std::wstring_view name)
{
    using namespace oppo_headphone;
    if (name == sony_headphone::model) return Model::sonyXm4;
    if (name == L"WH-1000XM5") return Model::sonyXm5FastPair;
    if (isClip2(name)) return Model::oppoClip2;
    if (isX4(name)) return Model::oppoX4;
    if (huawei_headphone::isFreeClip2(name)) return Model::huaweiFreeClip2;
    if (isX3(name)) return Model::oppoX3;
    if (isAir3Pro(name)) return Model::oppoAir3Pro;
    if (isBuds3Pro(name)) return Model::oppoBuds3Pro;
    return {};
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
