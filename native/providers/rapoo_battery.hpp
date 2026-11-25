#pragma once

#include "battery.hpp"

#include <map>
#include <memory>
#include <set>
#include <string>

namespace pm {

constexpr bool isRapooReceiver(unsigned vid, unsigned pid)
{
    return vid == 0x24ae && pid == 0x1411;
}

constexpr bool isRapooBatteryCollection(unsigned page, unsigned usage, unsigned inputLength)
{
    return page == 0xff00 && usage == 0x0002 && inputLength == 19;
}

// Evidence: A HUB's passive report 07; pinned downstream decoder and hardware
// capture described in Rapoo provider docs. No inference from other VT PIDs.
constexpr Sample parseRapooBatteryReport(std::span<const std::uint8_t> report)
{
    if (report.size() != 19 || report[0] != 0x07 || report[8] > 100) {
        return {Status::bad_report};
    }
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
