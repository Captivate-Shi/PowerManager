#include "discovery_scope.hpp"

#include <cassert>

using pm::HidDiscoveryScope;

int main()
{
    HidDiscoveryScope scope;
    auto result = scope.observe({{L"mouse-A", {L"receiver-A"}}, {L"keyboard-B", {L"receiver-B"}},
        {L"combo", {L"usb-combo", L"radio-combo"}}},
        {L"receiver-A", L"receiver-B", L"usb-combo", L"radio-combo"},
        {L"receiver-A", L"receiver-B", L"usb-combo", L"radio-combo"}, true);
    assert(result.absent.empty() && result.uncertain.empty());

    // Partial SetupAPI enumeration cannot erase prior identity bindings or
    // make an omitted receiver look unplugged.
    result = scope.observe({{L"combo", {L"usb-combo"}}}, {L"usb-combo"}, {L"usb-combo"}, false);
    assert(result.absent.empty());
    assert(result.uncertain.contains(L"mouse-A"));
    assert(result.uncertain.contains(L"keyboard-B"));
    assert(result.uncertain.contains(L"combo")); // One previously known transport still uncertain.

    // A complete scan proves A's parent disappeared even while B's unrelated
    // receiver is being probed, and even if the last scan was partial.
    result = scope.observe({{L"combo", {L"usb-combo"}}}, {L"receiver-B", L"usb-combo"},
        {L"usb-combo"}, true);
    assert(result.absent.size() == 1 && result.absent.contains(L"mouse-A"));
    assert(result.uncertain.size() == 1 && result.uncertain.contains(L"keyboard-B"));

    // B's own resolved receiver can then confirm that the previous child is gone.
    result = scope.observe({{L"combo", {L"usb-combo"}}}, {L"receiver-B", L"usb-combo"},
        {L"receiver-B", L"usb-combo"}, true);
    assert(result.absent.size() == 1 && result.absent.contains(L"keyboard-B"));
    assert(result.uncertain.empty());
}
