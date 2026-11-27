#include "peripheral_protocol.hpp"

#include <cassert>
#include <iostream>

int main()
{
    using namespace pm;
    const auto k650 = logitechNamedIdentity(0x046d, 0xc548, 0xb36f, L"Signature K650 Keyboard", 0);
    assert(k650 && k650->batteryFeatures == (named_percent_1004 | named_legacy_1000));
    assert(!logitechNamedIdentity(0x046d, 0xc548, 0xb370, L"Signature K650", 0));
    assert(!logitechNamedIdentity(0x046d, 0xc548, 0xb36f, L"Signature K650 for Business", 0));
    assert(!logitechNamedIdentity(0x046d, 0xc52b, 0xb36f, L"Signature K650", 0));
    assert(!logitechNamedIdentity(0x046d, 0xc548, 0xb36f, L"Signature K650", 3));
    assert(peripheralTransport(0x320f, 0x5055) == Transport::vgn_usb);
    assert(peripheralTransport(0x320f, 0x5088) == Transport::vgn_receiver);
    assert(peripheralTransport(0x258a, 0x024e) == Transport::vgn_v3_usb);
    assert(peripheralTransport(0x258a, 0x024f) == Transport::vgn_v3_receiver);
    assert(peripheralTransport(0x046d, 0xc547) == Transport::logitech_receiver);
    assert(peripheralTransport(0x046d, 0xc54d) == Transport::logitech_receiver);
    for (const auto pid : {0xc088u, 0xc08du, 0xc094u, 0xc095u, 0xc098u, 0xc09bu}) {
        assert(peripheralTransport(0x046d, pid) == Transport::logitech_usb);
        assert(!logitechUsbName(0x1234, pid));
    }
    assert(!logitechUsbName(0x046d, 0xc539));
    assert(!logitechUsbName(0x046d, 0xc08b)); // Wired G502 HERO, not a battery device.
    assert(!peripheralTransport(0x046d, 0xc099)); // Wired-only G502 X.
    assert(std::wstring_view(logitechUsbName(0x046d, 0xc098)) == L"Logitech G502 X LIGHTSPEED");
    assert(std::wstring_view(logitechUsbName(0x046d, 0xc09b)) == L"Logitech PRO X SUPERLIGHT 2");
    assert(!logitechVoltageProfile(logitechUsbName(0x046d, 0xc098)));
    assert(!logitechVoltageProfile(logitechUsbName(0x046d, 0xc09b)));
    assert(logitechVoltageProfile(logitechUsbName(0x046d, 0xc08d)));
    assert(!logitechVoltageProfile(logitechUsbName(0x046d, 0xc095)));
    assert(!peripheralTransport(0x1234, 0xc547));
    assert(!peripheralTransport(0x258a, 0x0250));
    assert(!peripheralTransport(0x046d, 0xc00e));
    assert(std::wstring_view(sharedKeyboardLabel(Transport::vgn_usb, L"ATK V75X")) == L"ATK V75X");
    assert(std::wstring_view(sharedKeyboardLabel(Transport::vgn_receiver, L"ATK V75X Dongle")) == L"ATK V75X 接收器");
    assert(std::wstring_view(sharedKeyboardLabel(Transport::vgn_usb, L"ATK V75X Dongle")) == L"兼容 USB 键盘");
    assert(std::wstring_view(sharedKeyboardLabel(Transport::vgn_receiver, L"Unknown VGN V98 Pro")) == L"兼容键盘接收器");


    Collection outlet{L"", L"", 0xff02, 2, 19, 0, 19};
    const auto shortCommand = vgnQuery(Transport::vgn_v3_receiver, outlet);
    assert(shortCommand.size() == 19 && shortCommand[0] == 0x13 && shortCommand[1] == 0x4a && shortCommand.back() == 0);
    outlet.outputLength = 20;
    const auto longCommand = vgnQuery(Transport::vgn_v3_receiver, outlet);
    assert(longCommand.size() == 20 && longCommand.back() == 0x5e);
    outlet.usage = 1;
    assert(vgnQuery(Transport::vgn_v3_receiver, outlet).empty());
    outlet.featureLength = 521;
    const auto feature = vgnQuery(Transport::vgn_v3_usb, outlet);
    assert(feature.size() == 521 && feature[0] == 9 && feature[1] == 0x87);
    const std::uint8_t oldUsb[] = {4, 0, 0, 0x1a, 6, 0, 0, 0, 100, 1};
    assert(parseVgn(Transport::vgn_usb, oldUsb)->reading->power == Power::charging);
    assert(parseVgn(Transport::vgn_receiver, oldUsb)->reading->high == 100);
    const std::uint8_t wiredV3[] = {9, 0x87, 0, 0, 1, 0, 2, 0, 0, 57, 0x10};
    assert(parseVgn(Transport::vgn_v3_usb, wiredV3)->reading->low == 57);
    assert(parseVgn(Transport::vgn_v3_usb, wiredV3)->reading->power == Power::charging);
    assert(!parseVgn(Transport::vgn_v3_usb, oldUsb));
    std::uint8_t frame[] = {0x13, 0x4a, 1, 0, 2, 72, 0x10};
    assert(!parseVgn(Transport::vgn_v3_receiver, std::span(frame).first(6)));
    assert(parseVgn(Transport::vgn_v3_receiver, frame)->reading->low == 72);
    frame[4] = 1;
    assert(parseVgn(Transport::vgn_v3_receiver, frame)->status == Status::no_radio_reply);
    frame[4] = 2;
    frame[5] = 0;
    assert(!parseVgn(Transport::vgn_v3_receiver, frame)->reading);
    frame[5] = 101;
    assert(parseVgn(Transport::vgn_v3_receiver, frame)->status == Status::bad_report);

    const std::uint8_t reply[20] = {0x11, 2, 5, 0x1b, 0, 1, 0};
    assert(!parseLogitechReply(reply, 1, 5, 0x1b));
    assert(!parseLogitechReply(reply, 2, 4, 0x1b));
    assert(!parseLogitechReply(reply, 2, 5, 0x1a));
    assert(!parseLogitechReply(std::span(reply).first(19), 2, 5, 0x1b));
    assert(!parseLogitechReply(std::span(reply).first(7), 2, 5, 0x1b));
    const auto valid = parseLogitechReply(reply, 2, 5, 0x1b);
    assert(valid && logitechBattery(0x1004, true, valid->params).reading->low == 0);
    assert(!logitechBattery(0x1004, false, valid->params).reading);
    const std::uint8_t paddedShort[20] = {0x10, 2, 5, 0x1b, 87, 4, 0, 255};
    assert(parseLogitechReply(paddedShort, 2, 5, 0x1b)->params.size() == 3);
    assert(!parseLogitechReply(std::span(paddedShort).first(6), 2, 5, 0x1b));
    const std::uint8_t protocolError[] = {0x10, 2, 0x8f, 5, 0x1b, 8, 0};
    assert(parseLogitechReply(protocolError, 2, 5, 0x1b)->error == 8);
    const std::uint8_t boltBusy[20] = {0x11, 2, 0xff, 5, 0x1b, 8};
    const auto busy = parseLogitechReply(boltBusy, 2, 5, 0x1b);
    const auto removed = parseLogitechReply(protocolError, 2, 5, 0x1b);
    assert(busy && logitechErrorStatus(busy->errorFrame, busy->error) == Status::busy);
    assert(removed && logitechErrorStatus(removed->errorFrame, removed->error) == Status::offline);
    assert(logitechErrorStatus(0xff, 9) == Status::unavailable);
    assert(!parseLogitechReply(boltBusy, 1, 5, 0x1b));
    const auto keyboard = boltOfficeIdentity(0x046d, 0xc548, L"MX KEYS S");
    const auto mouse = boltOfficeIdentity(0x046d, 0xc548, L"Logitech MX Master 3S");
    assert(keyboard && keyboard->kind == 0 && std::wstring_view(keyboard->label) == L"MX Keys S");
    assert(mouse && mouse->kind == 3 && std::wstring_view(mouse->label) == L"MX Master 3S");
    assert(!boltOfficeIdentity(0x046d, 0xc52b, L"MX Keys S"));
    assert(!boltOfficeIdentity(0x046d, 0xc548, L"MX Keys"));
    assert(!boltOfficeIdentity(0x046d, 0xc548, L"Logi Bolt Receiver"));
    // A full reply from the actual paired device, not the receiver name.
    std::uint8_t boltInfo[20] = {0x11, 2, 4, 0x0b, 3, 0x11, 0x22, 0x33, 0x44, 0, 2, 0xb0, 0x42};
    const auto boltInfoReply = parseLogitechReply(boltInfo, 2, 4, 0x0b);
    assert(boltInfoReply && boltOfficeModel(boltInfoReply->params) == 0xb042);
    assert(!parseLogitechReply(boltInfo, 1, 4, 0x0b));
    assert(!parseLogitechReply(boltInfo, 2, 4, 0x0a));
    assert(!boltOfficeModel(boltInfoReply->params.first(12)));
    boltInfo[10] = 1;
    assert(!boltOfficeModel(boltInfoReply->params));
    boltInfo[10] = 2;
    boltInfo[13] = 1;
    assert(!boltOfficeModel(boltInfoReply->params));

    struct BoltCase { unsigned model; const wchar_t* deviceName; const wchar_t* label; unsigned kind; };
    constexpr BoltCase namedBatches[] = {
        {0xb042, L"MX Master 4", L"MX Master 4", 3},
        {0xb037, L"MX Anywhere 3S", L"MX Anywhere 3S", 3},
        {0xb369, L"MX KEYS MINI", L"MX Keys Mini", 0},
        {0xb031, L"LIFT VERTICAL ERGONOMIC MOUSE", L"Lift Vertical Ergonomic Mouse", 3},
        {0xb02a, L"Signature M650 Mouse", L"Signature M650", 3},
    };
    for (const auto& entry : namedBatches) {
        const auto named = boltBatch11Identity(0x046d, 0xc548, entry.model, entry.deviceName, entry.kind);
        assert(named && named->label == std::wstring_view(entry.label) && named->kind == entry.kind);
        assert(!boltBatch11Identity(0x046d, 0xc548, 0, entry.deviceName, entry.kind));
        assert(!boltBatch11Identity(0x046d, 0xc52b, entry.model, entry.deviceName, entry.kind));
        assert(!boltBatch11Identity(0x1234, 0xc548, entry.model, entry.deviceName, entry.kind));
        assert(!boltBatch11Identity(0x046d, 0xc548, entry.model, entry.deviceName, entry.kind == 0 ? 3 : 0));
    }
    assert(!boltBatch11Identity(0x046d, 0xc548, 0xb02a, L"Signature M650 L Mouse", 3));
    assert(!boltBatch11Identity(0x046d, 0xc548, 0xb02a, L"Logi M650", 3));
    assert(!boltBatch11Identity(0x046d, 0xc548, 0xb037, L"MX Anywhere 3S for Business", 3));
    assert(!boltBatch11Identity(0x046d, 0xc548, 0xb038, L"MX Anywhere 3S", 3));
    struct Office12Case { unsigned model; const wchar_t* firmwareName; const wchar_t* label; unsigned kind; };
    constexpr Office12Case unifyingCases[] = {
        {0x4051, L"Wireless Mouse M510", L"M510 v2", 3},
        {0x405e, L"M720 Triathlon Multi-Device Mouse", L"M720 Triathlon", 3},
        {0x4069, L"Wireless Mouse MX Master 2S", L"MX Master 2S", 3},
        {0x408a, L"MX Keys Wireless Keyboard", L"MX Keys", 0},
        {0x4088, L"Wireless Keyboard ERGO K860", L"ERGO K860", 0},
        {0x405b, L"Wireless Multi-Device Keyboard K780", L"K780", 0},
    };
    for (const auto& row : unifyingCases) {
        const auto found = logitechNamedIdentity(0x046d, 0xc52b, row.model, row.firmwareName, row.kind);
        assert(found && found->model == row.model && found->kind == row.kind &&
               found->label == std::wstring_view(row.label) && found->batteryFeatures == named_legacy_1000);
        assert(logitechNamedIdentity(0x046d, 0xc532, row.model, row.firmwareName, row.kind));
        assert(!logitechNamedIdentity(0x046d, 0xc548, row.model, row.firmwareName, row.kind));
        assert(!logitechNamedIdentity(0x046d, 0xc52b, 0, row.firmwareName, row.kind));
        assert(!logitechNamedIdentity(0x046d, 0xc52b, row.model, L"USB Receiver", row.kind));
        assert(!logitechNamedIdentity(0x046d, 0xc52b, row.model, row.firmwareName,
                                      row.kind == 0 ? 3 : 0));
    }
    // Solaar #3156 observed receiver pairing label K360/4004, but the live
    // device reports 4051 and Wireless Mouse M510; redact the captured unit.
    const std::uint8_t m510Info[20]{0x11, 2, 2, 0x09, 1, 0x11, 0x22, 0x33, 0x44, 0, 4, 0x40, 0x51};
    const auto m510InfoReply = parseLogitechReply(m510Info, 2, 2, 0x09);
    assert(m510InfoReply && logitechReportedModel(m510InfoReply->params, 4) == 0x4051);
    assert(!parseLogitechReply(m510Info, 1, 2, 0x09));
    assert(!logitechNamedIdentity(0x046d, 0xc52b, 0x4008, L"Wireless Mouse M510", 3));
    assert(!logitechNamedIdentity(0x046d, 0xc52b, 0x1025, L"Wireless Mouse M510", 3));
    assert(!logitechNamedIdentity(0x046d, 0xc52b, 0x4004, L"Wireless Mouse M510", 3));
    assert(!logitechNamedIdentity(0x046d, 0xc52b, 0x4051, L"Wireless Keyboard K360", 3));
    assert(!logitechNamedIdentity(0x046d, 0xc52b, 0x4051, L"Wireless Mouse M510", 255));
    const std::uint8_t m510Battery[] = {70, 5, 0};
    const auto m510Bucket = logitechBattery(0x1000, true, m510Battery, true).reading;
    assert(m510Bucket && m510Bucket->low == 31 && m510Bucket->high == 80 && m510Bucket->raw == 70);
    constexpr std::uint8_t unifyingInfo[] = {3, 0x11, 0x22, 0x33, 0x44, 0, 6, 0xb0, 0x15, 0x40, 0x5e, 0, 0};
    static_assert(logitechReportedModel(unifyingInfo, 4) == 0x405e);
    static_assert(logitechReportedModel(unifyingInfo, 2) == 0xb015);
    static_assert(logitechReportedModel(std::span(unifyingInfo).first(12), 4) == 0);
    constexpr std::uint8_t k650Info[] = {3, 0x11, 0x22, 0x33, 0x44, 0, 2, 0xb3, 0x6f, 0, 0, 0, 0};
    static_assert(logitechReportedModel(k650Info, 2) == 0xb36f);
    static_assert(logitechReportedModel(k650Info, 4) == 0);
    // Reserve both variants until the live retail report and battery capabilities are verified.
    assert(!logitechNamedIdentity(0x046d, 0xc548, 0xb370, L"Signature K650 Keyboard", 0));
    assert(!logitechNamedIdentity(0x046d, 0xc548, 0xb36f, L"Signature K650 for Business", 0));
    const std::uint8_t legacyDiscrete[] = {4, 2}, legacyNoMileage[] = {20, 0}, legacyMileage[] = {20, 2};
    const std::uint8_t legacyMissing[] = {0, 0}, legacyCorrupt[] = {255, 2};
    assert(namedLegacyCoarse(legacyDiscrete) == true);
    assert(namedLegacyCoarse(legacyNoMileage) == true);
    assert(namedLegacyCoarse(legacyMileage) == false);
    assert(!namedLegacyCoarse(legacyMissing) && !namedLegacyCoarse(legacyCorrupt));
    // The two slots on one receiver return distinct battery values.
    const std::uint8_t keysBattery[20] = {0x11, 1, 8, 0x1a, 40, 4, 0};
    const std::uint8_t mouseBattery[20] = {0x11, 2, 8, 0x1a, 76, 4, 1};
    assert(!parseLogitechReply(mouseBattery, 1, 8, 0x1a));
    assert(logitechBattery(0x1004, true, parseLogitechReply(keysBattery, 1, 8, 0x1a)->params).reading->high == 40);
    const auto mouseReading = logitechBattery(0x1004, true, parseLogitechReply(mouseBattery, 2, 8, 0x1a)->params);
    assert(mouseReading.reading && mouseReading.reading->low == 76 && mouseReading.reading->power == Power::charging);
    // Synthetic HID++ frames reproducing the 54% / 61% upstream observations.
    const std::uint8_t superlight2Battery[20] = {0x11, 1, 6, 0x1a, 54, 0, 0};
    const std::uint8_t g502XBattery[20] = {0x11, 2, 6, 0x1a, 61, 0, 0};
    for (const auto* response : {&superlight2Battery, &g502XBattery}) {
        const unsigned slot = (*response)[1], percent = (*response)[4];
        assert(!parseLogitechReply(*response, 3 - slot, 6, 0x1a));
        const auto reply = parseLogitechReply(*response, slot, 6, 0x1a);
        assert(reply);
        const auto current = logitechBattery(0x1004, true, reply->params);
        assert(current.reading && current.reading->low == static_cast<int>(percent) &&
               current.reading->high == static_cast<int>(percent) && current.reading->power == Power::discharging);
    }
    const std::uint8_t legacyCharging[] = {0, 0, 1};
    assert(!logitechBattery(0x1000, true, legacyCharging).reading);
    const std::uint8_t legacyFull[] = {0, 0, 3};
    assert(logitechBattery(0x1000, true, legacyFull).reading->low == 100);
    const std::uint8_t legacyError[] = {0, 0, 7};
    assert(logitechBattery(0x1000, true, legacyError).status == Status::charging_error);
    const std::uint8_t legacyBucket[] = {30, 10, 0};
    const auto range = logitechBattery(0x1000, true, legacyBucket, true).reading;
    assert(range && range->low == 11 && range->high == 30 && range->raw == 30);
    const std::uint8_t voltage[] = {0x0f, 0x42, 0};
    const auto voltageOnly = logitechBattery(0x1001, true, voltage);
    assert(!voltageOnly.reading && voltageOnly.millivolts == 3906);
    const auto gpw = logitechBattery(0x1001, true, voltage, false,
        logitechVoltageProfile(L"G Pro Wireless Gaming Mouse"));
    assert(gpw.reading && gpw.reading->low == 60 && gpw.reading->high == 70);
    assert(gpw.reading->source == ReadingSource::hid_voltage);
    assert(logitechVoltageProfile(L"G502 LIGHTSPEED Wireless Gaming Mouse"));
    assert(logitechVoltageProfile(L"G Pro Wireless Gaming Mouse"));
    assert(logitechVoltageProfile(logitechUsbName(0x046d, 0xc088)));
    assert(!logitechVoltageProfile(L"G PRO X SUPERLIGHT"));
    assert(!logitechVoltageProfile(L"G PRO Wireless Headset"));
    assert(!logitechVoltageProfile(L"G502 X PLUS"));
    assert(!logitechVoltageProfile(L"Logitech HID++ 外设"));
    const std::uint8_t reportedG502[] = {0x10, 0x13, 0};
    const auto estimate = logitechBattery(0x1001, true, reportedG502, false, true);
    assert(estimate.status == Status::current && estimate.millivolts == 4115);
    assert(estimate.reading->low == 90 && estimate.reading->high == 100);
    assert(estimate.reading->source == ReadingSource::hid_voltage);
    const std::uint8_t lowG502[] = {0x0e, 0x4c, 0};
    const auto low = logitechBattery(0x1001, true, lowG502, false, true).reading;
    assert(low && low->low == 0 && low->high == 10);
    const std::uint8_t chargingG502[] = {0x10, 0x13, 0x80};
    assert(!logitechBattery(0x1001, true, chargingG502, false, true).reading);
    const std::uint8_t fullG502[] = {0x10, 0x13, 0x81};
    assert(logitechBattery(0x1001, true, fullG502, false, true).reading->power == Power::full);
    const std::uint8_t oddCurve[] = {0x12, 0x00, 0};
    assert(!logitechBattery(0x1001, true, oddCurve, false, true).reading);
    const std::uint8_t placeholder[] = {0xff, 0xff, 0};
    assert(logitechBattery(0x1001, true, placeholder).status == Status::bad_report);
    std::cout << "VGN and Logitech model, protocol, and precision boundaries passed\n";
}
