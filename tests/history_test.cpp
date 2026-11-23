#include "history.hpp"

#include <windows.h>
#include <cassert>

int main()
{
    using namespace pm;
    auto directory = std::filesystem::temp_directory_path() /
        (L"PowerManager-history-test-" + std::to_wstring(GetCurrentProcessId()) + L"-" +
         std::to_wstring(GetTickCount64()));
    assert(std::filesystem::create_directory(directory));
    const auto now = historyNow();
    const std::wstring oldKey = L"dualsense-path:usb\\port";
    const std::wstring key = L"dualsense:controller";
    {
        BatteryHistory history(directory);
        history.record(oldKey, Reading{60, 69, Power::discharging, 6}, now - 300);
        history.record(oldKey, {}, now - 240);
        history.record(oldKey, {}, now - 220);
        history.record(key, Reading{42, 42, Power::charging, 42, ReadingSource::windows}, now - 100);
        history.record(L"expired", Reading{90, 90, Power::discharging, 90}, now - 86401);
        history.merge(oldKey, key);
        assert(history.save(now));
    }
    {
        const BatteryHistory history(directory);
        const auto& points = history.forDevice(key);
        assert(points.size() == 3);
        assert(points[0].reading->low == 60 && points[0].reading->high == 69);
        assert(!points[1].reading);
        assert(points[2].reading->power == Power::charging && points[2].reading->source == ReadingSource::windows);
        assert(history.forDevice(oldKey).empty());
        assert(history.forDevice(L"expired").empty());
    }
    assert(std::filesystem::remove(directory / L"battery-history-v1.txt"));
    assert(std::filesystem::remove(directory));
}
