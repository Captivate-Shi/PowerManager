#include "rapoo_battery.hpp"
#include "langtu_t98.hpp"

#include <windows.h>
extern "C" {
#include <hidsdi.h>
#include <hidpi.h>
}

#include <array>

namespace pm {
namespace {

Sample rapooStatus(Status status, RapooDetail detail, unsigned error = 0)
{
    return {status, {}, 0x07, static_cast<unsigned>(detail), error};
}

unsigned rapooDescriptor(HANDLE file, bool langtu)
{
    HIDD_ATTRIBUTES attributes{sizeof(HIDD_ATTRIBUTES)};
    if (!HidD_GetAttributes(file, &attributes) ||
        (!langtu && !isRapooReceiver(attributes.VendorID, attributes.ProductID))) return 0;

    PHIDP_PREPARSED_DATA data{};
    if (!HidD_GetPreparsedData(file, &data)) return 0;
    HIDP_CAPS caps{};
    bool proven = false;
    if (langtu) {
        proven = HidP_GetCaps(data, &caps) == HIDP_STATUS_SUCCESS &&
            langtuT98Collection(attributes.VendorID, attributes.ProductID, 0, caps.UsagePage, caps.Usage,
                                caps.InputReportByteLength, caps.OutputReportByteLength);
    } else if (HidP_GetCaps(data, &caps) == HIDP_STATUS_SUCCESS &&
        isRapooBatteryCollection(caps.UsagePage, caps.Usage, caps.InputReportByteLength)) {
        // The captured 1411 descriptor has exactly one fixed-usage Data/Array
        // input field and no value caps. With this sole ID, the 19-byte
        // collection report length applies to 07; no other report is supported.
        if (caps.NumberInputButtonCaps == 1 && caps.NumberInputValueCaps == 0) {
            USHORT buttons = 1;
            HIDP_BUTTON_CAPS cap{};
            proven = HidP_GetButtonCaps(HidP_Input, &cap, &buttons, data) == HIDP_STATUS_SUCCESS
                && buttons == 1 && cap.ReportID == 0x07 && cap.UsagePage == 0xff00
                && !cap.IsAlias && !cap.IsRange
                && cap.NotRange.Usage == 0x0002 && (cap.BitField & 0x07) == 0;
        }
    }
    HidD_FreePreparsedData(data);
    return proven ? attributes.ProductID : 0;
}

} // namespace

struct RapooBatteryReader::Endpoint {
    HANDLE file{INVALID_HANDLE_VALUE};
    HANDLE event{};
    OVERLAPPED io{};
    std::array<std::uint8_t, 65> report{};
    unsigned length{};
    unsigned pid{};
    bool pending{};

    ~Endpoint()
    {
        if (pending) {
            CancelIoEx(file, &io);
            DWORD ignored{};
            GetOverlappedResult(file, &io, &ignored, TRUE);
        }
        if (event) CloseHandle(event);
        if (file != INVALID_HANDLE_VALUE) CloseHandle(file);
    }
};

RapooBatteryReader::RapooBatteryReader() = default;
RapooBatteryReader::~RapooBatteryReader() = default;

Sample RapooBatteryReader::read(const std::wstring& path, bool langtu)
{
    if (path.empty()) return rapooStatus(Status::unavailable, RapooDetail::descriptorMismatch);
    auto iter = endpoints_.find(path);
    if (iter == endpoints_.end()) {
        auto endpoint = std::make_unique<Endpoint>();
        endpoint->file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                                    nullptr, OPEN_EXISTING, FILE_FLAG_OVERLAPPED, nullptr);
        if (endpoint->file == INVALID_HANDLE_VALUE)
            return rapooStatus(Status::unavailable, RapooDetail::openFailed, GetLastError());
        if (!(endpoint->pid = rapooDescriptor(endpoint->file, langtu)))
            return rapooStatus(Status::unavailable, RapooDetail::descriptorMismatch);
        endpoint->length = langtu ? 65 : 19;
        endpoint->event = CreateEventW(nullptr, TRUE, FALSE, nullptr);
        if (!endpoint->event)
            return rapooStatus(Status::unavailable, RapooDetail::openFailed, GetLastError());
        iter = endpoints_.emplace(path, std::move(endpoint)).first;
    }

    auto& endpoint = *iter->second;
    Sample newest = rapooStatus(Status::unavailable, RapooDetail::noFreshReport);
    // Drain completions already available and arm exactly one pending read.
    // No worker, spin-wait, output/feature calls or radio activation.
    for (unsigned n = 0; n < 64; ++n) {
        DWORD bytes{};
        if (endpoint.pending) {
            if (!GetOverlappedResult(endpoint.file, &endpoint.io, &bytes, FALSE)) {
                const auto error = GetLastError();
                if (error == ERROR_IO_INCOMPLETE) break;
                endpoint.pending = false;
                endpoints_.erase(iter);
                return rapooStatus(Status::unavailable, RapooDetail::readFailed, error);
            }
            endpoint.pending = false;
        } else {
            ResetEvent(endpoint.event);
            endpoint.io = {};
            endpoint.io.hEvent = endpoint.event;
            if (!ReadFile(endpoint.file, endpoint.report.data(), static_cast<DWORD>(endpoint.length),
                          &bytes, &endpoint.io)) {
                const auto error = GetLastError();
                if (error == ERROR_IO_PENDING) {
                    endpoint.pending = true;
                    break;
                }
                endpoints_.erase(iter);
                return rapooStatus(Status::unavailable, RapooDetail::readFailed, error);
            }
        }
        const auto frame = std::span(endpoint.report).first(endpoint.length);
        const auto parsed = bytes == endpoint.length
            ? (langtu ? parseLangtuT98(frame) : parseRapooBatteryReport(frame, endpoint.pid))
            : Sample{Status::bad_report};
        if (parsed.reading || parsed.status == Status::offline) newest = parsed;
        else if ((langtu && parsed.status == Status::unavailable) || rapooFamilyReceiver(endpoint.pid) || (endpoint.pid == 0x1421 && parsed.status == Status::unavailable))
            newest = rapooStatus(Status::unavailable, RapooDetail::noFreshReport);
        else if (!newest.reading && newest.status != Status::offline) newest = rapooStatus(Status::bad_report, RapooDetail::invalidReport, bytes);
    }
    return newest;
}

void RapooBatteryReader::retainPaths(const std::set<std::wstring>& active)
{
    std::erase_if(endpoints_, [&](const auto& entry) { return !active.contains(entry.first); });
}

} // namespace pm
