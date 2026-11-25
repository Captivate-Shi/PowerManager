#pragma once

#include "battery.hpp"

#include <map>
#include <memory>
#include <set>
#include <string>

namespace pm {

// Exact receiver IDs with evidence for the same passive 19-byte status report.
constexpr const wchar_t* rapooReceiverName(unsigned vid, unsigned pid)
{
    if (vid != 0x24ae) return nullptr;
    switch (pid) {
    case 0x1411: return L"Rapoo VT3S";
    case 0x1412: return L"Rapoo VT3 双8K";
    case 0x1421: return L"Rapoo VT3S MAX";
    case 0x14a1: return L"Rapoo VT0 Air MAX";
    case 0x1b13: return L"Rapoo VT2S Air Max";
    default: return nullptr;
    }
}

constexpr bool isRapooReceiver(unsigned vid, unsigned pid)
{
    return rapooReceiverName(vid, pid) != nullptr;
}

constexpr bool isRapooBatteryCollection(unsigned page, unsigned usage, unsigned inputLength)
{
    return page == 0xff00 && usage == 0x0002 && inputLength == 19;
}

// Evidence: A HUB's passive report 07; pinned downstream decoder and hardware
// capture described in Rapoo provider docs. No inference from unknown VT PIDs.
constexpr Sample parseRapooBatteryReport(std::span<const std::uint8_t> report, unsigned pid)
{
    if (report.size() != 19 || report[0] != 0x07) {
        return {Status::bad_report};
    }
    // On 1412 the RF-disconnect marker is witnessed on air, not on cable.
    // Silence and invalid frames do not imply a disconnect.
    if (pid == 0x1412 && (report[1] & 0x0f) == 0 && report[18] == 0x7f)
        return {Status::offline, {}, 0x07};
    // A HUB independently maps 1421 to the same passive Input 07 decoder.
    // Only report current battery for the wireless, RF-connected shape
    // documented for this shared report layout. An uncertain link or power
    // state is not evidence that this exact mouse is offline.
    if (pid == 0x1421 && (report[7] < 1 || report[7] > 3 ||
        (report[1] & 0x0f) != 0 || (report[18] & 0x80) == 0))
        return {Status::unavailable, {}, 0x07};
    if (report[8] > 100) return {Status::bad_report};
    const auto power = report[7] == 1 ? Power::discharging :
        report[7] == 2 || report[7] == 3 ? Power::charging : Power::unknown;
    return {Status::current, Reading{report[8], report[8], power, report[8]}, 0x07};
}

enum class RapooDetail : unsigned {
    descriptorMismatch = 1, noFreshReport, invalidReport, openFailed, readFailed, ambiguousCollection,
};

class RapooBatteryReader {
public:
    RapooBatteryReader();
    ~RapooBatteryReader();
    // Caller proves unique FF00:0002 across all interfaces of the physical USB receiver.
    Sample read(const std::wstring& path);
    void retainPaths(const std::set<std::wstring>& active);
private:
    struct Endpoint;
    std::map<std::wstring, std::unique_ptr<Endpoint>> endpoints_;
};

} // namespace pm
