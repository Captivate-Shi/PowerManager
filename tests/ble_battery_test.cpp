#include "ble_battery.hpp"
#include "device_search.hpp"
#include <array>
#include <cassert>

int main()
{
    for (const auto level : {0, 1, 52, 99, 100}) {
        const std::array bytes{static_cast<std::uint8_t>(level)};
        const auto sample = pm::parseBleBatteryLevel(bytes);
        assert(sample.status == pm::Status::current && sample.reading);
        assert(sample.reading->low == level && sample.reading->high == level);
        assert(sample.reading->power == pm::Power::unknown);
        assert(sample.reading->source == pm::ReadingSource::ble);
    }
    for (const auto level : {101, 255}) {
        const std::array bytes{static_cast<std::uint8_t>(level)};
        const auto sample = pm::parseBleBatteryLevel(bytes);
        assert(!sample.reading && sample.status == pm::Status::bad_report);
        assert(sample.detail == static_cast<unsigned>(pm::BleBatteryDetail::invalid_value));
    }
    assert(!pm::parseBleBatteryLevel({}).reading);
    const std::array<std::uint8_t, 2> oversized{80, 0};
    assert(!pm::parseBleBatteryLevel(oversized).reading);

    using pm::BleBatteryDetail;
    using pm::Status;
    assert(pm::bleBatteryReadDeferred(pm::bleFailure(BleBatteryDetail::read_pending, Status::busy)));
    assert(pm::bleBatteryReadDeferred(pm::bleFailure(BleBatteryDetail::worker_busy, Status::busy)));
    assert(!pm::bleBatteryReadDeferred(pm::bleFailure(BleBatteryDetail::read_failed, Status::busy)));
    assert(!pm::bleBatteryReadDeferred(pm::bleFailure(BleBatteryDetail::read_failed, Status::timeout)));
    assert(!pm::bleBatteryReadDeferred(pm::parseBleBatteryLevel(std::array<std::uint8_t, 1>{0})));

    // The cache has no right to assign the consuming poll's sequence.
    const pm::BleBatteryOrigin beforeEdit{7, L"exact-mouse", 23, false};
    const pm::BleBatteryOrigin manual{7, L"exact-mouse", std::nullopt, false};
    const pm::BleBatteryOrigin laterRegular{7, L"exact-mouse", 25, false};
    assert(pm::matchesBleBatteryOrigin(beforeEdit, laterRegular) && beforeEdit.regularSequence == 23);
    assert(pm::matchesBleBatteryOrigin(manual, laterRegular) && !manual.regularSequence);
    assert(!pm::matchesBleBatteryOrigin(beforeEdit, {8, L"exact-mouse", 26, false}));
    assert(!pm::matchesBleBatteryOrigin(beforeEdit, {7, L"new-owner", 25, false}));
    assert(!pm::matchesBleBatteryOrigin(beforeEdit, {7, L"exact-mouse", 25, true}));

    using Evidence = pm::WindowsConnectionEvidence;
    using Detail = pm::WindowsBatteryDetail;
    assert(pm::windowsConnectionEvidence(std::nullopt) == Evidence::unknown);
    assert(pm::windowsConnectionEvidence(1) == Evidence::unknown);
    assert(pm::windowsConnectionEvidence(0) == Evidence::disconnected);
    assert(pm::windowsConnectionEvidence(255) == Evidence::connected);
    assert(!pm::permitsBleBatteryFallback(Detail::disconnected));
    for (const auto detail : {Detail::apiUnavailable, Detail::notFound, Detail::queryFailed, Detail::unknownConnection}) {
        assert(pm::permitsBleBatteryFallback(detail));
        assert(pm::needsIndependentBleConnection(detail));
    }
    for (const auto detail : {Detail::missingProperty, Detail::invalidPercent}) {
        assert(pm::permitsBleBatteryFallback(detail));
        assert(!pm::needsIndependentBleConnection(detail));
    }

    // An error with verified ownership blocks only that exact container;
    // an error without ownership prevents claiming uniqueness for any.
    pm::BleServiceInventory scoped{true, 0, {{L"good", 1}}, {{L"broken", 1}}};
    assert(scoped.canAssess(L"good") && !scoped.canAssess(L"broken"));
    scoped.complete = false;
    assert(!scoped.canAssess(L"good") && !scoped.canAssess(L"broken"));
}
