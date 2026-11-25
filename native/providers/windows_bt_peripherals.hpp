#pragma once

#include <string_view>

namespace pm {

// Windows can expose a Bluetooth display container without DeviceCategory.
// Recognizing an exact model name here only enables Windows/BAS reads of
// that same container. No spoofable label dispatches a vendor command.
constexpr bool knownBluetoothPeripheral(std::wstring_view foldedName)
{
    using namespace std::literals;
    constexpr std::wstring_view aliases[] = {
        L"dell ms7421w"sv, L"ms7421w"sv, L"dell ms5320w"sv, L"ms5320w"sv,
        L"dell kb7221w"sv, L"kb7221w"sv, L"dell km7321w"sv, L"km7321w"sv,
        L"hp 710 rechargeable silent mouse"sv, L"hp 930 creator wireless mouse"sv,
        L"hp 975 dual-mode wireless keyboard"sv, L"bluetooth ergonomic mouse"sv,
        L"microsoft bluetooth ergonomic mouse"sv, L"surface precision mouse"sv,
        L"microsoft surface precision mouse"sv, L"designer compact keyboard"sv,
        L"microsoft designer compact keyboard"sv, L"ak820 pro"sv, L"ajazz ak820 pro"sv,
        L"ak820 max"sv, L"ajazz ak820 max"sv, L"cherry mx 8.2 tkl wireless"sv,
        L"cherry kw 9200 mini"sv, L"kw 9200 mini"sv,
        L"keychron k2 pro"sv, L"keychron k3 max"sv, L"keychron k8 pro"sv,
        L"keychron q1 max"sv, L"lofree flow 2 84"sv,
        L"京东京造 k3 pro max"sv, L"k3promax"sv,
        L"bose quietcomfort headphones"sv, L"quietcomfort headphones"sv,
        L"bose quietcomfort ultra earbuds (2nd gen)"sv,
        L"bose quietcomfort ultra headphones (2nd gen)"sv,
        L"jbl live beam 3"sv, L"jbl tour pro 3"sv, L"jbl tune beam 2"sv,
        L"vivo tws 3e"sv, L"vivo tws 4 hi-fi"sv, L"vivo tws air2"sv,
        L"redmi buds 6 pro"sv, L"xiaomi buds 5 pro"sv,
        L"airpods pro 3"sv, L"honor earbuds 3 pro"sv, L"gamesir cyclone pro"sv
    };
    for (const auto alias : aliases) if (alias == foldedName) return true;
    return false;
}

} // namespace pm
