#include "device_search.hpp"
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
    FoundDevice rapoo{L"{receiver}", L"Rapoo 2.4G Wireless Device", L"USB", true, false, {}};
    assert(defaultPeripheralMonitoring(rapoo, false));
    assert(!defaultPeripheralMonitoring(rapoo, true));
    rapoo.connected = false;
    assert(!defaultPeripheralMonitoring(rapoo, false));
}
