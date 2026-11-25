#pragma once

#include "battery.hpp"

#include <chrono>
#include <map>
#include <ostream>
#include <string>
#include <vector>

namespace pm {

enum class Transport { razer_receiver, dualsense_usb, dualsense_bluetooth, windows_battery, razer_shared_keyboard,
    vgn_usb, vgn_receiver, vgn_v3_usb, vgn_v3_receiver, logitech_receiver };
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
    Sample requestBluetoothReadingOnce(const Device& device);
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
    std::map<std::wstring, Receiver> receivers_;
    unsigned logitechRequestId_{};
    std::vector<ReceiverAttempt> receiverAttempts_;
    std::map<std::wstring, std::wstring> razerCollections_;
    std::map<std::wstring, SharedPairing> sharedPairings_;
    std::map<std::wstring, std::wstring> usbIdentities_;
};

} // namespace pm
