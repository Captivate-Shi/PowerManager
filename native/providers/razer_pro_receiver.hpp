#pragma once

#include <string_view>

namespace pm {

constexpr bool razerBatch13Receiver(unsigned vid, unsigned pid)
{
    return vid == 0x1532 && (pid == 0x0094 || pid == 0x0296);
}

constexpr bool razerKeyboardReceiver(unsigned vid, unsigned pid)
{
    return vid == 0x1532 && (pid == 0x0296 || pid == 0x0290 || pid == 0x0271 || pid == 0x02d5);
}

constexpr bool razerBatch13Product(unsigned vid, unsigned pid, std::wstring_view name)
{
    if (!razerBatch13Receiver(vid, pid)) return false;
    while (!name.empty() && name.front() == L' ') name.remove_prefix(1);
    while (!name.empty() && name.back() == L' ') name.remove_suffix(1);
    if (pid == 0x0296) return name == L"dsv2pro tkl";
    return name == L"orochi v2" || name == L"razer orochi v2";
}

// OpenRazer documents these receiver interfaces for the shared keyboard
// battery query. Windows additionally requires a unique, usable collection.
constexpr bool razerKeyboardBatteryCollection(unsigned vid, unsigned pid, unsigned interfaceNumber,
                                                 unsigned featureLength)
{
    if (vid != 0x1532 || featureLength != 91) return false;
    switch (pid) {
    case 0x0290: // DeathStalker V2 Pro full-size receiver
    case 0x02d5: // BlackWidow V4 Tenkeyless HyperSpeed receiver
        return interfaceNumber == 2;
    case 0x0271: // BlackWidow V3 Mini HyperSpeed receiver
        return interfaceNumber == 3;
    default:
        return false;
    }
}

constexpr const wchar_t* razerProReceiverName(unsigned vid, unsigned pid)
{
    if (vid != 0x1532) return nullptr;
    switch (pid) {
    case 0x00c1: return L"Razer Viper V3 Pro";
    case 0x00b7: return L"Razer DeathAdder V3 Pro";
    case 0x00ab: return L"Razer Basilisk V3 Pro";
    case 0x0094: return L"Razer Orochi V2";
    case 0x0296: return L"Razer DeathStalker V2 Pro TKL";
    case 0x0290: return L"Razer DeathStalker V2 Pro";
    case 0x0271: return L"Razer BlackWidow V3 Mini HyperSpeed";
    case 0x02d5: return L"Razer BlackWidow V4 Tenkeyless HyperSpeed";
    default: return nullptr;
    }
}

constexpr bool razerProBatteryCollection(unsigned vid, unsigned pid, unsigned interfaceNumber,
                                         unsigned page, unsigned usage, unsigned featureLength)
{
    if (razerKeyboardBatteryCollection(vid, pid, interfaceNumber, featureLength))
        return (page >= 0xff00 && page <= 0xffff) || (page == 1 && usage == 2);
    // The Viper's Windows reference identifies the mouse TLC by caps. The
    // DeathAdder and Basilisk references additionally identify USB interface 0.
    return razerProReceiverName(vid, pid) && page == 1 && usage == 2 && featureLength == 91
        && (pid == 0x00c1 || interfaceNumber == (pid == 0x0296 ? 2u : 0u))
        && (!razerKeyboardReceiver(vid, pid) || pid == 0x0296);
}

} // namespace pm
