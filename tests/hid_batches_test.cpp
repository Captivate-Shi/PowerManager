#include "hid_batches.hpp"

#include <cassert>

int main()
{
    using pm::groupHidResources;
    const auto batches = groupHidResources({
        {L"razer-mouse", {L"razer", L"razer-control"}},
        {L"razer-keyboard", {L"razer", L"razer-control"}},
        {L"logitech-mouse", {L"bolt", L"mouse-direct"}},
        {L"logitech-keyboard", {L"bolt"}},
        {L"alternate-pipe", {L"mouse-direct"}},
        {L"separate-receiver", {L"bolt-2"}},
        {L"standalone", {L"standalone"}},
    });
    assert(batches.size() == 4);
    assert((batches.at(L"razer-keyboard") == std::vector<std::wstring>{L"razer-keyboard", L"razer-mouse"}));
    assert((batches.at(L"alternate-pipe") ==
        std::vector<std::wstring>{L"alternate-pipe", L"logitech-keyboard", L"logitech-mouse"}));
    assert(batches.at(L"separate-receiver").size() == 1);
    assert(batches.at(L"standalone").size() == 1);
    assert(groupHidResources({}).empty());
}
