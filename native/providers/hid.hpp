#pragma once

#include "battery.hpp"
#include "rapoo_battery.hpp"

#include <chrono>
#include <map>
#include <ostream>
#include <string>
#include <vector>

namespace pm {

enum class Transport { razer_receiver, dualsense_usb, dualsense_bluetooth, windows_battery, razer_shared_keyboard,
    vgn_usb, vgn_receiver, vgn_v3_usb, vgn_v3_receiver, logitech_receiver, rapoo_receiver, logitech_usb, sony_gamepad_usb, sony_gamepad_bluetooth, supported_mouse_receiver, eightbitdo_pro3_bluetooth, switch_pro_bluetooth, gamesir_super_nova_receiver, mchose_g3v2_receiver, aula_sc580_receiver, aula_f87v2d_receiver, dareu_em901x_inventory, razer_pro_receiver, mchose_a7v2pro_usb, ajazz_mk87pro_receiver, atk_v75x_usb, atk_v75x_receiver_candidate, rog_keyboard_receiver, mchose_g87_candidate, usb_wireless_headset, gamepad_flydigi, gamepad_nova2_lite_usb, joycon_left_bluetooth, joycon_right_bluetooth, eightbitdo_enhanced_bluetooth, eightbitdo_pro3_usb };
constexpr bool isSwitchHid(Transport t)
{
    return t == Transport::switch_pro_bluetooth || t == Transport::joycon_left_bluetooth ||
        t == Transport::joycon_right_bluetooth;
}
constexpr bool isEightBitDoHid(Transport t)
{
    return t == Transport::eightbitdo_pro3_bluetooth || t == Transport::eightbitdo_pro3_usb ||
        t == Transport::eightbitdo_enhanced_bluetooth;
}
constexpr bool isDualSense(Transport transport)
{
    return transport == Transport::dualsense_usb || transport == Transport::dualsense_bluetooth;
}

struct Collection {
    std::wstring path;
    std::wstring description;
    unsigned page;
    unsigned usage;
    unsigned inputLength;
    unsigned featureLength;
    unsigned outputLength{};
};

struct Device {
    std::wstring key;
    Transport transport;
    unsigned revision;
    std::optional<int> windowsBattery;
    std::vector<Collection> collections;
    std::wstring endpointKey{};
    unsigned vid{};
    unsigned pid{};
    unsigned slot{};
    std::uint32_t unit{};
    unsigned kind{255};
    std::wstring label{};
    std::wstring parentEndpoint{};
    unsigned logitechNamedModel{}; // Nonzero only for an exact live model/name match.
    unsigned logitechNamedFeatures{};
};

struct HidInterface {
    unsigned vid, pid, revision, page, usage, inputLength, outputLength, featureLength;
    int interfaceNumber;
    bool descriptorAvailable;
    std::optional<Transport> provider;
};

struct ReceiverAttempt {
    unsigned vid, pid, slot;
    std::int64_t unixSeconds;
    bool identityAvailable;
    Sample outcome;
};

const wchar_t* deviceName(Transport transport);
const wchar_t* transportName(Transport transport);
const wchar_t* providerName(Transport transport);
const wchar_t* statusName(Status status);
const wchar_t* powerName(Power power);
std::wstring formatReading(const Reading& reading);
std::wstring formatEstimatedReading(const Reading& reading);
std::wstring timestamp();

class HidMonitor {
public:
    std::vector<Device> enumerate(bool includePairedBluetooth = false, std::vector<HidInterface>* inventory = nullptr);
    Sample sample(const Device& device, std::wostream* diagnostics = nullptr);
    VoltageSample sampleVoltage(const Device& device, const Sample& pairedReading);
    void forgetOffline(const std::vector<Device>& devices);
    const std::vector<ReceiverAttempt>& receiverAttempts() const { return receiverAttempts_; }

private:
    struct SharedPairing {
        std::chrono::steady_clock::time_point nextCheck{};
        bool paired{};
    };
    struct Receiver {
        std::chrono::steady_clock::time_point due{};
        unsigned nextSlot{1};
        std::map<unsigned, Device> children;
    };
    RapooBatteryReader rapoo_;
    std::map<std::wstring, Receiver> receivers_;
    unsigned logitechRequestId_{};
    unsigned atkV75XSequence_{};
    std::vector<ReceiverAttempt> receiverAttempts_;
    std::map<std::wstring, std::wstring> razerCollections_;
    std::map<std::wstring, SharedPairing> sharedPairings_;
    std::map<std::wstring, std::wstring> usbIdentities_;
};

} // namespace pm
