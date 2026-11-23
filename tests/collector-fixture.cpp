#include "json.hpp"

#include <iostream>
#include <string>

int main()
{
    using nlohmann::json;
    for (std::string line; std::getline(std::cin, line);) {
        const auto request = json::parse(line);
        const auto action = request.at("action");
        json reply = {{"id", request.at("id")}};
        if (action == "hello") {
            reply["result"] = {{"protocol", 1}, {"doubleClickMs", 240}};
        } else if (action == "compatibility") {
            reply["result"] = {{"schemaVersion", 1}, {"hidInterfaces", json::array({
                {{"vid", 0x258a}, {"pid", 0x024f}, {"usagePage", 0xff02}, {"usage", 2}}})},
                {"recentSamples", json::array()}, {"logitechSlotAttempts", json::array()}};
        } else if (action == "metrics") {
            reply["result"] = nullptr;
        } else if (action == "scene") {
            reply["result"] = {{"mode", "desktop"}, {"allowed", true}, {"point", nullptr}};
        } else if (action == "poll") {
            const auto device = [](const char* id, const char* name, int value) {
                return json{{"id", id}, {"name", name}, {"connection", "USB"}, {"aliases", json::array()},
                    {"art", "mouse"}, {"voltage", nullptr}, {"sample", {
                        {"status", "current"}, {"reason", "Fixture battery reading"},
                        {"reading", {{"low", value}, {"high", value}, {"raw", value},
                                     {"power", "discharging"}, {"source", "hid"}}}
                    }}};
            };
            // The normal low-battery device deliberately precedes the critical one.
            reply["result"] = json::array({device("fixture-keyboard", "Fixture Keyboard", 16),
                                           device("fixture-mouse", "Fixture Mouse", 9)});
        } else {
            reply["error"] = "Unexpected fixture action";
        }
        std::cout << reply.dump() << std::endl;
    }
}
