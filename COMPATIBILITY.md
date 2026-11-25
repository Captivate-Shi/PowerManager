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
| Logitech G502 LIGHTSPEED、G PRO Wireless 初代 | 先查原生百分比；只上报 `0x1001` 时，按已匹配的型号把放电电压显示为估算区间，不显示假精度。GPW 初代的 2.4G 与 USB 仅读取路径及报文测试通过，余电真机待验。不扩给 SUPERLIGHT、耳机或未知设备。 |

GPW 初代上游证据：[Solaar #2330（WPID 4079 / USB C088，0x1001）](https://github.com/pwr-Solaar/Solaar/issues/2330)；回归边界：[OpenLogi #688（G502 只有电压）](https://github.com/AprilNEA/OpenLogi/issues/688)、[HaloBattery #413（截断回包）](https://github.com/HeyOkay/HaloBattery/issues/413)。

型号和协议依据：[VGNKeyboardBattery](https://github.com/MuyuDada/VGNKeyboardBattery) · [wdbattery 的 V3 实测](https://github.com/RIVERCROFT111/wdbattery) · [Logitech 公共协议](https://github.com/Logitech/cpg-docs) · [Solaar 接收器表](https://github.com/pwr-Solaar/Solaar/blob/master/lib/logitech_receiver/base_usb.py) · [HaloBattery 协议与型号记录](https://github.com/HeyOkay/HaloBattery/blob/main/docs/protocols.md)

评估读数精度时，先核对设备声明的粒度，并与同一时刻厂商工具或原始报告对照。能获取剩余容量和当前充满容量时，可在确认是同一电池、单位相同、容量字段有效的前提下做比值。只有开路电压时需要型号和电池化学专用曲线，还要分离充电、负载和温度条件，并用多个实测容量点标定。把一次满电电压或厂商工具显示的满电数字定为 100% 只能移动显示刻度。当前 H5 保留原始百分比、档位或毫伏字段，避免跨型号误换算。

用户反馈时建议分别采集唤醒、休眠和插拔充电线各一次。切换 USB、2.4 GHz 或蓝牙分别导出并另存一份，对照机身硬件版本及厂商读数。优先核对报告中的通道、固件修订号、报文长度、槽位、状态、错误码和电量来源。Windows 修订字段是系统能取得的描述符版本，有些设备不会暴露完整固件版本。

## 雷柏 VT 系列接收器

| 接收器 | 读取方式 |
| --- | --- |
| VT3S `24AE:1411`、VT3 双8K `24AE:1412`、VT0 Air MAX `24AE:14A1` | 唯一 `FF00:0002` 集合，描述符确认仅有 19 字节 `0x07` 报告，才被动监听电量。静默不判离线。1412 单独处理已实测的无线断链标记；不把该标记用于有线帧。 |

依据：[VT3S Windows 描述符与抓包](https://github.com/wushuai0802/myfinder-device-battery/issues/120) · [VT3 与 VT0 Air MAX 实机协议记录](https://github.com/evren-oct/vigil-watt/blob/main/docs/hardware/rapoo.md)。不按品牌扩展到其他接收器；同一商品名的其他硬件版本、有线 PID 与雷柏通用键盘接收器不套用此协议。

## 兼容分支第二批

| 设备 / 链路 | 当前读取方式 |
| --- | --- |
| G PRO Wireless、PRO X SUPERLIGHT、G502 LIGHTSPEED、G502 X PLUS 的指定有线 USB ID | 通过直连 HID++ 读取声明过的电量功能；只在有相同 Unit ID 时归并接收器与有线设备。不同代际不沿用 G502 LIGHTSPEED 电压估算。见 [Solaar 型号表](https://github.com/pwr-Solaar/Solaar/blob/master/lib/logitech_receiver/descriptors.py) 与 [libratbag G PRO Wireless](https://github.com/libratbag/libratbag/blob/master/data/devices/logitech-g-pro-wireless.device)。 |
| DualShock 4 v1/v2、DualSense Edge | USB 和蓝牙分别识别，读取有效的原生 HID 报告，无需开启增强模式。DualShock 4 蓝牙完整包校验 CRC；设备只上报档位时保留区间。 |
| 8BitDo Pro 3 | 只接 DInput 蓝牙的指定 ID，绑定游戏手柄 HID 集合被动读数，不推广到 USB、2.4 GHz 或其他代际。见 [HaloBattery 硬件证据](https://github.com/HeyOkay/HaloBattery/blob/15a73ac4d88435a771b0060b28171733a43dab06/providers/eightbitdo.py)。 |
| SteelSeries Aerox 9 Wireless、狼蛛 AULA V9Pro+ | 只接匹配 USB 接收器、接口与报文的只读查询；百分比能用时进入正常监测。见 [Aerox 9 硬件报告](https://github.com/HeyOkay/HaloBattery/issues/79) 与 [AULA 上游报文](https://github.com/wushuai0802/myfinder-device-battery/blob/7b4131b29709f79c833d5fb39db52656265ce9d1/engine/upstream-protocols.md#aula-v9pro-320f22ba-24-ghz-receiver)。 |
| 索尼 WH-1000XM4 | 已连接、已配对、物理容器唯一匹配时，Windows/BAS 无有效读数才尝试 [Sony V1 私有电量服务](https://github.com/marconvcm/sony-device-center#device-support)。单一工作任务、每设备至少间隔 60 秒。不使用通话音频配置、不向其他型号试发命令，不把延迟结果当实时数据。 |

这些是接入路径与回归样本，不是本应用的真机验收声明。仍需核对连接方式、睡眠唤醒、充电状态和同型号并用，耳机还需检查播放、通话及多点连接。此批不包括 Switch/北通、OPPO Enco Clip2 或华为耳机。

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

## OPPO Enco Clip2（ETEN1）

常规 Windows / BLE 电量没有读数时，可以对已配对、已连接且绑定同一物理容器的 Clip2，查询其专有 ELNK RFCOMM 服务。只发两条查询：先确认耳机返回产品 ID `06E010`，再读电量。没有通用串口回退、不占用通话协议、不改耳机设置。若只收到充电盒或占位 0，保留未知；若读到一只或两只耳机，状态行采用当次有效耳机读数的最低值。本批没有独立左右耳／充电盒 UI。

[OPPO 型号规格](https://www.oppo.com/au/accessories/enco-clip2-open-earbuds/specs/) · [上游 Windows 型号配置](https://github.com/TIANLI0/EncoDeck/blob/main/docs/COMPATIBILITY.md#oppo--一加--realme--dizo) · [上游报文和休眠行为](https://github.com/MageshwarSV/QuickBuds/blob/main/docs/PROTOCOL.md#7-battery--0x8106-and-push-01) 。这些是协议和实现依据，不是 Clip2 的 Windows 真机验收；仍需对照 HeyMelody 读数并验证音乐与通话同时使用。

## 华为 FreeClip 2

当 Windows 与标准蓝牙电量都无读数时，仅对已经配对并连接、同一 Windows 设备容器、型号名匹配且蓝牙 SIG 身份为 `027D:4113` 的设备，按 SDP 公布的 SPP 服务发一次电量查询。通道忙、无响应或格式无效时关闭连接，不抢占，不修改音频或耳机设置。双耳都有效时采用较低值，不用充电盒代替耳机；暂不推断充电状态。

协议依据：[FreeClip 2 同型号 Windows 真机记录](https://github.com/whisperers26/BatteryInfo/blob/main/docs/protocols/huawei.md)。余电仍需用真机对照电量，并验证与音乐、通话及其他管理软件的共存。

## 后续接入顺序

| 顺序 | 范围 | 开源依据与接入门槛 |
| --- | --- | --- |
| 1 · 本批 | OPPO Enco X4，经典蓝牙 | [EncoDeck 真机记录](https://github.com/TIANLI0/EncoDeck/blob/main/docs/PROTOCOL_FINDINGS.md)：同一 ELNK 服务，但先确认独立产品 ID `06EC10`。兼容 X4 已观测的盒内、取出两种电量回复；不开放 LE Audio、不订阅事件、不更改设置。 |
| 2 · 本批 | 雷柏 VT2S Air Max，原装 2.4G 接收器 | [VigilWatt 真机记录](https://github.com/evren-oct/vigil-watt/blob/main/docs/hardware/rapoo.md)：仅认 `24AE:1B13` 和已验证布局，不把有线 `4B13` 或底座 `4827` 当电量端点。沿用被动监听，不发命令。 |
| 3 · 待接入 | Nintendo Switch Pro 原生蓝牙；GameSir Super Nova 原装 2.4G | [SDL](https://github.com/libsdl-org/SDL/blob/main/src/joystick/hidapi/SDL_hidapi_switch.c)、[HaloBattery](https://github.com/HeyOkay/HaloBattery/blob/main/docs/protocols.md)、[Wireless Device Battery Monitor](https://github.com/notjiccu/wireless-device-battery-monitor#supported-devices)。先区分 Switch 原始报文是否已由游戏开启、GameSir 共用接收器能否核对型号。 |
| 4 · 待接入 | 其他罗技办公键鼠、达尔优／迈从等有协议线索的候选 | [Solaar](https://github.com/pwr-Solaar/Solaar)、[VigilWatt](https://github.com/evren-oct/vigil-watt/tree/main/docs/hardware)。按接收器、接口、模式和型号证据分批，不按品牌放开。 |
| 5 · 等设备身份 | 用户反馈的雷柏通用键盘及其他仅见通用名称的设备 | 不套用鼠标报文；先核对设备型号及接收器接口，再排期。 |

“本批”只表示代码进入兼容草稿。真机和并行音频仍需验证。

## Switch Pro 原生蓝牙

仅限原生 Bluetooth HID 的 `057E:2009` 游戏手柄集合，需有唯一匹配接口和 Windows 设备容器。只被动读取完整 `0x30` 报告里的电量档位和充电标记，不发子命令、不强切模式，也不读取 USB 或 Joy-Con。手柄仅上报简化 `0x3F` 时，尝试同一物理容器的 Windows 电量；仍无则保留未知。界面的区间是档位表达，不是校准的百分比。第三方手柄可能复用同一标识，所以用“Switch Pro（蓝牙模式）”，不据此辨别原厂。

依据：[SDL 报告布局](https://github.com/libsdl-org/SDL/blob/main/src/joystick/hidapi/SDL_hidapi_switch.c) · [Windows 枚举记录](https://github.com/libsdl-org/SDL/issues/11849) · [HaloBattery 实现范围](https://github.com/HeyOkay/HaloBattery/blob/main/docs/protocols.md#nintendo-switch-pro-controller-joy-con-l--r)。余电仍待实物，需对照 Steam 或游戏已开启完整报告及无完整报告两种状态。

## GameSir Super Nova

只对 `3537:103E` 原装接收器、明确的 Super Nova / NovaPro / T4NPro 产品字符串、唯一 `FFA0` 集合及已匹配的物理 USB 容器发一次设备信息查询。不以共享 PID 区分 Super Nova 和 Tarantula Pro；通用名称、不匹配规格、有线或其他 GameSir 型号均不进入此路径。返回 `0xFF` 只记作充电但没有可用百分比，不补 100％，也不触发电量提醒。还需余电真机验证产品字符串、游戏共存及充电行为。

依据：[Wireless Device Battery Monitor 的 Windows 实测与报文](https://github.com/notjiccu/wireless-device-battery-monitor/blob/main/docs/gamesir_sapjoy.md)。

## 罗技 MX Keys S / MX Master 3S（Logi Bolt）

复用现有 `046D:C548` 接收器与 HID++ 2.0 电量路径。固件特征索引从各自槽位动态查询，按 Unit ID 验证读数，不用接收器厂商号猜型号，也不固定键盘或鼠标的槽位。发现型号或类型读不全时，下次轮询补读；只有读到明确子设备名称才识别为 MX Keys S / MX Master 3S。区分 HID++ 1.0 的设备不存在与 HID++ 2.0 的忙，不随忙回复删掉设备。直连蓝牙不在本批。

依据：[MX Keys S Windows/Bolt 实测工具](https://github.com/svanlaere/mxkeys-cli) · [双设备 Bolt 读取项目](https://github.com/FedeltaMedia/mx-battery) · [Linux HID++ 错误码](https://github.com/torvalds/linux/blob/master/drivers/hid/hid-logitech-hidpp.c)。余电真机需确认同接收器双设备、休眠唤醒和充电切换。

## 国产外设接收器一批

| 设备 | 路径 | 接入边界 |
| --- | --- | --- |
| 迈从 G3 V2 | `3837:4245`、精确产品名、唯一 `FF01:0010` | 同次采样先查在线，再读电量；离线不吃缓存。按 M HUB 的档位显示，不把档位当精确百分比。参考 [MyFinder](https://github.com/wushuai0802/myfinder-device-battery/blob/main/docs/compatibility.md)、[VigilWatt](https://github.com/evren-oct/vigil-watt/blob/main/docs/hardware/mchose.md)。 |
| 狼蛛 SC580 / SC580X | `089D:062F`、唯一 `FF02:0000` | 读设备状态，核对型号标记、校验和及无线在线标识。只显示验证过的电量；充电占位 100 不当成满电，设备明确上报充满才显示充满。参考 [同型号协议](https://github.com/Crucialjun/omarchy-aula-SC580)、[Windows 真机记录](https://github.com/notjiccu/wireless-device-battery-monitor#supported-devices)。 |
| 达尔优 EM901X | `260D:1074`、对应的输入和 Feature 集合列入诊断 | **不发送电量查询，不开启监测。** 已知接收器关机后仍可回应上次电量，现有证据缺少能够独立验证无线在线的信号。参考 [Windows 上游驱动](https://github.com/notjiccu/wireless-device-battery-monitor/blob/main/src/drivers/dareu.cpp)。 |
| 狼蛛 F87 Pro V2D | `0C45:FEFE`、精确产品名 `AULA F87ProV2D Dongle`、接口 3、唯一 `FF60:0061` | 只读对应状态页电量，不推断充电状态；不接共用 ID 的黑爵或其他 F87。参考 [BatteryMonitor 实测](https://github.com/JKWTCN/BatteryMonitor/blob/master/README.en.md#verified-devices)、[MyFinder 报文](https://github.com/wushuai0802/myfinder-device-battery/blob/7b4131b29709f79c833d5fb39db52656265ce9d1/engine/upstream-protocols.md#L2043-L2070)。 |

三条监测路径都只匹配原装 2.4G 接收器，不发设置命令。使用余电的实物验收仍待进行。

## 赛睿 Aerox 3 / 5 Wireless

原装 2.4G 接收器分别为 `1038:1838` 和 `1038:1852`。沿用 Aerox 9 的单次 D2 电量查询，但匹配各自的产品 ID、物理 USB 父节点及唯一 `MI03 / FFC0:0001` HID 集合。查询前清理该读取句柄的缓冲队列；休眠、断链、空回包不生成当前电量。按设备的 5% 档位读取，不推断充电状态。不覆盖蓝牙、有线、Gen 2 或联名接收器。

依据：[Aerox 3 实机报告及描述符](https://alloy.szymon-wilczek.me/protocol/steelseries-aerox3-wireless.html) · [Windows 上游实现](https://github.com/notjiccu/wireless-device-battery-monitor/blob/main/src/drivers/steelseries.cpp#L1033-L1138) · [Aerox 5 同型号记录](https://github.com/LennardKittner/Aerox_5)。余电真机需验证 Aerox 5 的描述符、休眠前后和与 SteelSeries GG 同开的读数。

## 雷蛇三款 Pro 鼠标的原装接收器

仅在匹配物理 USB 容器、且只有一个符合 HID 描述符的鼠标集合时读取：Viper V3 Pro `1532:00C1`、DeathAdder V3 Pro `1532:00B7`、Basilisk V3 Pro `1532:00AB`。只发一次电量查询，校验事务、校验和和返回状态；接口忙或无无线响应时不重发、不生成电量。充电状态不推断。既有 `00B8` 和共享键盘路径不变；不覆盖有线、35K、`00C3` 或通用 HyperPolling 接收器。

依据：[Viper V3 Pro Windows 读取](https://github.com/damianyoko/viper-tray) · [DeathAdder 原装接收器实机](https://github.com/OpenMouse-Project/mouse-protocol/blob/main/docs/razer-testing.md#deathadder-v3-pro-153200b6-wired-153200b7-receiver--verified-firmware-21) · [Basilisk 接收器记录](https://github.com/justinthevoid/uncoil/blob/main/devices/razer-basilisk-v3-pro.toml) · [Windows 型号清单](https://github.com/xzeldon/razer-battery-report#supported-mice)。余电需真机核对电量、关机和 Synapse 并行。

## 罗技 Bolt 五款办公键鼠

在已有的 `046D:C548` 路径上，按活跃槽位、Unit ID、HID++ 型号 ID 和设备实时名称匹配；接收器型号本身不够。新增 MX Master 4（B042）、MX Anywhere 3S（B037）、MX Keys Mini（B369）、Lift（B031）、Signature M650（B02A）。只用 `0x1004` 的百分比能力；采样前后复核同一槽位的 Unit ID 和型号。休眠、回复忙或更换配对设备时，不发送当前读数。不带上直连蓝牙、Unifying、企业名称变体或 M650 L。

依据：[MX Master 4 Windows 读数](https://github.com/JKWTCN/BatteryMonitor/blob/25c221326391e26b62ae2b7db8e72ce8538ff909/README.en.md#verified-devices) · [MX Anywhere 3S Bolt 报告](https://github.com/AprilNEA/OpenLogi/pull/1962) · [MX Keys Mini](https://github.com/pwr-Solaar/Solaar/issues/2127) · [Lift](https://github.com/pwr-Solaar/Solaar/issues/2968) · [Signature M650](https://openlogi.uxatom.com/devices/signature-m650)。余电真机需验证多设备共用接收器时的重新配对、休眠唤醒和 Options+ 并行。

## 第 12 批：罗技 LIGHTSPEED / Unifying 与迈从 A7 V2 Pro

| 范围 | 默认接入条件 |
| --- | --- |
| LIGHTSPEED：G502 X PLUS（4099）、PRO X SUPERLIGHT 原版（4093） | 确认接收器类型、实时型号、设备名及槽位 Unit ID，只读 `0x1004` 原生百分比。不是同型号的 USB 路径，也不纳入第二代。 |
| LIGHTSPEED：G305（4074）、G613（4065） | 同样验证实时身份，仅读 `0x1000`。先看能力字段，只上报可确认的原生百分比或电量区间，不做电压换算。 |
| Unifying：M720 Triathlon（405E）、MX Master 2S（4069）、MX Keys 原版（408A）、ERGO K860 零售版（4088）、K780（405B） | 只认可对应无线型号与实时名称，查询前后复核同一槽位的 Unit ID 和型号。只读有能力依据的 `0x1000`；丢失响应或改配对不作为当前电量。 |
| 迈从 A7 V2 Pro 有线 | `3837:4018`、物理 USB 父设备及唯一 `MI02 / FF01:0001` 集合。只发一次已知 `0x11` Feature 查询并核对报文自报型号；无线接收器不计。 |

依据：[LIGHTSPEED 接收器与设备](https://pwr-solaar.github.io/Solaar/devices/) · [G502 X PLUS 电量](https://github.com/HeyOkay/HaloBattery/blob/main/docs/protocols.md) · [SUPERLIGHT 原版](https://github.com/pwr-Solaar/Solaar/issues/3005) · [G305](https://github.com/pwr-Solaar/Solaar/issues/850) · [G613](https://github.com/pwr-Solaar/Solaar/issues/1610) · [Unifying HID++ 跨设备验证](https://github.com/pwr-Solaar/Solaar/issues/1070) · [A7 V2 Pro Windows 记录](https://github.com/JKWTCN/BatteryMonitor/blob/25c221326391e26b62ae2b7db8e72ce8538ff909/README.en.md#verified-devices)。

暂不计入接入：G915 / G915 TKL（[有电压报文](https://github.com/pwr-Solaar/Solaar/issues/1462)，缺各自可验证的电量换算）、Signature K650（[官方支持 Bolt](https://hub.sync.logitech.com/mx-anywhere-3/post/logi-bolt-mice-keyboards-and-combos-features-and-information-zaeyQiSs2UKlECd)，缺零售机型的实际电量报文）、黑爵 MK87PRO（诊断只识别候选 HID 接口，不主动查询；上游的工作模式字段不能证明无线链路在线）。余电实物验收仍待进行。

## 第 13 批：雷蛇、ROG、ATK 和雷柏

| 路径 | 当前范围 |
| --- | --- |
| 雷蛇 Orochi V2 / DeathStalker V2 Pro TKL | 原装接收器 `1532:0094` / `1532:0296`；准确产品名、唯一 HID Feature 集合及独立物理容器。只读设备电量，接口忙不重发，零、静默、断连均不报新电量。DeathStalker 全尺寸、BlackWidow V3 Mini 和 V4 TKL 的本型号 Feature 集合缺实证，不启用。 [TKL 实机](https://github.com/HeyOkay/HaloBattery/issues/106) · [Orochi 读取记录](https://github.com/sanicxt/orochi-monitor) |
| ROG Azoth 原版 / Falchion RX Low Profile | Azoth 只接 `0B05:1A85` 原装；Falchion 只接同时持有唯一身份、读数接口的 `0B05:1ACE` OMNI，其实时配对列表须确认 `1B06`，在电量读取后再复核；关机拒绝回复不报电量。不猜共享接收器身份。 [Azoth 证据](https://github.com/wushuai0802/myfinder-device-battery/issues/317) · [Falchion 读数与断连抓包](https://github.com/Humblemonk/rogctl/blob/de007e06974fc630e9299516153ea202ab94282f/src/protocol.rs#L985-L1036) |
| ATK V75X | 有线 `320F:5055` 只匹配确切型号、唯一 `FF1C:0092` 集合及有效事务回显。无线 `5088` 的确切 ATK 设备只做诊断，不沿用 VGN 通用查询；实物尚未证明不会唤醒键盘或返回旧读数。 [有线抓包](https://github.com/HeyOkay/HaloBattery/pull/368) · [协议及休眠限制](https://github.com/HeyOkay/HaloBattery/blob/main/docs/protocols.md#atk-v75x) |
| 雷柏 VT3S MAX / 迈从 G87 | `24AE:1421` 仅从指定集合被动监听 19 字节无线在线报文，不主动查询。迈从 G87 的接收器可能在休眠时长期返回旧电量，查询会话可能与 M HUB 互斥，继续待接入。 [VT3S MAX 设备报告](https://github.com/wushuai0802/myfinder-device-battery/issues/86) · [G87 休眠缓存实测](https://github.com/evren-oct/vigil-watt/blob/main/docs/hardware/brands/mchose.md) |

本批新增路径均需余电实物验收。Xbox 的三款 × 两种连接仅完成接口核对与[验证方案](docs/xbox-battery-validation.md)，不启用新采集。

## 第 14 批：剩余 P0 取证入口

[18 条 P0 真机清单](docs/p0-hardware-validation.md)给出每条的证据缺口和复测方式。雷蛇三款未启用的键盘和迈从 G87 只增加匹配描述符的诊断候选，不发主动命令。ATK V75X 无线继续只做诊断；Xbox 的六条连接不加入默认读取。

另有 [Xbox 手工验证探针](tools/xbox-probe/README.md)，仅在测试机手动运行；不新增应用依赖或安装器内容。


## 第 15 批：默认尝试，读不到再回退

- 原生设备先试专用读数与同一设备的备用接口；仍无读数时，仅按无歧义的设备容器试 Windows 电量和标准 BLE。共享接收器的父容器不当作子设备，避免把同一读数贴给数台设备。
- 普通蓝牙外设按 Windows 电量 → 标准 BLE → 已接入的厂商协议尝试。已明确连接且被系统识别为外设，即使无电量也可显示「无数据」。没有新读数就不触发电量提醒，不把历史值当实时。反馈中的雷柏通用接收器也保留系统识别名，尝试系统电量，不猜具体键盘型号。
- [雷蛇](https://github.com/HeyOkay/HaloBattery/blob/main/docs/protocols.md#razer-deathstalker-v2-pro-blackwidow-v3-mini-v4-mini-and-v4-tenkeyless-hyperspeed)三款原装接收器在唯一匹配的接口上试一次电量查询；罗技 Signature K650 零售 Bolt（B36F）在匹配同一个槽位和型号后尝试 HID++ 0x1004 / 0x1000。两项均未做余电真机复测。
- 已知会返回旧电量或主动查询可能唤醒的接收器不拿缓存凑数；Xbox 槽位还不能与设备身份直接对应，先用可归属的系统电量。没有可用来源时不推算电量。

## 第 16 批：整表归类

[支持设备研发台账](docs/device-compatibility-ledger.md)按「型号 × 连接」记录开发结论。开发完仅表示默认可尝试；仅系统／标准蓝牙路径与专用协议分开标注，真机验收仍单独记录。发现身份冲突时保留原条目，新建正确的型号路径，不把硬件 ID 或共享接收器当型号证明。

仍无法确认的设备继续试可归属的通用路径，全部失败显示「无数据」。不以旧读数、未知百分比、Windows/第三方占位数据或其他设备的电量填充。


## 第 17 批：复用协议族和设备反馈

- [122 条原因及复用清单](docs/peripheral-fallback-audit.md)逐行区分协议证据、身份、新鲜度、数值语义等。列为候选不等于通过验收。
- **Sony**：经典蓝牙先读 Windows、再试单一 BAS。WH-1000XM3 和 WH-1000XM4 在确认同一个已配对并已连接的设备及其精确 SDP 身份后，共用 MDR v1 电量查询；已修正服务 UUID。WH-1000XM5 和其他 Sony WH 头戴系列可探测同设备的 [Fast Pair 消息服务](https://developers.google.com/nearby/fast-pair/specifications/extensions/deviceinformation)，只接收可验证的单电池新报文，不发送查询、订阅或设置命令。系列名只用于筛选候选，品牌以 Windows SDP 身份为准。WF 真无线耳机不套用单电池解析。
- **Logitech**：[HID++](https://github.com/Logitech/cpg-docs/blob/master/hidpp20/README.rst) 的同一只设备可在已有通道里按实际公告能力尝试 0x1004/0x1000，不再因该型号录入时只验证过其中一个就停止；结果发布前复核当前设备。只有电压时不套用其他设备的百分比曲线。
- **用户反馈**：在诊断里选设备后，可关联同一设备的 HID 接口号、VID/PID、用途与报文长度、标准蓝牙电量服务数量和各次读取的阶段、耗时、失败原因。无法绑定的共享接收器、手填设备和独立盘点不会错配给其他设备；不记录键鼠输入、原始报文、MAC、序列号或系统路径。报告依旧由用户预览、保存并自行提交。
