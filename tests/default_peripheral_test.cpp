#include "device_search.hpp"
#include <cassert>

int main()
{
    using namespace pm;
    FoundDevice candidate{L"{container}", L"keyboard", L"蓝牙", true, false, {}};
    assert(!defaultPeripheralMonitoring(candidate, true, false)); // not a peripheral category
    candidate.inputOrHeadset = true;
    assert(!defaultPeripheralMonitoring(candidate, true, false)); // BLE transport not verified
    candidate.knownBluetooth = true;
    assert(!defaultPeripheralMonitoring(candidate, false, false)); // no unique battery service
    assert(defaultPeripheralMonitoring(candidate, true, false)); // standard BAS candidate
    assert(!defaultPeripheralMonitoring(candidate, true, true)); // claimed by vendor path
    candidate.automaticallyMonitored = true;
    assert(defaultPeripheralMonitoring(candidate, true, false)); // OS heuristic alone does not prove a vendor path
    candidate.automaticallyMonitored = false;
    candidate.battery = Reading{0, 0, Power::unknown, 0, ReadingSource::windows};
    candidate.knownBluetooth = false;
    assert(defaultPeripheralMonitoring(candidate, false, false)); // actual Windows value, including zero
    candidate.connected = false;
    assert(!defaultPeripheralMonitoring(candidate, true, false)); // stale/offline never enroll
}
