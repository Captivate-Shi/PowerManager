#include "device_search.hpp"

#include <cassert>
#include <iostream>
#include <set>

int main()
{
    const auto devices = pm::findWindowsDevices();
    assert(devices);
    std::set<std::wstring> ids;
    unsigned readable = 0;
    unsigned usb = 0;
    unsigned bluetooth = 0;
    for (const auto& found : *devices) {
        assert(ids.insert(found.id).second);
        if (found.connection.starts_with(L"USB")) ++usb;
        if (found.connection == L"蓝牙") ++bluetooth;
        if (!found.battery) continue;
        ++readable;
        assert(found.connected);
        assert(found.battery->low >= 0 && found.battery->high <= 100);
        assert(found.battery->low == found.battery->high);
        assert(found.battery->source == pm::ReadingSource::windows);
    }
    std::cout << "Windows discovery: " << devices->size() << " containers, " << usb << " USB, "
              << bluetooth << " Bluetooth, " << readable << " readable battery properties\n";
}
