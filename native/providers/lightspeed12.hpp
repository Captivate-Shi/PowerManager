#pragma once

#include "logitech_named_identity.hpp"

#include <algorithm>
#include <cwctype>
#include <optional>
#include <string>
#include <string_view>

namespace pm {

inline constexpr bool lightspeed12Receiver(unsigned vid, unsigned pid)
{
    if (vid != 0x046d) return false;
    // Known LIGHTSPEED receivers; no inferred identities from the USB PID.
    switch (pid) {
    case 0xc539: case 0xc53a: case 0xc53d: case 0xc53f:
    case 0xc541: case 0xc545: case 0xc547: case 0xc54d:
        return true;
    default:
        return false;
    }
}

inline std::optional<LogitechNamedIdentity> lightspeed12Identity(unsigned vid, unsigned pid,
    unsigned model, std::wstring_view pairedLabel, unsigned kind)
{
    if (!lightspeed12Receiver(vid, pid)) return {};
    std::wstring name(pairedLabel);
    std::ranges::transform(name, name.begin(), [](wchar_t c) { return std::towlower(c); });
    if (kind == 3) {
        if (model == 0x4099 && name == L"g502 x plus")
            return LogitechNamedIdentity{L"Logitech G502 X PLUS", 3, model, named_percent_1004};
        if (model == 0x4093 && name == L"pro x wireless")
            return LogitechNamedIdentity{L"Logitech PRO X SUPERLIGHT", 3, model, named_percent_1004};
        if (model == 0x4074 && name == L"g305 lightspeed wireless gaming mouse")
            return LogitechNamedIdentity{L"Logitech G305 LIGHTSPEED", 3, model, named_legacy_1000};
    }
    if (kind == 0 && model == 0x4065 && name == L"g613 wireless mechanical gaming keyboard")
        return LogitechNamedIdentity{L"Logitech G613 LIGHTSPEED", 0, model, named_legacy_1000};
    // G915 407C and G915 TKL 408E expose 0x1001 voltage only; do not
    // treat that as native SOC or apply an unrelated mouse voltage curve.
    return {};
}
} // namespace pm
