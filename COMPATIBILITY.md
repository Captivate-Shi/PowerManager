# 外设电量读取与集成评估

## 检测、读数和精度

Windows 能识别外设只说明系统看到了相应接口。要读到剩余电量，还需要设备固件、接收器或驱动通过标准接口或型号专有协议提供电量数据。

| 连接方式 | 当前路径 | 覆盖边界 |
| --- | --- | --- |
| USB | Windows 电量属性、DualSense USB HID、VGN V98 Pro 原版／V2 与 V3 有线适配 | 普通 USB 鼠标、键盘和接收器可能只暴露输入接口。即便 USB-IF 定义了电池和电量用途，也需要设备实际实现。Windows 显示 USB 时，H5 标为「USB（直连或接收器）」。 |
| 2.4 GHz 私有接收器 | Razer Viper V3 HyperSpeed 与受支持的共享接收器键盘、VGN V98 Pro 原版／V2 与 V3 接收器、已识别的 Logitech HID++ 2.0 接收器 | USB 总线一般只识别到接收器。精确匹配接收器型号、配对槽位及固件上报后，才能区分每件外设。H5 只把明确适配的无线线路标为 2.4 GHz。 |
| 蓝牙 | Windows 已提供的电量百分比，或 DualSense 蓝牙 HID | BLE 设备可实现 Battery Service 及 Battery Level（`0x180F`、`0x2A19`）。蓝牙经典设备、模糊的系统缓存、多个电池的耳机和充电盒需分别处理。实验分支新增单电池标准 BAS 读取；多电池不会猜测部件，不自动纳入提醒。 |
| Xbox 和其他游戏手柄 | Windows 已上报有效电量的已识别手柄默认监测 | XInput 只暴露有限电量档位，插线与未知电池类型也没有可靠剩余百分比。实验分支已在诊断中分别采集 Windows.Gaming.Input、XInput。槽位不能当作物理设备标识；结果暂不并入设备行或历史。 |

Windows 发现阶段已根据总线和硬件 ID 区分蓝牙、USB 与连接方式未知。通用 HID 名称不会被自动认定是某种无线协议。查找列表会显示「Windows 暂无可用电量」，已连接、被 Windows 明确归入输入设备或耳麦，且有有效电量属性或单一标准 BLE BAS 的外设默认进入监测。不把手机、笔记本、未知蓝牙类或已有专用适配的容器重复收进去。未读到有效值不会触发提醒。已适配设备使用自己的协议状态。

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
| Logitech G502 LIGHTSPEED | 匹配接收器中实际配对的鼠标型号后，`0x1001` 放电电压按 [Linux HID++ 参考曲线](https://github.com/torvalds/linux/blob/master/drivers/hid/hid-logitech-hidpp.c)显示估算区间。保留毫伏值，充电中不套用放电曲线。G502 X PLUS 等仍走原生百分比路径。 |
| 雷柏 VT3S 接收器 | 仅接入 `24AE:1411` 的已知 HID 报告，在唯一物理容器与匹配描述符上被动读取，不发送命令。依据[上游真机报告](https://github.com/wushuai0802/myfinder-device-battery/blob/7b4131b29709f79c833d5fb39db52656265ce9d1/engine/upstream-protocols.md#120-windows-report-length-proof-not-missed-notifications)，本应用仍需真机验收。不适用于其他雷柏键鼠。 |

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

## 灰度优先级

没有本机实测的型号，不列入正式支持。顺序按通用覆盖、对照证据、实机验收成本排列。

| 优先级 | 路径与设备 | 本分支范围 |
| --- | --- | --- |
| P0 | Windows 已上报电量；键鼠、蓝牙耳机等的单电池 BLE BAS | 先保留系统属性。有明确单一 BAS 接口且已识别为外设时，默认按 Container ID 读取；缺服务、多电池、无权限、超时、异常值分别诊断。不推断电池部件或充电状态。 |
| P0 | Xbox、兼容手柄 | WGI 仅在容量明确且同单位时提供真实百分比；XInput 保留档位。两套读数先进入诊断，未确认 PnP 身份前不合并到设备、提醒或历史。 |
| P1 | 罗技 HID++、雷蛇已有型号、VGN V98 Pro / V2 / V3、ATK V75X | 优先回归原协议。ATK V75X 的公用接收方案有上游实测；同 VID/PID 不当成型号，产品字符串明确时才显示名字。VXE 鼠标和其他 VGN / ATK 型号需单独查证。 |
| P2 | Sony 头戴、Redmi TWS；赛睿、海盗船、HyperX 的 2.4G 耳麦 | 先进 Windows/BAS 通用路径灰度；左右耳／盒、多接口、私有接收器需样本，不扩大到全品牌。纯 3.5 mm 没有读数通道；普通 USB 音频不算电量证据。 |
| P3 | 八位堂、盖世小鸡、飞智；狼蛛、其他国产长尾键鼠 | 先用诊断确认连接模式与协议，再按 VID/PID、固件、接口/长度逐项加匹配。不把通用 Xbox ID 当成品牌；不新增对厂商常驻组件的依赖。 |

诊断仅在遇到问题时打开。先选有问题的设备，优先使用系统识别的型号；列表没识别或只有通用名称才手填。固件只有经过协议读取确认才作为可选值，蓝牙设备可以在支持标准固件字段时按需读一次；HID 修订号不当成固件。报告只预览与所选设备匹配的明细，确认后才保存同一份内容到本地。报告记录可见接口、Windows 属性与 BAS 候选、近期失败阶段、WGI/XInput 各自观测；不导出原始路径、MAC、序列号或原始输入报文。W1 等是本次采集进程的临时编号，不能跨报告追踪设备。

## 兼容路径与边界

| 情况 | 正常使用 | 诊断显示 |
| --- | --- | --- |
| 明确匹配 Razer / Sony / VGN / Logitech 专用接口 | 默认保留专用读数；同容器不另生成通用行 | 实际尝试的协议、阶段、状态、固件可用性 |
| Windows 已识别为输入／耳麦且提供有效电量 | 默认读系统属性。经典蓝牙 HFP（系统上报）、USB、接收器可走此路，但不是每台都上报 | 属性缺失、无效百分比、断开、查询失败 |
| Windows 无电量，已连接 BLE，单一明确 BAS | 默认读设备的标准值，不猜充电状态、不把失败显示为 0% | 无接口、多个服务、接口占用、特征不存在、超时、值不合规 |
| 多电池 LE、未公开协议的 2.4G/USB、纯有线音频 | 仅在系统提供有效总电量时显示；不探测未知私有报文，也不合成左右耳／盒值 | 多服务、无系统属性或未识别；保留可核对的来源 |
| 仅 WGI / XInput 有信息，不能关联物理设备 | 正常列表不绑定槽位；插线、未连接和空电档不混用 | 查看各接口读数、离散档位与失败原因 |
| 系统无可靠身份或只报通用型号 | 不编造品牌、型号或固件 | 只补缺失字段；手填条目不附带不相干设备明细 |

灰度用户正常连接使用。发现不一致再从诊断选设备提交；唤醒/休眠、切换连接、两台同型号和与厂商软件共存是测试团队的验收项，不是每位用户提交反馈的前置条件。
