#pragma once

#include "logitech_named_identity.hpp"

#include <algorithm>
#include <cwctype>
#include <optional>
#include <string>
#include <string_view>

namespace pm {

inline std::optional<LogitechNamedIdentity> office12Identity(unsigned vid, unsigned pid, unsigned model,
                                                            std::wstring_view label, unsigned kind)
{
    std::wstring name(label);
    std::ranges::transform(name, name.begin(), [](wchar_t c) { return std::towlower(c); });
    const bool keyboard = kind == 0 || kind == 255;
    const bool mouse = kind == 3 || kind == 255;
    if (!logitechUnifying(vid, pid)) return {};
    // Confirm the live feature 0x0003 model and 0x0005 name/kind; pairing
    // metadata alone can even report this mouse as a keyboard (Solaar #3156).
    if (model == 0x4051 && kind == 3 && name == L"wireless mouse m510")
        return LogitechNamedIdentity{L"M510 v2", 3, model, named_legacy_1000};
    if (model == 0x405e && mouse && name == L"m720 triathlon multi-device mouse")
        return LogitechNamedIdentity{L"M720 Triathlon", 3, model, named_legacy_1000};
    if (model == 0x4069 && mouse && name == L"wireless mouse mx master 2s")
        return LogitechNamedIdentity{L"MX Master 2S", 3, model, named_legacy_1000};
    if (model == 0x408a && keyboard && (name == L"mx keys wireless keyboard" || name == L"mx keys keyboard"))
        return LogitechNamedIdentity{L"MX Keys", 0, model, named_legacy_1000};
    if (model == 0x4088 && keyboard && name == L"wireless keyboard ergo k860")
        return LogitechNamedIdentity{L"ERGO K860", 0, model, named_legacy_1000};
    if (model == 0x405b && keyboard && name == L"wireless multi-device keyboard k780")
        return LogitechNamedIdentity{L"K780", 0, model, named_legacy_1000};
    return {};
}

} // namespace pm
