#include "gamepad_battery.hpp"

#include <windows.h>
#include <xinput.h>

#include <algorithm>
#include <bit>
#include <memory>

#if __has_include(<windows.gaming.input.h>) && __has_include(<windows.devices.power.h>)
#define PM_HAS_WINDOWS_GAMING_INPUT 1
#include <roapi.h>
#include <winstring.h>
#include <windows.gaming.input.h>
#endif

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

#ifdef PM_HAS_WINDOWS_GAMING_INPUT
namespace wgi = ABI::Windows::Gaming::Input;
namespace foundation = ABI::Windows::Foundation;
namespace systemPower = ABI::Windows::System::Power;
namespace devicePower = ABI::Windows::Devices::Power;

template<class T> inline auto comPtr(T* value)
{
    return std::unique_ptr<T, void(*)(T*)>(value, [](T* p) { p->Release(); });
}

using Capacity = HRESULT (STDMETHODCALLTYPE devicePower::IBatteryReport::*)(foundation::IReference<INT32>**);
std::optional<int> capacity(devicePower::IBatteryReport* report, Capacity getter)
{
    foundation::IReference<INT32>* raw = nullptr;
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
    wgi::IRawGameControllerStatics* rawFactory = nullptr;
    const auto factoryHr = RoGetActivationFactory(classId, __uuidof(wgi::IRawGameControllerStatics),
        reinterpret_cast<void**>(&rawFactory));
    auto factory = comPtr(rawFactory);
    if (FAILED(factoryHr) || !factory) {
        result.wgiStatus = "activation_failed";
        return;
    }
    foundation::Collections::IVectorView<wgi::RawGameController*>* rawControllers = nullptr;
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
        wgi::IRawGameController* raw = nullptr;
        const auto controllerHr = controllers->GetAt(index, &raw);
        auto controller = comPtr(raw);
        if (FAILED(controllerHr) || !controller) {
            observation.status = GamepadBatteryStatus::api_error;
            observation.detail = static_cast<unsigned>(controllerHr);
        } else {
            UINT16 vendor = 0, product = 0;
            if (SUCCEEDED(controller->get_HardwareVendorId(&vendor))) observation.vid = vendor;
            if (SUCCEEDED(controller->get_HardwareProductId(&product))) observation.pid = product;
            wgi::IGameControllerBatteryInfo* rawInfo = nullptr;
            const auto infoHr = controller->QueryInterface(__uuidof(wgi::IGameControllerBatteryInfo),
                reinterpret_cast<void**>(&rawInfo));
            auto info = comPtr(rawInfo);
            if (SUCCEEDED(infoHr) && info) {
                devicePower::IBatteryReport* rawReport = nullptr;
                const auto reportHr = info->TryGetBatteryReport(&rawReport);
                auto report = comPtr(rawReport);
                if (FAILED(reportHr)) {
                    observation.status = GamepadBatteryStatus::api_error;
                    observation.detail = static_cast<unsigned>(reportHr);
                } else if (report) {
                    systemPower::BatteryStatus status{};
                    const auto statusHr = report->get_Status(&status);
                    if (FAILED(statusHr)) {
                        observation.status = GamepadBatteryStatus::api_error;
                        observation.detail = static_cast<unsigned>(statusHr);
                    } else {
                        applyGamingInputBattery(observation, static_cast<unsigned>(status),
                            capacity(report.get(), &devicePower::IBatteryReport::get_RemainingCapacityInMilliwattHours),
                            capacity(report.get(), &devicePower::IBatteryReport::get_FullChargeCapacityInMilliwattHours));
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
#endif

} // namespace

GamepadBatteryInventory inspectGamepadBatteries()
{
    GamepadBatteryInventory result;
#ifdef PM_HAS_WINDOWS_GAMING_INPUT
    inspectWgi(result);
#else
    result.wgiStatus = "sdk_headers_unavailable";
#endif
    inspectXInput(result);
    return result;
}

} // namespace pm
