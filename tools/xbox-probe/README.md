# Xbox Windows 身份验证探针

仅用于 Windows 实物验证。不会进入 PowerManager 默认构建、安装包、历史或告警，不会下载与安装依赖，不会发送手柄输入或者写报告。

在已备妥 Microsoft 官方 **GameInput v4 SDK 与匹配运行时**的 x64 Windows 测试环境中，从 Visual Studio x64 Native Tools 命令提示符构建。下方 `GI_INC` 和 `GI_LIB` 指向测试机现有的 SDK 目录，分别包含 `GameInput.h` 和 `GameInput.lib`。运行时安装与分发由测试环境负责人按 [官方说明](https://learn.microsoft.com/en-us/gaming/gdk/docs/features/common/input/overviews/input-nuget)处理，探针不接管。

```bat
cl /nologo /std:c++20 /EHsc /W4 /I"%GI_INC%" tools\xbox-probe\xbox_probe.cpp /Fe:xbox_probe.exe /link /LIBPATH:"%GI_LIB%" gameinput.lib xinput.lib cfgmgr32.lib setupapi.lib
xbox_probe.exe 30
```

可选参数为 1–60 次，约一秒一次，默认 20。仅 stdout 输出本次探针内 Pad 标签、微软 VID/PID、可证实的连接类型与原生档位或失败原因；路径和容器 ID 不输出，也不跨运行关联。XInput 槽位在读取前后复核，任何被观察到的换槽、重连或不唯一都会丢弃候选。GameInput 初次枚举与事件是异步的，比较前后状态与事件代数仍**不是**原子事务，不能排除未及时送达的设备事件。

- `physical_binding_unproven`：没有独立、与 GameInput 一致的当前 Windows PnP 容器，路径无法解析，非受检连接类型，或存在重复容器。不按名称、VID/PID 或 USB 适配器容器猜测。
- `slot_binding_unproven` / `binding_changed`：无法确认槽位唯一性，或读取中观察到设备状态变化，不采用读数。
- `empty` / `low` / `medium` / `full`：只有 XInput 返回已知无线电池类型时才记录。不声称是百分比或充电状态。
- `no_microsoft_gamepad_seen` 不是“不支持”；有些固件/驱动可能不用微软硬件 VID，GameInput 初次枚举也可能尚未完成。

适配器仅试验已知的 `045E:02E6/02FE` 两种，要求系统证明手柄容器与适配器容器不同；如果驱动未暴露这条拓扑，就保留待验。硬件 ID 线索来自 [xone](https://github.com/medusalix/xone/blob/master/transport/dongle.c)，不是 Windows 型号验证。测试顺序见[六条路径复测方案](../../docs/xbox-battery-validation.md)：先 Series 两种连接，再 One S 与 Elite 2。探针结果是研究记录，不改默认支持状态。

与 Windows API 无关的门禁单测可在其他系统运行：

```sh
c++ -std=c++20 -Wall -Wextra -Wpedantic -Werror tools/xbox-probe/sample_gate_test.cpp -o /tmp/pm-xbox-probe-test
/tmp/pm-xbox-probe-test
```
