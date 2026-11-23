#pragma once

#include "battery.hpp"

#include <string>
#include <vector>

namespace pm {

struct FoundDevice {
    std::wstring id;
    std::wstring name;
    std::wstring connection;
    bool connected;
    bool automaticallyMonitored;
    std::optional<Reading> battery;
    bool offerBluetoothReading{};
};

std::optional<std::vector<FoundDevice>> findWindowsDevices();
Sample readWindowsDevice(const std::wstring& id);

} // namespace pm
