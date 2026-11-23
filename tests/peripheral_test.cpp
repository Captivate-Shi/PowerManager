#include "peripheral_protocol.hpp"

#include <cassert>
#include <iostream>

int main()
{
    using namespace pm;
    assert(peripheralTransport(0x320f, 0x5055) == Transport::vgn_usb);
    assert(peripheralTransport(0x320f, 0x5088) == Transport::vgn_receiver);
    assert(peripheralTransport(0x258a, 0x024e) == Transport::vgn_v3_usb);
    assert(peripheralTransport(0x258a, 0x024f) == Transport::vgn_v3_receiver);
    assert(peripheralTransport(0x046d, 0xc547) == Transport::logitech_receiver);
    assert(!peripheralTransport(0x1234, 0xc547));
    assert(!peripheralTransport(0x258a, 0x0250));
    assert(!peripheralTransport(0x046d, 0xc00e));

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

    const std::uint8_t reply[] = {0x11, 2, 5, 0x1b, 0, 1, 0};
    assert(!parseLogitechReply(reply, 1, 5, 0x1b));
    assert(!parseLogitechReply(reply, 2, 4, 0x1b));
    assert(!parseLogitechReply(reply, 2, 5, 0x1a));
    const auto valid = parseLogitechReply(reply, 2, 5, 0x1b);
    assert(valid && logitechBattery(0x1004, true, valid->params).reading->low == 0);
    assert(!logitechBattery(0x1004, false, valid->params).reading);
    const std::uint8_t protocolError[] = {0x10, 2, 0x8f, 5, 0x1b, 8};
    assert(parseLogitechReply(protocolError, 2, 5, 0x1b)->error == 8);
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
    const std::uint8_t placeholder[] = {0xff, 0xff, 0};
    assert(logitechBattery(0x1001, true, placeholder).status == Status::bad_report);
    std::cout << "VGN and Logitech model, protocol, and precision boundaries passed\n";
}
