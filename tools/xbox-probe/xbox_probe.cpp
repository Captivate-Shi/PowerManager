// Standalone lab harness; not part of the PowerManager build or installer.
#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <cfgmgr32.h>
#include <setupapi.h>
#include <xinput.h>
#include <GameInput.h>
#include <wrl/client.h>
#include <initguid.h>
#include <devpkey.h>

#include "sample_gate.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <charconv>
#include <cstdio>
#include <cwctype>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>

static_assert(GAMEINPUT_API_VERSION == 4, "This probe targets GameInput v4.");
using namespace GameInput::v4;
using Microsoft::WRL::ComPtr;

namespace {

bool knownGuid(const GUID& id)
{
    const GUID empty{};
    return !InlineIsEqualGUID(id, empty);
}

std::optional<GUID> nodeContainer(DEVINST node)
{
    GUID id{};
    DEVPROPTYPE type{};
    ULONG size = sizeof(id);
    if (CM_Get_DevNode_PropertyW(node, &DEVPKEY_Device_ContainerId, &type,
        reinterpret_cast<PBYTE>(&id), &size, 0) != CR_SUCCESS ||
        type != DEVPROP_TYPE_GUID || size != sizeof(id) || !knownGuid(id)) return {};
    return id;
}

enum class Link { bluetooth, adapter };
struct Identity {
    std::wstring path;
    GUID container;
    Link link;
};

std::optional<Identity> physicalIdentity(IGameInputDevice& device)
{
    if (device.GetVendorId() != 0x045e || !device.IsConnected()) return {};
    GUID reported{};
    device.GetContainerId(&reported);
    if (!knownGuid(reported)) return {};
    std::array<char, 2048> utf8{};
    const auto size = device.GetPnpPath(0, nullptr);
    if (size < 2 || size > utf8.size() || device.GetPnpPath(size, utf8.data()) != size ||
        utf8[size - 1] != '\0') return {};
    std::array<wchar_t, 2048> utf16{};
    const auto units = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, utf8.data(),
        static_cast<int>(size), utf16.data(), static_cast<int>(utf16.size()));
    if (units < 2 || std::wstring_view(utf16.data(), units - 1).find(L'\0') != std::wstring_view::npos) return {};

    const auto set = SetupDiCreateDeviceInfoList(nullptr, nullptr);
    if (set == INVALID_HANDLE_VALUE) return {};
    struct InfoSet {
        HDEVINFO set;
        ~InfoSet() { SetupDiDestroyDeviceInfoList(set); }
    } close{set};
    SP_DEVICE_INTERFACE_DATA iface{};
    iface.cbSize = sizeof(iface);
    if (!SetupDiOpenDeviceInterfaceW(set, utf16.data(), 0, &iface) || !(iface.Flags & SPINT_ACTIVE)) return {};
    SP_DEVINFO_DATA dev{};
    dev.cbSize = sizeof(dev);
    alignas(SP_DEVICE_INTERFACE_DETAIL_DATA_W) std::array<BYTE, 4096> storage{};
    auto* detail = reinterpret_cast<SP_DEVICE_INTERFACE_DETAIL_DATA_W*>(storage.data());
    detail->cbSize = sizeof(SP_DEVICE_INTERFACE_DETAIL_DATA_W);
    if (!SetupDiGetDeviceInterfaceDetailW(set, &iface, detail, static_cast<DWORD>(storage.size()), nullptr, &dev)) return {};
    const auto actual = nodeContainer(dev.DevInst);
    if (!actual || !InlineIsEqualGUID(reported, *actual)) return {};

    auto node = dev.DevInst;
    for (unsigned depth = 0; depth < 32; ++depth) {
        std::array<wchar_t, MAX_DEVICE_ID_LEN> id{};
        if (CM_Get_Device_IDW(node, id.data(), static_cast<ULONG>(id.size()), 0) != CR_SUCCESS) break;
        std::wstring value(id.data());
        std::ranges::transform(value, value.begin(), [](wchar_t c) { return std::towlower(c); });
        if (value.starts_with(L"bthledevice\\") || value.starts_with(L"bthenum\\")) {
            const auto container = nodeContainer(node);
            if (container && InlineIsEqualGUID(*container, *actual))
                return Identity{std::wstring(utf16.data(), units - 1), *actual, Link::bluetooth};
        }
        const auto adapter = [&](std::wstring_view prefix) {
            if (!value.starts_with(prefix) || value.size() <= prefix.size()) return false;
            return value[prefix.size()] == L'&' || value[prefix.size()] == L'\\';
        };
        // Two Microsoft adapter hardware IDs; the child may never borrow the adapter container.
        if (adapter(L"usb\\vid_045e&pid_02e6") || adapter(L"usb\\vid_045e&pid_02fe")) {
            const auto parent = nodeContainer(node);
            if (parent && !InlineIsEqualGUID(*parent, *actual))
                return Identity{std::wstring(utf16.data(), units - 1), *actual, Link::adapter};
            break;
        }
        DEVINST parent{};
        if (CM_Get_Parent(&parent, node, 0) != CR_SUCCESS || parent == node) break;
        node = parent;
    }
    return {};
}

struct Entry { ComPtr<IGameInputDevice> device; unsigned label{}; };
using Entries = std::array<Entry, 32>;
struct Context {
    std::mutex mutex;
    Entries entries;
    std::atomic<std::uint64_t> generation{};
    std::atomic<unsigned> activeCallbacks{};
    std::atomic<bool> overflow{};
    unsigned nextLabel{};
};

void CALLBACK onDevice(GameInputCallbackToken, void* ptr, GameInputDeviceEvent event, IGameInputDevice* device)
{
    auto& ctx = *static_cast<Context*>(ptr);
    // Treat a callback waiting to update the list as an in-flight change too.
    struct InFlight {
        Context& ctx;
        explicit InFlight(Context& value) : ctx(value) { ++ctx.activeCallbacks; ++ctx.generation; }
        ~InFlight() { --ctx.activeCallbacks; }
    } inFlight{ctx};
    std::scoped_lock lock(ctx.mutex);
    if (!device) return;
    const auto it = std::ranges::find_if(ctx.entries, [&](const auto& e) { return e.device.Get() == device; });
    if (event == GameInputDeviceEventDisconnected) {
        if (it != ctx.entries.end()) *it = {};
    } else if (device->IsConnected() && it == ctx.entries.end()) {
        const auto empty = std::ranges::find_if(ctx.entries, [](const auto& e) { return !e.device; });
        if (empty == ctx.entries.end()) ctx.overflow = true;
        else {
            empty->device = device;
            empty->label = ++ctx.nextLabel;
        }
    }
}

std::optional<unsigned> uniqueSlot(IGameInputDevice& device, const Entries& entries)
{
    std::uint32_t slot{};
    if (!device.IsConnected() || !device.GetXInputDeviceIndex(&slot) || slot >= XUSER_MAX_COUNT) return {};
    for (const auto& other : entries) {
        std::uint32_t candidate{};
        if (other.device && other.device.Get() != &device && other.device->IsConnected() &&
            other.device->GetXInputDeviceIndex(&candidate) && candidate == slot) return {};
    }
    return slot;
}

bool uniqueContainer(IGameInputDevice& device, const Entries& entries, const Identity& identity)
{
    for (const auto& other : entries) {
        GUID id{};
        if (!other.device || other.device.Get() == &device || !other.device->IsConnected()) continue;
        other.device->GetContainerId(&id);
        if (InlineIsEqualGUID(id, identity.container)) return false;
    }
    return true;
}

const char* format(pm_xbox_probe::Observation obs)
{
    using namespace pm_xbox_probe;
    switch (obs.result) {
    case Result::no_binding: return "no_unique_slot";
    case Result::changed: return "binding_changed";
    case Result::call_failed: return "xinput_call_failed";
    case Result::unsupported_battery: return "no_supported_wireless_battery";
    case Result::invalid_level: return "invalid_level";
    case Result::observed: {
        constexpr const char* names[]{"empty", "low", "medium", "full"};
        return names[static_cast<unsigned>(*obs.level)];
    }
    }
    return "unavailable";
}
}

int main(int argc, char** argv)
{
    unsigned rounds = 20;
    if (argc > 2) return 2;
    if (argc == 2) {
        std::string_view arg(argv[1]);
        auto result = std::from_chars(arg.data(), arg.data() + arg.size(), rounds);
        if (result.ec != std::errc{} || result.ptr != arg.data() + arg.size() || rounds < 1 || rounds > 60) return 2;
    }
    Context ctx;
    ComPtr<IGameInput> input;
    if (FAILED(GameInputCreate(input.GetAddressOf())) || !input) {
        std::fputs("GameInput v4 initialization unavailable\n", stderr);
        return 3;
    }
    GameInputCallbackToken token{};
    if (FAILED(input->RegisterDeviceCallback(nullptr, GameInputKindGamepad, &ctx, onDevice, &token))) {
        std::fputs("GameInput callback registration unavailable\n", stderr);
        return 3;
    }
    struct Subscription {
        IGameInput& input;
        GameInputCallbackToken token;
        ~Subscription() { input.UnregisterCallback(token); }
    } subscription{*input.Get(), token};
    // Initial enumeration is asynchronous; no snapshot asserts a complete census.
    Sleep(1000);
    for (unsigned round = 1; round <= rounds; ++round) {
        Entries entries;
        std::uint64_t generation{};
        {
            std::scoped_lock lock(ctx.mutex);
            entries = ctx.entries;
            generation = ctx.generation.load();
        }
        if (ctx.overflow) {
            std::fputs("GameInput census overflow, stopped\n", stderr);
            return 4;
        }
        bool found = false;
        for (const auto& e : entries) {
            if (!e.device || !e.device->IsConnected() || e.device->GetVendorId() != 0x045e) continue;
            found = true;
            const auto pid = static_cast<unsigned>(e.device->GetProductId());
            const auto before = physicalIdentity(*e.device.Get());
            if (!before || !uniqueContainer(*e.device.Get(), entries, *before)) {
                std::printf("%u Pad%u 045e:%04x physical_binding_unproven\n", round, e.label, pid);
                continue;
            }
            const auto slot = uniqueSlot(*e.device.Get(), entries);
            if (ctx.activeCallbacks.load() || ctx.generation.load() != generation || !slot) {
                std::printf("%u Pad%u 045e:%04x slot_binding_unproven\n", round, e.label, pid);
                continue;
            }
            XINPUT_BATTERY_INFORMATION raw{};
            const auto error = XInputGetBatteryInformation(*slot, BATTERY_DEVTYPE_GAMEPAD, &raw);
            const auto after = physicalIdentity(*e.device.Get());
            const auto secondSlot = uniqueSlot(*e.device.Get(), entries);
            const bool same = after && before->link == after->link && before->path == after->path &&
                InlineIsEqualGUID(before->container, after->container);
            const bool verified = after && secondSlot && uniqueContainer(*e.device.Get(), entries, *after) &&
                ctx.activeCallbacks.load() == 0;
            const auto sample = pm_xbox_probe::observe({generation, *slot, true},
                {ctx.generation.load(), secondSlot.value_or(XUSER_MAX_COUNT), verified},
                same, error == ERROR_SUCCESS, raw.BatteryType, raw.BatteryLevel);
            std::printf("%u Pad%u 045e:%04x %s %s\n", round, e.label, pid,
                before->link == Link::bluetooth ? "bluetooth" : "adapter", format(sample));
        }
        if (!found) std::printf("%u no_microsoft_gamepad_seen\n", round);
        if (round < rounds) Sleep(1000);
    }
}
