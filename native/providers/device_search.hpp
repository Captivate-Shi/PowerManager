#pragma once

#include "battery.hpp"

#include <map>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace pm {

enum class WindowsBatteryDetail : unsigned {
    none = 0, disconnected, missingProperty, invalidPercent, apiUnavailable, notFound, queryFailed,
    unknownConnection, bluetoothNodeProperty,
};
const char* windowsBatteryReason(const Sample& sample);

constexpr bool permitsBluetoothNodeBatteryFallback(WindowsBatteryDetail detail)
{
    // These states already have positive connection evidence from Windows.
    return detail == WindowsBatteryDetail::missingProperty || detail == WindowsBatteryDetail::invalidPercent;
}

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

enum class WindowsDeviceArt { unknown, mouse, keyboard, controller, headset, earbuds, stylus };

constexpr bool windowsHeadphoneCategory(std::wstring_view category)
{
    return category.starts_with(L"Audio.Headphone") || category.starts_with(L"Audio.Headset") ||
           category == L"Communication.Headset" || category.starts_with(L"Communication.Headset.");
}

constexpr WindowsDeviceArt windowsCategoryArt(std::span<const std::wstring_view> categories, std::wstring_view foldedName)
{
    WindowsDeviceArt art{};
    bool steering = false;
    for (const auto category : categories) {
        WindowsDeviceArt candidate{};
        if (windowsHeadphoneCategory(category)) {
            // The category establishes the audio type. The recognized model
            // or an explicit in-ear descriptor distinguishes its form factor.
            const bool earbuds = foldedName == L"huawei freebuds 7i" || foldedName == L"freebuds 7i" ||
                foldedName.find(L"earbud") != foldedName.npos || foldedName.find(L"耳塞") != foldedName.npos ||
                foldedName.find(L"入耳") != foldedName.npos;
            candidate = earbuds ? WindowsDeviceArt::earbuds : WindowsDeviceArt::headset;
        } else if (category == L"Input.Mouse") {
            candidate = WindowsDeviceArt::mouse;
        } else if (category == L"Input.Keyboard") {
            candidate = WindowsDeviceArt::keyboard;
        } else if (category == L"Input.Digitizer.Pen") {
            candidate = WindowsDeviceArt::stylus;
        } else if (category == L"Input.Gaming" || category == L"Input.Gaming.Common" ||
                   category == L"Input.Gaming.Controller" || category == L"Input.Gaming.Gamepad" ||
                   category == L"Input.Gaming.Generic") {
            candidate = WindowsDeviceArt::controller;
        } else if (category == L"Input.Gaming.Steering") {
            steering = true;
        }
        if (candidate == WindowsDeviceArt::unknown) continue;
        // A shared receiver can report multiple functional categories.
        if (art != WindowsDeviceArt::unknown && art != candidate) return WindowsDeviceArt::unknown;
        art = candidate;
    }
    return steering && art == WindowsDeviceArt::controller ? WindowsDeviceArt::unknown : art;
}

constexpr const char* windowsDeviceArtName(WindowsDeviceArt art)
{
    switch (art) {
        case WindowsDeviceArt::mouse: return "mouse";
        case WindowsDeviceArt::keyboard: return "keyboard";
        case WindowsDeviceArt::controller: return "controller";
        case WindowsDeviceArt::headset: return "headset";
        case WindowsDeviceArt::earbuds: return "earbuds";
        case WindowsDeviceArt::stylus: return "stylus";
        case WindowsDeviceArt::unknown: return nullptr;
    }
    return nullptr;
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
    WindowsDeviceArt windowsArt{};
};

// A present Bluetooth Keyboard devnode can outlive the live radio link.
// It contributes identity/classification only; if BAS exists the worker
// independently verifies a unique connected, paired LE association endpoint.
constexpr void markKeyboardWithoutDisplayContainer(FoundDevice& keyboard, bool bluetooth)
{
    keyboard.inputOrHeadset = true;
    keyboard.knownBluetooth = bluetooth;
    keyboard.batteryDetail = bluetooth ? WindowsBatteryDetail::unknownConnection : WindowsBatteryDetail::missingProperty;
    if (bluetooth) keyboard.connected = false;
}

// Do not enroll a phone, laptop, dock, or other general Bluetooth/container
// entry merely because Windows exposes a battery property on it. A recognized,
// connected Bluetooth peripheral can be sampled before its first reading.
constexpr bool defaultPeripheralMonitoring(const FoundDevice& device, bool claimedByNative)
{
    if (!device.connected || claimedByNative) return false;
    // Windows may only expose this receiver name. Keep that identity; do not
    // resolve a keyboard model or send a vendor query from the label alone.
    if (device.name == L"Rapoo 2.4G Wireless Device") return true;
    return device.inputOrHeadset && (device.battery.has_value() || device.knownBluetooth);
}

constexpr bool eligibleForBleConnectionVerification(const FoundDevice& device, bool claimedByNative,
                                                    bool hasScopedBatteryService)
{
    return !claimedByNative && device.knownBluetooth && device.inputOrHeadset &&
           device.batteryDetail == WindowsBatteryDetail::unknownConnection && hasScopedBatteryService;
}

std::optional<std::vector<FoundDevice>> findWindowsDevices();

// Share one lazy devnode enumeration per discovery scan or sampling batch.
// A reader is short-lived so a later scan always checks the current properties.
class WindowsBatteryReader {
public:
    Sample read(const std::wstring& id);
private:
    friend std::optional<std::vector<FoundDevice>> findWindowsDevices();
    Sample withBluetoothNodeProperty(const std::wstring& id, Sample sample);
    std::optional<std::map<std::wstring, std::optional<int>>> bluetoothLevels_;
};

Sample readWindowsDevice(const std::wstring& id);
// A fresh Windows connection-only query of a unique, paired LE association
// endpoint for this exact container. Presence or Classic links cannot qualify.
WindowsConnectionEvidence inspectWindowsBleConnection(const std::wstring& id);

} // namespace pm
