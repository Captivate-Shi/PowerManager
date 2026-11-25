#pragma once

#include "sony_headphone_battery.hpp"

#include <string_view>

namespace pm::rfcomm_battery {

enum class Status { success, unknown_endpoint, disconnected, ambiguous, service_unavailable, timeout, protocol_invalid, system_error };

struct Result {
    Status status;
    std::optional<sony_headphone::Battery> battery{};
};

// containerId comes from the selected local Windows device container, never
// from a user-supplied address or an application/advertised display name.
Result readSonyXm4(std::wstring_view containerId);

} // namespace pm::rfcomm_battery
