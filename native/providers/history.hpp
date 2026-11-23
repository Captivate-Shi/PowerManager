#pragma once
#include "battery.hpp"

#include <cstdint>
#include <filesystem>
#include <map>
#include <string>
#include <vector>

namespace pm {

struct HistoryPoint {
    std::int64_t time;
    std::optional<Reading> reading;
};

std::int64_t historyNow();

class BatteryHistory {
public:
    explicit BatteryHistory(std::filesystem::path directory);
    void record(const std::wstring& key, std::optional<Reading> reading, std::int64_t time);
    void merge(const std::wstring& oldKey, const std::wstring& key);
    const std::vector<HistoryPoint>& forDevice(const std::wstring& key) const;
    bool save(std::int64_t now);

private:
    void prune(std::int64_t now);
    std::filesystem::path file_;
    std::map<std::wstring, std::vector<HistoryPoint>> points_;
    bool dirty_{};
};

} // namespace pm
