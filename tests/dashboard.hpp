#pragma once
#include "hid.hpp"
#include "history.hpp"

#include <windows.h>
#include <functional>
#include <memory>

namespace pm {

enum class DeviceArt { unknown, mouse, keyboard, dualsense, xbox, controller, headset, earbuds, stylus };
DeviceArt classifyDevice(Transport transport, std::wstring name);

struct DashboardDevice {
    Transport transport;
    Status status;
    std::optional<Reading> lastReading;
    std::wstring lastReadAt;
    std::wstring customName{};
    std::wstring key{};
    std::wstring connection{};
    DeviceArt art{};

    bool connected() const { return status != Status::offline && status != Status::no_radio_reply; }
    bool fresh() const { return status == Status::current && lastReading.has_value(); }
    bool low(int threshold) const;
    std::wstring name() const;
};

struct DashboardState {
    std::vector<DashboardDevice> devices;
    int lowThreshold = 20;
    bool paused = false;
    bool refreshing = false;
    int criticalThreshold = 10;
    bool fullscreenSound = true;
    bool startup = false;
    bool voltageExperiment = false;
    bool developerMode = false;
};

enum class DashboardAction {
    refresh, search, pause, open, openDevice,
    toggleStartup, toggleVoltage, toggleDeveloper, previewLow, previewCritical
};
struct ReminderOptions { Thresholds levels; bool fullscreenSound; };
enum class DashboardSurface { main, tray, toast };

class Dashboard {
public:
    using Action = std::function<void(DashboardAction, const std::wstring&)>;
    using History = std::function<const std::vector<HistoryPoint>&(const std::wstring&)>;
    using SaveReminders = std::function<bool(const ReminderOptions&)>;
    Dashboard(HINSTANCE instance, Action action, History history = {}, SaveReminders save = {});
    ~Dashboard();
    HWND window() const;
    void show();
    void showDevice(const std::wstring& key);
    void remapDevice(const std::wstring& from, const std::wstring& to);
    void showTray(RECT anchor);
    bool showToast(const DashboardDevice& device, Alert level, HMONITOR monitor, bool preview = false);
    void close();
    void update(DashboardState state);

private:
    struct View;
    std::unique_ptr<View> view_;
};

} // namespace pm
