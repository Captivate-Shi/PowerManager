#include "gamepad_battery.hpp"

#include <windows.h>
#include <xinput.h>

#include <algorithm>
#include <bit>
#include <memory>

#include <inspectable.h>
#include <roapi.h>
#include <winstring.h>

namespace pm {
namespace {

using XInputBattery = DWORD (WINAPI *)(DWORD, BYTE, XINPUT_BATTERY_INFORMATION*);

void inspectXInput(GamepadBatteryInventory& result)
{
    // XInput 1.4 is in the supported Windows OS; never load a copy beside the app.
    const auto module = LoadLibraryExW(L"xinput1_4.dll", nullptr, LOAD_LIBRARY_SEARCH_SYSTEM32);
    if (!module) return;
    struct Library {
        HMODULE module;
        ~Library() { FreeLibrary(module); }
    } library{module};
    const auto fn = std::bit_cast<XInputBattery>(GetProcAddress(module, "XInputGetBatteryInformation"));
    if (!fn) return;

    result.xinputStatus = "ok";
    for (DWORD slot = 0; slot < XUSER_MAX_COUNT; ++slot) {
        XINPUT_BATTERY_INFORMATION sample{};
        const auto code = fn(slot, BATTERY_DEVTYPE_GAMEPAD, &sample);
        if (code == ERROR_SUCCESS) {
            result.xinput.push_back(classifyXInputBattery(slot, sample.BatteryType, sample.BatteryLevel));
        } else {
            result.xinput.push_back({.slot = slot, .detail = code,
                .status = code == ERROR_DEVICE_NOT_CONNECTED ? GamepadBatteryStatus::disconnected :
                                                               GamepadBatteryStatus::api_error});
        }
    }
}

// The generated MinGW 13 Windows.Foundation header in w64devkit has
// colliding Boolean and UINT8 template specializations in C++ mode.
// Keep only the COM ABI slots used here. Order and IDs are from the tagged
// MinGW generated windows.gaming.input.h, windows.devices.power.h and
// windows.foundation.h. Unused entries below exist only to preserve order.
namespace abi {
struct BoxedInt32 : IInspectable {
    virtual HRESULT STDMETHODCALLTYPE get_Value(INT32*) = 0;
};
struct BatteryReport : IInspectable {
    virtual HRESULT STDMETHODCALLTYPE get_ChargeRateInMilliwatts(BoxedInt32**) = 0;
    virtual HRESULT STDMETHODCALLTYPE get_DesignCapacityInMilliwattHours(BoxedInt32**) = 0;
    virtual HRESULT STDMETHODCALLTYPE get_FullChargeCapacityInMilliwattHours(BoxedInt32**) = 0;
    virtual HRESULT STDMETHODCALLTYPE get_RemainingCapacityInMilliwattHours(BoxedInt32**) = 0;
    virtual HRESULT STDMETHODCALLTYPE get_Status(INT32*) = 0;
};
struct ControllerBatteryInfo : IInspectable {
    virtual HRESULT STDMETHODCALLTYPE TryGetBatteryReport(BatteryReport**) = 0;
};
struct RawController : IInspectable {
    virtual HRESULT STDMETHODCALLTYPE get_AxisCount(INT32*) = 0;
    virtual HRESULT STDMETHODCALLTYPE get_ButtonCount(INT32*) = 0;
    virtual HRESULT STDMETHODCALLTYPE get_ForceFeedbackMotors(IInspectable**) = 0;
    virtual HRESULT STDMETHODCALLTYPE get_HardwareProductId(UINT16*) = 0;
    virtual HRESULT STDMETHODCALLTYPE get_HardwareVendorId(UINT16*) = 0;
};
struct RawControllerVectorView : IInspectable {
    virtual HRESULT STDMETHODCALLTYPE GetAt(UINT32, RawController**) = 0;
    virtual HRESULT STDMETHODCALLTYPE get_Size(UINT32*) = 0;
};
struct EventRegistrationToken { INT64 value; };
struct RawControllerStatics : IInspectable {
    virtual HRESULT STDMETHODCALLTYPE add_RawGameControllerAdded(IInspectable*, EventRegistrationToken*) = 0;
    virtual HRESULT STDMETHODCALLTYPE remove_RawGameControllerAdded(EventRegistrationToken) = 0;
    virtual HRESULT STDMETHODCALLTYPE add_RawGameControllerRemoved(IInspectable*, EventRegistrationToken*) = 0;
    virtual HRESULT STDMETHODCALLTYPE remove_RawGameControllerRemoved(EventRegistrationToken) = 0;
    virtual HRESULT STDMETHODCALLTYPE get_RawGameControllers(RawControllerVectorView**) = 0;
};
constexpr GUID rawControllerStaticsId{0xeb8d0792, 0xe95a, 0x4b19,
    {0xaf, 0xc7, 0x0a, 0x59, 0xf8, 0xbf, 0x75, 0x9e}};
constexpr GUID batteryInfoId{0xdcecc681, 0x3963, 0x4da6,
    {0x95, 0x5d, 0x55, 0x3f, 0x3b, 0x6f, 0x61, 0x61}};
} // namespace abi

template<class T> inline auto comPtr(T* value)
{
    return std::unique_ptr<T, void(*)(T*)>(value, [](T* p) { p->Release(); });
}

using Capacity = HRESULT (STDMETHODCALLTYPE abi::BatteryReport::*)(abi::BoxedInt32**);
std::optional<int> capacity(abi::BatteryReport* report, Capacity getter)
{
    abi::BoxedInt32* raw = nullptr;
    const auto hr = (report->*getter)(&raw);
    auto boxed = comPtr(raw);
    INT32 value = 0;
    if (FAILED(hr) || !boxed || FAILED(boxed->get_Value(&value))) return {};
    return value;
}

void inspectWgi(GamepadBatteryInventory& result)
{
    const wchar_t name[] = L"Windows.Gaming.Input.RawGameController";
    HSTRING classId = nullptr;
    HSTRING_HEADER header{};
    if (FAILED(WindowsCreateStringReference(name, ARRAYSIZE(name)-1, &header, &classId))) {
        result.wgiStatus = "string_error";
        return;
    }
    abi::RawControllerStatics* rawFactory = nullptr;
    const auto factoryHr = RoGetActivationFactory(classId, abi::rawControllerStaticsId,
        reinterpret_cast<void**>(&rawFactory));
    auto factory = comPtr(rawFactory);
    if (FAILED(factoryHr) || !factory) {
        result.wgiStatus = "activation_failed";
        return;
    }
    abi::RawControllerVectorView* rawControllers = nullptr;
    const auto listHr = factory->get_RawGameControllers(&rawControllers);
    auto controllers = comPtr(rawControllers);
    UINT32 count = 0;
    if (FAILED(listHr) || !controllers || FAILED(controllers->get_Size(&count))) {
        result.wgiStatus = "enumeration_failed";
        return;
    }
    result.wgiStatus = count > 16 ? "truncated" : "ok";
    for (UINT32 index = 0; index < std::min<UINT32>(count, 16); ++index) {
        GamepadBatteryObservation observation{.slot = index};
        abi::RawController* raw = nullptr;
        const auto controllerHr = controllers->GetAt(index, &raw);
        auto controller = comPtr(raw);
        if (FAILED(controllerHr) || !controller) {
            observation.status = GamepadBatteryStatus::api_error;
            observation.detail = static_cast<unsigned>(controllerHr);
        } else {
            UINT16 vendor = 0, product = 0;
            if (SUCCEEDED(controller->get_HardwareVendorId(&vendor))) observation.vid = vendor;
            if (SUCCEEDED(controller->get_HardwareProductId(&product))) observation.pid = product;
            abi::ControllerBatteryInfo* rawInfo = nullptr;
            const auto infoHr = controller->QueryInterface(abi::batteryInfoId,
                reinterpret_cast<void**>(&rawInfo));
            auto info = comPtr(rawInfo);
            if (SUCCEEDED(infoHr) && info) {
                abi::BatteryReport* rawReport = nullptr;
                const auto reportHr = info->TryGetBatteryReport(&rawReport);
                auto report = comPtr(rawReport);
                if (FAILED(reportHr)) {
                    observation.status = GamepadBatteryStatus::api_error;
                    observation.detail = static_cast<unsigned>(reportHr);
                } else if (report) {
                    INT32 status{};
                    const auto statusHr = report->get_Status(&status);
                    if (FAILED(statusHr)) {
                        observation.status = GamepadBatteryStatus::api_error;
                        observation.detail = static_cast<unsigned>(statusHr);
                    } else {
                        applyGamingInputBattery(observation, static_cast<unsigned>(status),
                            capacity(report.get(), &abi::BatteryReport::get_RemainingCapacityInMilliwattHours),
                            capacity(report.get(), &abi::BatteryReport::get_FullChargeCapacityInMilliwattHours));
                    }
                }
            } else if (infoHr != E_NOINTERFACE) {
                observation.status = GamepadBatteryStatus::api_error;
                observation.detail = static_cast<unsigned>(infoHr);
            }
        }
        result.windowsGamingInput.push_back(observation);
    }
}

} // namespace

GamepadBatteryInventory inspectGamepadBatteries()
{
    GamepadBatteryInventory result;
    inspectWgi(result);
    inspectXInput(result);
    return result;
}

} // namespace pm
