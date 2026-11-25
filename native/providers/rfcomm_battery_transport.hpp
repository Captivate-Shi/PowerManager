#pragma once

#include "oppo_headphone_battery.hpp"
#include "sony_headphone_battery.hpp"

#include <string_view>

namespace pm::rfcomm_battery {

enum class Status { success, unknown_endpoint, disconnected, ambiguous, service_unavailable, timeout, protocol_invalid, system_error };

enum class Model { sonyXm4, oppoClip2 };

struct Battery { unsigned percent; bool charging; };

struct Result {
    Status status;
    std::optional<Battery> battery{};
};

// containerId comes from the selected local Windows device container, never
// from a user-supplied address or an application/advertised display name.
Result read(std::wstring_view containerId, Model model);

} // namespace pm::rfcomm_battery
