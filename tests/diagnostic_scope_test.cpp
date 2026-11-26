#include "diagnostic_scope.hpp"

#include <cassert>

int main()
{
    using pm::diagnosticScopeKey;
    const std::map<std::wstring, std::wstring> owners{
        {L"{native}", L"native:device"}, {L"{ambiguous}", L""}, {L"{receiver}", L"receiver:child"},
    };
    const std::set<std::wstring> shared{L"{receiver}"};
    const std::set<std::wstring> windows{L"{unknown-hid}", L"{native}", L"{ambiguous}", L"{receiver}"};
    assert(diagnosticScopeKey(L"{unknown-hid}", owners, shared, windows) == L"{unknown-hid}");
    assert(diagnosticScopeKey(L"{native}", owners, shared, windows) == L"native:device");
    assert(diagnosticScopeKey(L"{ambiguous}", owners, shared, windows).empty());
    assert(diagnosticScopeKey(L"{receiver}", owners, shared, windows).empty());
    assert(diagnosticScopeKey(L"{unrelated}", owners, shared, windows).empty());
    assert(diagnosticScopeKey(L"", owners, shared, windows).empty());

    const std::map<std::wstring, pm::DiagnosticReceiverSlot> slots{
        {L"mouse", {L"receiver-a", 2}}, {L"keyboard", {L"receiver-b", 2}}, {L"ambiguous", {L"", 2}},
    };
    assert(pm::matchesReceiverProbe(slots, L"mouse", L"receiver-a", 2));
    assert(!pm::matchesReceiverProbe(slots, L"mouse", L"receiver-b", 2));
    assert(!pm::matchesReceiverProbe(slots, L"mouse", L"receiver-a", 3));
    assert(!pm::matchesReceiverProbe(slots, L"keyboard", L"receiver-a", 2));
    assert(!pm::matchesReceiverProbe(slots, L"", L"receiver-a", 2));
    assert(!pm::matchesReceiverProbe(slots, L"ambiguous", L"receiver-a", 2));
}
