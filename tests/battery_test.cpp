#include "battery.hpp"
#include "dashboard.hpp"
#include "device_identity.hpp"
#include "device_transport.hpp"
#include <cassert>

#include <cstdlib>
#include <iostream>

using namespace pm;

void require(bool condition, const char* message)
{
    if (!condition) {
        std::cerr << message << '\n';
        std::exit(1);
    }
}

Sample level(int low, int high, Power power = Power::discharging)
{
    return {Status::current, Reading{low, high, power, 0}};
}

int main()
{
    using pm::WindowsBus;
    const std::wstring_view usbIds[] = {L"USB\\VID_1234&PID_2345"};
    const std::wstring_view ble[] = {L"BTHLEDEVICE\\{SERVICE}", L"USB\\VID_0000"};
    const std::wstring_view hid[] = {L"HID\\VID_1234&PID_2345"};
    const std::wstring_view bluetoothMethods[] = {L"Bluetooth"};
    assert(pm::windowsBus({}, usbIds) == WindowsBus::usb);
    assert(pm::windowsBus({}, ble) == WindowsBus::bluetooth);
    assert(pm::windowsBus(bluetoothMethods, usbIds) == WindowsBus::bluetooth);
    assert(pm::windowsBus({}, hid) == WindowsBus::unknown);
    assert(pm::windowsBus({}, {}) == WindowsBus::unknown);
    const auto usbVoltage = makeDualSenseVoltageQuery(false);
    const auto bluetoothVoltage = makeDualSenseVoltageQuery(true);
    require(usbVoltage[0] == 0x80 && usbVoltage[1] == 4 && usbVoltage[2] == 3 && usbVoltage[63] == 0,
            "USB voltage uses only the battery query");
    require(bluetoothVoltage[60] == 0x78 && bluetoothVoltage[61] == 0xc9 &&
            bluetoothVoltage[62] == 0x5c && bluetoothVoltage[63] == 0x3a,
            "Bluetooth voltage request checksum");
    std::array<std::uint8_t, 8> voltageReply{0x81, 4, 3, 2, 0x31, 0x0e, 0, 0};
    require(parseDualSenseVoltageReply(voltageReply).millivolts == 3633, "Voltage response in millivolts");
    voltageReply[2] = 2;
    require(!parseDualSenseVoltageReply(voltageReply).millivolts, "Unrelated response ignored");
    voltageReply[2] = 3;
    require(parseDualSenseVoltageReply(std::span(voltageReply).first(6)).status == VoltageStatus::invalid_reply,
            "Truncated voltage response rejected");
    voltageReply[5] = 0;
    require(parseDualSenseVoltageReply(voltageReply).status == VoltageStatus::invalid_reply,
            "Invalid millivolt reading rejected");

    auto razer = makeRazerQuery();
    require(razer[2] == 0x1f && razer[7] == 0x07 && razer[8] == 0x80 && razer[89] == 0x85,
            "Razer request framing");
    razer[1] = 2;
    razer[10] = 171;
    razer[89] = 0x2e;
    require(parseRazerReport(razer).reading == Reading{67, 67, Power::discharging, 171}, "Razer scaling");
    razer[89] ^= 1;
    require(parseRazerReport(razer).status == Status::bad_report, "Razer checksum");
    razer[8] = 0x84;
    require(parseRazerReport(razer).status == Status::busy, "Razer unrelated response");
    razer[8] = 0x80;
    razer[1] = 4;
    require(parseRazerReport(razer).status == Status::no_radio_reply, "Razer asleep or off");

    auto pair = makeRazerQuery(RazerQuery::pairedDevices);
    pair[1] = 2;
    pair[9] = 2;
    pair[10] = 1;
    pair[12] = 0xb8;
    pair[13] = 1;
    pair[14] = 0x02;
    pair[15] = 0xd2;
    for (auto i = 9u; i < 16; ++i) pair[89] ^= pair[i];
    const auto knownPair = parseRazerReport(pair, RazerQuery::pairedDevices);
    require(knownPair.status == Status::current && knownPair.detail == 1, "Shared receiver identifies the keyboard");
    pair[15] ^= 1;
    pair[89] ^= 1;
    require(parseRazerReport(pair, RazerQuery::pairedDevices).detail == 0, "An unrelated paired device is ignored");
    auto keyboard = makeRazerQuery(RazerQuery::keyboardBattery);
    keyboard[1] = 2;
    keyboard[10] = 161;
    keyboard[89] ^= 161;
    require(parseRazerReport(keyboard, RazerQuery::keyboardBattery).reading ==
                Reading{63, 63, Power::unknown, 161}, "Keyboard battery uses its own transaction");
    require(!parseRazerReport(keyboard).reading, "Keyboard battery cannot be attributed to the mouse");
    auto charge = makeRazerQuery(RazerQuery::keyboardCharging);
    charge[1] = 2;
    charge[10] = 1;
    charge[89] ^= 1;
    require(parseRazerReport(charge, RazerQuery::keyboardCharging).detail == 1, "Keyboard charging flag");

    std::array<std::uint8_t, 64> usb{};
    usb[0] = 1;
    usb[53] = 0x03;
    require(parseDualSenseReport(usb, false).reading == Reading{30, 39, Power::discharging, 3},
            "DualSense discharge band");
    usb[53] = 0x10;
    require(parseDualSenseReport(usb, false).reading == Reading{0, 9, Power::charging, 0},
            "DualSense real zero band while charging");
    usb[53] = 0x29;
    require(parseDualSenseReport(usb, false).reading == Reading{90, 99, Power::full, 9},
            "DualSense charge-complete flag does not overwrite the gauge bucket");
    usb[53] = 0x2a;
    require(parseDualSenseReport(usb, false).reading == Reading{100, 100, Power::full, 10},
            "DualSense maximum gauge bucket still reports 100%");
    require(Reading{80, 89, Power::discharging, 8}.midpoint() == 85 &&
            Reading{90, 99, Power::full, 9}.midpoint() == 95 &&
            Reading{47, 47, Power::discharging, 120}.midpoint() == 47,
            "Display estimates the midpoint only for a gauge interval");
    usb[53] = 0xa0;
    require(parseDualSenseReport(usb, false).status == Status::charging_error, "DualSense charging error");
    usb[53] = 0x0b;
    require(parseDualSenseReport(usb, false).status == Status::bad_report, "DualSense invalid band");
    require(parseDualSenseReport(std::span(usb).first(63), false).status == Status::bad_report,
            "DualSense short USB report");
    require(parseDualSenseReport(usb, true).status == Status::basic_bluetooth,
            "DualSense basic Bluetooth report");
    std::array<std::uint8_t, 78> bluetooth{};
    bluetooth[0] = 0x31;
    bluetooth[54] = 0x06;
    bluetooth[74] = 0x48;
    bluetooth[75] = 0xcc;
    bluetooth[76] = 0xbf;
    bluetooth[77] = 0x98;
    require(parseDualSenseReport(bluetooth, true).reading == Reading{60, 69, Power::discharging, 6},
            "DualSense full Bluetooth report");
    bluetooth[54] ^= 1;
    require(parseDualSenseReport(bluetooth, true).status == Status::bad_report, "DualSense Bluetooth CRC");

    const Thresholds thresholds;
    AlertState state;
    require(state.observe(level(20, 29), thresholds, true) == Alert::none, "Use range upper bound");
    require(state.observe(level(10, 19), thresholds, false) == Alert::none, "Quiet mode");
    require(state.observe(level(10, 19, Power::charging), thresholds, true) == Alert::none,
            "Charging is quiet");
    require(state.observe(level(10, 19), thresholds, true) == Alert::low, "First low alert");
    state.markSent(Alert::low);
    require(state.observe(level(10, 19), thresholds, true) == Alert::none, "Low alert dedupe");
    require(state.observe(level(0, 9), thresholds, true) == Alert::critical, "Escalation");
    state.markSent(Alert::critical);
    state.observe(level(25, 25), thresholds, true);
    state.observe({Status::timeout}, thresholds, true);
    state.observe(level(25, 25), thresholds, true);
    require(state.lowSent && state.criticalSent, "Failed read interrupts consecutive recovery");
    state.observe(level(25, 25), thresholds, true);
    require(!state.lowSent && !state.criticalSent, "Two recovered samples allow a new cycle");

    AlertState first;
    require(first.observe(level(0, 0), thresholds, true) == Alert::critical, "Valid zero alerts");
    first.markSent(Alert::critical);
    const AlertState persisted{first.lowSent, first.criticalSent};
    state = persisted;
    require(state.observe(level(15, 15), thresholds, true) == Alert::none,
            "Critical-first suppresses lower alert after restart");

    const Reading previous{39, 39, Power::discharging, 100};
    const DashboardDevice busy{Transport::razer_receiver, Status::busy, previous, L"15:20"};
    require(busy.connected() && !busy.fresh(), "Busy device remains connected with a stale reading");
    const DashboardDevice asleep{Transport::razer_receiver, Status::no_radio_reply, previous, L"15:20"};
    require(!asleep.connected() && !asleep.fresh(), "A connected receiver alone does not imply an awake mouse");
    const DashboardDevice detached{Transport::dualsense_usb, Status::offline, {}, {}};
    require(!detached.connected() && !detached.fresh(), "An unplugged controller stays in the offline group");
    const DashboardDevice charging{Transport::dualsense_usb, Status::current,
                                   Reading{0, 9, Power::charging, 0}, L"15:25"};
    require(charging.connected() && charging.fresh(), "A valid zero band is displayed as live");
    require(windowsReading(0, 1) == Reading{0, 0, Power::charging, 0, ReadingSource::windows},
            "Windows battery zero while charging");
    require(!windowsReading(101, 0) && !windowsReading({}, 0), "Windows battery unknown sentinels");
    const auto external = windowsReading(8, {});
    require(external == Reading{8, 8, Power::unknown, 8, ReadingSource::windows},
            "Windows battery without charging property");
    AlertState windowsAlert;
    require(windowsAlert.observe({Status::current, external}, thresholds, true) == Alert::critical,
            "A known Windows battery level can alert even without separate charging information");
    constexpr std::array<std::uint8_t, 20> pairing{0x09, 0x6f, 0x5e, 0x4d, 0x3c, 0x2b, 0x1a};
    const auto identity = dualSenseUsbIdentity(pairing);
    require(identity == L"dualsense:1a2b3c4d5e6f", "USB pairing report uses reversed address bytes");
    require(dualSenseBluetoothIdentity(L"bthenum\\dev_1a2b3c4d5e6f\\7&1234&0") == identity,
            "USB and Bluetooth derive one physical DualSense identity");
    require(dualSenseBluetoothIdentity(L"bthenum\\{00001124-0000-1000-8000-00805f9b34fb}"
                L"_vid&0002054c_pid&0ce6\\8&abcd1234&0&1a2b3c4d5e6f_c00000000") == identity,
            "Classic HID service instance identifies the same DualSense");
    require(dualSenseBluetoothIdentity(L"bthenum\\dev_000000000000").empty(),
            "Invalid addresses cannot merge controllers");
    std::cout << "Battery and voltage protocols, alerts, and dashboard state tests passed\n";
}
