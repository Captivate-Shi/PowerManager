#include <atomic>
#include "hid.hpp"
#include "langtu_t98.hpp"
#include "headset_battery.hpp"
#include "verified_mouse.hpp"
#include "atk_v75x.hpp"
#include "razer_pro_receiver.hpp"
#include "razer_collection_fallback.hpp"
#include "battery_fallback.hpp"
#include "rog_keyboard_battery.hpp"
#include "cn_mouse_codecs.hpp"
#include "cn_tail_codecs.hpp"
#include "gamesir_battery.hpp"
#include "gamepad_vendor_battery.hpp"
#include "peripheral_protocol.hpp"
#include "device_identity.hpp"
#include "device_search.hpp"

#include <windows.h>
#include <combaseapi.h>
#include <cfgmgr32.h>
#include <initguid.h>
#include <devpkey.h>
extern "C" {
#include <hidsdi.h>
#include <hidpi.h>
}
#include <setupapi.h>
#include <winioctl.h>

#include <algorithm>
#include <chrono>
#include <cwctype>
#include <tuple>

namespace pm {
namespace {

constexpr DWORD setFeature = CTL_CODE(FILE_DEVICE_KEYBOARD, 100, METHOD_IN_DIRECT, FILE_ANY_ACCESS);
constexpr DWORD getFeature = CTL_CODE(FILE_DEVICE_KEYBOARD, 100, METHOD_OUT_DIRECT, FILE_ANY_ACCESS);
// HIDClass output SET_REPORT over the control endpoint.
constexpr DWORD setOutputReport = CTL_CODE(FILE_DEVICE_KEYBOARD, 101, METHOD_IN_DIRECT, FILE_ANY_ACCESS);
constexpr DEVPROPKEY batteryLife{{0x49cd1f76, 0x5626, 0x4b17,
    {0xa4, 0xe8, 0x18, 0xb4, 0xaa, 0x1a, 0x22, 0x13}}, 10};
constexpr DWORD sharing = FILE_SHARE_READ | FILE_SHARE_WRITE;
using Clock = std::chrono::steady_clock;
using namespace std::chrono_literals;

struct Handle {
    HANDLE value;
    ~Handle() { if (valid()) CloseHandle(value); }
    bool valid() const { return value && value != INVALID_HANDLE_VALUE; }
    Handle(HANDLE handle) : value(handle) {}
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
};

struct DeviceSet {
    HDEVINFO value;
    ~DeviceSet() { if (value != INVALID_HANDLE_VALUE) SetupDiDestroyDeviceInfoList(value); }
};

std::wstring lower(std::wstring value)
{
    for (auto& c : value) {
        c = static_cast<wchar_t>(std::towlower(c));
    }
    return value;
}

std::wstring nodeId(DEVINST node)
{
    wchar_t value[MAX_DEVICE_ID_LEN]{};
    if (CM_Get_Device_IDW(node, value, MAX_DEVICE_ID_LEN, 0) != CR_SUCCESS) {
        return {};
    }
    return lower(value);
}

std::wstring deviceKey(DEVINST node, Transport transport, const std::wstring& fallback)
{
    DEVPROPTYPE type{};
    GUID container{};
    ULONG size = sizeof(container);
    std::wstring identity;
    if (CM_Get_DevNode_PropertyW(node, &DEVPKEY_Device_ContainerId, &type,
                               reinterpret_cast<PBYTE>(&container), &size, 0) == CR_SUCCESS
        && type == DEVPROP_TYPE_GUID && container.Data1 != 0 && container.Data1 != 0xffffffff) {
        wchar_t value[40]{};
        if (StringFromGUID2(container, value, 40)) {
            identity = value;
        }
    }
    if (identity.empty()) {
        DEVINST ancestor = node;
        for (int depth = 0; depth < 8; ++depth) {
            const auto id = nodeId(ancestor);
            if (identity.empty()) {
                identity = id;
            }
            if (id.starts_with(L"usb\\vid_") && id.find(L"&mi_") == std::wstring::npos) {
                identity = id;
                break;
            }
            if (CM_Get_Parent(&ancestor, ancestor, 0) != CR_SUCCESS) {
                break;
            }
        }
    }
    return std::to_wstring(static_cast<int>(transport)) + L":" +
           (identity.empty() ? fallback : identity);
}

std::optional<int> windowsBattery(DEVINST node)
{
    for (int depth = 0; depth < 8; ++depth) {
        DEVPROPTYPE type{};
        BYTE value{};
        ULONG size = sizeof(value);
        if (CM_Get_DevNode_PropertyW(node, &batteryLife, &type, &value, &size, 0) == CR_SUCCESS
            && type == DEVPROP_TYPE_BYTE && value <= 100) {
            return value;
        }
        if (CM_Get_Parent(&node, node, 0) != CR_SUCCESS) {
            break;
        }
    }
    return {};
}

std::wstring bluetoothIdentity(DEVINST node)
{
    for (int depth = 0; depth < 8; ++depth) {
        if (auto key = dualSenseBluetoothIdentity(nodeId(node)); !key.empty()) {
            return key;
        }
        DEVINST parent{};
        if (CM_Get_Parent(&parent, node, 0) != CR_SUCCESS) {
            break;
        }
        node = parent;
    }
    return {};
}

std::optional<unsigned> hexId(std::wstring_view path, std::wstring_view prefix, unsigned digits)
{
    const auto pos = path.find(prefix);
    if (pos == std::wstring_view::npos || pos + prefix.size() + digits > path.size()) return {};
    unsigned value = 0;
    for (const auto ch : path.substr(pos + prefix.size(), digits)) {
        if (ch >= L'0' && ch <= L'9') value = value * 16 + ch - L'0';
        else if (ch >= L'a' && ch <= L'f') value = value * 16 + ch - L'a' + 10;
        else return {};
    }
    return value;
}

constexpr bool extraSonyGamepad(unsigned pid)
{
    return pid == 0x05c4 || pid == 0x09cc || pid == 0x0df2;
}

constexpr const wchar_t* eightBitDoEnhancedName(unsigned pid)
{
    switch (pid) {
    case 0x6000: return L"8BitDo SF30 Pro";
    case 0x6001: return L"8BitDo SN30 Pro";
    case 0x6006: return L"8BitDo Pro 2";
    default: return nullptr;
    }
}

std::optional<Transport> candidate(const std::wstring& path)
{
    if (path.find(L"vid_1532&pid_00b8") != std::wstring::npos &&
        path.find(L"rzvirtual") == std::wstring::npos) {
        return Transport::razer_receiver;
    }
    if (path.find(L"vid_054c&pid_0ce6") != std::wstring::npos) {
        return Transport::dualsense_usb;
    }
    if (path.find(L"vid&0002054c_pid&0ce6") != std::wstring::npos) {
        return Transport::dualsense_bluetooth;
    }
    if (hexId(path, L"vid_", 4) == 0x054c && extraSonyGamepad(hexId(path, L"pid_", 4).value_or(0))) {
        return Transport::sony_gamepad_usb;
    }
    if (path.find(L"vid&0002054c_pid&") != std::wstring::npos &&
        extraSonyGamepad(hexId(path, L"vid&0002054c_pid&", 4).value_or(0))) {
        return Transport::sony_gamepad_bluetooth;
    }
    if (hexId(path, L"vid&00022dc8_pid&", 4) == 0x6009) {
        return Transport::eightbitdo_pro3_bluetooth;
    }
    constexpr std::wstring_view bluetoothHid = L"{00001124-0000-1000-8000-00805f9b34fb}";
    if (path.find(bluetoothHid) != std::wstring::npos) {
        if (eightBitDoEnhancedName(hexId(path, L"vid&00022dc8_pid&", 4).value_or(0)))
            return Transport::eightbitdo_enhanced_bluetooth;
        switch (hexId(path, L"vid&0002057e_pid&", 4).value_or(0)) {
        case 0x2009: return Transport::switch_pro_bluetooth;
        case 0x2006: return Transport::joycon_left_bluetooth;
        case 0x2007: return Transport::joycon_right_bluetooth;
        default: break;
        }
    }
    if (hexId(path, L"vid_", 4) == 0x2dc8 && hexId(path, L"pid_", 4) == 0x6009)
        return Transport::eightbitdo_pro3_usb;
    if (hexId(path, L"vid_", 4) == 0x3537 && hexId(path, L"pid_", 4) == 0x103e)
        return Transport::gamesir_super_nova_receiver;
    const auto vid = hexId(path, L"vid_", 4).value_or(0);
    const auto pid = hexId(path, L"pid_", 4).value_or(0);
    if (vid == 0x2dc8 && pid == 0x6012) return Transport::eightbitdo_ultimate2_candidate;
    if (vid == 0x1a2c && pid == 0x8fff) return Transport::langtu_t98_receiver;
    if (headset_battery::lane(vid, pid) != headset_battery::Lane::none)
        return Transport::usb_wireless_headset;
    if (const auto mouse = verified_mouse::kind(vid, pid))
        return verified_mouse::wireless(*mouse) ? Transport::verified_mouse_receiver : Transport::verified_mouse_usb;
    if (razerProReceiverName(vid, pid) && path.find(L"rzvirtual") == std::wstring::npos)
        return Transport::razer_pro_receiver;
    if (const auto pad = vendor_pad::match(vid, pid))
        return *pad == vendor_pad::Model::nova2LiteUsb ? Transport::gamepad_nova2_lite_usb
                                                      : Transport::gamepad_flydigi;
    if (vid == 0x3837 && pid == 0x4245) return Transport::mchose_g3v2_receiver;
    if (vid == 0x089d && pid == 0x062f) return Transport::aula_sc580_receiver;
    if (vid == 0x0c45 && pid == 0xfefe) return Transport::aula_f87v2d_receiver;
    if (vid == 0x3837 && pid == 0x4018) return Transport::mchose_a7v2pro_usb;
    if (vid == 0x0c45 && pid == 0xfefc) return Transport::ajazz_mk87pro_receiver;
    if (vid == 0x41e4 && pid == 0x2001) return Transport::mchose_g87_candidate;
    if (vid == 0x260d && pid == 0x1074) return Transport::dareu_em901x_inventory;
    if (vid == rog_keyboard::vendor && (pid == rog_keyboard::azothReceiver || pid == rog_keyboard::omniReceiver))
        return Transport::rog_keyboard_receiver;
    return peripheralTransport(hexId(path, L"vid_", 4).value_or(0), hexId(path, L"pid_", 4).value_or(0));
}

Sample ioFailure(DWORD error, unsigned report = 0)
{
    switch (error) {
    case ERROR_ACCESS_DENIED:
    case ERROR_SHARING_VIOLATION:
    case ERROR_BUSY: return {Status::busy, {}, report, error};
    case ERROR_DEVICE_NOT_CONNECTED:
    case ERROR_FILE_NOT_FOUND: return {Status::offline, {}, report, error};
    case ERROR_TIMEOUT:
    case ERROR_SEM_TIMEOUT: return {Status::timeout, {}, report, error};
    default: return {Status::unavailable, {}, report, error};
    }
}

template<class StartIo>
DWORD completeIo(HANDLE file, HANDLE event, Clock::time_point deadline, DWORD& bytes, StartIo start)
{
    if (deadline <= Clock::now()) {
        return ERROR_TIMEOUT;
    }
    ResetEvent(event);
    OVERLAPPED io{};
    io.hEvent = event;
    if (start(&io)) {
        return Clock::now() <= deadline ? ERROR_SUCCESS : ERROR_TIMEOUT;
    }
    const DWORD error = GetLastError();
    if (error != ERROR_IO_PENDING) {
        return error;
    }
    const auto remaining = std::max(Clock::duration::zero(), deadline - Clock::now());
    const auto wait = std::chrono::ceil<std::chrono::milliseconds>(remaining);
    if (WaitForSingleObject(event, static_cast<DWORD>(wait.count())) != WAIT_OBJECT_0) {
        CancelIoEx(file, &io);
        // Windows can complete cancellation asynchronously, so keep the buffer alive.
        GetOverlappedResult(file, &io, &bytes, TRUE);
        return ERROR_TIMEOUT;
    }
    if (!GetOverlappedResult(file, &io, &bytes, FALSE)) {
        return GetLastError();
    }
    return Clock::now() <= deadline ? ERROR_SUCCESS : ERROR_TIMEOUT;
}

bool cnReceiver(Transport t)
{
    return t == Transport::mchose_g3v2_receiver || t == Transport::aula_sc580_receiver || t == Transport::aula_f87v2d_receiver ||
        t == Transport::mchose_a7v2pro_usb;
}

template<class Caps, class GetCaps>
bool onlyReportId(USHORT count, PHIDP_PREPARSED_DATA prep, HIDP_REPORT_TYPE type, GetCaps get, unsigned id = 0)
{
    if (!count) return true;
    std::array<Caps,64> caps{};
    const auto n = count;
    if (n > caps.size() || get(type, caps.data(), &count, prep) != HIDP_STATUS_SUCCESS || count != n) return false;
    return std::ranges::all_of(std::span(caps).first(count), [id](const auto& cap) { return cap.ReportID == id; });
}

bool cnDescriptor(HANDLE file, Transport t, unsigned iface, const Collection* expected = nullptr)
{
    HIDD_ATTRIBUTES a{};
    a.Size = sizeof(a);
    HIDP_CAPS caps{};
    PHIDP_PREPARSED_DATA prep{};
    if (!HidD_GetAttributes(file, &a) || !HidD_GetPreparsedData(file, &prep)) return false;
    std::array<wchar_t,128> product{};
    const bool haveName = HidD_GetProductString(file, product.data(), static_cast<ULONG>(sizeof(product))) && product.back() == 0;
    const std::wstring_view name = haveName ? std::wstring_view(product.data()) : std::wstring_view{};
    bool valid = false;
    if (HidP_GetCaps(prep, &caps) == HIDP_STATUS_SUCCESS) {
        const auto in = caps.InputReportByteLength, out = caps.OutputReportByteLength;
        if (expected && (expected->page != caps.UsagePage || expected->usage != caps.Usage ||
            expected->inputLength != in || expected->outputLength != out ||
            expected->featureLength != caps.FeatureReportByteLength)) {
            HidD_FreePreparsedData(prep);
            return false;
        }
        if (t == Transport::mchose_a7v2pro_usb) {
            const auto featureLength = caps.FeatureReportByteLength;
            std::array<char,65> feature{};
            valid = mchoseA7V2ProCollection(a.VendorID, a.ProductID, iface,
                caps.UsagePage, caps.Usage, featureLength) &&
                HidP_InitializeReportForID(HidP_Feature, 0x11, prep, feature.data(), featureLength) == HIDP_STATUS_SUCCESS;
            HidD_FreePreparsedData(prep);
            return valid;
        }
        if (t == Transport::mchose_g87_candidate) {
            valid = mchoseG87CandidateCollection(a.VendorID, a.ProductID, iface, caps.UsagePage, caps.Usage, in, out)
                && (caps.NumberInputValueCaps || caps.NumberInputButtonCaps)
                && (caps.NumberOutputValueCaps || caps.NumberOutputButtonCaps)
                && onlyReportId<HIDP_BUTTON_CAPS>(caps.NumberInputButtonCaps, prep, HidP_Input, HidP_GetButtonCaps, 0x13)
                && onlyReportId<HIDP_VALUE_CAPS>(caps.NumberInputValueCaps, prep, HidP_Input, HidP_GetValueCaps, 0x13)
                && onlyReportId<HIDP_BUTTON_CAPS>(caps.NumberOutputButtonCaps, prep, HidP_Output, HidP_GetButtonCaps, 0x13)
                && onlyReportId<HIDP_VALUE_CAPS>(caps.NumberOutputValueCaps, prep, HidP_Output, HidP_GetValueCaps, 0x13);
            HidD_FreePreparsedData(prep);
            return valid;
        }
        if (t == Transport::ajazz_mk87pro_receiver)
            valid = ajazzMk87ProCollection(a.VendorID, a.ProductID, caps.UsagePage, caps.Usage, in, out, name);
        else if (t == Transport::mchose_g3v2_receiver)
            valid = cn_mouse::MatchesMchoseG3(a.VendorID, a.ProductID, caps.UsagePage, caps.Usage, in, out, name);
        else if (t == Transport::aula_sc580_receiver)
            valid = cn_mouse::MatchesAulaSc580(a.VendorID, a.ProductID, caps.UsagePage, caps.Usage, in, out);
        else if (t == Transport::aula_f87v2d_receiver)
            valid = aulaF87ProV2DCollection(a.VendorID, a.ProductID, static_cast<int>(iface), caps.UsagePage, caps.Usage, in, out, name, true);
        valid = valid && (caps.NumberInputValueCaps || caps.NumberInputButtonCaps) &&
            (caps.NumberOutputValueCaps || caps.NumberOutputButtonCaps) &&
            onlyReportId<HIDP_BUTTON_CAPS>(caps.NumberInputButtonCaps, prep, HidP_Input, HidP_GetButtonCaps) &&
            onlyReportId<HIDP_VALUE_CAPS>(caps.NumberInputValueCaps, prep, HidP_Input, HidP_GetValueCaps) &&
            onlyReportId<HIDP_BUTTON_CAPS>(caps.NumberOutputButtonCaps, prep, HidP_Output, HidP_GetButtonCaps) &&
            onlyReportId<HIDP_VALUE_CAPS>(caps.NumberOutputValueCaps, prep, HidP_Output, HidP_GetValueCaps);
    }
    HidD_FreePreparsedData(prep);
    return valid;
}

bool vendorGamepadDescriptor(HANDLE file, vendor_pad::Model model, const Collection* expected = nullptr)
{
    HIDD_ATTRIBUTES attributes{};
    attributes.Size = sizeof(attributes);
    if (!HidD_GetAttributes(file, &attributes) || vendor_pad::match(attributes.VendorID, attributes.ProductID) != model)
        return false;
    PHIDP_PREPARSED_DATA prep{};
    if (!HidD_GetPreparsedData(file, &prep)) return false;
    HIDP_CAPS caps{};
    std::array<char, 65> output{};
    const auto result = HidP_GetCaps(prep, &caps) == HIDP_STATUS_SUCCESS &&
        vendor_pad::collection(model, caps.UsagePage, caps.Usage, caps.InputReportByteLength, caps.OutputReportByteLength) &&
        (!expected || (expected->page == caps.UsagePage && expected->usage == caps.Usage &&
            expected->inputLength == caps.InputReportByteLength && expected->outputLength == caps.OutputReportByteLength)) &&
        HidP_InitializeReportForID(HidP_Output, static_cast<UCHAR>(vendor_pad::outputId(model)),
            prep, output.data(), caps.OutputReportByteLength) == HIDP_STATUS_SUCCESS;
    HidD_FreePreparsedData(prep);
    return result;
}

bool atkDescriptor(HANDLE file, unsigned pid, const Collection* expected = nullptr)
{
    HIDD_ATTRIBUTES attributes{};
    attributes.Size = sizeof(attributes);
    std::array<wchar_t, 128> name{};
    if (!HidD_GetAttributes(file, &attributes) || attributes.ProductID != pid ||
        !HidD_GetProductString(file, name.data(), static_cast<ULONG>(sizeof(name))) ||
        name.back() != 0 || !atkV75XProduct(attributes.VendorID, pid, lower(name.data()))) return false;
    PHIDP_PREPARSED_DATA prep{};
    if (!HidD_GetPreparsedData(file, &prep)) return false;
    HIDP_CAPS caps{};
    std::array<char, 64> input{}, output{};
    const auto valid = HidP_GetCaps(prep, &caps) == HIDP_STATUS_SUCCESS &&
        atkV75XCollection(caps.UsagePage, caps.Usage, caps.InputReportByteLength, caps.OutputReportByteLength) &&
        (!expected || (expected->page == caps.UsagePage && expected->usage == caps.Usage &&
            expected->inputLength == caps.InputReportByteLength && expected->outputLength == caps.OutputReportByteLength)) &&
        HidP_InitializeReportForID(HidP_Input, 4, prep, input.data(), caps.InputReportByteLength) == HIDP_STATUS_SUCCESS &&
        HidP_InitializeReportForID(HidP_Output, 4, prep, output.data(), caps.OutputReportByteLength) == HIDP_STATUS_SUCCESS;
    HidD_FreePreparsedData(prep);
    return valid;
}

namespace rog = rog_keyboard;

template<class Caps, class Reader>
bool onlyRogReport(USHORT count, PHIDP_PREPARSED_DATA prep, HIDP_REPORT_TYPE type,
                   unsigned id, Reader read)
{
    if (!count) return true;
    std::array<Caps, 64> caps{};
    const auto expected = count;
    if (expected > caps.size() || read(type, caps.data(), &count, prep) != HIDP_STATUS_SUCCESS ||
        count != expected) return false;
    return std::ranges::all_of(std::span(caps).first(count), [id](const auto& cap) { return cap.ReportID == id; });
}

rog::Port rogPort(HANDLE file, std::wstring_view path)
{
    const auto selector = rog::pathRole(path);
    if (selector == rog::Port::none) return rog::Port::none;
    const auto pid = selector == rog::Port::azoth ? rog::azothReceiver : rog::omniReceiver;
    const auto iface = selector == rog::Port::azoth ? 1u : 2u;
    const auto col = rog::reportId(selector);

    HIDD_ATTRIBUTES attr{};
    attr.Size = sizeof(attr);
    std::array<wchar_t, 64> product{};
    PHIDP_PREPARSED_DATA prep{};
    if (!HidD_GetAttributes(file, &attr) || attr.ProductID != pid || attr.VendorID != rog::vendor ||
        !HidD_GetProductString(file, product.data(), static_cast<ULONG>(sizeof(product))) || product.back() != 0 ||
        !HidD_GetPreparsedData(file, &prep)) return rog::Port::none;
    HIDP_CAPS caps{};
    auto port = rog::Port::none;
    if (HidP_GetCaps(prep, &caps) == HIDP_STATUS_SUCCESS) {
        port = rog::endpoint(attr.VendorID, attr.ProductID, lower(product.data()), iface, col,
                             caps.UsagePage, caps.Usage, caps.InputReportByteLength, caps.OutputReportByteLength);
        const auto id = rog::reportId(port);
        if (port != selector) port = rog::Port::none;
        if (port != rog::Port::none &&
            (!(caps.NumberInputButtonCaps || caps.NumberInputValueCaps) ||
             !(caps.NumberOutputButtonCaps || caps.NumberOutputValueCaps) ||
             !onlyRogReport<HIDP_BUTTON_CAPS>(caps.NumberInputButtonCaps, prep, HidP_Input, id, HidP_GetButtonCaps) ||
             !onlyRogReport<HIDP_VALUE_CAPS>(caps.NumberInputValueCaps, prep, HidP_Input, id, HidP_GetValueCaps) ||
             !onlyRogReport<HIDP_BUTTON_CAPS>(caps.NumberOutputButtonCaps, prep, HidP_Output, id, HidP_GetButtonCaps) ||
             !onlyRogReport<HIDP_VALUE_CAPS>(caps.NumberOutputValueCaps, prep, HidP_Output, id, HidP_GetValueCaps)))
            port = rog::Port::none;
    }
    HidD_FreePreparsedData(prep);
    return port;
}

std::wstring rogUsbParent(DEVINST node, unsigned pid)
{
    const std::wstring_view prefix = pid == rog::azothReceiver ? LR"(usb\vid_0b05&pid_1a85\)" :
        LR"(usb\vid_0b05&pid_1ace\)";
    for (int depth = 0; depth < 9; ++depth) {
        const auto id = nodeId(node);
        if (id.starts_with(prefix) && id.size() > prefix.size()) return id;
        DEVINST parent{};
        if (CM_Get_Parent(&parent, node, 0) != CR_SUCCESS) break;
        node = parent;
    }
    return {};
}

bool exactSuperNova(HANDLE handle)
{
    std::array<wchar_t,128> name{};
    return HidD_GetProductString(handle, name.data(), static_cast<ULONG>(sizeof(name))) &&
        name.back() == 0 && gamesir_battery::superNovaName(lower(name.data()));
}

bool usbHeadsetDescriptor(HANDLE handle, unsigned vid, unsigned pid, unsigned mi)
{
    HIDD_ATTRIBUTES identity{};
    identity.Size = sizeof(identity);
    PHIDP_PREPARSED_DATA data{};
    if (!HidD_GetAttributes(handle, &identity) || identity.VendorID != vid || identity.ProductID != pid ||
        !HidD_GetPreparsedData(handle, &data)) return false;
    HIDP_CAPS caps{};
    const auto model = headset_battery::lane(vid, pid);
    const auto has = [&](HIDP_REPORT_TYPE direction, unsigned id, unsigned length) {
        std::array<char,65> buffer{};
        return length > 0 && length <= buffer.size() &&
            HidP_InitializeReportForID(direction, id, data, buffer.data(), length) == HIDP_STATUS_SUCCESS;
    };
    bool ok = HidP_GetCaps(data, &caps) == HIDP_STATUS_SUCCESS &&
        headset_battery::collection(model, mi, caps.UsagePage, caps.Usage, caps.InputReportByteLength,
            caps.OutputReportByteLength, caps.FeatureReportByteLength);
    if (ok && model == headset_battery::Lane::jbl650)
        ok = has(HidP_Feature, 0x88, caps.FeatureReportByteLength) && has(HidP_Input, 0x86, caps.InputReportByteLength);
    if (ok && (model == headset_battery::Lane::jbl350 || model == headset_battery::Lane::jbl610))
        ok = has(HidP_Feature, 0x49, caps.FeatureReportByteLength) && has(HidP_Feature, 0x68, caps.FeatureReportByteLength);
    if (ok && model == headset_battery::Lane::nova7)
        ok = has(HidP_Input, 0, caps.InputReportByteLength) && has(HidP_Output, 0, caps.OutputReportByteLength);
    if (ok && model == headset_battery::Lane::hyperxAlpha)
        ok = has(HidP_Input, 0x21, caps.InputReportByteLength) && has(HidP_Output, 0x21, caps.OutputReportByteLength);
    HidD_FreePreparsedData(data);
    return ok;
}

bool exactMouseDescriptor(HANDLE file, std::wstring_view path, verified_mouse::Kind expected)
{
    HIDD_ATTRIBUTES attrs{};
    attrs.Size = sizeof(attrs);
    if (!HidD_GetAttributes(file, &attrs) || verified_mouse::kind(attrs.VendorID,attrs.ProductID) != expected)
        return false;
    PHIDP_PREPARSED_DATA prep{};
    if (!HidD_GetPreparsedData(file, &prep)) return false;
    HIDP_CAPS caps{};
    const auto mi=hexId(path,L"&mi_",2).value_or(255);
    const auto prove = [&](HIDP_REPORT_TYPE type,unsigned id,unsigned length) {
        std::array<char,64> buffer{};
        return length<=buffer.size() && HidP_InitializeReportForID(type,static_cast<UCHAR>(id),
            prep,buffer.data(),static_cast<ULONG>(length)) == HIDP_STATUS_SUCCESS;
    };
    const auto in=[&](unsigned id){return prove(HidP_Input,id,caps.InputReportByteLength);};
    const auto out=[&](unsigned id){return prove(HidP_Output,id,caps.OutputReportByteLength);};
    const bool valid=HidP_GetCaps(prep,&caps)==HIDP_STATUS_SUCCESS &&
        verified_mouse::collection(expected,mi,caps.UsagePage,caps.Usage,
            caps.InputReportByteLength,caps.OutputReportByteLength) &&
        (expected==verified_mouse::Kind::keychronM5 ? (in(0xb4)&&out(0xb3)) :
         expected==verified_mouse::Kind::haste2 ? (in(0x53)&&in(0x51)&&out(0x52)&&out(0x50)) :
         (in(8)&&out(8)));
    HidD_FreePreparsedData(prep);
    return valid;
}

class HidExchange {
public:
    explicit HidExchange(const Collection& channel, DWORD access = GENERIC_READ | GENERIC_WRITE)
        : input_(channel.inputLength), file_(CreateFileW(channel.path.c_str(), access,
            sharing, nullptr, OPEN_EXISTING, FILE_FLAG_OVERLAPPED, nullptr)),
          openError_(file_.valid() ? 0 : GetLastError()), event_(CreateEventW(nullptr, TRUE, FALSE, nullptr)) {}

    bool matchesCnReceiver(Transport t, unsigned iface, const Collection& expected) const
    {
        return file_.valid() && cnDescriptor(file_.value, t, iface, &expected);
    }

    bool matchesAtkV75X(unsigned pid, const Collection& expected) const
    {
        return file_.valid() && atkDescriptor(file_.value, pid, &expected);
    }

    bool flushInput() const { return file_.valid() && HidD_FlushQueue(file_.value); }

    bool matchesRogPort(const Collection& channel, rog::Port role) const
    {
        return file_.valid() && rogPort(file_.value, lower(channel.path)) == role;
    }

    bool matchesUsbHeadset(unsigned vid, unsigned pid, unsigned mi) const
    {
        return file_.valid() && usbHeadsetDescriptor(file_.value, vid, pid, mi);
    }

    DWORD getNumberedFeature(std::span<std::uint8_t> buffer, Clock::time_point end, DWORD& count)
    {
        if (const auto failure = error()) return failure;
        const auto size = static_cast<DWORD>(buffer.size());
        return completeIo(file_.value, event_.value, end, count, [&](OVERLAPPED* io) {
            return DeviceIoControl(file_.value, getFeature, buffer.data(), size, buffer.data(), size, &count, io);
        });
    }

    template<class Match>
    DWORD featureThenInput(std::span<std::uint8_t> query, Clock::time_point end, Match match)
    {
        if (const auto failure = error()) return failure;
        DWORD size = 0;
        const auto send = completeIo(file_.value, event_.value, end, size, [&](OVERLAPPED* io) {
            return DeviceIoControl(file_.value, setFeature, query.data(),
                static_cast<DWORD>(query.size()), nullptr, 0, &size, io);
        });
        if (send) return send;
        while (Clock::now() < end) {
            const auto result = receive(end, match);
            if (result != ERROR_NO_DATA) return result;
        }
        return ERROR_TIMEOUT;
    }

    bool matchesVendorGamepad(vendor_pad::Model model, const Collection& channel) const
    {
        return file_.valid() && vendorGamepadDescriptor(file_.value, model, &channel);
    }

    bool matchesExactMouse(const Collection& channel, verified_mouse::Kind kind) const
    {
        return file_.valid() && exactMouseDescriptor(file_.value, lower(channel.path), kind);
    }

    bool identifiesSuperNova() const
    {
        return file_.valid() && exactSuperNova(file_.value);
    }

    template<class Match>
    DWORD request(std::span<std::uint8_t> query, Clock::time_point end, Match match, HidExchange* alternate = nullptr,
                  bool controlOutput = false)
    {
        if (const auto failure = error()) return failure;
        DWORD size = 0;
        const auto write = completeIo(file_.value, event_.value, end, size, [&](OVERLAPPED* io) {
            if (controlOutput) return DeviceIoControl(file_.value, setOutputReport, query.data(),
                static_cast<DWORD>(query.size()), nullptr, 0, &size, io);
            return WriteFile(file_.value, query.data(), static_cast<DWORD>(query.size()), &size, io);
        });
        if (write) return write;
        if (!controlOutput && size != query.size()) return ERROR_INVALID_DATA;
        if (alternate && alternate->error()) alternate = nullptr;
        while (Clock::now() < end) {
            const auto interval = [&] { return alternate ? std::min(end, Clock::now() + 25ms) : end; };
            const auto read = receive(interval(), match);
            if (read == ERROR_SUCCESS) return ERROR_SUCCESS;
            if (read != ERROR_TIMEOUT && read != ERROR_NO_DATA) return read;
            if (!alternate) continue;
            const auto other = alternate->receive(interval(), match);
            if (other == ERROR_SUCCESS) return ERROR_SUCCESS;
            if (other != ERROR_TIMEOUT && other != ERROR_NO_DATA) alternate = nullptr;
        }
        return ERROR_TIMEOUT;
    }

    template<class Match>
    DWORD feature(std::span<std::uint8_t> query, Clock::time_point end, Match match, bool standardHid = false)
    {
        if (const auto failure = error()) return failure;
        DWORD size = 0;
        const auto send = completeIo(file_.value, event_.value, end, size, [&](OVERLAPPED* io) {
            // Windows HIDClass SET_FEATURE consumes the input buffer.
            if (standardHid)
                return DeviceIoControl(file_.value, setFeature, query.data(),
                    static_cast<DWORD>(query.size()), nullptr, 0, &size, io);
            return DeviceIoControl(file_.value, setFeature, nullptr, 0, query.data(),
                static_cast<DWORD>(query.size()), &size, io);
        });
        if (send) return send;
        Sleep(25);
        std::vector<std::uint8_t> response(query.size());
        response[0] = query[0];
        const auto read = completeIo(file_.value, event_.value, end, size, [&](OVERLAPPED* io) {
            // Match hidapi's Windows numbered-report GET_FEATURE exchange.
            return DeviceIoControl(file_.value, getFeature, standardHid ? response.data() : nullptr,
                standardHid ? static_cast<DWORD>(response.size()) : 0, response.data(),
                static_cast<DWORD>(response.size()), &size, io);
        });
        if (read) return read;
        return match(std::span<const std::uint8_t>(response).first(std::min<std::size_t>(size, response.size())))
            ? ERROR_SUCCESS : ERROR_INVALID_DATA;
    }

private:
    template<class Match>
    DWORD receive(Clock::time_point end, Match& match)
    {
        DWORD size = 0;
        const auto read = completeIo(file_.value, event_.value, end, size, [&](OVERLAPPED* io) {
            return ReadFile(file_.value, input_.data(), static_cast<DWORD>(input_.size()), &size, io);
        });
        if (read) return read;
        return match(std::span<const std::uint8_t>(input_).first(std::min<std::size_t>(size, input_.size())))
            ? ERROR_SUCCESS : ERROR_NO_DATA;
    }

    DWORD error() const { return openError_ ? openError_ : event_.valid() ? 0 : ERROR_NOT_ENOUGH_MEMORY; }
    std::vector<std::uint8_t> input_;
    Handle file_;
    const DWORD openError_;
    Handle event_;
};

bool pairedFalchion(HidExchange& exchange, Clock::time_point deadline)
{
    auto bytes = rog::request(rog::Port::omniIdentity);
    bool found = false;
    if (!exchange.flushInput()) return false;
    const auto ec = exchange.request(std::span(bytes).first(64), deadline, [&](auto frame) {
        if (frame.size() != 64 || frame[0] != 1 ||
            (frame[1] != 0xa0 && !(frame[1] == 0xff && frame[2] == 0xaa))) return false;
        found = rog::falchionPairedOnly(frame);
        return true;
    });
    return ec == ERROR_SUCCESS && found;
}

bool eligibleFalchion(const Collection& identity)
{
    HidExchange exchange(identity);
    return exchange.matchesRogPort(identity, rog::Port::omniIdentity) &&
        pairedFalchion(exchange, Clock::now() + 260ms);
}

Sample rogBatteryExchange(HidExchange& exchange, rog::Port port, Clock::time_point deadline)
{
    auto bytes = rog::request(port);
    const auto length = port == rog::Port::azoth ? 65u : 64u;
    Sample sample{Status::unavailable};
    if (!exchange.flushInput()) return sample;
    const auto ec = exchange.request(std::span(bytes).first(length), deadline, [&](auto frame) {
        if (frame.size() != length || frame[0] != rog::reportId(port) ||
            !((frame[1] == 0x12 && frame[2] == 1) || (frame[1] == 0xff && frame[2] == 0xaa))) return false;
        sample = rog::read(port, frame);
        return true;
    });
    return ec ? ioFailure(ec, rog::reportId(port)) : sample;
}

Sample readRogKeyboard(const Device& device)
{
    if (device.vid != rog::vendor) return {Status::unavailable};
    if (device.pid == rog::azothReceiver && device.collections.size() == 1) {
        const auto& port = device.collections.front();
        HidExchange exchange(port);
        if (!exchange.matchesRogPort(port, rog::Port::azoth)) return {Status::unavailable};
        return rogBatteryExchange(exchange, rog::Port::azoth, Clock::now() + 300ms);
    }
    if (device.pid != rog::omniReceiver || device.collections.size() != 2) return {Status::unavailable};
    // Enumeration puts the two individually proven ports of one USB parent
    // in this order. Repeat pair proof around the fresh 12 01 radio response
    // so a concurrent re-pair doesn't publish under the wrong label.
    const auto& id = device.collections[0];
    const auto& battery = device.collections[1];
    HidExchange identity(id), power(battery);
    if (!identity.matchesRogPort(id, rog::Port::omniIdentity) ||
        !power.matchesRogPort(battery, rog::Port::omniBattery)) return {Status::unavailable};
    const auto deadline = Clock::now() + 750ms;
    if (!pairedFalchion(identity, std::min(deadline, Clock::now() + 260ms))) return {Status::no_radio_reply};
    const auto sample = rogBatteryExchange(power, rog::Port::omniBattery, std::min(deadline, Clock::now() + 300ms));
    if (sample.status != Status::current) return sample;
    return pairedFalchion(identity, deadline) ? sample : Sample{Status::no_radio_reply};
}

Sample readCnReceiver(const Device& device)
{
    if (device.collections.size() != 1) return {Status::unavailable};
    const auto& c = device.collections.front();
    HidExchange exchange(c);
    const auto iface = hexId(c.description, L"&mi_", 2).value_or(255);
    if (!exchange.matchesCnReceiver(device.transport, iface, c)) return {Status::unavailable};
    const auto end = Clock::now() + 550ms;
    if (device.transport == Transport::mchose_a7v2pro_usb) {
        auto request = makeMchoseA7V2ProQuery();
        Sample result{Status::unavailable};
        const auto error = exchange.feature(std::span(request).first(c.featureLength), end, [&](auto reply) {
            result = parseMchoseA7V2ProReply(reply);
            return result.reading.has_value();
        }, true);
        return error == ERROR_INVALID_DATA ? result : error ? ioFailure(error, 0x11) : result;
    }
    if (device.transport == Transport::aula_f87v2d_receiver) {
        if (!exchange.flushInput()) return {Status::unavailable};
        auto query = makeAulaF87ProV2DQuery();
        Sample result{Status::unavailable};
        const auto err = exchange.request(query, end, [&](auto frame) {
            const auto parsed = parseAulaF87ProV2DReply(frame);
            if (!parsed.reading) return false;
            result = parsed;
            return true;
        });
        return err ? ioFailure(err, 0x55) : result;
    }
    using S = cn_mouse::Status;
    cn_mouse::Result result{S::Unrelated};
    const auto ask = [&](auto query, auto parse) -> DWORD {
        if (!exchange.flushInput()) return ERROR_READ_FAULT;
        unsigned skipped = 0;
        return exchange.request(query, end, [&](auto frame) {
            const auto decoded = parse(frame.data(), frame.size());
            if (decoded.status == S::Unrelated || decoded.status == S::Invalid) {
                if (++skipped < 4) return false;
                result.status = S::Invalid;
            } else result = decoded;
            return true;
        });
    };
    const bool g3 = device.transport == Transport::mchose_g3v2_receiver;
    if (g3) {
        const auto err = ask(cn_mouse::kMchoseOnlineQuery, cn_mouse::ParseMchoseOnline);
        if (err) return ioFailure(err, 0xed);
        if (result.status == S::Offline) return {Status::offline, {}, 0xed};
        if (result.status != S::Online) return {Status::bad_report, {}, 0xed};
    }
    const auto err = g3
        ? ask(cn_mouse::kMchoseBatteryQuery, [](auto buf, auto len) { return cn_mouse::ParseMchoseBattery(buf, len, true); })
        : ask(cn_mouse::kAulaBatteryQuery, cn_mouse::ParseAulaBattery);
    if (err) return ioFailure(err, 0x30);
    switch (result.status) {
    case S::Offline: return {Status::offline, {}, 0x30};
    case S::Retry: return {Status::busy, {}, 0x30};
    case S::ChargingWithoutLevel: return {Status::unavailable, {}, 0x30, 1, 0x30};
    case S::Battery: {
        const int level = result.percent;
        const auto power = result.full ? Power::full : result.charging ? Power::charging : Power::discharging;
        // M HUB's 10% UI buckets are not a calibrated single-percent sample.
        if (g3) return {Status::current, Reading{std::max(1, level - (level == 10 ? 9 : 5)),
            std::min(100, level + 4), power, level}, 0x30};
        return {Status::current, Reading{level, level, power, level}, 0x30};
    }
    default: return {Status::bad_report, {}, 0x30};
    }
}

Sample readUsbHeadset(const Device& device)
{
    using namespace headset_battery;
    if (device.collections.size() != 1) return {Status::unavailable};
    const auto& c = device.collections.front();
    const auto type = lane(device.vid, device.pid);
    if (type == Lane::none) return {Status::unavailable};
    const auto iface = hexId(c.description, L"&mi_", 2).value_or(255);
    const auto linkFeature = type == Lane::jbl350 || type == Lane::jbl610;
    if (!collection(type, iface, c.page, c.usage, c.inputLength, c.outputLength, c.featureLength))
        return {Status::unavailable};
    HidExchange exchange(c, linkFeature ? 0 : GENERIC_READ | GENERIC_WRITE);
    if (!exchange.matchesUsbHeadset(device.vid, device.pid, iface))
        return {Status::unavailable};
    const auto deadline = Clock::now() + 550ms;
    if (linkFeature) {
        const auto readByte = [&](std::uint8_t id) {
            std::array<std::uint8_t, 64> response{};
            response[0] = id;
            DWORD size = 0;
            if (exchange.getNumberedFeature(std::span(response).first(c.featureLength), deadline, size))
                return -1;
            return jblByte(std::span(response).first(std::min<std::size_t>(size, response.size())), id);
        };
        // Confirm the link on both sides of the battery read, not merely USB presence.
        if (readByte(0x68) != 1) return {Status::no_radio_reply};
        const auto n = readByte(0x49);
        if (n < 0 || n > 100) return {Status::bad_report};
        if (readByte(0x68) != 1) return {Status::no_radio_reply};
        return {Status::current, Reading{n,n,Power::unknown,n},0x49};
    }
    if (type == Lane::hyperxAlpha) {
        const auto read21 = [&](std::uint8_t command) {
            if (!alphaQuery(command) || !exchange.flushInput()) return -1;
            std::array<std::uint8_t,32> request{0x21, 0xbb, command};
            int value = -1;
            const auto error = exchange.request(std::span(request).first(c.outputLength), deadline,
                [&](auto frame) {
                    value = alphaByte(frame, command);
                    return value >= 0;
                });
            return error ? -1 : value;
        };
        // 02 explicitly means connected; 01 means off/unpaired. Ignore
        // cached capacity when the headset is not connected end to end.
        if (read21(0x03) != 2) return {Status::no_radio_reply};
        const auto n = read21(0x0b);
        if (n < 0 || n > 100) return {Status::bad_report};
        if (read21(0x03) != 2) return {Status::no_radio_reply};
        return {Status::current, Reading{n,n,Power::unknown,n},0x21};
    }
    if (!exchange.flushInput()) return {Status::unavailable};
    Sample result{Status::no_radio_reply};
    const auto match = [&](std::span<const std::uint8_t> report) {
        const auto reading = type == Lane::jbl650 ? jbl650Battery(report) : nova7Battery(report);
        if (reading.status == Status::bad_report) return false;
        result = reading;
        return true;
    };
    if (type == Lane::jbl650) {
        auto frame = jbl650Request();
        const auto error = exchange.featureThenInput(frame, deadline, match);
        if (error) return ioFailure(error, 0x88);
    } else {
        std::array<std::uint8_t,65> frame{0,0xb0};
        const auto error = exchange.request(std::span(frame).first(c.outputLength), deadline, match);
        if (error) return ioFailure(error, 0xb0);
    }
    return result;
}

Sample readVendorGamepad(const Device& device)
{
    if (device.collections.size() != 1) return {Status::unavailable};
    const auto model = vendor_pad::match(device.vid, device.pid);
    const auto& channel = device.collections.front();
    if (!model || !vendor_pad::collection(*model, channel.page, channel.usage, channel.inputLength, channel.outputLength))
        return {Status::unavailable};
    HidExchange exchange(channel);
    if (!exchange.matchesVendorGamepad(*model, channel) || !exchange.flushInput()) return {Status::unavailable};
    bool modern = false;
    if (*model != vendor_pad::Model::nova2LiteUsb) {
        auto query = vendor_pad::request(*model, true);
        const auto error = exchange.request(std::span(query).first(channel.outputLength), Clock::now() + 300ms, [&](auto bytes) {
            const auto reply = vendor_pad::architecture(bytes);
            if (!reply) return false;
            modern = *reply;
            return true;
        });
        if (error) return ioFailure(error, 7);
        if (!exchange.flushInput()) return {Status::unavailable};
    }
    auto query = vendor_pad::request(*model);
    Sample reading{Status::unavailable};
    const auto error = exchange.request(std::span(query).first(channel.outputLength), Clock::now() + 500ms, [&](auto bytes) {
        const auto sample = vendor_pad::parse(*model, bytes, modern);
        if (!sample) return false; // input reports or other command replies
        reading = *sample;
        return true;
    });
    return error ? ioFailure(error, 1) : reading;
}

Sample readGameSirSuperNova(const Device& device)
{
    if (device.collections.size() != 1) return {Status::unavailable};
    const auto& c = device.collections.front();
    if (!gamesir_battery::collection(device.vid, device.pid, c.page, c.inputLength,
        c.outputLength, c.featureLength)) return {Status::unavailable};

    HidExchange exchange(c);
    if (!exchange.identifiesSuperNova()) return {Status::unavailable};
    auto query = gamesir_battery::deviceInfo;
    Sample result{Status::unavailable};
    const auto error = exchange.request(query, Clock::now() + 650ms, [&](auto bytes) {
        const auto value = gamesir_battery::parseReply(bytes);
        if (value.status == Status::bad_report) return false;
        result = value;
        return true;
    });
    return error ? ioFailure(error, 7) : result;
}

Sample readVerifiedMouse(const Device& device,
                         std::map<std::wstring,Clock::time_point>& hasteReady)
{
    using namespace verified_mouse;
    const auto model=kind(device.vid,device.pid);
    if (!model || device.collections.size()!=1) return {Status::unavailable};
    const auto& channel=device.collections.front();
    HidExchange exchange(channel);
    if (!exchange.matchesExactMouse(channel,*model)) return {Status::unavailable};
    Sample reading{Status::unavailable};
    const auto send=[&](auto query,auto match,bool control=false) {
        if (!exchange.flushInput()) return GetLastError();
        return exchange.request(query,Clock::now()+240ms,match,nullptr,control);
    };
    if (*model==Kind::keychronM5) {
        const auto error=send(keychronQuery(),[&](auto frame) {
            if (const auto got=keychronReply(frame)) { reading=*got; return true; }
            return false;
        },true);
        return error ? ioFailure(error,0xb3) : reading;
    }
    if (*model==Kind::haste2) {
        const auto online=[&] {
            bool isLinked=false;
            const auto error=send(hasteQuery(true),[&](auto frame) {
                const auto got=hasteLink(frame);
                if (!got) return false;
                isLinked=*got;
                return true;
            });
            return !error && isLinked;
        };
        if (!online()) { hasteReady.erase(device.key); return {Status::no_radio_reply}; }
        const auto now=Clock::now();
        const auto [first,added]=hasteReady.try_emplace(device.key,now+6s);
        if (added || now<first->second) return {Status::no_radio_reply};
        const auto error=send(hasteQuery(false),[&](auto frame) {
            if (const auto got=hasteReply(frame)) { reading=*got; return true; }
            return false;
        });
        if (error || !online()) {
            hasteReady.erase(device.key);
            return error ? ioFailure(error,0x50) : Sample{Status::no_radio_reply};
        }
        return reading;
    }
    unsigned rfBefore=0,rfAfter=0;
    // HIDClass may pad this numbered 17-byte report to the collection's
    // longer maximum (the original receiver exposes non-17-byte maxima).
    if (!collection(*model, 1, channel.page, channel.usage, channel.inputLength, channel.outputLength))
        return {Status::unavailable};
    const auto sendCompx=[&](CompxCommand command,auto match) {
        std::array<std::uint8_t,32> buffer{};
        const auto query=compxQuery(command);
        std::copy(query.begin(),query.end(),buffer.begin());
        return send(std::span(buffer).first(channel.outputLength),match);
    };
    const auto link=[&](unsigned& identity) {
        return sendCompx(CompxCommand::link,[&](auto frame) {
            const auto got=compxLink(frame);
            if (!got) return false;
            identity=*got;
            return true;
        });
    };
    if (*model==Kind::vxeReceiver && (link(rfBefore) || !rfBefore)) return {Status::no_radio_reply};
    if (const auto error=sendCompx(CompxCommand::identity,compxIdentity)) return ioFailure(error,8);
    const auto error=sendCompx(CompxCommand::battery,[&](auto frame) {
        if (const auto got=compxBattery(frame)) { reading=*got; return true; }
        return false;
    });
    if (error) return ioFailure(error,8);
    if (*model==Kind::vxeReceiver && (link(rfAfter) || rfAfter!=rfBefore)) return {Status::no_radio_reply};
    return reading;
}

Sample readAtkV75XUsb(const Device& device, unsigned& sequence)
{
    // The receiver is deliberately not sampled. On that path a successful
    // fresh transaction does not prove fresh keyboard data or safe idle behavior.
    if (device.transport != Transport::atk_v75x_usb || device.vid != 0x320f ||
        device.pid != 0x5055 || device.collections.size() != 1) return {Status::unavailable};
    const auto& channel = device.collections.front();
    HidExchange exchange(channel);
    if (!exchange.matchesAtkV75X(device.pid, channel)) return {Status::unavailable};
    if (!exchange.flushInput()) return ioFailure(GetLastError(), 4);
    sequence = sequence % 0xffff + 1;
    auto query = makeAtkV75XQuery(sequence);
    std::optional<Sample> reply;
    const auto error = exchange.request(std::span(query).first(channel.outputLength), Clock::now() + 350ms,
        [&](std::span<const std::uint8_t> frame) {
            if (frame.size() != channel.inputLength) return false;
            reply = parseAtkV75XReply(frame, sequence);
            return reply.has_value();
        });
    return error || !reply ? ioFailure(error ? error : ERROR_INVALID_DATA, 4) : *reply;
}

Sample readVgn(const Device& device)
{
    const auto end = Clock::now() + 1050ms;
    Sample result{Status::unavailable};
    for (const auto& channel : device.collections) {
        auto query = vgnQuery(device.transport, channel);
        if (query.empty() || Clock::now() >= end) continue;
        HidExchange exchange(channel);
        std::optional<Sample> reply;
        const auto match = [&](std::span<const std::uint8_t> frame) {
            reply = parseVgn(device.transport, frame);
            return reply.has_value();
        };
        const auto requestEnd = std::min(end, Clock::now() + 650ms);
        const auto error = device.transport == Transport::vgn_v3_usb
            ? exchange.feature(query, requestEnd, match) : exchange.request(query, requestEnd, match);
        if (!error && reply) return *reply;
        result = ioFailure(error, query[0]);
        if (result.status == Status::timeout &&
            (device.transport == Transport::vgn_receiver || device.transport == Transport::vgn_v3_receiver)) {
            result.status = Status::no_radio_reply;
        }
    }
    return result;
}

std::atomic<unsigned> logitechRequestId{};

class LogitechQuery {
public:
    LogitechQuery(const Collection& channel, const Collection* shortChannel, unsigned slot,
                  Clock::time_point end)
        : exchange_(channel), end_(end), slot_(slot)
    {
        if (shortChannel) short_.emplace(*shortChannel, GENERIC_READ);
    }

    std::vector<std::uint8_t> read(unsigned index, unsigned function, unsigned a = 0, unsigned b = 0)
    {
        const auto now = Clock::now();
        if (now >= end_) {
            protocolError = protocolErrorFrame = 0;
            winError = ERROR_TIMEOUT;
            return {};
        }
        const unsigned tagged = function * 16 + 8 + logitechRequestId.fetch_add(1, std::memory_order_relaxed) % 8;
        std::array<std::uint8_t, 20> query{0x11, static_cast<std::uint8_t>(slot_),
            static_cast<std::uint8_t>(index), static_cast<std::uint8_t>(tagged),
            static_cast<std::uint8_t>(a), static_cast<std::uint8_t>(b)};
        protocolError = 0;
        protocolErrorFrame = 0;
        std::vector<std::uint8_t> response;
        winError = exchange_.request(query, std::min(end_, now + LogitechReceiverScan::queryBudget), [&](auto bytes) {
            const auto parsed = parseLogitechReply(bytes, slot_, index, tagged);
            if (!parsed) return false;
            protocolError = parsed->error;
            protocolErrorFrame = parsed->errorFrame;
            response.assign(parsed->params.begin(), parsed->params.end());
            return true;
        }, short_ ? &*short_ : nullptr);
        return response;
    }

    unsigned feature(unsigned id)
    {
        const auto response = read(0, 0, id >> 8, id & 255);
        return response.empty() ? 0 : response.front();
    }

    std::uint32_t unit(unsigned* reportedModel = nullptr, unsigned modelLink = 0)
    {
        if (reportedModel) *reportedModel = 0;
        const auto index = feature(3);
        if (!index) return 0;
        const auto info = read(index, 0);
        if (info.size() < 5) return 0;
        if (reportedModel) *reportedModel = logitechReportedModel(info, modelLink);
        std::uint32_t identity = 0;
        for (unsigned i = 1; i <= 4; ++i) identity = (identity << 8) | info[i];
        return identity == 0xffffffff ? 0 : identity;
    }

    Sample failure(unsigned feature = 0) const
    {
        if (protocolErrorFrame) return {logitechErrorStatus(protocolErrorFrame, protocolError),
            {}, 0x11, protocolError, feature};
        auto result = winError ? ioFailure(winError, 0x11) : Sample{Status::unavailable, {}, 0x11};
        if (result.status == Status::timeout) result.status = Status::no_radio_reply;
        result.feature = feature;
        return result;
    }

    DWORD winError{};
    unsigned protocolError{};
    unsigned protocolErrorFrame{};

private:
    HidExchange exchange_;
    std::optional<HidExchange> short_;
    Clock::time_point end_;
    unsigned slot_;
};

bool logitechChannel(const Collection& channel)
{
    return channel.page == 0xff00 && channel.usage == 2 &&
        channel.inputLength == 20 && channel.outputLength == 20;
}

const Collection* shortLogitechChannel(const Device& device)
{
    const auto match = std::ranges::find_if(device.collections, [](const Collection& channel) {
        return channel.page == 0xff00 && channel.usage == 1 && channel.inputLength == 7;
    });
    return match == device.collections.end() ? nullptr : &*match;
}

std::wstring logitechName(LogitechQuery& query, unsigned index)
{
    if (!index) return {};
    const auto size = query.read(index, 0);
    if (size.empty() || size.front() == 0 || size.front() > 48) return {};
    std::string text;
    while (text.size() < size.front()) {
        const auto part = query.read(index, 1, static_cast<unsigned>(text.size()));
        if (part.empty()) return {};
        const auto count = std::min<std::size_t>(part.size(), size.front() - text.size());
        text.append(reinterpret_cast<const char*>(part.data()), count);
    }
    if (std::ranges::any_of(text, [](unsigned char ch) { return ch < 32 || ch == 127; })) return {};
    const auto length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(), static_cast<int>(text.size()), nullptr, 0);
    if (length <= 0) return {};
    std::wstring label(length, L'\0');
    MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(), static_cast<int>(text.size()), label.data(), length);
    return label;
}

Sample readLogitech(const Device& device)
{
    const auto channel = std::ranges::find_if(device.collections, logitechChannel);
    if (channel == device.collections.end()) return {Status::unavailable};
    LogitechQuery query(*channel, shortLogitechChannel(device), device.slot, Clock::now() + 900ms);
    unsigned model = 0;
    const bool named = device.logitechNamedModel != 0;
    const bool uniqueChannel = std::ranges::count_if(device.collections, logitechChannel) == 1;
    if (named && !uniqueChannel)
        return {Status::unavailable};
    const unsigned modelLink = logitechBolt(device.vid, device.pid) ? 2 : 4;
    const auto identity = query.unit(named ? &model : nullptr, modelLink);
    if (identity != device.unit) return identity ? Sample{Status::offline} : query.failure(3);
    if (named && model != device.logitechNamedModel) return {Status::unavailable};
    const auto verify = [&](Sample reading) {
        if (!reading.reading) return reading;
        // A receiver remains attached while a paired device is replaced.
        // Re-check the live unit + model rather than publishing its reading
        // against the identity cached during enumeration.
        const auto verified = query.unit(named ? &model : nullptr, modelLink);
        if (verified != identity) return verified ? Sample{Status::offline} : query.failure(3);
        return !named || model == device.logitechNamedModel ? reading : Sample{Status::unavailable};
    };
    Sample previous{Status::unavailable};
    const auto remember = [&](const Sample& attempt) {
        if (!previous.feature) previous = attempt;
        // Busy/radio-off are transport failures, not missing battery features.
        return attempt.status == Status::busy || attempt.status == Status::offline ||
               attempt.status == Status::no_radio_reply || attempt.status == Status::timeout;
    };
    std::array<unsigned, 3> features{0x1004u, 0x1000u, 0x1001u};
    // Experience from an exact model is still preferred; another announced
    // native percentage/level function is tried if that route fails.
    if (named && (device.logitechNamedFeatures & named_legacy_1000) &&
        !(device.logitechNamedFeatures & named_percent_1004)) std::swap(features[0], features[1]);
    for (const unsigned feature : features) {
        if (!tryLogitechBatteryFeature(feature, device.logitechNamedFeatures, named, uniqueChannel)) continue;
        const auto index = query.feature(feature);
        if (!index) {
            if (query.winError || query.protocolError) {
                const auto failure = query.failure(feature);
                if (remember(failure)) return failure;
            }
            continue;
        }
        Sample candidate{Status::unavailable, {}, 0x11, 0, feature};
        if (feature == 0x1004) {
            const auto caps = query.read(index, 0);
            if (caps.size() < 2) candidate = query.failure(feature);
            else if (caps[1] & 2) {
                const auto data = query.read(index, 1);
                candidate = data.empty() ? query.failure(feature) : logitechBattery(feature, true, data);
            }
        } else {
            bool coarse = false;
            if (feature == 0x1000) {
                const auto caps = query.read(index, 1);
                const auto classification = namedLegacyCoarse(caps);
                if (!classification) {
                    const auto failure = query.failure(feature);
                    if (remember(failure)) return failure;
                    // No guessed interpretation (raw level versus percent).
                    continue;
                }
                coarse = *classification;
            }
            const auto data = query.read(index, 0);
            if (data.empty()) candidate = query.failure(feature);
            else if (feature == 0x1000 && data.size() >= 3 && data[2] == 0 && data[1] > data[0])
                candidate = {Status::bad_report, {}, 0x11, data[1], feature};
            else candidate = logitechBattery(feature, true, data, coarse,
                feature == 0x1001 && (named ? (device.logitechNamedFeatures & named_voltage_1001) != 0
                                           : logitechVoltageProfile(device.label)));
        }
        if (hasBatteryReading(candidate)) return verify(candidate);
        if (remember(candidate)) return candidate;
    }
    return previous;
}

Sample readRazer(const Collection& collection, Clock::time_point deadline, RazerQuery query,
                 bool singleRequest = false)
{
    const auto request = makeRazerQuery(query);
    const auto command = request[8];
    // The receiver exposes its feature report on the Windows-owned mouse collection.
    // Feature IOCTLs use FILE_ANY_ACCESS, so leave pointer input to Windows.
    Handle file(CreateFileW(collection.path.c_str(), 0, sharing,
                            nullptr, OPEN_EXISTING, FILE_FLAG_OVERLAPPED, nullptr));
    if (!file.valid()) {
        return ioFailure(GetLastError(), command);
    }
    Handle event(CreateEventW(nullptr, TRUE, FALSE, nullptr));
    if (!event.valid()) {
        return ioFailure(GetLastError(), command);
    }
    const auto length = std::max<std::size_t>(request.size(), collection.featureLength);
    std::vector<std::uint8_t> buffer(length);
    DWORD count = 0;
    const auto control = [&](DWORD code) {
        return completeIo(file.value, event.value, deadline, count, [&](OVERLAPPED* io) {
            const auto size = static_cast<DWORD>(buffer.size());
            return DeviceIoControl(file.value, code, buffer.data(), size,
                                   code == getFeature ? buffer.data() : nullptr,
                                   code == getFeature ? size : 0, &count, io);
        });
    };
    const auto send = [&] {
        std::fill(buffer.begin(), buffer.end(), 0);
        std::copy(request.begin(), request.end(), buffer.begin());
        return control(setFeature);
    };
    if (const auto error = send()) {
        return ioFailure(error, command);
    }
    Sample result{Status::busy, {}, command};
    for (int attempt = 0; attempt < 5 && Clock::now() + 65ms < deadline; ++attempt) {
        Sleep(65);
        std::fill(buffer.begin(), buffer.end(), 0);
        if (const auto error = control(getFeature)) {
            return ioFailure(error, command);
        }
        // HIDClass may count the payload only when report ID is the implicit zero.
        if (count < request.size() - 1) {
            return {Status::bad_report, {}, command, count};
        }
        result = parseRazerReport(std::span(buffer).first(request.size()), query);
        if (result.status != Status::busy) {
            return result;
        }
        if (!singleRequest && attempt == 2 && result.detail == 2) {
            if (const auto error = send()) {
                return ioFailure(error, command);
            }
        }
    }
    return result;
}

Sample readPassiveGamepad(const Collection& collection, bool bluetooth, bool dualShock4, unsigned eightBitDoReport, bool switchPro,
                       Clock::time_point pollDeadline)
{
    Handle file(CreateFileW(collection.path.c_str(), GENERIC_READ, sharing, nullptr,
                            OPEN_EXISTING, FILE_FLAG_OVERLAPPED, nullptr));
    if (!file.valid()) {
        return ioFailure(GetLastError());
    }
    Handle event(CreateEventW(nullptr, TRUE, FALSE, nullptr));
    if (!event.valid()) {
        return ioFailure(GetLastError());
    }
    std::vector<std::uint8_t> report(collection.inputLength);
    const auto deadline = std::min(pollDeadline, Clock::now() + (eightBitDoReport || switchPro ? 400ms : 1200ms));
    Sample result{Status::timeout};
    for (int attempt = 0; attempt < 8 && Clock::now() < deadline; ++attempt) {
        DWORD count = 0;
        const auto error = completeIo(file.value, event.value, deadline, count, [&](OVERLAPPED* io) {
            return ReadFile(file.value, report.data(), static_cast<DWORD>(report.size()), &count, io);
        });
        if (error) {
            return error == ERROR_TIMEOUT && result.report ? result : ioFailure(error);
        }
        const auto frame = std::span(report).first(std::min<std::size_t>(count, report.size()));
        result = switchPro ? parseSwitchProBluetoothReport(frame)
            : eightBitDoReport ? parse8BitDoBatteryReport(frame, eightBitDoReport)
            : dualShock4 ? parseDualShock4Report(frame, bluetooth) : parseDualSenseReport(frame, bluetooth);
        if (result.status != Status::bad_report && result.status != Status::basic_bluetooth) {
            return result;
        }
    }
    return result;
}

// A zero-effect BT output is accepted by the physical Sony gamepad only;
// keep the ordinary reader read-only. No feature or control-report fallback.
DWORD requestDualSenseFullReport(const Collection& collection, unsigned pid, Clock::time_point deadline)
{
    Handle file(CreateFileW(collection.path.c_str(), GENERIC_READ | GENERIC_WRITE, sharing,
        nullptr, OPEN_EXISTING, FILE_FLAG_OVERLAPPED, nullptr));
    if (!file.valid()) return GetLastError();
    HIDD_ATTRIBUTES attributes{sizeof(HIDD_ATTRIBUTES)};
    if (!HidD_GetAttributes(file.value, &attributes) || attributes.VendorID != 0x054c || attributes.ProductID != pid)
        return ERROR_INVALID_DATA;
    Handle event(CreateEventW(nullptr, TRUE, FALSE, nullptr));
    if (!event.valid()) return GetLastError();
    PHIDP_PREPARSED_DATA descriptor{};
    if (!HidD_GetPreparsedData(file.value, &descriptor)) return ERROR_INVALID_DATA;
    HIDP_CAPS caps{};
    const auto capStatus = HidP_GetCaps(descriptor, &caps);
    HidD_FreePreparsedData(descriptor);
    if (capStatus != HIDP_STATUS_SUCCESS || caps.UsagePage != 1 || caps.Usage != 5 ||
        caps.InputReportByteLength < 78 || caps.OutputReportByteLength != collection.outputLength ||
        !dualSenseValidHostOutputLength(caps.OutputReportByteLength)) return ERROR_INVALID_DATA;

    // Windows uses the collection size. The logical report and its CRC
    // are still in bytes 0..77; trailing bytes are zero transport padding.
    std::array<std::uint8_t, dualSenseMaxHostOutputLength> buffer{};
    const auto request = std::span(buffer).first(caps.OutputReportByteLength);
    if (!encodeDualSenseHostOutput(request)) return ERROR_INVALID_DATA;
    DWORD written{};
    const auto error = completeIo(file.value, event.value, deadline, written, [&](OVERLAPPED* io) {
        return WriteFile(file.value, request.data(), static_cast<DWORD>(request.size()), &written, io);
    });
    return error ? error : written == request.size() ? ERROR_SUCCESS : ERROR_WRITE_FAULT;
}

bool gamepad(const Collection& value)
{
    return value.page == 1 && (value.usage == 4 || value.usage == 5);
}

bool hasVoltageReports(HANDLE file)
{
    PHIDP_PREPARSED_DATA data{};
    if (!HidD_GetPreparsedData(file, &data)) {
        return false;
    }
    HIDP_CAPS caps{};
    USHORT count = 0;
    std::vector<HIDP_VALUE_CAPS> fields;
    if (HidP_GetCaps(data, &caps) == HIDP_STATUS_SUCCESS && caps.NumberFeatureValueCaps) {
        count = caps.NumberFeatureValueCaps;
        fields.resize(count);
        if (HidP_GetValueCaps(HidP_Feature, fields.data(), &count, data) != HIDP_STATUS_SUCCESS) {
            count = 0;
        }
    }
    HidD_FreePreparsedData(data);
    const auto flags = std::span(fields).first(count);
    const auto hasReport = [&](unsigned id) {
        return std::ranges::any_of(flags, [id](const auto& field) {
            return field.ReportID == id && field.BitSize == 8 && field.ReportCount == 63;
        });
    };
    return hasReport(0x80) && hasReport(0x81);
}

DWORD readFeature(const Collection& collection, std::span<std::uint8_t> report,
                  DWORD access, std::chrono::milliseconds limit, DWORD& count)
{
    Handle file(CreateFileW(collection.path.c_str(), access, sharing, nullptr, OPEN_EXISTING,
                            FILE_FLAG_OVERLAPPED, nullptr));
    if (!file.valid()) {
        return GetLastError();
    }
    Handle event(CreateEventW(nullptr, TRUE, FALSE, nullptr));
    if (!event.valid()) {
        return GetLastError();
    }
    const auto size = static_cast<DWORD>(report.size());
    return completeIo(file.value, event.value, Clock::now() + limit, count, [&](OVERLAPPED* io) {
        return DeviceIoControl(file.value, getFeature, report.data(), size, report.data(), size, &count, io);
    });
}

std::wstring readUsbIdentity(const Collection& collection)
{
    constexpr std::uint8_t pairingReport = 0x09;
    const auto length = collection.featureLength;
    if (length < 20) {
        return {};
    }
    // This feature report is queried over USB only. On Bluetooth it can change input mode.
    std::vector<std::uint8_t> report(length);
    report.front() = pairingReport;
    DWORD size = 0;
    const auto error = readFeature(collection, report, 0, 300ms, size);
    return error ? std::wstring{} : dualSenseUsbIdentity(std::span(report).first(std::min<std::size_t>(size, length)));
}

void addBluetoothDevnodes(std::map<std::wstring, Device>& devices)
{
    DeviceSet set{SetupDiGetClassDevsW(nullptr, L"BTHENUM", nullptr, DIGCF_PRESENT | DIGCF_ALLCLASSES)};
    if (set.value == INVALID_HANDLE_VALUE) {
        return;
    }
    for (DWORD index = 0;; ++index) {
        SP_DEVINFO_DATA info{};
        info.cbSize = sizeof(info);
        if (!SetupDiEnumDeviceInfo(set.value, index, &info)) {
            break;
        }
        const auto id = nodeId(info.DevInst);
        if (!id.starts_with(L"bthenum\\{00001124") || candidate(id) != Transport::dualsense_bluetooth) {
            continue;
        }
        constexpr auto transport = Transport::dualsense_bluetooth;
        const auto key = deviceKey(info.DevInst, transport, id);
        const auto identity = bluetoothIdentity(info.DevInst);
        if (!identity.empty() && std::ranges::any_of(devices, [&](const auto& entry) {
            return entry.second.transport == transport && entry.second.key == identity;
        })) {
            continue;
        }
        auto& device = devices.try_emplace(key, Device{
            identity.empty() ? key : identity, transport, 0, {}, {}, key}).first->second;
        if (!device.windowsBattery) {
            device.windowsBattery = windowsBattery(info.DevInst);
        }
    }
}

auto razerRank(const Collection& value)
{
    return std::tuple{value.featureLength != 91, value.page < 0xff00,
                      value.description.find(L"&mi_00") == std::wstring::npos,
                      value.description};
}

} // namespace

const wchar_t* deviceName(Transport transport)
{
    if (transport == Transport::razer_receiver) {
        return L"Razer Viper V3 HyperSpeed";
    }
    if (transport == Transport::razer_pro_receiver) return L"Razer 游戏鼠标";
    if (transport == Transport::verified_mouse_usb || transport == Transport::verified_mouse_receiver) return L"鼠标";
    if (transport == Transport::razer_shared_keyboard) {
        return L"Razer BlackWidow V4 Low-profile TKL HyperSpeed";
    }
    if (transport == Transport::vgn_usb || transport == Transport::vgn_receiver) return sharedKeyboardLabel(transport, {});
    if (isVgn(transport)) return L"VGN V98 Pro V3";
    if (transport == Transport::atk_v75x_usb || transport == Transport::atk_v75x_receiver_candidate) return L"ATK V75X";
    if (transport == Transport::logitech_receiver || transport == Transport::logitech_usb) return L"Logitech HID++ 外设";
    if (transport == Transport::langtu_t98_receiver) return L"兼容键盘接收器";
    if (transport == Transport::rapoo_receiver) return L"Rapoo 接收器";
    if (transport == Transport::supported_mouse_receiver) return L"2.4 GHz 鼠标";
    if (transport == Transport::rog_keyboard_receiver) return L"ROG 2.4 GHz 键盘";
    if (transport == Transport::gamepad_flydigi || transport == Transport::gamepad_nova2_lite_usb) return L"游戏手柄";
    return transport == Transport::windows_battery ? L"Windows 外设" : L"DualSense";
}

const wchar_t* transportName(Transport transport)
{
    switch (transport) {
    case Transport::razer_pro_receiver:
    case Transport::razer_receiver: return L"2.4 GHz";
    case Transport::razer_shared_keyboard: return L"2.4 GHz 共享接收器";
    case Transport::usb_wireless_headset: return L"2.4 GHz";
    case Transport::gamepad_flydigi: return L"USB / 2.4 GHz";
    case Transport::gamepad_nova2_lite_usb:
    case Transport::sony_gamepad_usb:
    case Transport::dualsense_usb: return L"USB";
    case Transport::eightbitdo_pro3_usb: return L"USB";
    case Transport::switch_pro_bluetooth:
    case Transport::joycon_left_bluetooth:
    case Transport::joycon_right_bluetooth:
    case Transport::eightbitdo_enhanced_bluetooth:
    case Transport::eightbitdo_pro3_bluetooth:
    case Transport::sony_gamepad_bluetooth:
    case Transport::dualsense_bluetooth: return L"蓝牙";
    case Transport::windows_battery: return L"Windows 电量";
    case Transport::vgn_usb:
    case Transport::vgn_v3_usb:
    case Transport::mchose_a7v2pro_usb:
    case Transport::atk_v75x_usb:
    case Transport::verified_mouse_usb:
    case Transport::logitech_usb: return L"USB";
    case Transport::vgn_receiver:
    case Transport::vgn_v3_receiver:
    case Transport::atk_v75x_receiver_candidate:
    case Transport::verified_mouse_receiver:
    case Transport::logitech_receiver:
    case Transport::rapoo_receiver:
    case Transport::langtu_t98_receiver:
    case Transport::mchose_g3v2_receiver:
    case Transport::aula_sc580_receiver:
    case Transport::ajazz_mk87pro_receiver:
    case Transport::mchose_g87_candidate:
    case Transport::aula_f87v2d_receiver:
    case Transport::dareu_em901x_inventory:
    case Transport::gamesir_super_nova_receiver:
    case Transport::rog_keyboard_receiver:
    case Transport::supported_mouse_receiver: return L"2.4 GHz";
    }
    return L"";
}

const wchar_t* providerName(Transport transport)
{
    switch (transport) {
    case Transport::razer_receiver:
    case Transport::razer_shared_keyboard: return L"razer-1532-00b8";
    case Transport::razer_pro_receiver: return L"razer-pro-receiver";
    case Transport::usb_wireless_headset: return L"headset-usb-battery";
    case Transport::sony_gamepad_usb: return L"sony-gamepad-usb";
    case Transport::sony_gamepad_bluetooth: return L"sony-gamepad-bluetooth";
    case Transport::switch_pro_bluetooth: return L"nintendo-switch-pro-bluetooth";
    case Transport::eightbitdo_pro3_bluetooth: return L"8bitdo-pro3-dinput-bluetooth";
    case Transport::eightbitdo_pro3_usb: return L"8bitdo-pro3-dinput-usb";
    case Transport::eightbitdo_enhanced_bluetooth: return L"8bitdo-dinput-enhanced";
    case Transport::joycon_left_bluetooth: return L"nintendo-joycon-left-bluetooth";
    case Transport::joycon_right_bluetooth: return L"nintendo-joycon-right-bluetooth";
    case Transport::dualsense_usb: return L"dualsense-usb";
    case Transport::dualsense_bluetooth: return L"dualsense-bluetooth";
    case Transport::windows_battery: return L"windows-property";
    case Transport::vgn_usb:
    case Transport::vgn_receiver: return L"vgn-weisheng";
    case Transport::vgn_v3_usb: return L"vgn-beiying-feature";
    case Transport::vgn_v3_receiver: return L"vgn-beiying-receiver";
    case Transport::atk_v75x_usb: return L"atk-v75x-usb";
    case Transport::verified_mouse_usb: return L"mouse-verified-usb";
    case Transport::verified_mouse_receiver: return L"mouse-verified-receiver";
    case Transport::atk_v75x_receiver_candidate: return L"atk-v75x-receiver-candidate";
    case Transport::logitech_receiver:
    case Transport::logitech_usb: return L"logitech-hidpp20";
    case Transport::rapoo_receiver: return L"rapoo-passive-hid";
    case Transport::langtu_t98_receiver: return L"langtu-t98-passive";
    case Transport::eightbitdo_ultimate2_candidate: return L"8bitdo-ultimate2-dinput-candidate";
    case Transport::mchose_g3v2_receiver: return L"mchose-g3v2";
    case Transport::aula_sc580_receiver: return L"aula-sc580";
    case Transport::aula_f87v2d_receiver: return L"aula-f87v2d";
    case Transport::mchose_a7v2pro_usb: return L"mchose-a7v2pro-usb";
    case Transport::ajazz_mk87pro_receiver: return L"ajazz-mk87pro-candidate";
    case Transport::mchose_g87_candidate: return L"mchose-g87-candidate";
    case Transport::dareu_em901x_inventory: return L"dareu-em901x-cache-unverified";
    case Transport::gamesir_super_nova_receiver: return L"gamesir-sapjoy";
    case Transport::gamepad_flydigi: return L"flydigi-vendor-hid";
    case Transport::gamepad_nova2_lite_usb: return L"gamesir-nova2-lite-usb";
    case Transport::supported_mouse_receiver: return L"mouse-vendor-hid";
    case Transport::rog_keyboard_receiver: return L"rog-keyboard";
    }
    return L"unknown";
}

const wchar_t* statusName(Status status)
{
    switch (status) {
    case Status::current: return L"当前读数";
    case Status::offline: return L"未连接";
    case Status::no_radio_reply: return L"休眠或关机";
    case Status::busy: return L"接口暂时繁忙";
    case Status::timeout: return L"读取超时";
    case Status::bad_report: return L"报告无法验证";
    case Status::unavailable: return L"暂时无法读取";
    case Status::basic_bluetooth: return L"蓝牙当前未提供电量";
    case Status::charging_error: return L"设备报告充电异常";
    }
    return L"";
}

const wchar_t* powerName(Power power)
{
    switch (power) {
    case Power::discharging: return L"电池供电";
    case Power::charging: return L"充电中";
    case Power::full: return L"已充满";
    case Power::unknown: return L"充电状态未上报";
    }
    return L"";
}

std::wstring formatReading(const Reading& reading)
{
    std::wstring text = std::to_wstring(reading.low);
    if (reading.low != reading.high) {
        text += L"–" + std::to_wstring(reading.high);
    }
    return text + L"%";
}

std::wstring formatEstimatedReading(const Reading& reading)
{
    return (reading.low == reading.high ? L"" : L"约 ") +
           std::to_wstring(reading.midpoint()) + L"%";
}

std::wstring timestamp()
{
    SYSTEMTIME time{};
    GetLocalTime(&time);
    wchar_t value[32]{};
    swprintf(value, 32, L"%04u-%02u-%02u %02u:%02u:%02u", time.wYear, time.wMonth,
             time.wDay, time.wHour, time.wMinute, time.wSecond);
    return value;
}

std::vector<Device> HidMonitor::enumerate(bool includePairedBluetooth, std::vector<HidInterface>* inventory,
    const std::set<std::wstring>& busyReceivers)
{
    GUID hidGuid{};
    HidD_GetHidGuid(&hidGuid);
    DeviceSet set{SetupDiGetClassDevsW(&hidGuid, nullptr, nullptr, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE)};
    if (set.value == INVALID_HANDLE_VALUE) {
        return {};
    }
    std::map<std::wstring, Device> devices;
    // Container IDs aid deduplication, but never substitute for same-parent
    // proof when a receiver exposes multiple protocol collections.
    std::map<std::wstring, std::wstring> rogParents;
    for (DWORD index = 0;; ++index) {
        SP_DEVICE_INTERFACE_DATA iface{};
        iface.cbSize = sizeof(iface);
        if (!SetupDiEnumDeviceInterfaces(set.value, nullptr, &hidGuid, index, &iface)) {
            break;
        }
        DWORD bytes = 0;
        SetupDiGetDeviceInterfaceDetailW(set.value, &iface, nullptr, 0, &bytes, nullptr);
        if (bytes < sizeof(SP_DEVICE_INTERFACE_DETAIL_DATA_W)) {
            continue;
        }
        std::vector<std::byte> storage(bytes);
        auto* detail = reinterpret_cast<SP_DEVICE_INTERFACE_DETAIL_DATA_W*>(storage.data());
        detail->cbSize = sizeof(*detail);
        SP_DEVINFO_DATA devInfo{};
        devInfo.cbSize = sizeof(devInfo);
        if (!SetupDiGetDeviceInterfaceDetailW(set.value, &iface, detail, bytes, nullptr, &devInfo)) {
            continue;
        }
        std::wstring path = detail->DevicePath;
        const auto normalized = lower(path);
        auto transport = candidate(normalized);
        if (!transport && !inventory) continue;
        if (inventory && inventory->size() >= 512) break;
        const auto instance = nodeId(devInfo.DevInst);
        if (instance.starts_with(L"rzvirtual")) {
            continue;
        }
        Handle info(CreateFileW(path.c_str(), 0, sharing, nullptr, OPEN_EXISTING, 0, nullptr));
        HIDD_ATTRIBUTES attributes{};
        attributes.Size = sizeof(attributes);
        HIDP_CAPS caps{};
        bool haveCaps = false;
        if (info.valid()) {
            HidD_GetAttributes(info.value, &attributes);
            PHIDP_PREPARSED_DATA parsed{};
            if (HidD_GetPreparsedData(info.value, &parsed)) {
                haveCaps = HidP_GetCaps(parsed, &caps) == HIDP_STATUS_SUCCESS;
                HidD_FreePreparsedData(parsed);
            }
        }
        const auto vid = attributes.VendorID ? attributes.VendorID : hexId(normalized, L"vid_", 4).value_or(0);
        const auto pid = attributes.ProductID ? attributes.ProductID : hexId(normalized, L"pid_", 4).value_or(0);
        if ((transport == Transport::vgn_usb || transport == Transport::vgn_receiver) && info.valid()) {
            std::array<wchar_t, 128> name{};
            if (HidD_GetProductString(info.value, name.data(), static_cast<ULONG>(sizeof(name))) &&
                name.back() == 0 && atkV75XProduct(vid, pid, lower(name.data()))) {
                transport = pid == 0x5055 ? Transport::atk_v75x_usb : Transport::atk_v75x_receiver_candidate;
            }
        }
        const auto exactMouse=verified_mouse::kind(vid,pid);
        const bool verifiedMouse=transport==Transport::verified_mouse_usb || transport==Transport::verified_mouse_receiver;
        const bool exactMouseReady=verifiedMouse && exactMouse && info.valid() &&
            exactMouseDescriptor(info.value,normalized,*exactMouse);
        const bool atkUsb = transport == Transport::atk_v75x_usb;
        const bool atkCandidate = transport == Transport::atk_v75x_receiver_candidate;
        const bool rzPro = transport == Transport::razer_pro_receiver;
        const bool usbHeadset = transport == Transport::usb_wireless_headset;
        const auto headsetCollection = [&] {
            return usbHeadset && info.valid() && haveCaps &&
                hexId(normalized, L"vid_", 4) == vid && hexId(normalized, L"pid_", 4) == pid &&
                usbHeadsetDescriptor(info.value, vid, pid, hexId(normalized, L"&mi_", 2).value_or(255));
        };
        const bool rogCandidate = transport == Transport::rog_keyboard_receiver;
        const auto rogRole = rogCandidate && info.valid() ? rogPort(info.value, normalized) : rog::Port::none;
        const auto rogParent = rogRole != rog::Port::none ? rogUsbParent(devInfo.DevInst, pid) : std::wstring{};
        const auto rzProCollection = [&] {
            return haveCaps && attributes.VendorID == 0x1532 && attributes.ProductID == hexId(normalized, L"pid_", 4).value_or(0) &&
                razerProBatteryCollection(vid, pid, hexId(normalized, L"&mi_", 2).value_or(255),
                    caps.UsagePage, caps.Usage, caps.FeatureReportByteLength);
        };
        const auto rzExactCollection = [&] {
            if (!rzProCollection()) return false;
            if (!razerBatch13Receiver(vid, pid) && !razerKeyboardReceiver(vid, pid)) return true;
            if (!info.valid()) return false;
            if (razerBatch13Receiver(vid, pid)) {
                std::array<wchar_t, 128> product{};
                if (!HidD_GetProductString(info.value, product.data(), static_cast<ULONG>(sizeof(product))) ||
                    product.back() != 0 || !razerBatch13Product(vid, pid, lower(product.data()))) return false;
            }
            PHIDP_PREPARSED_DATA prep{};
            if (!HidD_GetPreparsedData(info.value, &prep)) return false;
            std::array<char, 91> feature{};
            const auto valid = HidP_InitializeReportForID(HidP_Feature, 0, prep,
                feature.data(), static_cast<ULONG>(feature.size())) == HIDP_STATUS_SUCCESS;
            HidD_FreePreparsedData(prep);
            return valid;
        };
        const auto vendorPad = transport == Transport::gamepad_flydigi || transport == Transport::gamepad_nova2_lite_usb
            ? vendor_pad::match(vid, pid) : std::nullopt;
        const auto exactVendorPad = vendorPad && info.valid() && vendorGamepadDescriptor(info.value, *vendorPad);
        const bool langtu = transport == Transport::langtu_t98_receiver;
        const bool langtuReady = langtu && haveCaps && langtuT98Collection(attributes.VendorID, attributes.ProductID,
            hexId(normalized, L"&mi_", 2).value_or(255), caps.UsagePage, caps.Usage,
            caps.InputReportByteLength, caps.OutputReportByteLength);
        if (inventory) {
            const auto interfaceNumber = hexId(normalized, L"&mi_", 2);
            auto reportedProvider = transport;
            if (langtu && !langtuReady) reportedProvider.reset();
            // Both receiver modes have been reported with this PID. This
            // is an inventory hint only, never permission to sample battery.
            if (transport == Transport::eightbitdo_ultimate2_candidate &&
                (!haveCaps || attributes.VendorID != 0x2dc8 || attributes.ProductID != 0x6012 ||
                 caps.UsagePage != 1 || caps.Usage != 5 || caps.InputReportByteLength != 34))
                reportedProvider.reset();
            if (vendorPad && !exactVendorPad) reportedProvider.reset();
            if (rzPro && !rzExactCollection()) reportedProvider.reset();
            if (usbHeadset && !headsetCollection()) reportedProvider.reset();
            if ((atkUsb || atkCandidate) && (!info.valid() || !atkDescriptor(info.value, pid)))
                reportedProvider.reset();
            if (rogCandidate && rogParent.empty()) reportedProvider.reset();
            if (verifiedMouse && !exactMouseReady) reportedProvider.reset();
            if (transport == Transport::dareu_em901x_inventory && (!haveCaps || interfaceNumber != 1 ||
                !((caps.UsagePage == 0xff01 && caps.Usage == 0 && caps.InputReportByteLength == 17) ||
                  (caps.UsagePage == 0xff02 && caps.Usage == 2 && caps.FeatureReportByteLength == 17))))
                reportedProvider.reset();
            if ((transport == Transport::aula_f87v2d_receiver || transport == Transport::mchose_a7v2pro_usb ||
                 transport == Transport::ajazz_mk87pro_receiver || transport == Transport::mchose_g87_candidate) &&
                (!info.valid() || !cnDescriptor(info.value, *transport, interfaceNumber.value_or(255))))
                reportedProvider.reset();
            std::wstring physicalContainer;
            // Do not fall back to a USB parent or path: a shared receiver,
            // hub or composite parent is not evidence of child identity.
            DEVPROPTYPE type{};
            GUID id{};
            ULONG size = sizeof(id);
            if (CM_Get_DevNode_PropertyW(devInfo.DevInst, &DEVPKEY_Device_ContainerId, &type,
                    reinterpret_cast<PBYTE>(&id), &size, 0) == CR_SUCCESS &&
                type == DEVPROP_TYPE_GUID && size == sizeof(id) && id.Data1 != 0 && id.Data1 != 0xffffffff) {
                wchar_t value[40]{};
                if (StringFromGUID2(id, value, 40)) physicalContainer = lower(value);
            }
            inventory->push_back({vid, pid, attributes.VersionNumber, caps.UsagePage, caps.Usage,
                caps.InputReportByteLength, caps.OutputReportByteLength, caps.FeatureReportByteLength,
                interfaceNumber ? static_cast<int>(*interfaceNumber) : -1, haveCaps, reportedProvider,
                std::move(physicalContainer), transport.has_value()});
            continue;
        }
        if ((isVgn(*transport) || *transport == Transport::logitech_receiver || *transport == Transport::logitech_usb) &&
            (peripheralTransport(vid, pid) != transport || !haveCaps)) continue;
        if (transport == Transport::eightbitdo_ultimate2_candidate) continue;
        if (langtu && !langtuReady) continue;
        if (*transport == Transport::rapoo_receiver && !isRapooReceiver(vid, pid)) continue;
        if (*transport == Transport::dareu_em901x_inventory || *transport == Transport::ajazz_mk87pro_receiver ||
            *transport == Transport::mchose_g87_candidate || atkCandidate) continue;
        const bool cn = cnReceiver(*transport);
        const bool superNova = *transport == Transport::gamesir_super_nova_receiver;
        if ((transport == Transport::gamepad_flydigi || transport == Transport::gamepad_nova2_lite_usb) && !exactVendorPad) continue;
        if (cn || superNova || atkUsb || vendorPad || verifiedMouse || *transport == Transport::supported_mouse_receiver) {
            const auto kind = supportedMouse(vid, pid);
            const auto ifaceNumber = hexId(normalized, L"&mi_", 2);
            if (!haveCaps) continue;
            if (cn) {
                if (!info.valid() || !cnDescriptor(info.value, *transport, ifaceNumber.value_or(255))) continue;
            } else if (verifiedMouse) {
                if (!exactMouseReady) continue;
            } else if (atkUsb) {
                if (!info.valid() || !atkDescriptor(info.value, pid)) continue;
            } else if (superNova) {
                if (!gamesir_battery::collection(vid, pid, caps.UsagePage, caps.InputReportByteLength,
                    caps.OutputReportByteLength, caps.FeatureReportByteLength) ||
                    !info.valid() || !exactSuperNova(info.value)) continue;
            } else if (!vendorPad && (!kind || !ifaceNumber ||
                !supportedMouseCollection(*kind, static_cast<int>(*ifaceNumber), caps.UsagePage, caps.Usage))) continue;
            bool usbParent = false;
            DEVINST parent = devInfo.DevInst;
            for (int depth = 0; depth < 9; ++depth) {
                const auto id = nodeId(parent);
                if (id.starts_with(L"usb\\vid_") && id.find(L"&mi_") == std::wstring::npos &&
                    hexId(id, L"vid_", 4) == vid && hexId(id, L"pid_", 4) == pid) {
                    usbParent = true;
                    break;
                }
                DEVINST next{};
                if (CM_Get_Parent(&next, parent, 0) != CR_SUCCESS) break;
                parent = next;
            }
            if (!usbParent) continue;
            if (kind == SupportedMouse::aulaV9) {
                std::array<wchar_t, 128> name{};
                if (!HidD_GetProductString(info.value, name.data(), static_cast<ULONG>(sizeof(name))) ||
                    name.back() != 0 || std::wstring_view(name.data()) != L"AULA-V9Pro+") continue;
            }
        }
        if (rzPro || usbHeadset) {
            if (rzPro ? !rzExactCollection() : !headsetCollection()) continue;
            bool physicalReceiver = false;
            DEVINST node = devInfo.DevInst;
            for (int depth = 0; depth < 9; ++depth) {
                const auto id = nodeId(node);
                if (id.starts_with(L"usb\\vid_") && id.find(L"&mi_") == std::wstring::npos &&
                    hexId(id, L"vid_", 4) == vid && hexId(id, L"pid_", 4) == pid) {
                    physicalReceiver = true;
                    break;
                }
                DEVINST parent{};
                if (CM_Get_Parent(&parent, node, 0) != CR_SUCCESS) break;
                node = parent;
            }
            if (!physicalReceiver) continue;
        }
        const bool eightBitDo = isEightBitDoHid(*transport);
        const bool enhanced = *transport == Transport::eightbitdo_enhanced_bluetooth;
        const bool eightBitDoUsb = *transport == Transport::eightbitdo_pro3_usb;
        if (eightBitDo && (attributes.VendorID != 0x2dc8 || (enhanced ?
            !eightBitDoEnhancedName(attributes.ProductID) ||
            attributes.ProductID != hexId(normalized, L"vid&00022dc8_pid&", 4).value_or(0) :
            attributes.ProductID != 0x6009) ||
            !haveCaps || caps.UsagePage != 1 || (caps.Usage != 4 && caps.Usage != 5) ||
            caps.InputReportByteLength < 15 || caps.InputReportByteLength > 64)) continue;
        if (eightBitDoUsb) {
            bool physical = false;
            for (DEVINST node = devInfo.DevInst, parent{}; node;) {
                const auto id = nodeId(node);
                if (id.starts_with(L"usb\vid_2dc8&pid_6009") && id.find(L"&mi_") == std::wstring::npos) {
                    physical = true;
                    break;
                }
                if (CM_Get_Parent(&parent, node, 0) != CR_SUCCESS || parent == node) break;
                node = parent;
            }
            if (!physical) continue;
        }
        const bool switchPro = isSwitchHid(*transport);
        const auto switchPid = *transport == Transport::joycon_left_bluetooth ? 0x2006u :
            *transport == Transport::joycon_right_bluetooth ? 0x2007u : 0x2009u;
        if (switchPro && (vid != 0x057e || pid != switchPid || !haveCaps ||
            caps.UsagePage != 1 || caps.Usage != 5 ||
            caps.InputReportByteLength < 49 || caps.InputReportByteLength > 512)) continue;
        const bool extraSony = *transport == Transport::sony_gamepad_usb ||
                               *transport == Transport::sony_gamepad_bluetooth;
        if (extraSony && (attributes.VendorID != 0x054c || attributes.ProductID !=
                          hexId(normalized, *transport == Transport::sony_gamepad_usb ?
                                L"pid_" : L"vid&0002054c_pid&", 4).value_or(0) ||
                          !haveCaps || caps.UsagePage != 1 || (caps.Usage != 4 && caps.Usage != 5) ||
                          caps.InputReportByteLength < 10 || caps.InputReportByteLength > 128)) continue;
        const bool bluetooth = *transport == Transport::dualsense_bluetooth;
        const auto key = deviceKey(devInfo.DevInst, *transport, normalized);
        if (rogCandidate) {
            if (rogParent.empty() || !key.ends_with(L'}')) continue;
            auto [parent, first] = rogParents.try_emplace(key, rogParent);
            if (!first && parent->second != rogParent) {
                parent->second.clear();
                continue;
            }
        }
        // Report the receiver only when Windows supplied a physical container.
        if ((langtu || cn || superNova || switchPro || enhanced || eightBitDoUsb || rzPro || usbHeadset || vendorPad || verifiedMouse || atkUsb || *transport == Transport::rapoo_receiver || *transport == Transport::supported_mouse_receiver) &&
            !key.ends_with(L'}')) continue;
        auto [it, inserted] = devices.try_emplace(key, Device{key, *transport, attributes.VersionNumber,
                                                               bluetooth ? windowsBattery(devInfo.DevInst)
                                                                         : std::nullopt, {}, key, vid, pid});
        if ((*transport == Transport::vgn_usb || *transport == Transport::vgn_receiver) && info.valid() &&
            (it->second.label.empty() || it->second.label == sharedKeyboardLabel(*transport, {}))) {
            std::array<wchar_t, 126> product{};
            if (HidD_GetProductString(info.value, product.data(), static_cast<ULONG>(sizeof(product)))) {
                product.back() = 0;
                it->second.label = sharedKeyboardLabel(*transport, product.data());
            }
        }
        if (rzPro && inserted) it->second.label = razerProReceiverName(vid, pid);
        if (usbHeadset && inserted) it->second.label = headset_battery::name(headset_battery::lane(vid,pid));
        if (atkUsb && inserted) it->second.label = L"ATK V75X";
        if (exactMouseReady && inserted) {
            using verified_mouse::Kind;
            const bool vxe=*exactMouse==Kind::vxeReceiver || *exactMouse==Kind::vxeCable;
            it->second.label=vxe && !confirmedVxe_.contains(key) ?
                (*exactMouse==Kind::vxeReceiver ? L"VXE 鼠标接收器" : L"VXE USB 鼠标") :
                verified_mouse::name(*exactMouse);
        }
        if (eightBitDo && inserted) it->second.label = enhanced ? eightBitDoEnhancedName(pid) : L"8BitDo Pro 3";
        if (superNova && inserted) it->second.label = L"GameSir Super Nova";
        if (vendorPad && inserted) it->second.label = vendor_pad::name(*vendorPad);
        if (cn && inserted) {
            it->second.label = *transport == Transport::mchose_g3v2_receiver ? L"MCHOSE G3 V2" :
                *transport == Transport::aula_sc580_receiver ? L"AULA SC580 / SC580X" :
                *transport == Transport::mchose_a7v2pro_usb ? L"MCHOSE A7 V2 Pro" : L"AULA F87 Pro V2D";
        }
        if (switchPro && inserted) it->second.label = *transport == Transport::joycon_left_bluetooth ? L"Joy-Con (L)" :
            *transport == Transport::joycon_right_bluetooth ? L"Joy-Con (R)" : L"Switch Pro（蓝牙模式）";
        if (extraSony && inserted) {
            it->second.label = pid == 0x0df2 ? L"DualSense Edge" : L"DUALSHOCK 4";
        }
        if (bluetooth && inserted) {
            if (auto identity = bluetoothIdentity(devInfo.DevInst); !identity.empty()) {
                it->second.key = std::move(identity);
            }
        }
        const auto first = normalized.find(L'#');
        const auto second = normalized.find(L'#', first + 1);
        auto description = normalized.substr(first + 1, second - first - 1);
        it->second.collections.push_back({std::move(path), std::move(description),
                                          caps.UsagePage, caps.Usage, caps.InputReportByteLength,
                                          caps.FeatureReportByteLength, caps.OutputReportByteLength});
    }
    if (inventory) return {};
    if (includePairedBluetooth) {
        addBluetoothDevnodes(devices);
    }
    std::erase_if(receivers_, [&](const auto& item) { return !devices.contains(item.first); });
    std::vector<Device> result;
    // Count Logitech receiver probes only; Windows enumeration and other
    // device discovery retain their own time limits.
    auto logitechRemaining = Clock::duration(LogitechReceiverScan::sweepBudget);
    for (auto& [key, device] : devices) {
        if ((isSwitchHid(device.transport) || device.transport == Transport::eightbitdo_enhanced_bluetooth ||
            device.transport == Transport::eightbitdo_pro3_usb || device.transport == Transport::gamesir_super_nova_receiver ||
            device.transport == Transport::atk_v75x_usb || device.transport == Transport::gamepad_flydigi ||
            device.transport == Transport::gamepad_nova2_lite_usb || device.transport == Transport::verified_mouse_usb ||
            device.transport == Transport::verified_mouse_receiver || cnReceiver(device.transport)) &&
            device.collections.size() != 1) continue;
        if (device.transport == Transport::rog_keyboard_receiver) {
            if (!rogParents.contains(key) || rogParents.at(key).empty()) continue;
            if (device.pid == rog::azothReceiver && device.collections.size() == 1) {
                device.label = L"ROG Azoth";
            } else if (device.pid == rog::omniReceiver && device.collections.size() == 2) {
                std::ranges::sort(device.collections, {}, &Collection::description);
                if (!device.collections[0].description.ends_with(L"&mi_02&col01") ||
                    !device.collections[1].description.ends_with(L"&mi_02&col02") ||
                    !eligibleFalchion(device.collections[0])) continue;
                device.label = L"ROG Falchion RX Low Profile";
            } else {
                continue;
            }
        }
        if (device.transport == Transport::supported_mouse_receiver) {
            if (device.collections.size() != 1) continue;
            const auto kind = supportedMouse(device.vid, device.pid);
            if (!kind) continue;
            device.label = supportedMouseName(*kind);
        }
        if (device.transport == Transport::langtu_t98_receiver && device.collections.size() != 1) continue;
        if (device.transport == Transport::rapoo_receiver) {
            const auto vendorCollection = [](const Collection& c) { return c.page == 0xff00 && c.usage == 2; };
            const auto current = std::ranges::find_if(device.collections, vendorCollection);
            if (current == device.collections.end() || std::ranges::count_if(device.collections, vendorCollection) != 1 ||
                std::ranges::any_of(device.collections, [](const Collection& c) { return !c.page && !c.usage; }) ||
                !isRapooBatteryCollection(current->page, current->usage, current->inputLength)) continue;
            device.label = rapooReceiverName(device.vid, device.pid);
            const auto only = *current;
            device.collections = {only};
        }
        if (device.transport == Transport::logitech_usb) {
            const auto channel = std::ranges::find_if(device.collections, logitechChannel);
            if (channel == device.collections.end() || std::ranges::count_if(device.collections, logitechChannel) != 1) continue;
            auto& direct = receivers_[key];
            const auto now = Clock::now();
            constexpr unsigned directIndex = 0xff; // HID++ 2.0, no receiver slot.
            auto child = direct.children.find(directIndex);
            if (now >= direct.due && !busyReceivers.contains(key)) {
                LogitechQuery query(*channel, shortLogitechChannel(device), directIndex, now + 750ms);
                const auto id = query.unit();
                direct.due = now + (id ? 30s : 5s);
                if (id) {
                    auto usb = device;
                    usb.key = L"logitech-hidpp:" + std::to_wstring(id);
                    usb.slot = directIndex;
                    usb.unit = id;
                    usb.kind = 3;
                    usb.label = logitechUsbName(device.vid, device.pid);
                    child = direct.children.insert_or_assign(directIndex, std::move(usb)).first;
                } else if (child != direct.children.end()) {
                    direct.children.erase(child);
                    child = direct.children.end();
                }
            }
            if (child != direct.children.end()) {
                child->second.collections = device.collections;
                result.push_back(child->second);
            }
            continue;
        }
        if (device.transport == Transport::logitech_receiver) {
            const auto channel = std::ranges::find_if(device.collections, logitechChannel);
            if (channel == device.collections.end()) continue;
            const bool bolt = logitechBolt(device.vid, device.pid);
            const auto channels = std::ranges::count_if(device.collections, logitechChannel);
            if (bolt && channels != 1) continue;
            auto& receiver = receivers_[key];
            const auto passStart = Clock::now();
            const auto deadline = passStart + logitechRemaining;
            const auto* shortChannel = shortLogitechChannel(device);
            for (auto now = passStart; receiver.slotScan.canProbe(now, deadline, busyReceivers.contains(key));
                 now = Clock::now()) {
                const auto slot = receiver.slotScan.nextSlot();
                LogitechQuery query(*channel, shortChannel, slot, std::min(deadline, now + LogitechReceiverScan::slotBudget));
                unsigned model = 0;
                const auto identity = query.unit(channels == 1 ? &model : nullptr, bolt ? 2 : 4);
                const auto stamp = std::chrono::duration_cast<std::chrono::seconds>(
                    std::chrono::system_clock::now().time_since_epoch()).count();
                if (receiverAttempts_.size() == 96) receiverAttempts_.erase(receiverAttempts_.begin());
                receiverAttempts_.push_back({device.vid, device.pid, slot, stamp, identity != 0,
                    identity ? Sample{Status::current, {}, 0x11, 0, 3} : query.failure(3)});
                auto child = receiver.children.find(slot);
                const bool newIdentity = child == receiver.children.end() || child->second.unit != identity ||
                    (child->second.logitechNamedModel && model && child->second.logitechNamedModel != model);
                const bool confirmNamed = !newIdentity && !child->second.logitechNamedModel &&
                    logitechNamedIdentity(device.vid, device.pid, model, child->second.label, child->second.kind);
                if (identity && (newIdentity || confirmNamed || child->second.label.empty() || child->second.kind == 255)) {
                    // Preserve metadata already proven by the same unit. A
                    // partial name/type read on discovery is retried on rotation.
                    auto paired = newIdentity ? device : child->second;
                    paired.key = L"logitech-hidpp:" + std::to_wstring(identity);
                    paired.parentEndpoint = device.endpointKey;
                    paired.endpointKey.clear();
                    paired.slot = slot;
                    paired.unit = identity;
                    const auto nameIndex = query.feature(5);
                    if (nameIndex) {
                        const auto type = query.read(nameIndex, 2);
                        if (!type.empty()) paired.kind = type.front();
                        if (auto name = logitechName(query, nameIndex); !name.empty())
                            paired.label = std::move(name);
                        if (const auto named = logitechNamedIdentity(device.vid, device.pid, model, paired.label, paired.kind)) {
                            paired.label = named->label;
                            paired.kind = named->kind;
                            paired.logitechNamedModel = named->model;
                            paired.logitechNamedFeatures = named->batteryFeatures;
                        } else if (const auto office = boltOfficeIdentity(device.vid, device.pid, paired.label)) {
                            paired.label = office->label;
                            if (paired.kind == 255) paired.kind = office->kind;
                        }
                    }
                    receiver.children.insert_or_assign(slot, std::move(paired));
                } else if (!identity && query.failure(3).status == Status::offline) {
                    receiver.children.erase(slot);
                }
                receiver.slotScan.probed(now);
            }
            logitechRemaining = std::max(Clock::duration::zero(), deadline - Clock::now());
            for (auto& [slot, child] : receiver.children) {
                child.collections = device.collections;
                result.push_back(child);
            }
            continue;
        }
        if ((device.transport == Transport::razer_pro_receiver || device.transport == Transport::usb_wireless_headset) &&
            device.collections.size() != 1) continue;
        if (device.transport == Transport::razer_receiver) {
            std::ranges::sort(device.collections, {}, razerRank);
            const auto control = std::ranges::find_if(device.collections, [](const Collection& collection) {
                return collection.featureLength == 91 && collection.description.ends_with(L"pid_00b8&mi_00");
            });
            if (control != device.collections.end()) {
                auto& pairing = sharedPairings_[key];
                const auto now = Clock::now();
                if (now >= pairing.nextCheck && !busyReceivers.contains(key)) {
                    const auto answer = readRazer(*control, now + 500ms, RazerQuery::pairedDevices);
                    if (answer.status == Status::current) {
                        pairing.paired = answer.detail == 1;
                    }
                    pairing.nextCheck = now + (answer.status == Status::current ? 2min : 1min);
                }
                if (pairing.paired) {
                    Device keyboard{device.key + L":02d2", Transport::razer_shared_keyboard,
                                    device.revision, {}, {*control}, {}, device.vid, device.pid};
                    keyboard.parentEndpoint = device.endpointKey;
                    result.push_back(std::move(keyboard));
                }
            }
        } else {
            std::ranges::stable_sort(device.collections, {}, [](const Collection& c) { return !gamepad(c); });
            if (device.transport == Transport::dualsense_usb && !device.collections.empty() &&
                gamepad(device.collections.front())) {
                const auto& collection = device.collections.front();
                auto known = usbIdentities_.find(collection.path);
                if (known == usbIdentities_.end()) {
                    if (auto identity = readUsbIdentity(collection); !identity.empty()) {
                        known = usbIdentities_.emplace(collection.path, std::move(identity)).first;
                    }
                }
                if (known != usbIdentities_.end()) {
                    device.key = known->second;
                }
            }
        }
        result.push_back(std::move(device));
    }
    return result;
}

Sample HidMonitor::sample(const Device& device, std::wostream* diagnostics)
{
    if (device.transport == Transport::gamesir_super_nova_receiver) return readGameSirSuperNova(device);
    if (device.transport == Transport::usb_wireless_headset) return readUsbHeadset(device);
    if (device.transport == Transport::gamepad_flydigi || device.transport == Transport::gamepad_nova2_lite_usb)
        return readVendorGamepad(device);
    if (cnReceiver(device.transport)) return readCnReceiver(device);
    if (device.transport == Transport::atk_v75x_usb) return readAtkV75XUsb(device, atkV75XSequence_);
    if (device.transport==Transport::verified_mouse_usb || device.transport==Transport::verified_mouse_receiver) {
        auto reading=readVerifiedMouse(device,hasteReady_);
        rememberVerifiedMouse(device, reading);
        return reading;
    }
    if (device.transport == Transport::rog_keyboard_receiver) return readRogKeyboard(device);
    if (device.transport == Transport::supported_mouse_receiver) {
        const auto kind = supportedMouse(device.vid, device.pid);
        if (!kind || device.collections.size() != 1) return {Status::unavailable};
        const auto& collection = device.collections.front();
        const auto iface = hexId(collection.description, L"&mi_", 2);
        if (!iface) return {Status::unavailable};
        return readSupportedMouseBattery(*kind, static_cast<int>(*iface), collection.path);
    }
    if (device.transport == Transport::rapoo_receiver || device.transport == Transport::langtu_t98_receiver) {
        if (device.collections.size() != 1) return {Status::unavailable};
        return rapoo_.read(device.collections.front().path, device.transport == Transport::langtu_t98_receiver);
    }
    if (isVgn(device.transport)) return readVgn(device);
    if (device.transport == Transport::logitech_receiver || device.transport == Transport::logitech_usb)
        return readLogitech(device);
    if (device.transport == Transport::razer_pro_receiver) {
        if (device.collections.size() != 1) return {Status::unavailable};
        const auto& collection = device.collections.front();
        if (!razerProBatteryCollection(device.vid, device.pid,
                hexId(collection.description, L"&mi_", 2).value_or(255),
                collection.page, collection.usage, collection.featureLength)) return {Status::unavailable};
        // One read-only exchange per scan. Don't re-send into a shared command
        // channel if Synapse has it busy or an unrelated reply is observed.
        const auto command = razerKeyboardReceiver(device.vid, device.pid)
            ? RazerQuery::keyboardBattery : RazerQuery::mouseBattery;
        auto result = readRazer(collection, Clock::now() + 400ms, command, true);
        // Zero can reflect a sleeping wireless endpoint, not a fresh battery
        // measurement. Do not alert at 0% on these newly enabled receivers.
        if ((razerBatch13Receiver(device.vid, device.pid) || razerKeyboardReceiver(device.vid, device.pid)) && result.reading && result.reading->raw == 0)
            return {Status::no_radio_reply, {}, 0x80};
        if (result.reading) result.reading->power = Power::unknown;
        return result;
    }
    const bool keyboard = device.transport == Transport::razer_shared_keyboard;
    const bool razer = device.transport == Transport::razer_receiver || keyboard;
    const unsigned eightBitDoReport = !isEightBitDoHid(device.transport) ? 0u :
        device.transport == Transport::eightbitdo_enhanced_bluetooth ? 1u : 4u;
    const bool switchPro = isSwitchHid(device.transport);
    const bool bluetooth = switchPro || (eightBitDoReport && device.transport != Transport::eightbitdo_pro3_usb) ||
                           device.transport == Transport::dualsense_bluetooth ||
                           device.transport == Transport::sony_gamepad_bluetooth;
    const auto deadline = Clock::now() + 1800ms;
    const auto logAttempt = [&](const Collection& collection, Sample result) {
        if (diagnostics) {
            *diagnostics << L"  " << collection.description << L" usage=" << std::hex
                         << collection.page << L":" << collection.usage << std::dec
                         << L" input=" << collection.inputLength << L" feature=" << collection.featureLength
                         << L" => " << statusName(result.status) << L" report=0x" << std::hex
                         << result.report << L" detail=0x" << result.detail << std::dec << L"\n";
        }
        return result;
    };
    if (razer) {
        const auto cached = razerCollections_.find(device.key);
        const std::wstring_view preferred =
            cached == razerCollections_.end() ? std::wstring_view{} : std::wstring_view(cached->second);
        const auto [result, winner] = readRazerCollections(device.collections, preferred, deadline,
            [] { return Clock::now(); }, [&](const Collection& collection, Clock::time_point cutoff) {
                auto sample = readRazer(collection, cutoff,
                    keyboard ? RazerQuery::keyboardBattery : RazerQuery::mouseBattery);
                if (keyboard && hasBatteryReading(sample) && Clock::now() + 65ms < cutoff) {
                    const auto charging = readRazer(collection, cutoff, RazerQuery::keyboardCharging);
                    if (charging.status == Status::current) {
                        sample.reading->power = charging.detail ? Power::charging : Power::discharging;
                    }
                }
                return logAttempt(collection, sample);
            });
        if (winner) razerCollections_[device.key] = winner->path;
        else razerCollections_.erase(device.key);
        return result;
    }
    const auto attempt = [&](const Collection& collection) {
        return logAttempt(collection, readPassiveGamepad(collection, bluetooth, device.vid == 0x054c &&
            (device.pid == 0x05c4 || device.pid == 0x09cc), eightBitDoReport, switchPro, deadline));
    };
    Sample result{Status::unavailable};
    Sample radioSilent{Status::unavailable};
    for (const auto& collection : device.collections) {
        if (!gamepad(collection) || collection.inputLength < 10) {
            continue;
        }
        if (Clock::now() >= deadline) {
            break;
        }
        result = attempt(collection);
        const auto canRequestFull = [&](const Collection& lane) {
            return dualSenseFullReportEligible(device.vid, device.pid, bluetooth, lane.page, lane.usage,
                lane.inputLength, lane.outputLength, result) &&
                lower(lane.path).find(L"{00001124-0000-1000-8000-00805f9b34fb}") != std::wstring::npos;
        };
        // Only the single physical Sony Bluetooth gamepad lane that actually
        // sent a basic report is eligible. Throttle even denied/timed-out I/O.
        if (canRequestFull(collection) && std::ranges::count_if(device.collections, canRequestFull) == 1 &&
            Clock::now() + 150ms < deadline) {
            const auto now = Clock::now();
            auto& next = dualSenseFullRequestDue_[collection.path];
            if (now >= next) {
                next = now + 60s;
                const auto error = requestDualSenseFullReport(collection, device.pid, std::min(deadline, now + 150ms));
                result.detail = error;
                if (error == ERROR_SUCCESS) {
                    const auto enhanced = attempt(collection);
                    if (enhanced.reading) return enhanced;
                    if (enhanced.status == Status::offline || enhanced.status == Status::charging_error) return enhanced;
                }
            }
        }
        if (result.reading) {
            return result;
        }
        if (result.status == Status::basic_bluetooth || result.status == Status::charging_error) {
            break;
        }
        if (result.status == Status::no_radio_reply) {
            radioSilent = result;
        }
    }
    if (bluetooth && result.status != Status::offline && result.status != Status::charging_error) {
        // A present Bluetooth devnode is enough to try the exact container,
        // but only a connected Windows report with a valid level is accepted.
        // Do not re-stamp a cached ancestor property as this controller's reading.
        const auto delimiter = device.endpointKey.find(L':');
        if (delimiter != std::wstring::npos) {
            const auto container = device.endpointKey.substr(delimiter + 1);
            if (container.size() == 38 && container.front() == L'{' && container.back() == L'}') {
                if (auto windows = readWindowsDevice(container); windows.reading) {
                    return windows;
                }
            }
        }
    }
    return radioSilent.status == Status::no_radio_reply ? radioSilent : result;
}

VoltageSample HidMonitor::sampleVoltage(const Device& device, const Sample& pairedReading)
{
    if (!isDualSense(device.transport)) {
        return {VoltageStatus::unsupported};
    }
    const bool bluetooth = device.transport == Transport::dualsense_bluetooth;
    if (!pairedReading.reading || pairedReading.reading->source != ReadingSource::hid ||
        pairedReading.report != (bluetooth ? 0x31u : 0x01u)) {
        return {VoltageStatus::missing_hid_reading};
    }
    const auto collection = std::ranges::find_if(device.collections, gamepad);
    if (collection == device.collections.end() || collection->featureLength < 64) {
        return {VoltageStatus::unsupported};
    }
    Handle file(CreateFileW(collection->path.c_str(), 0, sharing, nullptr, OPEN_EXISTING,
                            FILE_FLAG_OVERLAPPED, nullptr));
    if (!file.valid()) {
        return {VoltageStatus::io_error, {}, GetLastError()};
    }
    if (!hasVoltageReports(file.value)) {
        return {VoltageStatus::unsupported};
    }
    Handle event(CreateEventW(nullptr, TRUE, FALSE, nullptr));
    if (!event.valid()) {
        return {VoltageStatus::io_error, {}, GetLastError()};
    }
    const auto request = makeDualSenseVoltageQuery(bluetooth);
    std::vector<std::uint8_t> buffer(collection->featureLength);
    std::copy(request.begin(), request.end(), buffer.begin());
    const auto size = static_cast<DWORD>(buffer.size());
    const auto deadline = Clock::now() + 750ms;
    DWORD count = 0;
    const auto exchange = [&](DWORD code) {
        return completeIo(file.value, event.value, deadline, count, [&](OVERLAPPED* io) {
            return DeviceIoControl(file.value, code, buffer.data(), size,
                                   code == getFeature ? buffer.data() : nullptr,
                                   code == getFeature ? size : 0, &count, io);
        });
    };
    const auto failed = [](DWORD error) {
        return VoltageSample{error == ERROR_TIMEOUT ? VoltageStatus::timeout : VoltageStatus::io_error,
                             {}, error};
    };
    if (const auto error = exchange(setFeature)) {
        return failed(error);
    }
    for (int attempt = 0; attempt < 6 && Clock::now() + 35ms < deadline; ++attempt) {
        Sleep(35);
        std::fill(buffer.begin(), buffer.end(), 0);
        buffer.front() = 0x81;
        count = 0;
        if (const auto error = exchange(getFeature)) {
            return failed(error);
        }
        const auto result = parseDualSenseVoltageReply(std::span(buffer).first(std::min<std::size_t>(count, buffer.size())));
        if (result.status != VoltageStatus::waiting) {
            return result;
        }
    }
    return {VoltageStatus::timeout};
}

void HidMonitor::rememberVerifiedMouse(const Device& device, const Sample& reading)
{
    if (device.transport != Transport::verified_mouse_usb && device.transport != Transport::verified_mouse_receiver) return;
    const auto model = verified_mouse::kind(device.vid, device.pid);
    if (model == verified_mouse::Kind::vxeCable || model == verified_mouse::Kind::vxeReceiver) {
        if (reading.reading) confirmedVxe_.insert(device.key);
        else confirmedVxe_.erase(device.key);
    }
}

void HidMonitor::forgetOffline(const std::vector<Device>& devices)
{
    std::set<std::wstring> rapooPaths;
    for (const auto& device : devices) {
        if ((device.transport == Transport::rapoo_receiver || device.transport == Transport::langtu_t98_receiver) && device.collections.size() == 1)
            rapooPaths.insert(device.collections.front().path);
    }
    rapoo_.retainPaths(rapooPaths);
    std::erase_if(dualSenseFullRequestDue_, [&](const auto& entry) {
        return std::ranges::none_of(devices, [&](const auto& device) {
            return std::ranges::find(device.collections, entry.first, &Collection::path) != device.collections.end();
        });
    });
    std::erase_if(confirmedVxe_, [&](const auto& key) {
        return std::ranges::find(devices,key,&Device::key)==devices.end();
    });
    std::erase_if(hasteReady_, [&](const auto& entry) {
        return std::ranges::find(devices, entry.first, &Device::key) == devices.end();
    });
    std::erase_if(razerCollections_, [&](const auto& entry) {
        return std::ranges::find(devices, entry.first, &Device::key) == devices.end();
    });
    std::erase_if(sharedPairings_, [&](const auto& entry) {
        return std::ranges::find(devices, entry.first, &Device::key) == devices.end();
    });
    std::erase_if(usbIdentities_, [&](const auto& entry) {
        return std::ranges::none_of(devices, [&](const auto& device) {
            return device.transport == Transport::dualsense_usb &&
                std::ranges::find(device.collections, entry.first, &Collection::path) != device.collections.end();
        });
    });
}

} // namespace pm
