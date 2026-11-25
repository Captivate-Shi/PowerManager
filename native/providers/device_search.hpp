#pragma once

#include "battery.hpp"

#include <string>
#include <vector>

namespace pm {

enum class WindowsBatteryDetail : unsigned {
    none = 0, disconnected, missingProperty, invalidPercent, apiUnavailable, notFound, queryFailed,
};
const char* windowsBatteryReason(const Sample& sample);

struct FoundDevice {
    std::wstring id;
    std::wstring name;
    std::wstring connection;
    bool connected;
    bool automaticallyMonitored;
    std::optional<Reading> battery;
    bool offerBluetoothReading{};
    WindowsBatteryDetail batteryDetail{};
    bool inputOrHeadset{};
    bool knownBluetooth{};
};

// Do not enroll a phone, laptop, dock, or other general Bluetooth/container
// entry merely because Windows exposes a battery property on it.
constexpr bool defaultPeripheralMonitoring(const FoundDevice& device, bool uniqueBas, bool claimedByNative)
{
    return device.connected && device.inputOrHeadset && !claimedByNative &&
        (device.battery.has_value() || (device.knownBluetooth && uniqueBas));
}

std::optional<std::vector<FoundDevice>> findWindowsDevices();
Sample readWindowsDevice(const std::wstring& id);

} // namespace pm
