# Xbox 三款手柄电量验证

第 13 批验证了当前代码、Windows 接口和六条连接路径的验收条件；没有连接实物，**六条都待验**。这一批不新增 Xbox 电量采集路径，也不改变 Windows 已能提供的设备电量显示。

| 手柄 | 蓝牙 | Microsoft Xbox 无线适配器 |
| --- | --- | --- |
| Xbox Series（1914） | 优先验证。SDL 的型号线索为 `045E:0B13`（BLE）；核对实际 Windows 控制器容器、固件和电量来源。 | 优先验证。核对适配器下是否有独立的控制器设备节点及身份，再测试电量；不能使用适配器本身的 VID/PID 或容器替代手柄。 |
| Xbox One S（1708） | 待验。SDL 列出 `045E:02E0` / `02FD` 和 BLE 的 `0B20`；记录实际固件与所走路径，不把一个固件的结果扩到另一个。 | 待验。Series 链路通过后，用这款实物单独验证电池档位、换槽和重连。 |
| Xbox Elite Series 2（1797） | 待验。SDL 区分 `045E:0B05` 与 BLE 的 `0B22`；验证内置电池的读数与充电语义。 | 待验。Series 链路通过后，单独验证这款的身份与内置电池；XInput 不认识电池类型时不显示档位。 |

表中的 PID 是 [SDL 型号线索](https://github.com/libsdl-org/SDL/blob/main/src/joystick/controller_list.h)，不是 Windows 上所有固件的允收项。SDL 也实现了 [蓝牙 HID 电池报文读取](https://github.com/libsdl-org/SDL/blob/main/src/joystick/hidapi/SDL_hidapi_xboxone.c)，但其中的数字是档位映射，并不证明 Windows 可在不干扰输入的情况下从这些固件被动读到相同报文，也不是原生百分比。

## 为什么不能把现有诊断条目合起来

- WGI 的 [`RawGameController.TryGetBatteryReport()`](https://learn.microsoft.com/en-us/uwp/api/windows.gaming.input.rawgamecontroller.trygetbatteryreport) 和电量属于同一个控制器对象；可在两个 mWh 容量字段均有效时计算 `剩余 / 充满`，不得拿设计容量、空值或仅有充电状态代替。微软说明 [`NonRoamableId`](https://learn.microsoft.com/en-us/uwp/api/windows.gaming.input.rawgamecontroller.nonroamableid) 标识该控制器，但没有承诺它等于 PnP 实例或 Container ID。不要按字符串结构解析、按枚举顺序配对，也不要单凭 VID/PID 或设备名去重。
- [`XInputGetBatteryInformation`](https://learn.microsoft.com/en-us/windows/win32/api/xinput/nf-xinput-xinputgetbatteryinformation) 只按槽位读。仅按 [公开结构定义](https://learn.microsoft.com/en-us/windows/win32/api/xinput/ns-xinput-xinput_battery_information) 接受有明确类型的无线电池以及 Empty / Low / Medium / Full 枚举；不换算百分比、不推断充电。未知电池、USB 供电、掉线、异常值都不给当前电量。
- 后续有一条受文档支持的身份桥：在授权的 Windows 测试机上，用 Microsoft.GameInput **v4 或更高的 SDK 和与之匹配的运行时**（[PC 部署说明](https://learn.microsoft.com/en-us/gaming/gdk/docs/features/common/input/overviews/input-nuget)）。先从 [同一个 GameInput 设备](https://learn.microsoft.com/en-us/gaming/gdk/docs/reference/input/gameinput/interfaces/igameinputdevice/igameinputdevice?view=gdk-2510) 取 PnP 接口及 Container ID，核对到 [独立的手柄 PnP 容器](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/devpkey-device-containerid)；无对应、容器共享、虚拟/汇总设备或同一手柄出现多个模糊候选时停止，不凭适配器推断。再调用 [`GetXInputDeviceIndex`](https://learn.microsoft.com/en-us/gaming/gdk/docs/reference/input/gameinput/interfaces/igameinputdevice/methods/igameinputdevice_getxinputdeviceindex?view=gdk-2510)；只有返回 `true` 才读槽位。读前后分别确认同一 GameInput 设备仍在线、路径和容器一致、槽位仍属于它且这段时间没有换槽或连接变更事件，任何变化都丢弃样本。这是竞态防护，不是 API 原子保证；不缓存槽位去匹配下一次。v1 起已移除 `GetBatteryState`，不要把 v4 的身份桥误写成 v4 原生电量读取。此方案属于后续验证，不是本批运行时依赖。

## 实物复测顺序

1. 在 Windows 上从仓库执行 `pnpm run build:native`。同一轮只切换一种连接：蓝牙测试先拔掉无线适配器和 USB 线；适配器测试排除这只手柄的蓝牙及有线连接。手动记录 Windows 版本、手柄型号/固件、适配器型号及参考电量档位，不记录序列号、蓝牙地址或完整 PnP 路径。
2. 每换一种状态执行 `& .\.native\collector.exe --inventory`。先录无手柄基线，再录只接一台、双台电量不同的同款手柄、关掉其中一台、重连并交换开机顺序；再测低电、充电（机型支持时）、睡眠唤醒和拔适配器。USB 插线用于负例，不计入这六条。
3. 用 `windowsDevices` 判断 Windows 电量是否已绑定到设备行，用 `gamepads.windowsGamingInput` 和 `gamepads.xinput` 分别判断接口是否提供电量。各自的槽位、排序和报告内临时 `target` 不能作为跨表或跨采样的身份证据。现有输出能验证接口有没有值、档位有没有变，**不能验证 GameInput 身份桥**；该桥需在单独探针上实测，只保留脱敏的是否匹配/换槽结果。
4. 通过条件：双台同款不串读数；换槽、休眠、断开后不沿用旧值；无实际百分比只显示原生档位；并在 Steam 或实际游戏运行时复查输入不受影响。只有对应 **型号 × 连接** 的 Windows 实测通过才更新支持表，不能用 Series 单项测试给其他型号打勾。

### 第 14 批：独立验证探针

[Windows 实机探针](../tools/xbox-probe/README.md)可在已准备 GameInput v4 SDK 的测试机上手动构建，不参与应用构建与安装。其便携测试覆盖读数前后身份变化、换槽、无有效无线电池和原生档位；它不等于 Windows SDK 编译或实体手柄验收。
