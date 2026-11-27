#include "device_search.hpp"
#include "device_transport.hpp"
#include "hid.hpp"
#include "windows_bt_peripherals.hpp"
#include <cassert>

int main()
{
    using namespace pm;
    static_assert(knownBluetoothPeripheral(L"keychron k2 pro"));
    static_assert(knownBluetoothPeripheral(L"gamesir cyclone pro"));
    static_assert(knownBluetoothPeripheral(L"dell kb7221w"));
    static_assert(!knownBluetoothPeripheral(L"keychron k2"));
    static_assert(!knownBluetoothPeripheral(L"iphone"));
    static_assert(!knownBluetoothPeripheral(L"jbl tour pro 3 case"));
    static_assert(!knownBluetoothPeripheral(L"g915"));
    static_assert(windowsHeadphoneCategory(L"Audio.Headphone"));
    static_assert(windowsHeadphoneCategory(L"Communication.Headset"));
    static_assert(windowsHeadphoneCategory(L"Communication.Headset.Bluetooth"));
    static_assert(!windowsHeadphoneCategory(L"Audio.Speaker"));
    static_assert(!windowsHeadphoneCategory(L"Communication.Phone.Speaker"));
    constexpr std::wstring_view headphones[] = {L"Audio.Headphone", L"Communication.Headset.Bluetooth"};
    constexpr std::wstring_view headset[] = {L"Communication.Headset.Bluetooth"};
    constexpr std::wstring_view mouse[] = {L"Input.Mouse"};
    constexpr std::wstring_view keyboard[] = {L"Input.Keyboard"};
    constexpr std::wstring_view mixed[] = {L"Input.Keyboard", L"Input.Mouse"};
    constexpr std::wstring_view controller[] = {L"Input.Gaming", L"Input.Gaming.Gamepad", L"Audio"};
    constexpr std::wstring_view wheel[] = {L"Input.Gaming", L"Input.Gaming.Steering"};
    constexpr std::wstring_view pen[] = {L"Input.Digitizer", L"Input.Digitizer.Pen"};
    constexpr std::wstring_view touchscreen[] = {L"Input.Digitizer", L"Input.Digitizer.Touchscreen"};
    constexpr std::wstring_view speaker[] = {L"Audio.Speakers.Wireless"};
    static_assert(windowsCategoryArt(headphones, L"huawei freebuds 7i") == WindowsDeviceArt::earbuds);
    static_assert(windowsCategoryArt(headset, L"bluetooth earbuds") == WindowsDeviceArt::earbuds);
    static_assert(windowsCategoryArt(headphones, L"huawei freebuds studio") == WindowsDeviceArt::headset);
    static_assert(windowsCategoryArt(headset, L"generic model") == WindowsDeviceArt::headset);
    static_assert(windowsCategoryArt(mouse, L"generic model") == WindowsDeviceArt::mouse);
    static_assert(windowsCategoryArt(keyboard, L"generic model") == WindowsDeviceArt::keyboard);
    static_assert(windowsCategoryArt(mixed, L"generic model") == WindowsDeviceArt::unknown);
    static_assert(windowsCategoryArt(controller, L"generic model") == WindowsDeviceArt::controller);
    static_assert(windowsCategoryArt(wheel, L"generic model") == WindowsDeviceArt::unknown);
    static_assert(windowsCategoryArt(pen, L"generic model") == WindowsDeviceArt::stylus);
    static_assert(windowsCategoryArt(touchscreen, L"generic model") == WindowsDeviceArt::unknown);
    static_assert(windowsCategoryArt(speaker, L"huawei freebuds 7i") == WindowsDeviceArt::unknown);

    FoundDevice candidate{L"{container}", L"keyboard", L"蓝牙", true, false, {}};
    assert(!defaultPeripheralMonitoring(candidate, false)); // not a peripheral
    candidate.inputOrHeadset = true;
    assert(!defaultPeripheralMonitoring(candidate, false)); // don't enroll wired devices with no data
    candidate.knownBluetooth = true;
    assert(defaultPeripheralMonitoring(candidate, false)); // connected peripheral, even with no data yet
    assert(!defaultPeripheralMonitoring(candidate, true)); // no duplicate native row
    candidate.battery = Reading{0, 0, Power::unknown, 0, ReadingSource::windows};
    candidate.knownBluetooth = false;
    assert(defaultPeripheralMonitoring(candidate, false)); // actual Windows value, including zero
    // Before successful native identity resolution, an exact Windows value
    // for the wired device can surface. A receiver must not supply a slot's value.
    assert(defaultPeripheralMonitoring(candidate, reservesWindowsContainerBeforeProbe(Transport::logitech_usb)));
    assert(!defaultPeripheralMonitoring(candidate, reservesWindowsContainerBeforeProbe(Transport::logitech_receiver)));
    candidate.connected = false;
    assert(!defaultPeripheralMonitoring(candidate, false)); // stale/offline never enroll
    // A Windows Keyboard-class HID-over-GATT devnode is useful evidence
    // even when the display container's category, transport, or label is absent.
    constexpr std::wstring_view hogp = L"hid\\{00001812-0000-1000-8000-00805f9b34fb}_dev_vid&020000";
    constexpr std::wstring_view classic = L"hid\\{00001124-0000-1000-8000-00805f9b34fb}_vid&020000";
    constexpr std::wstring_view batteryService = L"hid\\{0000180f-0000-1000-8000-00805f9b34fb}";
    static_assert(windowsKeyboardInstanceCandidate(hogp));
    static_assert(windowsKeyboardInstanceCandidate(classic));
    static_assert(windowsKeyboardInstanceCandidate(L"bthle\\dev_mock"));
    static_assert(!windowsKeyboardInstanceCandidate(batteryService));
    static_assert(!windowsKeyboardInstanceCandidate(L"rapoo 2.4g wireless device"));
    static_assert(!windowsKeyboardInstanceCandidate(L"usb\\vid_24ae&pid_0000"));
    const std::wstring_view hogpIds[] = {L"HID\\{00001812-0000-1000-8000-00805F9B34FB}_DEV_MOCK"};
    const std::wstring_view genericHid[] = {L"HID\\VID_24AE&PID_0000"};
    assert(windowsBus({}, hogpIds) == WindowsBus::bluetooth);
    assert(windowsBus({}, genericHid) == WindowsBus::unknown);

    FoundDevice orphan{L"{keyboard}", L"HID Keyboard Device", L"蓝牙", true, false, {}};
    markKeyboardWithoutDisplayContainer(orphan, true);
    assert(!orphan.connected && orphan.knownBluetooth && orphan.inputOrHeadset);
    assert(!defaultPeripheralMonitoring(orphan, false)); // presence is not a radio connection
    assert(!eligibleForBleConnectionVerification(orphan, false, false)); // not the same scoped service
    assert(!eligibleForBleConnectionVerification(orphan, true, true)); // native source owns it
    assert(eligibleForBleConnectionVerification(orphan, false, true));
    assert(needsIndependentBleConnection(orphan.batteryDetail));
    orphan.batteryDetail = WindowsBatteryDetail::disconnected;
    assert(!eligibleForBleConnectionVerification(orphan, false, true));
    FoundDevice usbKeyboard{L"{usb}", L"HID Keyboard Device", L"USB", true, false, {}};
    markKeyboardWithoutDisplayContainer(usbKeyboard, false);
    assert(usbKeyboard.connected && !usbKeyboard.knownBluetooth && usbKeyboard.inputOrHeadset);
    assert(!eligibleForBleConnectionVerification(usbKeyboard, false, true));

    FoundDevice rapoo{L"{receiver}", L"Rapoo 2.4G Wireless Device", L"USB", true, false, {}};
    assert(defaultPeripheralMonitoring(rapoo, false));
    assert(!defaultPeripheralMonitoring(rapoo, true));
    rapoo.connected = false;
    assert(!defaultPeripheralMonitoring(rapoo, false));
}
