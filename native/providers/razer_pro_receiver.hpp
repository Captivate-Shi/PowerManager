#pragma once

namespace pm {

constexpr const wchar_t* razerProReceiverName(unsigned vid, unsigned pid)
{
    if (vid != 0x1532) return nullptr;
    switch (pid) {
    case 0x00c1: return L"Razer Viper V3 Pro";
    case 0x00b7: return L"Razer DeathAdder V3 Pro";
    case 0x00ab: return L"Razer Basilisk V3 Pro";
    default: return nullptr;
    }
}

constexpr bool razerProBatteryCollection(unsigned vid, unsigned pid, unsigned interfaceNumber,
                                         unsigned page, unsigned usage, unsigned featureLength)
{
    // The Viper's Windows reference identifies the mouse TLC by caps. The
    // DeathAdder and Basilisk references additionally identify USB interface 0.
    return razerProReceiverName(vid, pid) && page == 1 && usage == 2 && featureLength == 91
        && (pid == 0x00c1 || interfaceNumber == 0);
}

} // namespace pm
