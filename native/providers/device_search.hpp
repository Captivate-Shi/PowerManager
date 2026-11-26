#pragma once

#include "battery.hpp"

#include <string>
#include <vector>

namespace pm {

enum class WindowsBatteryDetail : unsigned {
    none = 0, disconnected, missingProperty, invalidPercent, apiUnavailable, notFound, queryFailed,
    unknownConnection,
};
const char* windowsBatteryReason(const Sample& sample);

enum class WindowsConnectionEvidence { unknown, disconnected, connected };

// DEVPROP_BOOLEAN is one byte: TRUE is -1 (0xff), not arbitrary nonzero.
constexpr WindowsConnectionEvidence windowsConnectionEvidence(std::optional<int> property)
{
    if (property == 0) return WindowsConnectionEvidence::disconnected;
    if (property == 255) return WindowsConnectionEvidence::connected;
    return WindowsConnectionEvidence::unknown;
}

constexpr bool permitsBleBatteryFallback(WindowsBatteryDetail detail)
{
    return detail == WindowsBatteryDetail::missingProperty || detail == WindowsBatteryDetail::invalidPercent ||
           detail == WindowsBatteryDetail::unknownConnection || detail == WindowsBatteryDetail::apiUnavailable ||
           detail == WindowsBatteryDetail::notFound || detail == WindowsBatteryDetail::queryFailed;
}

constexpr bool needsIndependentBleConnection(WindowsBatteryDetail detail)
{
    return detail != WindowsBatteryDetail::missingProperty && detail != WindowsBatteryDetail::invalidPercent;
}

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
// entry merely because Windows exposes a battery property on it. A connected
// Bluetooth peripheral is still shown if none of its sources has a reading.
constexpr bool defaultPeripheralMonitoring(const FoundDevice& device, bool claimedByNative)
{
    if (!device.connected || claimedByNative) return false;
    // Windows may only expose this receiver name. Keep that identity; do not
    // resolve a keyboard model or send a vendor query from the label alone.
    if (device.name == L"Rapoo 2.4G Wireless Device") return true;
    return device.inputOrHeadset && (device.battery.has_value() || device.knownBluetooth);
}

std::optional<std::vector<FoundDevice>> findWindowsDevices();
Sample readWindowsDevice(const std::wstring& id);
// A fresh Windows connection-only query of a unique, paired LE association
// endpoint for this exact container. Presence or Classic links cannot qualify.
WindowsConnectionEvidence inspectWindowsBleConnection(const std::wstring& id);

} // namespace pm
