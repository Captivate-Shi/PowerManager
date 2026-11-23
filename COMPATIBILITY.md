# 外设电量读取与集成评估

## 检测、读数和精度

Windows 能识别外设只说明系统看到了相应接口。要读到剩余电量，还需要设备固件、接收器或驱动通过标准接口或型号专有协议提供电量数据。

| 连接方式 | H5 1.4.0 当前路径 | 覆盖边界 |
| --- | --- | --- |
| USB | Windows 电量属性、DualSense USB HID、VGN V98 Pro 原版／V2 与 V3 有线适配 | 普通 USB 鼠标、键盘和接收器可能只暴露输入接口。即便 USB-IF 定义了电池和电量用途，也需要设备实际实现。Windows 显示 USB 时，H5 标为「USB（直连或接收器）」。 |
| 2.4 GHz 私有接收器 | Razer Viper V3 HyperSpeed 与受支持的共享接收器键盘、VGN V98 Pro 原版／V2 与 V3 接收器、已识别的 Logitech HID++ 2.0 接收器 | USB 总线一般只识别到接收器。精确匹配接收器型号、配对槽位及固件上报后，才能区分每件外设。H5 只把明确适配的无线线路标为 2.4 GHz。 |
| 蓝牙 | Windows 已提供的电量百分比，或 DualSense 蓝牙 HID | BLE 设备可实现 Battery Service 及 Battery Level（`0x180F`、`0x2A19`）。蓝牙经典设备、模糊的系统缓存、多个电池的耳机和充电盒需分别处理。直接 GATT 读取和耳机分电池展示均属于后续适配。 |
| Xbox 和其他游戏手柄 | Windows 可读设备可以被发现并添加 | XInput 只暴露有限电量档位，插线与未知电池类型也没有可靠剩余百分比。继续做 Xbox 适配时，优先评估 Windows.Gaming.Input 的 TryGetBatteryReport，再用 XInput 档位作为回退。按实体标识验证 USB、蓝牙与无线适配器去重。 |

Windows 发现阶段已根据总线和硬件 ID 区分蓝牙、USB 与连接方式未知。通用 HID 名称不会被自动认定是某种无线协议。查找列表会显示「Windows 暂无可用电量」，只有读到有效电量的外设才可作为通用设备添加。已适配设备使用自己的协议状态。

- **系统百分比**来自 Windows 或设备固件给出的剩余容量。对于真实容量，精度取决于外设本身的电量计、固件和使用条件。
- **Razer**由设备刻度换算成显示百分比。**DualSense**的 HID 电量有分档，详情保留区间，提醒用区间上限判断。暂时断开或读取失败时可以保留上次有效值，旧值不会触发新提醒。
- **磷酸铁锂**在很大荷电区间内开路电压很平。单次电压还会受负载、温度、静置时间和滞后影响。仅有电压时，可把它用作诊断。本应用目前只在 DualSense 实验路径记录电压。可靠的百分比应来自针对电池化学和容量校准的电量计，例如使用电流积分并结合电压与温度补偿。Windows 找到的百分比仍可能是外设估算出来的。

资料：[Windows 设备属性](https://learn.microsoft.com/en-us/windows/apps/develop/devices-sensors/device-information-properties) · [USB-IF 电源设备用途](https://www.usb.org/sites/default/files/pdcv11.pdf) · [Bluetooth SIG Battery Service](https://www.bluetooth.com/specifications/specs/battery-service/) · [XInput 电池信息](https://learn.microsoft.com/en-us/windows/win32/api/xinput/ns-xinput-xinput_battery_information) · [Windows 游戏控制器电池报告](https://learn.microsoft.com/en-us/uwp/api/windows.gaming.input.rawgamecontroller.trygetbatteryreport) · [Windows GATT 读取](https://learn.microsoft.com/en-us/windows/win32/api/bluetoothleapis/nf-bluetoothleapis-bluetoothgattgetcharacteristicvalue) · [TI 磷酸铁锂电量计分析](https://www.ti.com/lit/an/slyt402/slyt402.pdf)

## VGN 和 Logitech 本轮接入

| 型号或设备路径 | 实现与证据 |
| --- | --- |
| VGN V98 Pro 原版／V2 USB `320F:5055` | 维盛 Output/Input 报文。上游有实测，H5 已通过报文测试。 |
| VGN V98 Pro 原版／V2 2.4 GHz `320F:5088` | 同族电量报文按精确 ID 和描述符匹配。等待用户实机验证。 |
| VGN V98 Pro V3 USB `258A:024E` | 北鹰 Feature 电量查询，限定厂商用途页与描述符长度。等待用户实机验证。 |
| VGN V98 Pro V3 2.4 GHz `258A:024F` | 匹配已报道的厂商通道 `FF02:0002`，按描述符处理 19 字节和带校验的 20 字节格式。无线应答需确认当前模式，0% 占位暂视为未知。19 字节路径有独立上游实测。USB 和接收器线路分开记录，缺少可验证的跨线路设备身份时可出现两条记录。 |
| VGN V98 Pro V4 与其他 VGN 协议 | 先导出报告核对实际 VID/PID、版本与报文接口。V4 的 VIA 路径单独评估。蓝牙继续以 Windows 可用的电量为准。 |
| Logitech LIGHTSPEED、Bolt、Unifying、部分 Nano | 已接入限定接收器表和 HID++ 2.0 的只读槽位轮询。匹配槽位和设备实体后才绑定读数。能够取得稳定的单元标识后进入自动监测。百分比支持声明明确时使用 `0x1004`，有 `0x1000` 时区分低分辨率档位、充满状态和未知值。HID++ 1.0 与 Centurion 另行适配。 |
| Logitech 电压型设备，例如部分 G502 LIGHTSPEED | `0x1001` 可记下毫伏值供比对。G502 X PLUS 等上报原生百分比的型号走数字读数路径。不同厂商、电池或充电状态不共用一条电压曲线。 |

型号和协议依据：[VGNKeyboardBattery](https://github.com/MuyuDada/VGNKeyboardBattery) · [wdbattery 的 V3 实测](https://github.com/RIVERCROFT111/wdbattery) · [Logitech 公共协议](https://github.com/Logitech/cpg-docs) · [Solaar 接收器表](https://github.com/pwr-Solaar/Solaar/blob/master/lib/logitech_receiver/base_usb.py) · [HaloBattery 协议与型号记录](https://github.com/HeyOkay/HaloBattery/blob/main/docs/protocols.md)

评估读数精度时，先核对设备声明的粒度，并与同一时刻厂商工具或原始报告对照。能获取剩余容量和当前充满容量时，可在确认是同一电池、单位相同、容量字段有效的前提下做比值。只有开路电压时需要型号和电池化学专用曲线，还要分离充电、负载和温度条件，并用多个实测容量点标定。把一次满电电压或厂商工具显示的满电数字定为 100% 只能移动显示刻度。当前 H5 保留原始百分比、档位或毫伏字段，避免跨型号误换算。

用户反馈时建议分别采集唤醒、休眠和插拔充电线各一次。切换 USB、2.4 GHz 或蓝牙分别导出并另存一份，对照机身硬件版本及厂商读数。优先核对报告中的通道、固件修订号、报文长度、槽位、状态、错误码和电量来源。Windows 修订字段是系统能取得的描述符版本，有些设备不会暴露完整固件版本。

## 可参考的开源实现

| 项目 | 用途 | 集成注意点 |
| --- | --- | --- |
| [HaloBattery](https://github.com/HeyOkay/HaloBattery) | Windows 多厂商 HID、蓝牙与手柄的覆盖清单和 provider 分层 | 适合先核对目标型号、连接方式、需要争用的 HID 接口及固件差异。 |
| [BatteryMonitor](https://github.com/JKWTCN/BatteryMonitor) | Windows 多 provider 架构，覆盖蓝牙、接收器及部分手柄 | 型号列表的已验证条目适合作为实机测试候选，部分路径还依赖厂商后台服务。 |
| [Solaar](https://github.com/pwr-Solaar/Solaar) | Logitech HID++、配对槽位、Unifying、Bolt 与其他 Logitech 连接方式 | Linux 设备实现可作为协议参考。移植要考虑 Windows 句柄访问和 G HUB 共存。 |
| [OpenRazer](https://github.com/openrazer/openrazer) | Razer 型号表、HID 命令、返回状态 | 使用明确 VID/PID 和型号差异验证查询，不能把所有 Razer 接收器视为同一型号。 |
| [HeadsetControl](https://github.com/Sapd/HeadsetControl) | 多品牌 USB 耳机和接收器的电量报告 | 适合按型号独立核实，读取路径与修改灯光、音效等控制功能应分开。 |

## 集成优先级

1. 通用 Windows 属性保留为低成本公共入口。对确认在线且 Windows 没有电量的 BLE 型号，下一步验证标准 Battery Service，仅对支持的服务读取并校验 0–100。多实例按正确电池部件识别。
2. 专有接收器按厂商分 provider，继续实测 Logitech HID++ 2.0 接收器，优先补充明确型号的 HID++ 1.0、Logitech Centurion、狼蛛 SC620 和耳机协议。建立 VID/PID、连接路径、报告精度和实测状态矩阵，经实机验证后再扩展匹配范围。使用代码前按具体版本核对许可证。
3. 每个 provider 记录设备身份、连接线路、读数来源、分辨或分档区间及时间。失败或无电量保留明确状态。相同物理设备的 USB 与蓝牙会话需要做身份去重；没有足够证据时保留独立来源。
4. 实机验收覆盖 0% 与 100%、充电和断充、睡眠与拔插、同一接收器的多设备、设备在 USB 与蓝牙间切换，以及厂商软件占用。同一型号分固件和连接方式记录结果。

本次实现保留 Windows 通用属性并新增两组可编译适配。开源项目用作型号、协议和样本来源。具体型号是否可用仍以 H5 实机结果为准。
