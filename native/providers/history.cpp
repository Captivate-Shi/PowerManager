#include "history.hpp"

#include <windows.h>
#include <algorithm>
#include <chrono>
#include <fstream>
#include <iomanip>
#include <sstream>

namespace pm {
namespace {
constexpr auto day = 24 * 60 * 60;
constexpr std::size_t pointLimit = 4320;
}

std::int64_t historyNow()
{
    return std::chrono::duration_cast<std::chrono::seconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
}

BatteryHistory::BatteryHistory(std::filesystem::path directory)
{
    if (directory.empty()) return;
    file_ = directory / L"battery-history-v1.txt";
    std::wifstream input(file_);
    std::wstring line;
    const auto now = historyNow();
    while (std::getline(input, line)) {
        std::wistringstream fields(line);
        std::wstring key;
        std::int64_t time{};
        int low{}, high{}, power{}, source{};
        if (!(fields >> std::quoted(key) >> time >> low >> high >> power) ||
            time < now - day || time > now) continue;
        fields >> source;
        if (low == -1) record(key, {}, time);
        else if (low >= 0 && high >= low && high <= 100 && power >= 0 && power <= 3)
            record(key, Reading{low, high, static_cast<Power>(power), 0,
                                source == 1 ? ReadingSource::windows : ReadingSource::hid}, time);
    }
}

void BatteryHistory::record(const std::wstring& key, std::optional<Reading> reading, std::int64_t time)
{
    if (key.empty() || (!reading && !points_.contains(key))) return;
    auto& points = points_[key];
    while (!points.empty() && points.back().time > time) {
        points.pop_back();
        dirty_ = true;
    }
    if (!reading && (points.empty() || !points.back().reading)) return;
    if (reading && !points.empty() && points.back().reading && time - points.back().time < 20) {
        const auto& previous = *points.back().reading;
        if (reading->low == previous.low && reading->high == previous.high && reading->power == previous.power)
            return;
    }
    if (points.size() >= pointLimit) points.erase(points.begin(), points.begin() + 120);
    points.push_back({time, reading});
    dirty_ = true;
}

void BatteryHistory::merge(const std::wstring& oldKey, const std::wstring& key)
{
    if (oldKey == key) return;
    auto old = points_.extract(oldKey);
    if (old.empty()) return;
    auto& points = points_[key];
    points.insert(points.end(), old.mapped().begin(), old.mapped().end());
    std::stable_sort(points.begin(), points.end(), [](const auto& a, const auto& b) { return a.time < b.time; });
    if (points.size() > pointLimit) points.erase(points.begin(), points.end() - pointLimit);
    dirty_ = true;
}

const std::vector<HistoryPoint>& BatteryHistory::forDevice(const std::wstring& key) const
{
    static const std::vector<HistoryPoint> empty;
    const auto it = points_.find(key);
    return it == points_.end() ? empty : it->second;
}

void BatteryHistory::prune(std::int64_t now)
{
    for (auto it = points_.begin(); it != points_.end();) {
        auto& points = it->second;
        const auto removed = std::erase_if(points, [now](const auto& point) {
            return point.time < now - day || point.time > now;
        });
        dirty_ |= removed != 0;
        if (points.empty()) it = points_.erase(it);
        else ++it;
    }
}

bool BatteryHistory::save(std::int64_t now)
{
    prune(now);
    if (!dirty_ || file_.empty()) return true;
    auto temporary = file_;
    temporary += L".tmp";
    std::wofstream output(temporary, std::ios::trunc);
    // Canonical device keys contain ASCII PnP identifiers, encoded punctuation, or GUIDs.
    for (const auto& [key, points] : points_) {
        for (const auto& point : points) {
            const auto& level = point.reading;
            output << std::quoted(key) << L' ' << point.time << L' '
                   << (level ? level->low : -1) << L' ' << (level ? level->high : -1) << L' '
                   << (level ? static_cast<int>(level->power) : 0) << L' '
                   << (level ? static_cast<int>(level->source) : 0) << L'\n';
        }
    }
    output.close();
    if (!output || !MoveFileExW(temporary.c_str(), file_.c_str(), MOVEFILE_REPLACE_EXISTING)) return false;
    dirty_ = false;
    return true;
}

} // namespace pm
