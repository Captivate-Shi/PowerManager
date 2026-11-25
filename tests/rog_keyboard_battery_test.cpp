#include "rog_keyboard_battery.hpp"
#include <cassert>
#include <span>
using namespace pm;
using namespace pm::rog_keyboard;
int main()
{
    static_assert(pathRole(LR"(\\?\hid#vid_0b05&pid_1a85&mi_01&col01#instance#guid)") == Port::azoth);
    static_assert(pathRole(LR"(\\?\hid#vid_0b05&pid_1a85&mi_01&colzz#instance#guid)") == Port::none);
    static_assert(pathRole(LR"(\\?\hid#vid_0b05&pid_1a85&mi_02#instance#guid)") == Port::none);
    static_assert(pathRole(LR"(\\?\hid#vid_0b05&pid_1ace&mi_02&col01#instance#guid)") == Port::omniIdentity);
    static_assert(pathRole(LR"(\\?\hid#vid_0b05&pid_1ace&mi_02&col02#instance#guid)") == Port::omniBattery);
    static_assert(pathRole(LR"(\\?\hid#vid_0b05&pid_1ace&mi_02&col03#instance#guid)") == Port::none);
    static_assert(endpoint(vendor, azothReceiver, L"rog azoth", 1, 0, 0xff00, 1, 65, 65) == Port::azoth);
    static_assert(endpoint(vendor, azothReceiver, L"rog azoth", 2, 0, 0xff00, 1, 65, 65) == Port::none);
    static_assert(endpoint(vendor, azothReceiver, L"rog azoth", 1, 0, 1, 6, 65, 65) == Port::none);
    static_assert(endpoint(vendor, azothReceiver, L"rog azoth extreme", 1, 0, 0xff00, 1, 65, 65) == Port::none);
    static_assert(endpoint(vendor, azothReceiver, L"rog azoth", 1, 0, 0xff00, 1, 64, 65) == Port::none);
    static_assert(endpoint(vendor, omniReceiver, L"rog omni receiver", 2, 1, 0xff02, 1, 64, 64) == Port::omniIdentity);
    static_assert(endpoint(vendor, omniReceiver, L"rog omni receiver", 2, 2, 0xff00, 1, 64, 64) == Port::omniBattery);
    static_assert(endpoint(vendor, omniReceiver, L"rog omni receiver", 2, 3, 0xff00, 1, 64, 64) == Port::none);
    static_assert(endpoint(vendor, falchionPaired, L"rog omni receiver", 2, 2, 0xff00, 1, 64, 64) == Port::none);

    static_assert(request(Port::azoth)[0] == 0 && request(Port::azoth)[1] == 0x12 && request(Port::azoth)[2] == 1);
    static_assert(request(Port::omniIdentity)[0] == 1 && request(Port::omniIdentity)[1] == 0xa0);
    static_assert(request(Port::omniBattery)[0] == 2 && request(Port::omniBattery)[1] == 0x12);

    const std::array<std::uint8_t, 64> falchionPair{1, 0xa0, 0, 1, 0, 6, 0x1b, 2, 4};
    assert(falchionPairedOnly(falchionPair));
    auto pairs = falchionPair;
    pairs[9] = 0x68; pairs[10] = 0x1a;
    assert(falchionPairedOnly(pairs));
    pairs[13] = 6; pairs[14] = 0x1b;
    assert(!falchionPairedOnly(pairs));
    pairs = falchionPair;
    pairs[9] = 0x85; pairs[10] = 0x1a;
    assert(!falchionPairedOnly(pairs));
    pairs[5] = 0x68; pairs[6] = 0x1a;
    assert(!falchionPairedOnly(pairs));
    assert(!falchionPairedOnly(std::span{falchionPair}.first(12)));

    std::array<std::uint8_t, 64> falchion{2, 0x12, 1, 0, 0, 0, 0x34, 2, 1, 0, 0x14, 0x34, 0xff, 0x0e};
    assert(read(Port::omniBattery, falchion).reading->low == 52);
    assert(read(Port::omniBattery, falchion).reading->power == Power::discharging);
    // Markers at byte 6 are not a battery field on this model.
    falchion[6] = 5; falchion[9] = 1;
    assert(read(Port::omniBattery, falchion).reading->low == 52);
    assert(read(Port::omniBattery, falchion).reading->power == Power::charging);
    falchion[11] = 0;
    assert(!read(Port::omniBattery, falchion).reading);
    falchion[11] = 101;
    assert(!read(Port::omniBattery, falchion).reading);
    falchion = {2, 0xff, 0xaa};
    assert(read(Port::omniBattery, falchion).status == Status::no_radio_reply);

    std::array<std::uint8_t, 65> azoth{0, 0x12, 1, 0, 0, 0, 77, 0, 0, 1};
    assert(read(Port::azoth, azoth).reading->low == 77);
    assert(read(Port::azoth, azoth).reading->power == Power::charging);
    assert(!read(Port::azoth, std::span{azoth}.first(64)).reading);
    azoth[9] = 7;
    assert(!read(Port::azoth, azoth).reading);
    azoth = request(Port::azoth);
    assert(!read(Port::azoth, azoth).reading);
}
