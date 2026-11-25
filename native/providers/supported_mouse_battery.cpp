#include "supported_mouse_battery.hpp"

#include <windows.h>
extern "C" {
#include <hidsdi.h>
#include <hidpi.h>
}
#include <chrono>
#include <string_view>

namespace pm {
namespace {
using Clock = std::chrono::steady_clock;
using namespace std::chrono_literals;

struct Handle {
    HANDLE value;
    ~Handle() { if (value && value != INVALID_HANDLE_VALUE) CloseHandle(value); }
    explicit operator bool() const { return value && value != INVALID_HANDLE_VALUE; }
};

Sample failed(SupportedMouse kind, Status status, SupportedMouseReason reason, unsigned code = 0)
{
    return {status, {}, kind == SupportedMouse::aerox9 ? 0xd2u : 0x1au, static_cast<unsigned>(reason), code};
}

template<typename Caps, typename ReadCaps>
bool onlyReport(USHORT count, PHIDP_PREPARSED_DATA prep, HIDP_REPORT_TYPE type, unsigned id, ReadCaps read)
{
    if (!count) return true;
    std::array<Caps, 64> caps{};
    if (count > caps.size() || read(type, caps.data(), &count, prep) != HIDP_STATUS_SUCCESS
        || !count || count > caps.size())
        return false;
    for (unsigned i = 0; i < count; ++i)
        if (caps[i].ReportID != id) return false;
    return true;
}

bool direction(PHIDP_PREPARSED_DATA prep, HIDP_REPORT_TYPE type, unsigned id, USHORT buttons, USHORT values)
{
    return (buttons || values)
        && onlyReport<HIDP_BUTTON_CAPS>(buttons, prep, type, id, HidP_GetButtonCaps)
        && onlyReport<HIDP_VALUE_CAPS>(values, prep, type, id, HidP_GetValueCaps);
}

bool descriptor(HANDLE file, SupportedMouse kind, int iface, HIDP_CAPS& caps)
{
    HIDD_ATTRIBUTES identity{};
    identity.Size = sizeof(identity);
    if (!HidD_GetAttributes(file, &identity) || supportedMouse(identity.VendorID, identity.ProductID) != kind)
        return false;
    if (kind == SupportedMouse::aulaV9) {
        std::array<wchar_t, 128> product{};
        if (!HidD_GetProductString(file, product.data(), sizeof(product))
            || product.back() != 0 || std::wstring_view(product.data()) != L"AULA-V9Pro+")
            return false;
    }
    PHIDP_PREPARSED_DATA prep{};
    if (!HidD_GetPreparsedData(file, &prep)) return false;
    const auto length = [&](unsigned bytes) {
        return bytes == 64 || (kind == SupportedMouse::aerox9 && bytes == 65);
    };
    const unsigned report = kind == SupportedMouse::aerox9 ? 0 : 4;
    const bool valid = HidP_GetCaps(prep, &caps) == HIDP_STATUS_SUCCESS
        && supportedMouseCollection(kind, iface, caps.UsagePage, caps.Usage)
        && length(caps.InputReportByteLength) && length(caps.OutputReportByteLength)
        && direction(prep, HidP_Input, report, caps.NumberInputButtonCaps, caps.NumberInputValueCaps)
        && direction(prep, HidP_Output, report, caps.NumberOutputButtonCaps, caps.NumberOutputValueCaps);
    HidD_FreePreparsedData(prep);
    return valid;
}

template<typename StartIo>
DWORD transfer(HANDLE file, HANDLE event, Clock::time_point deadline, DWORD& bytes, StartIo start)
{
    using std::chrono::duration_cast;
    if (Clock::now() >= deadline) return ERROR_TIMEOUT;
    ResetEvent(event);
    OVERLAPPED op{};
    op.hEvent = event;
    if (start(&op)) return ERROR_SUCCESS;
    const auto error = GetLastError();
    if (error != ERROR_IO_PENDING) return error;
    const auto remaining = duration_cast<std::chrono::milliseconds>(deadline - Clock::now()).count();
    const auto result = WaitForSingleObject(event, remaining > 0 ? static_cast<DWORD>(remaining) : 0);
    if (result == WAIT_OBJECT_0)
        return GetOverlappedResult(file, &op, &bytes, FALSE) ? ERROR_SUCCESS : GetLastError();
    const auto waitError = result == WAIT_FAILED ? GetLastError() : ERROR_TIMEOUT;
    CancelIoEx(file, &op);
    GetOverlappedResult(file, &op, &bytes, TRUE);
    return waitError;
}

} // namespace

Sample readSupportedMouseBattery(SupportedMouse kind, int iface, const std::wstring& path)
{
    const auto expectedIface = kind == SupportedMouse::aerox9 ? 3 : 1;
    if (path.empty() || iface != expectedIface)
        return failed(kind, Status::unavailable, SupportedMouseReason::descriptor);
    const Handle file{CreateFileW(path.c_str(), GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
                                  nullptr, OPEN_EXISTING, FILE_FLAG_OVERLAPPED, nullptr)};
    if (!file) return failed(kind, Status::unavailable, SupportedMouseReason::open, GetLastError());
    HIDP_CAPS caps{};
    if (!descriptor(file.value, kind, iface, caps))
        return failed(kind, Status::unavailable, SupportedMouseReason::descriptor);
    const Handle event{CreateEventW(nullptr, TRUE, FALSE, nullptr)};
    if (!event) return failed(kind, Status::unavailable, SupportedMouseReason::open, GetLastError());

    std::array<std::uint8_t, 65> out{};
    const auto request = supportedMouseQuery(kind);
    for (std::size_t i = 0; i < request.size(); ++i) out[i] = request[i];
    const auto deadline = Clock::now() + 300ms;
    DWORD count{};
    const auto write = transfer(file.value, event.value, deadline, count, [&](OVERLAPPED* op) {
        return WriteFile(file.value, out.data(), caps.OutputReportByteLength, &count, op);
    });
    if (write || count != caps.OutputReportByteLength)
        return failed(kind, write == ERROR_TIMEOUT ? Status::timeout : Status::unavailable,
            SupportedMouseReason::write, write ? write : count);
    std::array<std::uint8_t, 65> frame{};
    bool invalid{};
    for (unsigned attempt = 0; attempt < 8 && Clock::now() < deadline; ++attempt) {
        const auto read = transfer(file.value, event.value, deadline, count, [&](OVERLAPPED* op) {
            return ReadFile(file.value, frame.data(), caps.InputReportByteLength, &count, op);
        });
        if (read == ERROR_TIMEOUT) break;
        if (read) return failed(kind, Status::unavailable, SupportedMouseReason::read, read);
        if (count != caps.InputReportByteLength) {
            invalid = true;
            continue;
        }
        const auto sample = parseSupportedMouseReply(kind, std::span(frame).first(count));
        if (sample.reading) return sample;
        invalid = invalid || sample.status == Status::bad_report;
        // A request echo should not mask a subsequent actual response.
    }
    return invalid ? failed(kind, Status::bad_report, SupportedMouseReason::invalidReply)
                   : failed(kind, Status::no_radio_reply, SupportedMouseReason::silent);
}
} // namespace pm
