# 支持设备研发台账

247 条型号 × 连接：开发完 125 条（其中 33 条只有系统／标准蓝牙读数路径），无法判断 122 条（含 3 条模拟音频排除项）。
开发完只表示读取路径已写入代码，仍以真机能否取得有效数据为准。“无法判断”不阻止已经可用的系统兜底，不以假值填充。真实 0% 和无数据不同。上一批 122 条的逐行归类见[兜底审计](./peripheral-fallback-audit.md)。

| ID | 设备 | 连接 | 结论 | 说明 |
|---|---|---|---|---|
| DEV-A0F79A9092 | AULA 狼蛛 SC580 / SC580X（089D:062F） | 2.4G 原装接收器 | 开发完 | 校验型号/在线/校验和，充电占位100不当满电。余电待真机。 |
| DEV-B7583EDD7F | AULA 狼蛛 V9 Pro+（320F:22BA） | 2.4G 原装接收器 | 开发完 | 公开实报 80/48%，必须全名/MI_01/FF1C:0092；充电未知 |
| DEV-471A4536FF | Logitech Lift Vertical Ergonomic Mouse | 2.4G Logi Bolt | 开发完 | Logi Bolt，B031 + 实时设备名；只读 1004，休眠和换槽不报实时；蓝牙、其他型号不算。余电待真机。 |
| DEV-1CAFA27898 | Logitech M510（WPID 4008） | 2.4G Unifying | 无法判断 | 原表 4008 与 M510 型号冲突（4008 另有 M175/M185 记录），没有匹配此身份。另增经实报核对的 M510 v2 / 4051 原装 Unifying 路径；不把新条目回填到 4008。 [来源](https://github.com/pwr-Solaar/Solaar/issues/3156) |
| DEV-6024C59A53 | Logitech M720 Triathlon | 2.4G Unifying | 开发完 | Unifying 405E + 设备名 + Unit ID；0x1000 依能力保留原生档位或百分比。多设备不按接收器 PID 猜。待余电真机。 |
| DEV-8298757E23 | Logitech MX Anywhere 3S | 2.4G Logi Bolt | 开发完 | Logi Bolt，B037 + 实时名称；不带入 Anywhere 3 或企业名称变体；只读 1004，休眠不报实时。余电待真机。 |
| DEV-7F3BA94F4C | Logitech MX Master 2S | 2.4G Unifying | 开发完 | Unifying 4069 + 设备名 + Unit ID，按实际 0x1000 精度读取；蓝牙与 MX Master 3S 不混用。待余电真机。 |
| DEV-287B816316 | Logitech MX Master 3S | 2.4G Logi Bolt | 开发完 | Bolt 046D:C548；按子设备槽位和 Unit ID 读 0x1004，不按接收器猜型号。两设备同接收器测试以余电真机为准。 |
| DEV-1F3A4C5F2E | Logitech MX Master 4 | 2.4G Logi Bolt | 开发完 | Logi Bolt 046D:C548；型号 B042 与实时设备名同时匹配；仅读 1004 百分比，读取前后复核槽位身份。余电待真机。 |
| DEV-8B30C1E356 | Logitech Signature M650 | 2.4G Logi Bolt | 开发完 | Logi Bolt，B02A + 明确的 Signature M650 Mouse；共用 ID 的 M650 L 不匹配；只读 1004。余电待真机。 |
| DEV-1D48D3B47A | Logitech G G PRO Wireless（原版） | 2.4G 原装 LIGHTSPEED 接收器 | 开发完 | 仅初代 WPID 4079；只有 0x1001 时显示放电估算区间。余电真机待验。 |
| DEV-9DD728ACF0 | Logitech G G PRO Wireless（原版） | USB | 开发完 | PR #8 有线 C088；无线读数另验。 |
| DEV-6B10430502 | Logitech G G305 LIGHTSPEED | 2.4G LIGHTSPEED | 开发完 | LIGHTSPEED；4074 + 实时名称 + Unit ID；0x1000 必须先核实电量能力，按设备精度显示。不套用电压曲线。 |
| DEV-891C200ACE | Logitech G G502 LIGHTSPEED | 2.4G LIGHTSPEED | 开发完 | 旧代可能为电压转换，不能和实报百分比同等级 |
| DEV-5452E339F0 | Logitech G G502 LIGHTSPEED | USB | 开发完 | PR #8 有线 C08D；电压估算路径不是精确百分比。 |
| DEV-6B390A835D | Logitech G G502 X PLUS | 2.4G LIGHTSPEED | 开发完 | LIGHTSPEED 原装接收器；HID++ 4099 + 实时名称 + Unit ID；0x1004 原生百分比，不含有线或 G502 X 其他型号。待余电真机。 |
| DEV-96EA82EB7A | Logitech G PRO X SUPERLIGHT（第一代） | 2.4G LIGHTSPEED | 开发完 | LIGHTSPEED 原装接收器；HID++ 4093 + PRO X Wireless + Unit ID；0x1004 原生百分比。SUPERLIGHT 2 另验。 |
| DEV-F9C75225EE | Logitech G PRO X SUPERLIGHT（第一代） | USB | 开发完 | PR #8 有线 C094，不扩到二代。 |
| DEV-5C803986E5 | MCHOSE 迈从 A7 V2 Pro（3837:4018） | USB 线缆 | 开发完 | 只限有线，要求物理 USB、唯一 MI02/FF01:0001 Feature 11 集合并校验回复自报型号；接收器模式不纳入。待余电真机。 |
| DEV-61C89F4D0C | MCHOSE 迈从 G3 V2（3837:4245） | 2.4G 原装接收器 | 开发完 | 同次先验证在线再读，按 M HUB 档位表达，不报精确百分比。余电待真机。 |
| DEV-8C5D89E280 | Rapoo 雷柏 VT0 Air MAX（24AE:14A1） | 2.4G 原装接收器 | 开发完 | PR #8 接入被动 19 字节状态帧。上游有测试记录，余电真机待验。 |
| DEV-57637F9D17 | Rapoo 雷柏 VT2S Air Max（24AE:1B13） | 2.4G 原装接收器 | 开发完 | 接入序 2：仅 1B13 接收器，排除有线和底座。 |
| DEV-389E0D3BBC | Rapoo 雷柏 VT3 双8K（24AE:1412） | 2.4G 原装接收器 | 开发完 | PR #8 接入被动 19 字节状态帧。上游有测试记录，余电真机待验。 |
| DEV-D10D485E4A | Rapoo 雷柏 VT3S MAX（24AE:1421） | 2.4G 原装接收器 | 开发完 | 仅 24AE:1421、FF00:0002、19 字节 Input 07；被动监听，匹配无线协议和在线位才上报，未知状态不算离线或 0%。型号实报及断连待余电真机。 |
| DEV-A8A3965C7F | Rapoo 雷柏 VT3S（24AE:1411） | 2.4G 原装接收器 | 开发完 | 已公布 19B 实机帧、约3秒；渐进灰度 |
| DEV-8A92565591 | Razer Basilisk V3 Pro | 2.4G HyperSpeed | 开发完 | 1532:00AB 原装接收器、MI00；非 35K 版或扩展坞；读数校验，充电状态不推断。余电待真机。 |
| DEV-1AB182FD6E | Razer DeathAdder V3 Pro | 2.4G HyperSpeed | 开发完 | 1532:00B7 原装接收器、MI00；有线、00C3 和通用 HyperPolling 不纳入；忙时跳过，不推断充电。余电待真机。 |
| DEV-5637EB0113 | Razer Orochi V2 | 2.4G HyperSpeed | 开发完 | 只认 1532:0094、MI00、准确产品名及唯一 91 字节 Feature 集合；使用设备电量值，不推断充电；零或静默不作为当前电量，不含蓝牙。 |
| DEV-DA7A0EAE9E | Razer Viper V3 HyperSpeed（1532:00B8） | 2.4G 原装 HyperSpeed 接收器 | 开发完 | 按 00B8 接收器回归；不等同 Viper V3 Pro 或 HyperPolling 接收器。 |
| DEV-0C51411712 | Razer Viper V3 Pro | 2.4G HyperSpeed | 开发完 | 1532:00C1 原装接收器；物理 USB 容器、唯一 91 字节鼠标集合；07:80 忙时不重发；不是 Viper V3 HyperSpeed。Synapse 共存待真机。 |
| DEV-F799000549 | SteelSeries Aerox 3 Wireless（1038:1838） | 2.4G 原装接收器 | 开发完 | 原装 2.4G，MI03 / FFC0:0001 唯一集合；D2 只读 5% 档，休眠和关机不报 0%；不覆盖 Gen 2、联名款或有线。余电待真机。 |
| DEV-029FA2FB33 | SteelSeries Aerox 5 Wireless（1038:1852） | 2.4G 原装接收器 | 开发完 | 原装 2.4G，MI03 / FFC0:0001 唯一集合；D2 只读 5% 档，空回复不当电量；联名版、蓝牙、有线不纳入。余电待真机。 |
| DEV-25EA83E11F | SteelSeries Aerox 9 Wireless（1038:1858） | 2.4G 原装接收器 | 开发完 | Windows 15%已和 GG 对照，见专门 issue；5%步进 |
| DEV-162BBC834F | AJAZZ 黑爵 MK87PRO（0C45:FEFC） | 2.4G 原装接收器 | 无法判断 | Windows 上游验证原装接收器在线百分比；协议字段只表工作模式、不能表示无线当前在线。仅在精确产品名、匹配接口及物理 USB 身份时标记诊断，不查询；须保留接收器并对照键盘在线、关机和唤醒，证明不会回旧读数。 [来源](https://github.com/JKWTCN/BatteryMonitor/blob/25c221326391e26b62ae2b7db8e72ce8538ff909/README.en.md#verified-devices) |
| DEV-F0EA34F99F | ASUS ROG ROG Azoth（原版） | 2.4G 原装/OMNI（分开验） | 开发完 | 只启用 0B05:1A85 原装独立接收器及已知 12 01 读数，不将共用 OMNI 或有线视作 Azoth。余电真机待验。 |
| DEV-547EC4305A | ASUS ROG ROG Falchion RX Low Profile | 2.4G 原装/OMNI（分开验） | 开发完 | 只启用同一 1ACE OMNI 的已验证集合，实时配对表确认 1B06 后查询并复核；1B06 不是直接 USB PID；拒绝断连 FF AA。其他连接待验。 |
| DEV-0C5A352CAF | ATK V75X（320F:5055） | USB 线缆 | 开发完 | 仅 320F:5055 ATK V75X 有线、FF1C:0092、唯一编号 04 接口；校验事务回显，空回复不当 0%，不拦截 VGN 路径。 |
| DEV-8BBAB2F8E9 | ATK V75X（320F:5088） | 2.4G 原装接收器 | 无法判断 | 上游有 5088 接收器实时电量和插拔充电抓包，但读取无线侧要求基于键盘输入活动暂停查询，实机休眠耗电仍待验。余电仅标记精确诊断接口，不引入全局键盘监听，也不套有线路径。 [来源](https://github.com/HeyOkay/HaloBattery/pull/368) |
| DEV-B5004FCD1D | AULA 狼蛛 F87 Pro V2D（0C45:FEFE） | 2.4G 原装接收器 | 开发完 | 只限 AULA F87ProV2D Dongle / 接口3 / FF60:0061 / 33B，不接同ID其他设备。余电待真机。 |
| DEV-0581FB898F | Logitech ERGO K860（Unifying 零售版） | 2.4G Unifying | 开发完 | Unifying 4088 + 实时名称 + Unit ID，0x1000 按真实能力出值，不外推到 Bolt 企业版。待余电真机。 |
| DEV-41FDCD731B | Logitech K780 | 2.4G Unifying | 开发完 | Unifying 405B + 实时名称 + Unit ID；按 0x1000 出值，休眠或换槽时不报实时。待余电真机。 |
| DEV-F4733153F0 | Logitech MX Keys Mini | 2.4G Logi Bolt | 开发完 | Logi Bolt，B369 + 实时名称；不含蓝牙；同一接收器键鼠按各自槽位和 Unit ID 读取。不推断其他型号。余电待真机。 |
| DEV-9C8D6E6F24 | Logitech MX Keys S | 2.4G Logi Bolt | 开发完 | Bolt 046D:C548；按子设备槽位和 Unit ID 读 0x1004，不按接收器猜型号。两设备同接收器测试以余电真机为准。 |
| DEV-80E32F2629 | Logitech MX Keys（原版） | 2.4G Unifying | 开发完 | Unifying 408A + 实时名称 + Unit ID；0x1000 能力确认后读，MX Keys S 和 Bolt 不纳入。待余电真机。 |
| DEV-055D7FF653 | Logitech Signature K650 | 2.4G Logi Bolt | 开发完 | 零售 Bolt B36F，核对活跃槽位的型号与 Unit ID，按 0x1004 → 0x1000 试读；不含企业版。 [来源](https://pwr-solaar.github.io/Solaar/devices/) |
| DEV-F53FA24F0D | Logitech G G613 LIGHTSPEED | 2.4G LIGHTSPEED | 开发完 | LIGHTSPEED；4065 + 实时名称 + Unit ID；仅读经能力核实的 0x1000，档位不当精确百分比。 |
| DEV-E1415436E4 | Logitech G G915 LIGHTSPEED | 2.4G LIGHTSPEED | 无法判断 | 407C 的实报仅证 0x1001 电压／状态。上游显示的百分比来自换算，缺独立高、中、低放电对照，不用鼠标曲线替代和触发低电提醒。 [来源](https://github.com/pwr-Solaar/Solaar/issues/2253) |
| DEV-F61B7F554D | Logitech G G915 TKL LIGHTSPEED | 2.4G LIGHTSPEED | 无法判断 | 408E 的完整功能表只见 0x1001；实测同一台插拔跳变 68mV 且校准只覆盖一个电量点，不把电压当原生百分比。需跨放电区间及充电状态实机校验。 [来源](https://github.com/rodolfocamara/battery-widget/blob/main/docs/linux.md#keyboard-battery-why-the-number-is-an-estimate) |
| DEV-E731C6987B | MCHOSE 迈从 G87（41E4:2001 候选） | 2.4G 原装接收器 | 无法判断 | G87 的共享接收器只按 MI01/FF02:0002、20B I/O、Report 13 标记诊断；上游见休眠缓存长期回旧电量及 M HUB 会话冲突，主动查询维持关闭。 [来源](https://github.com/evren-oct/vigil-watt/blob/main/docs/hardware/brands/mchose.md) |
| DEV-2040D76407 | Rapoo 雷柏 反馈键盘（型号待确认） | 2.4G 原装接收器 | 无法判断 | 系统能按雷柏通用接收器自动试读。未确认具体键盘和私有协议；没有系统值就显示无数据。 [来源](https://www.rapoo.com/en/product/9510M) |
| DEV-4B0FE97EAA | Rapoo 雷柏 反馈键盘（型号待确认） | 蓝牙 | 无法判断 | 已具备通用蓝牙兜底。该反馈缺少键盘底标及蓝牙与接收器独立诊断，无法确认具体型号。 [来源](https://www.bluetooth.com/specifications/specs/battery-service/) |
| DEV-C876B8BD55 | Razer BlackWidow V3 Mini HyperSpeed | 2.4G HyperSpeed | 开发完 | 原装 HyperSpeed 接收器 1532:0271 MI03；唯一匹配 91 字节集合时试读，不以休眠 0 值报低电。 [来源](https://github.com/wushuai0802/myfinder-device-battery/blob/7b4131b29709f79c833d5fb39db52656265ce9d1/engine/upstream-protocols.md) |
| DEV-79A51BE263 | Razer BlackWidow V4 Tenkeyless HyperSpeed | 2.4G HyperSpeed | 开发完 | 原装 HyperSpeed 接收器 1532:02D5 MI02；唯一匹配 91 字节集合时试读，不含有线和其他 V4。 [来源](https://github.com/wushuai0802/myfinder-device-battery/blob/7b4131b29709f79c833d5fb39db52656265ce9d1/engine/upstream-protocols.md) |
| DEV-E3B2D31694 | Razer DeathStalker V2 Pro | 2.4G HyperSpeed | 开发完 | 全尺寸原装接收器 1532:0290 MI02；唯一匹配 91 字节集合时试读，不借用 TKL 真机结论。 [来源](https://github.com/wushuai0802/myfinder-device-battery/blob/7b4131b29709f79c833d5fb39db52656265ce9d1/engine/upstream-protocols.md) |
| DEV-EDD16C92EB | Razer DeathStalker V2 Pro TKL | 2.4G HyperSpeed | 开发完 | 只认 1532:0296、MI02、准确产品名、唯一 91 字节 Feature 集合，0x9F 查询；零、忙或无回包不报当前电量。 |
| DEV-4A73CB93E9 | VGN V98 Pro V3（258A:024F） | 2.4G 原装接收器 | 开发完 | #190有99%插拔对照；确认双向20字节及校验；有线 024E 独立 |
| DEV-C5C0ECE94A | 8BitDo Pro 3 (2DC8:6009) | 蓝牙 DInput | 开发完 | 上游 Steam 关闭时实测；04 帧、不发切换命令，拒绝可疑 0 |
| DEV-78D3225E87 | GameSir Super Nova | 2.4GHz 原装接收器 | 开发完 | 只限 3537:103E、FFA0、唯一集合、明确 Super Nova 型号名；0xFF 仅充电，不算满电。余电待真机。 |
| DEV-91F4CF7A9B | Nintendo Nintendo Switch Pro Controller (HAC-013, 057E:2009) | 蓝牙（原生 HID） | 开发完 | 仅被动读完整 0x30 档位，不切模式；0x3F 尝试同一容器 Windows 电量，不猜百分比。余电待真机。 |
| DEV-EA399C26C0 | Sony DualSense (CFI-ZCT1W, 054C:0CE6) | 蓝牙（原生 HID） | 开发完 | 仅在收到带电量的扩展帧时读取；普通帧尝试同设备 Windows 电量，不发切模式命令 |
| DEV-D15B62CCB1 | Sony DualSense (CFI-ZCT1W, 054C:0CE6) | USB | 开发完 | 按协议档位保留区间；上游或代码证据不等于本项目真机验收 |
| DEV-740684D220 | Sony DualSense Edge (CFI-ZCP1, 054C:0DF2) | 蓝牙（原生 HID） | 开发完 | 仅在收到带电量的扩展帧时读取；普通帧尝试同设备 Windows 电量，不发切模式命令 |
| DEV-8712AB474B | Sony DualSense Edge (CFI-ZCP1, 054C:0DF2) | USB | 开发完 | 按协议档位保留区间；上游或代码证据不等于本项目真机验收 |
| DEV-2B0541AEF2 | Sony DualShock 4 v1 (CUH-ZCT1, 054C:05C4) | 蓝牙（原生 HID） | 开发完 | 仅在收到带电量的扩展帧时读取；普通帧尝试同设备 Windows 电量，不发切模式命令 |
| DEV-896CD0DD39 | Sony DualShock 4 v1 (CUH-ZCT1, 054C:05C4) | USB | 开发完 | 按协议档位保留区间；上游或代码证据不等于本项目真机验收 |
| DEV-FAE8309D55 | Sony DualShock 4 v2 (CUH-ZCT2, 054C:09CC) | 蓝牙（原生 HID） | 开发完 | 仅在收到带电量的扩展帧时读取；普通帧尝试同设备 Windows 电量，不发切模式命令 |
| DEV-9DD2F1CED3 | Sony DualShock 4 v2 (CUH-ZCT2, 054C:09CC) | USB | 开发完 | 按协议档位保留区间；上游或代码证据不等于本项目真机验收 |
| DEV-665258E17E | Xbox Xbox Elite Wireless Controller Series 2 (1797) | 蓝牙 | 无法判断 | 已有 Windows 实物探针与门禁单测；尚无此型号和连接的真实容器/槽位及掉线记录。只接受实际蓝牙设备路径，不将 XInput 槽位当物理身份。 [来源](https://learn.microsoft.com/en-us/uwp/api/windows.gaming.input.rawgamecontroller.trygetbatteryreport) |
| DEV-5A09018DF3 | Xbox Xbox Elite Wireless Controller Series 2 (1797) | Xbox 无线适配器 | 无法判断 | 已有 Windows 实物探针与门禁单测；尚无此型号和连接的真实容器/槽位及掉线记录。独立适配器子设备身份未验证。 [来源](https://learn.microsoft.com/en-us/uwp/api/windows.gaming.input.rawgamecontroller.trygetbatteryreport) |
| DEV-B31D37B53E | Xbox Xbox One S Wireless Controller (1708) | 蓝牙 | 无法判断 | 已有 Windows 实物探针与门禁单测；尚无此型号和连接的真实容器/槽位及掉线记录。只接受实际蓝牙设备路径，不将 XInput 槽位当物理身份。 [来源](https://learn.microsoft.com/en-us/uwp/api/windows.gaming.input.rawgamecontroller.trygetbatteryreport) |
| DEV-664565011A | Xbox Xbox One S Wireless Controller (1708) | Xbox 无线适配器 | 无法判断 | 已有 Windows 实物探针与门禁单测；尚无此型号和连接的真实容器/槽位及掉线记录。独立适配器子设备身份未验证。 [来源](https://learn.microsoft.com/en-us/uwp/api/windows.gaming.input.rawgamecontroller.trygetbatteryreport) |
| DEV-2C292D5E66 | Xbox Xbox Wireless Controller (Series X\|S / 1914) | 蓝牙 | 无法判断 | 已有 Windows 实物探针与门禁单测；尚无此型号和连接的真实容器/槽位及掉线记录。只接受实际蓝牙设备路径，不将 XInput 槽位当物理身份。 [来源](https://learn.microsoft.com/en-us/uwp/api/windows.gaming.input.rawgamecontroller.trygetbatteryreport) |
| DEV-728CC898D7 | Xbox Xbox Wireless Controller (Series X\|S / 1914) | Xbox 无线适配器 | 无法判断 | 已有 Windows 实物探针与门禁单测；尚无此型号和连接的真实容器/槽位及掉线记录。独立适配器子设备身份未验证。 [来源](https://learn.microsoft.com/en-us/uwp/api/windows.gaming.input.rawgamecontroller.trygetbatteryreport) |
| DEV-7882A9E055 | HUAWEI FreeClip 2 | 配对后经典蓝牙 | 开发完 | Windows SIG 027D:4113、已配对且已连接；系统无读数才查 SPP，忙时退出。显示最低有效耳机电量；充电状态不推断。余电待真机。 |
| DEV-A0071606A0 | OPPO Enco Clip2 | 配对后经典蓝牙候选 | 开发完 | 仅已配对、连接、精确型号和 ELNK 服务；确认 06E010 后才读电量。耳机取最低有效值，不拿盒电量代替。真机待验。 |
| DEV-E71A5F4913 | OPPO Enco X4 | 配对后经典蓝牙 | 开发完 | 接入序 1：产品 ID 06EC10；读取最低有效耳机电量，不含 LE Audio。 |
| DEV-AD8F661901 | Sony WH-1000XM3 | 配对后经典蓝牙 | 开发完 | Windows → BAS → Sony MDR v1；与 XM4 共用电量查询，核对同一容器和独立 SDP 身份 054C:0CD3。待余电真机。 [来源](https://github.com/mos9527/SonyHeadphonesClient/blob/v1-compat/docs/device-support/WH-1000XM3.md) |
| DEV-FCFFFD3DA2 | Sony WH-1000XM4 | 配对后经典蓝牙 | 开发完 | 与 XM3 共用 MDR v1 电量查询，校正服务 UUID；核对同一容器和 SDP 身份 054C:0D58。待余电真机。 [来源](https://github.com/randwardatake/wh1000xm4-anc-optimizer/blob/main/docs/STATUS.md) |
| DEV-C5DE96A056 | ASUS ROG ROG Gladius III Wireless AimPoint | 2.4G OMNI | 无法判断 | OMNI 共用接收器尚不能把 Gladius III AimPoint 与其他鼠标的在线身份绑定；未启用。 [来源](https://www.asus.com/us/support/faq/1050878/) |
| DEV-869A8AD6F9 | ASUS ROG ROG Harpe Ace Aim Lab Edition | 2.4G OMNI | 无法判断 | 缺 Harpe Ace Aim Lab Edition 的 OMNI 模式实时型号与电量回包；不借共用接收器身份。 [来源](https://www.asus.com/us/support/faq/1050878/) |
| DEV-9D38CCDA66 | ASUS ROG ROG Keris II Ace | 2.4G OMNI | 无法判断 | 缺 Keris II Ace 的 OMNI 同鼠标在线身份与厂商电量回包；早代 Keris 路径不外推。 [来源](https://www.asus.com/us/support/faq/1050878/) |
| DEV-F0E8581E2B | CORSAIR DARK CORE RGB PRO SE | 2.4G SLIPSTREAM | 无法判断 | Dark Core RGB Pro 与 SE 接收器边界不同，缺精确 SE 无线端点及电量读数证据。 [来源](https://www.corsair.com/us/en/c/gaming-mouse/wireless-gaming-mice) |
| DEV-3C76A887C3 | CORSAIR HARPOON RGB WIRELESS | 2.4G SLIPSTREAM | 无法判断 | 缺 Harpoon RGB Wireless 原装 SLIPSTREAM 端点、在线字段及电量回包；不借有线。 [来源](https://www.corsair.com/us/en/c/gaming-mouse/wireless-gaming-mice) |
| DEV-67229D7389 | CORSAIR SABRE RGB PRO WIRELESS | 2.4G SLIPSTREAM | 无法判断 | 缺独立 Sabre RGB Pro Wireless 原装接收器实报；Sabre V2 已知协议不外推。 [来源](https://www.corsair.com/us/en/c/gaming-mouse/wireless-gaming-mice) |
| DEV-4E91A2FCD4 | DAREU 达尔优 EM901X（260D:1074） | 2.4G 原装接收器 | 无法判断 | 仅诊断。关机后接收器可能继续回旧读数，缺同次查询的在线证据。 [来源](https://github.com/notjiccu/wireless-device-battery-monitor/blob/main/src/drivers/dareu.cpp) |
| DEV-F8E56D1B00 | Dell MS7421W | 蓝牙 | 开发完（仅通用） | 系统电量 → 标准 BLE Battery Service（若可枚举）；没有可用值就显示无数据。未证明该型号一定上报电量。 [来源](https://learn.microsoft.com/en-us/windows-hardware/design/accessory-guidelines/bluetooth-accessory-guidelines/bluetooth-accessory-guidelines-battery-profiles-services) |
| DEV-FB36C0D99E | HP 710 Rechargeable Silent Mouse | 蓝牙 | 开发完（仅通用） | 系统电量 → 标准 BLE Battery Service（若可枚举）；没有可用值就显示无数据。未证明该型号一定上报电量。 [来源](https://learn.microsoft.com/en-us/windows-hardware/design/accessory-guidelines/bluetooth-accessory-guidelines/bluetooth-accessory-guidelines-battery-profiles-services) |
| DEV-B911DD8DA3 | HP 930 Creator Wireless Mouse | 蓝牙 | 开发完（仅通用） | 系统电量 → 标准 BLE Battery Service（若可枚举）；没有可用值就显示无数据。未证明该型号一定上报电量。 [来源](https://learn.microsoft.com/en-us/windows-hardware/design/accessory-guidelines/bluetooth-accessory-guidelines/bluetooth-accessory-guidelines-battery-profiles-services) |
| DEV-2E1FD43A45 | HyperX Pulsefire Haste 2 Core Wireless | 2.4G 原装接收器 | 无法判断 | Core 版 03F0:0AB5 上游读数实测过，但仍缺该实物确切 Windows HID 集合/报告描述符；不把 0F98 的实现扩过去。 [来源](https://github.com/notjiccu/wireless-device-battery-monitor/blob/main/src/drivers/hyperx.cpp) |
| DEV-98944A6D2B | HyperX Pulsefire Haste 2 Mini Wireless（03F0:0F98） | 2.4G 原装接收器 | 无法判断 | 该行的型号/PID 映射矛盾：0F98 的真实硬件是 Haste 2 Wireless，已另按第 95 行处理；Mini 另行核对 0DA0 描述符。 [来源](https://github.com/notjiccu/wireless-device-battery-monitor/blob/main/src/drivers/hyperx.cpp) |
| DEV-0F97C98163 | HyperX Pulsefire Haste 2 Wireless | 2.4G 原装接收器 | 开发完 | 仅已实测的 Haste 2 Wireless 03F0:0F98、MI02 FF00:0001、64 字节指定报告；要求查询前后实时链接在线，首次确认连上等待 6 秒，不扩到 0D97、Core、Mini。 [来源](https://github.com/notjiccu/wireless-device-battery-monitor/blob/main/src/drivers/hyperx.cpp) |
| DEV-E0CAE11F77 | Keychron M5 Ultra-Link 8K（3434:D028） | 2.4G 8K 接收器 | 无法判断 | D028 是 M5/M6 共用接收器；Linux 有 B5/03 活跃槽位身份查询，但仍缺 Windows 输出/输入报告形状和切槽过程中电量归属验证。保持待接入。 [来源](https://github.com/HeyOkay/HaloBattery/blob/main/docs/protocols.md) |
| DEV-FC53784FD8 | Keychron M5（3434:D048） | USB 线缆 | 开发完 | 仅原装有线 3434:D048、MI04 唯一厂商集合、经描述符证明 64 字节 B3 输出和 B4 输入。一次 Control SET_REPORT 及中断输入校验，无值不告警；上游 Linux，余电 Windows 真机待验。 [来源](https://github.com/HeyOkay/HaloBattery/blob/main/docs/protocols.md) |
| DEV-71519250DE | Logitech G G502 X PLUS | USB | 开发完 | PR #8 有线 C095；不使用 G502 LIGHTSPEED 的电压估算。 |
| DEV-99A5138CA8 | Microsoft Bluetooth Ergonomic Mouse | 蓝牙 | 开发完（仅通用） | 系统电量 → 标准 BLE Battery Service（若可枚举）；没有可用值就显示无数据。未证明该型号一定上报电量。 [来源](https://learn.microsoft.com/en-us/windows-hardware/design/accessory-guidelines/bluetooth-accessory-guidelines/bluetooth-accessory-guidelines-battery-profiles-services) |
| DEV-1ACC52D422 | Microsoft Surface Precision Mouse | 蓝牙 | 开发完（仅通用） | 系统电量 → 标准 BLE Battery Service（若可枚举）；没有可用值就显示无数据。未证明该型号一定上报电量。 [来源](https://learn.microsoft.com/en-us/windows-hardware/design/accessory-guidelines/bluetooth-accessory-guidelines/bluetooth-accessory-guidelines-battery-profiles-services) |
| DEV-1F194FA97A | Rapoo 雷柏 VT9 PRO（24AE:1601） | 2.4G 原装接收器 | 无法判断 | VT9 PRO 24AE:1601 是独立方案，缺确切被动报文和断连验证。不可借新 VT9 Gen2 或 VT3。 [来源](https://github.com/wushuai0802/myfinder-device-battery/blob/7b4131b29709f79c833d5fb39db52656265ce9d1/engine/upstream-protocols.md) |
| DEV-F41994234C | SteelSeries Rival 3 Wireless（1038:1830） | 2.4G 原装接收器 | 无法判断 | Rival 3 Wireless 1038:1830 的两份上游报告形状不一致，需要抓对应 USB 接收器实报和关机时形状。 [来源](https://github.com/HeyOkay/HaloBattery/blob/main/docs/protocols.md) |
| DEV-10716040FA | VGN Dragonfly3 SE（391D:1A01） | 2.4G 原装接收器 | 无法判断 | 静态 55:30 来源只证明 FF01:0010 状态查询语义，未建立同型号离线事实或可排除旧电量。保留候选。 [来源](https://github.com/wushuai0802/myfinder-device-battery/blob/7b4131b29709f79c833d5fb39db52656265ce9d1/engine/upstream-protocols.md) |
| DEV-6D296B76E1 | VXE R1 Pro Max 原装 1K（3554:F58A） | 2.4G 原装接收器 | 开发完 | 原装 1K 3554:F58A，MI01 FF02:0002；仅编号 08 的 17 字节协议帧及 HIDClass 0 填充，先验在线及 RF ID、再验实时 CID/MID 2,27；校验电量并再次确认同一 RF ID。无 4K 外推。 [来源](https://github.com/HeyOkay/HaloBattery/issues/87) |
| DEV-79DADF93C5 | VXE R1 Pro Max（3554:F58C） | USB 线缆 | 开发完 | 有线 3554:F58C，MI01 FF02:0002；仅编号 08 的 17 字节协议帧及 HIDClass 0 填充，CID/MID 2,27 区分共用 ID 的 R1 Pro，再解析带校验电量。无硬件实例证据不跨传输合并。 [来源](https://github.com/HeyOkay/HaloBattery/issues/87) |
| DEV-FBA50C34AE | AJAZZ 黑爵 AK820 Pro | 2.4G 原装接收器 | 无法判断 | AK820 Pro 无线需确切接收器、集合和型号回包，非 AK820 Max/标准版，也不能继承 MK87PRO。 [来源](https://ajazzbrand.com/products/ajazz-ak820-pro-keyboard) |
| DEV-418168CEDE | AJAZZ 黑爵 AK820 Pro | 蓝牙 | 开发完（仅通用） | 系统电量 → 标准 BLE Battery Service（若可枚举）；没有可用值就显示无数据。未证明该型号一定上报电量。 [来源](https://learn.microsoft.com/en-us/windows-hardware/design/accessory-guidelines/bluetooth-accessory-guidelines/bluetooth-accessory-guidelines-battery-profiles-services) |
| DEV-0DE76F1E4D | ASUS ROG ROG Strix Scope II 96 Wireless | 2.4G OMNI | 无法判断 | ROG Scope II 96 与现有 Azoth 接收器同家族，仍缺带同设备 SKU 的真实在线电量响应。 [来源](https://www.asus.com/us/support/faq/1050878/) |
| DEV-4FC755DA62 | AULA 狼蛛 F75 | 2.4G 原装接收器 | 无法判断 | F75 需先固定地区与 PCB 版本、原装接收器和真实在线电量语义，不按 F75 字符串合并。 [来源](https://www.aulastar.com/aula-hub/) |
| DEV-4C8E2760DB | AULA 狼蛛 F99 | 2.4G 原装接收器 | 无法判断 | F99 不等于 F99 Pro/Max；缺该型号端点和读数证据。 [来源](https://www.aulastar.com/aula-hub/) |
| DEV-7B0037C5B5 | CHERRY MX 3.0S Wireless（046A:00EA） | 2.4G 原装接收器 | 无法判断 | 上游品牌级有读数，但 SHARED HID 命令需定 MX 3.0S 无线确切集合，并验证关机/充电回包；不直接继承 MX 2.0S 的协议。 [来源](https://github.com/notjiccu/wireless-device-battery-monitor#supported-devices) |
| DEV-4B7B49FD73 | CHERRY MX 8.2 TKL Wireless | 蓝牙 | 开发完（仅通用） | 系统电量 → 标准 BLE Battery Service（若可枚举）；没有可用值就显示无数据。未证明该型号一定上报电量。 [来源](https://learn.microsoft.com/en-us/windows-hardware/design/accessory-guidelines/bluetooth-accessory-guidelines/bluetooth-accessory-guidelines-battery-profiles-services) |
| DEV-D534905A02 | CORSAIR K100 AIR WIRELESS | 2.4G SLIPSTREAM | 无法判断 | K100 AIR 缺专属 SLIPSTREAM PID/集合和脱机状态资料，需同一设备的 iCUE 电量对照。 [来源](https://www.corsair.com/ww/en/c/keyboards/wireless-keyboards) |
| DEV-30A08DE4A5 | CORSAIR K65 PLUS WIRELESS | 2.4G SLIPSTREAM | 无法判断 | K65 PLUS 上游有候选，但缺确切连接模式下型号、读数及接收器离线判据，暂不发查询。 [来源](https://github.com/HeyOkay/HaloBattery/blob/main/docs/protocols.md) |
| DEV-8EC41752AB | CORSAIR K70 CORE TKL WIRELESS | 2.4G SLIPSTREAM | 无法判断 | K70 CORE TKL WIRELESS 需独立 2.4G 实测资料；不按有线同名模式猜测。 [来源](https://www.corsair.com/ww/en/c/keyboards/wireless-keyboards) |
| DEV-D357B11765 | HP 975 Dual-Mode Wireless Keyboard | 蓝牙 | 开发完（仅通用） | 系统电量 → 标准 BLE Battery Service（若可枚举）；没有可用值就显示无数据。未证明该型号一定上报电量。 [来源](https://learn.microsoft.com/en-us/windows-hardware/design/accessory-guidelines/bluetooth-accessory-guidelines/bluetooth-accessory-guidelines-battery-profiles-services) |
| DEV-FC6F5699DE | Keychron K2 Pro | Bluetooth | 开发完（仅通用） | 系统电量 → 标准 BLE Battery Service（若可枚举）；没有可用值就显示无数据。未证明该型号一定上报电量。 [来源](https://learn.microsoft.com/en-us/windows-hardware/design/accessory-guidelines/bluetooth-accessory-guidelines/bluetooth-accessory-guidelines-battery-profiles-services) |
| DEV-E657777254 | Keychron K3 Max | Bluetooth | 开发完（仅通用） | 系统电量 → 标准 BLE Battery Service（若可枚举）；没有可用值就显示无数据。未证明该型号一定上报电量。 [来源](https://learn.microsoft.com/en-us/windows-hardware/design/accessory-guidelines/bluetooth-accessory-guidelines/bluetooth-accessory-guidelines-battery-profiles-services) |
| DEV-BF8ED537C2 | Keychron K8 Pro | Bluetooth | 开发完（仅通用） | 系统电量 → 标准 BLE Battery Service（若可枚举）；没有可用值就显示无数据。未证明该型号一定上报电量。 [来源](https://learn.microsoft.com/en-us/windows-hardware/design/accessory-guidelines/bluetooth-accessory-guidelines/bluetooth-accessory-guidelines-battery-profiles-services) |
| DEV-3D0485D41A | Keychron Q1 Max | Bluetooth | 开发完（仅通用） | 系统电量 → 标准 BLE Battery Service（若可枚举）；没有可用值就显示无数据。未证明该型号一定上报电量。 [来源](https://learn.microsoft.com/en-us/windows-hardware/design/accessory-guidelines/bluetooth-accessory-guidelines/bluetooth-accessory-guidelines-battery-profiles-services) |
| DEV-B429935039 | Lofree 洛斐 Flow 2 84 | 蓝牙 | 开发完（仅通用） | 系统电量 → 标准 BLE Battery Service（若可枚举）；没有可用值就显示无数据。未证明该型号一定上报电量。 [来源](https://learn.microsoft.com/en-us/windows-hardware/design/accessory-guidelines/bluetooth-accessory-guidelines/bluetooth-accessory-guidelines-battery-profiles-services) |
| DEV-F93F7822F2 | Lofree 洛斐 Flow Lite84（05AC:024F） | 2.4G 原装接收器 | 无法判断 | 05AC:024F 多品牌共用；需 Flow Lite84 完整产品名、同一物理 USB、真实入/出报告以及脱机时的报告，不能按 PID 激活。 [来源](https://github.com/wushuai0802/myfinder-device-battery/blob/7b4131b29709f79c833d5fb39db52656265ce9d1/engine/upstream-protocols.md) |
| DEV-8F392A3673 | Lofree 洛斐 Hyzen（388D:0025） | 2.4G 原装接收器 | 无法判断 | 上游是网页驱动静态候选，START/END 会话的无线在线与断线状态尚无硬件验证；不引入会话控制写入。 [来源](https://github.com/HeyOkay/HaloBattery/blob/main/docs/protocols.md) |
| DEV-7C81C8CAF6 | MCHOSE 迈从 G98 Pro | 2.4G 原装接收器 | 无法判断 | G98 Pro 与 G98 及 G98 V3 需分别实测原装接收器，缺专属身份与只读电量事务。 [来源](https://www.mchose.store/pages/user-manual) |
| DEV-F8D91E591A | MCHOSE 迈从 GX87 | 2.4G 原装接收器 | 无法判断 | GX87 不等于 G87/G87 Pro，无可复用的确切接收器身份和实测读数。 [来源](https://www.mchose.store/pages/user-manual) |
| DEV-D84BBCD475 | MCHOSE 迈从 K99 V3 | 2.4G 原装接收器 | 无法判断 | K99 V3 需独立产品 PID/报告描述符及电量报文；不沿用 K99 原版。 [来源](https://www.mchose.store/pages/user-manual) |
| DEV-D93D6C8E43 | Microsoft Designer Compact Keyboard | Bluetooth | 开发完（仅通用） | 系统电量 → 标准 BLE Battery Service（若可枚举）；没有可用值就显示无数据。未证明该型号一定上报电量。 [来源](https://learn.microsoft.com/en-us/windows-hardware/design/accessory-guidelines/bluetooth-accessory-guidelines/bluetooth-accessory-guidelines-battery-profiles-services) |
| DEV-CFF26C933B | Rapoo 雷柏 E9500G | 2.4G 原装接收器 | 无法判断 | E9500G 仅确认接收器连接；需真实 PID/集合和原装接收器的只读电量路径。 [来源](https://rapoo.com/en/support/downloadcenter) |
| DEV-78FDC7B921 | Rapoo 雷柏 V700DIY-75 | 2.4G 原装接收器 | 无法判断 | V700DIY-75 缺实体接收器被动报告和离线样本，不能外推 VT 鼠标。 [来源](https://rapoo.com/en/support/downloadcenter) |
| DEV-FD98ABC3C7 | Rapoo 雷柏 V700DIY-87 | 2.4G 原装接收器 | 无法判断 | V700DIY-87 缺同型号原装接收器的 PID、报告签名及关机验证。 [来源](https://rapoo.com/en/support/downloadcenter) |
| DEV-C22DE2D3D2 | Rapoo 雷柏 V700DIY-98 | 2.4G 原装接收器 | 无法判断 | 有上游 V700DIY-98 协议信息线索，仍缺零售版本原装接收器和离线新鲜度样本。 [来源](https://github.com/HeyOkay/HaloBattery/blob/main/docs/protocols.md) |
| DEV-6FE9550197 | Razer BlackWidow V4 Low-profile TKL HyperSpeed | 2.4G 共享 HyperSpeed 接收器 | 开发完 | 仅已有共享配对路径；单接收器或其它固件单列验证。 |
| DEV-336A593A62 | VGN N75 V2（391D:2A01） | 2.4G 原装接收器 | 无法判断 | N75 V2 的上游仅为 BY 13:4A 候选，另有仅 FF00:0001 的变体；欠确切硬件回包。 [来源](https://github.com/wushuai0802/myfinder-device-battery/blob/7b4131b29709f79c833d5fb39db52656265ce9d1/engine/upstream-protocols.md) |
| DEV-22E3F41BF1 | VGN V108（391D:2A02） | 2.4G 原装接收器 | 无法判断 | V108 族仅静态/上游实现，缺 391D:2A02 实物的入出描述符和已连接/失联回包验证。 [来源](https://github.com/wushuai0802/myfinder-device-battery/blob/7b4131b29709f79c833d5fb39db52656265ce9d1/engine/upstream-protocols.md) |
| DEV-E8FEFF2788 | VGN V87 V2（258A:027B） | 2.4G 原装接收器 | 无法判断 | V87 V2 族只见静态官方候选，缺 258A:027B 同 SKU 实报，未沿用 V98。 [来源](https://github.com/wushuai0802/myfinder-device-battery/blob/7b4131b29709f79c833d5fb39db52656265ce9d1/engine/upstream-protocols.md) |
| DEV-4E9C108A67 | VGN V98 Pro V3（258A:024E） | USB 线缆 | 开发完 | 项目代码有分支不等于真机；而 BY 无线证据不能移植 |
| DEV-E05304CE8A | Dell KM7321W | 蓝牙 | 开发完（仅通用） | 键盘、鼠标按各自容器独立读取。系统电量 → 标准 BLE Battery Service（若可枚举）；没有可用值就显示无数据。未证明该型号一定上报电量。 [来源](https://learn.microsoft.com/en-us/windows-hardware/design/accessory-guidelines/bluetooth-accessory-guidelines/bluetooth-accessory-guidelines-battery-profiles-services) |
| DEV-3CB8990021 | 8BitDo Ultimate 2 Wireless (2DC8:310B / 6012) | 2.4GHz 310B XInput | 无法判断 | Ultimate 2 的 310B 是 XInput 接收器；Linux 扩展协议不证明 Windows XInput 槽位可绑到具体实体。不要按槽位猜测电量。 [来源](https://github.com/ascendedent/8bitdo-Linux-Software/blob/main/README.md) |
| DEV-25FCD3DE08 | BEITONG 北通 KP40D (20BC:515C) | 2.4GHz 原装接收器 | 无法判断 | KP40D 上游有实测状态报文，但两个实现对于线上的 0x15/0xAD 含义冲突，旧教程利用单槽推断；余电未证明同接收器的新鲜链路，未启用。 [来源](https://github.com/notjiccu/wireless-device-battery-monitor/blob/main/src/drivers/beitong.cpp) |
| DEV-2EBFA0F75A | Flydigi Apex 5 (37D7:2501) | 2.4GHz 原装接收器 | 开发完 | Apex 5 仅指定 PID、唯一 FFA0:0001 与已证实的编号方式；每次验证架构、回包型号、固件、连接与原生 0–5 档，不把台阶当准确百分比；待余电实物复测。 [来源](https://github.com/libsdl-org/SDL/blob/main/src/joystick/hidapi/SDL_hidapi_flydigi.c) |
| DEV-75F1E1C1F5 | Flydigi Apex 5 (37D7:2501) | USB | 开发完 | Apex 5 仅指定 PID、唯一 FFA0:0001 与已证实的编号方式；每次验证架构、回包型号、固件、连接与原生 0–5 档，不把台阶当准确百分比；待余电实物复测。 [来源](https://github.com/libsdl-org/SDL/blob/main/src/joystick/hidapi/SDL_hidapi_flydigi.c) |
| DEV-290FEE7706 | Flydigi Vader 5 Pro (37D7:2401) | 2.4GHz 原装接收器 | 开发完 | Vader 5 Pro 仅指定 PID、唯一 FFA0:0001 与已证实的编号方式；每次验证架构、回包型号、固件、连接与原生 0–5 档，不把台阶当准确百分比；待余电实物复测。 [来源](https://github.com/HeyOkay/HaloBattery/issues/191) |
| DEV-9CB2DF91F6 | Flydigi Vader 5 Pro (37D7:2401) | USB | 开发完 | Vader 5 Pro 仅指定 PID、唯一 FFA0:0001 与已证实的编号方式；每次验证架构、回包型号、固件、连接与原生 0–5 档，不把台阶当准确百分比；待余电实物复测。 [来源](https://github.com/HeyOkay/HaloBattery/issues/191) |
| DEV-45A28E6FBA | GameSir Cyclone 2 | 2.4GHz 原装接收器 | 无法判断 | 100B USB 与接收器共用；上游需主动开启持续状态流，不能当成一次性只读查询。本轮保留，待被动读取/自动停止及连接语义证据。 [来源](https://github.com/vdemonchy/cyclone2-linux) |
| DEV-86252B81A8 | GameSir G7 Pro Zenless Zone Zero Edition (3537:105E) | 2.4GHz 原装接收器 | 无法判断 | 上游 WGI/Xbox GIP 给电量，但尚未证明 105E 该版本能把读数与同一物理控制器唯一匹配。 [来源](https://github.com/notjiccu/wireless-device-battery-monitor/blob/main/src/drivers/gamesir.cpp) |
| DEV-EB58C32925 | GameSir Nova Lite | 2.4GHz 原装接收器 | 无法判断 | 1098 共用于多款 Nova 系列；共享协议的设备信息回包未验证带 SKU 标识，不按接收器 VID/PID 自动命名。 [来源](https://github.com/notjiccu/wireless-device-battery-monitor/blob/main/src/drivers/gamesir.cpp) |
| DEV-ACAF7A0E18 | GameSir Nova Lite 2 | 2.4GHz 原装接收器 | 无法判断 | 1040 上游明确未实测，1098 共用且缺精确 SKU 鉴别。只启用与之独立的 100F USB 端点。 [来源](https://github.com/notjiccu/wireless-device-battery-monitor/blob/main/src/drivers/gamesir.cpp) |
| DEV-C5EC79A0C8 | GameSir Nova Lite 2 | USB | 开发完 | 只限 3537:100F PC USB 端点、唯一 FF7A 及有效 65 字节报告；255 表示充电时未提供百分比，不当作满电。原装 2.4G 不继承。 [来源](https://github.com/takasurazeem/padcheck) |
| DEV-CBD0F54315 | Nintendo Joy-Con (L, HAC-015, 057E:2006) | 蓝牙（原生 HID） | 开发完 | Joy-Con 左只读原生蓝牙 057E:2006 唯一实体容器的完整 0x30 状态；分档和充电，不切换模式、不发命令。普通帧不作电量。待余电真机。 [来源](https://github.com/libsdl-org/SDL/blob/a01f51916eb3a3989b0bcbc2e2dbcbc724515414/src/joystick/hidapi/SDL_hidapi_switch.c) |
| DEV-6435CA928F | Nintendo Joy-Con (R, HAC-016, 057E:2007) | 蓝牙（原生 HID） | 开发完 | Joy-Con 右只读原生蓝牙 057E:2007 唯一实体容器的完整 0x30 状态；分档和充电，独立于左手柄，不切换模式。待余电真机。 [来源](https://github.com/libsdl-org/SDL/blob/a01f51916eb3a3989b0bcbc2e2dbcbc724515414/src/joystick/hidapi/SDL_hidapi_switch.c) |
| DEV-E00EB0E606 | Valve Steam Controller（新版，28DE:1304／1305） | 2.4GHz 原装 puck | 无法判断 | 新版 Steam Controller 的 puck 每槽 0x43 约 2.5 秒一次；短轮询不能可靠取得实时读数，不能把上次样本冒充当前。需独立每槽监听与断连回归。 [来源](https://github.com/HeyOkay/HaloBattery/blob/15a73ac4d88435a771b0060b28171733a43dab06/docs/protocols.md) |
| DEV-762F845076 | Xbox Xbox One Wireless Controller (1537/1697，各自独立核验) | Xbox 无线适配器 | 无法判断 | 1537/1697 均保留待验；同一适配器下没有物理唯一身份与有效电池档位实板证据，不继承 1708 蓝牙结论。 [来源](https://learn.microsoft.com/en-us/uwp/api/windows.gaming.input.rawgamecontroller.trygetbatteryreport) |
| DEV-587DD55BC1 | Apple AirPods Pro（第 2 代） | 配对蓝牙/BLE 厂商广播 | 无法判断 | 广播可能来自附近未配对或同型号耳机；尚无可靠的同设备身份绑定。 [来源](https://github.com/JKWTCN/BatteryMonitor/blob/master/README.en.md) |
| DEV-C5FBAF65BD | Apple AirPods（第 2 代） | 配对蓝牙/BLE 厂商广播 | 无法判断 | 上游 Windows 有实测，但广播不能凭型号或信号强度绑定到 Windows 配对设备。 [来源](https://github.com/JKWTCN/BatteryMonitor/blob/master/README.en.md) |
| DEV-F8F17647E8 | Bose QuietComfort Headphones | 配对蓝牙 | 开发完（仅通用） | 系统电量 → 标准 BLE Battery Service（若可枚举）；没有可用值就显示无数据。未证明该型号一定上报电量。 [来源](https://learn.microsoft.com/en-us/windows-hardware/design/accessory-guidelines/bluetooth-accessory-guidelines/bluetooth-accessory-guidelines-battery-profiles-services) |
| DEV-3F13435B0E | Bose QuietComfort Ultra Earbuds（第 2 代） | 配对蓝牙 | 开发完（仅通用） | 系统电量 → 标准 BLE Battery Service（若可枚举）；没有可用值就显示无数据。未证明该型号一定上报电量。 [来源](https://learn.microsoft.com/en-us/windows-hardware/design/accessory-guidelines/bluetooth-accessory-guidelines/bluetooth-accessory-guidelines-battery-profiles-services) |
| DEV-4EBDCB8BB3 | Bose QuietComfort Ultra Headphones（第 2 代） | 配对蓝牙 | 开发完（仅通用） | 系统电量 → 标准 BLE Battery Service（若可枚举）；没有可用值就显示无数据。未证明该型号一定上报电量。 [来源](https://learn.microsoft.com/en-us/windows-hardware/design/accessory-guidelines/bluetooth-accessory-guidelines/bluetooth-accessory-guidelines-battery-profiles-services) |
| DEV-D633FC3A87 | HONOR Earbuds 2 Lite | 配对后经典蓝牙 | 无法判断 | 上游按名称选择 FreeBuds 4i 变体；未核实此精确零售型号的 Windows 蓝牙硬件身份与服务路径。 [来源](https://github.com/melianmiko/OpenFreebuds) |
| DEV-89A102784E | HONOR Earbuds S2 | 配对后经典蓝牙 | 无法判断 | 上游按名称支持，未核实该型号的 Windows 蓝牙硬件身份及服务端点。 [来源](https://github.com/melianmiko/OpenFreebuds) |
| DEV-7561791074 | HUAWEI FreeBuds 5i | 配对后经典蓝牙 | 无法判断 | 上游有精确型号电量功能，但仍缺可用的 Windows 蓝牙硬件身份；不泛发通用 SPP 电量请求。 [来源](https://github.com/melianmiko/OpenFreebuds/blob/main/docs/devices/HUAWEI_FreeBuds_5i.md) |
| DEV-32B5F815B7 | HUAWEI FreeBuds 6i | 配对后经典蓝牙 | 无法判断 | 上游确有 SPP 读取；Windows 配对端点的精确硬件身份没有锚定，不用名称单独开启。 [来源](https://github.com/melianmiko/OpenFreebuds) |
| DEV-E7953339FD | HUAWEI FreeBuds Pro 4 | 配对后经典蓝牙 | 无法判断 | 上游与 Pro 3 共用驱动；未核实 Windows 硬件身份及本款电量服务，不继承 FreeClip 2 的端点。 [来源](https://github.com/melianmiko/OpenFreebuds) |
| DEV-DAE9C6BC53 | JBL Live Beam 3 | 配对蓝牙 | 开发完（仅通用） | 系统电量 → 标准 BLE Battery Service（若可枚举）；没有可用值就显示无数据。未证明该型号一定上报电量。 [来源](https://learn.microsoft.com/en-us/windows-hardware/design/accessory-guidelines/bluetooth-accessory-guidelines/bluetooth-accessory-guidelines-battery-profiles-services) |
| DEV-316BD420D0 | JBL Tour Pro 3 | 配对蓝牙 | 开发完（仅通用） | 系统电量 → 标准 BLE Battery Service（若可枚举）；没有可用值就显示无数据。未证明该型号一定上报电量。 [来源](https://learn.microsoft.com/en-us/windows-hardware/design/accessory-guidelines/bluetooth-accessory-guidelines/bluetooth-accessory-guidelines-battery-profiles-services) |
| DEV-9C328192A0 | OPPO Enco Air3 Pro | 配对后经典蓝牙 | 开发完 | 065C10；HeyMelody/ELNK 同容器已配对且已连接，实时响应须匹配硬件产品码；从长度与序号严格匹配的新回包取低电量的一侧，不用盒替代。上游已捕获 80% 响应。 [来源](https://github.com/ncr/omarchy-headphones/blob/main/PROTOCOL.md#oppo-enco-air3-pro--heymelody-on-rfcomm) |
| DEV-4303F98702 | OPPO Enco Buds3 Pro | 配对后经典蓝牙 | 开发完 | 06A850；HeyMelody/ELNK 同容器已配对且已连接，核对产品码；明确拒绝 Buds3 Pro+，新回包只取有效耳机电量。上游有 Windows 实测。 [来源](https://github.com/spizganed/QuickBuds/blob/214e03f073da1fffe655cec67c539644e6e8f1ad/docs/MODELS.md) |
| DEV-0BCC15F023 | OPPO Enco X3 | 配对后经典蓝牙 | 开发完 | 067410；HeyMelody/ELNK 同容器已配对且已连接，核对实时产品码；新回包仅取有效耳机电量。上游有 Windows 实机验证。 [来源](https://github.com/3295074384/OppoPodsWindows) |
| DEV-59F72C55EA | Samsung Galaxy Buds FE | 配对后经典蓝牙 | 无法判断 | 上游有状态报文，但未核实专有会话的安全读取及关闭行为；不启用通用串口写入。 [来源](https://github.com/timschneeb/GalaxyBudsClient/tree/master/GalaxyBudsClient.Tests/BudsFe) |
| DEV-CBD94A3ACD | Samsung Galaxy Buds3 | 配对后经典蓝牙 | 无法判断 | 上游有型号配置，但未核实此型号的会话身份、电量样本与新鲜度。 [来源](https://github.com/timschneeb/GalaxyBudsClient/blob/master/GalaxyBudsClient/Model/Specifications/Buds3DeviceSpec.cs) |
| DEV-237E9E784A | Samsung Galaxy Buds3 Pro | 配对后经典蓝牙 | 无法判断 | 上游有 Windows 型号解码测试，尚未验证私有会话和电量采样实时性。 [来源](https://github.com/timschneeb/GalaxyBudsClient/tree/master/GalaxyBudsClient.Tests/Buds3Pro) |
| DEV-CC4E3B59BF | Sony WH-1000XM5 | 配对后经典蓝牙 | 开发完 | 精确名称、配对且连接、Windows 同容器、SDP USB-IF 054C:0DF0；Fast Pair RFCOMM 只接收单电池新报文，无写入、无订阅，不从 MDR 或广播猜电量。待 Windows 真机。 [来源](https://developers.google.com/nearby/fast-pair/specifications/extensions/deviceinformation) |
| DEV-D3671EC1DB | Sony WH-1000XM6 | 配对后经典蓝牙 | 无法判断 | 默认尝试 Windows／BAS 和 Sony WH 系列只收不发的 Fast Pair 单电池路径；是否有该服务及实时读数未实测。MDR2 缺稳定证据，不发送 XM3/XM4 命令。 [来源](https://github.com/marconvcm/sony-device-center/blob/main/README.md) |
| DEV-1A917A12CD | soundcore Liberty 4 NC | 配对蓝牙 | 无法判断 | 找到型号专用 RFCOMM UUID 与 A3947 状态报文；上游只提供五格电量，不证实每格对应的百分比边界。产品界面需支持保留原始档位后再接，不将格数换算成精确值。 [来源](https://github.com/Oppzippy/OpenSCQ30/blob/master/tools/soundcore-device-faker/devices/a3947.toml) |
| DEV-FA95A9B1CE | soundcore Space One | 配对蓝牙 | 无法判断 | 找到型号专用 RFCOMM UUID 与 A3035 状态报文；上游只提供五格电量，不证实每格对应的百分比边界。产品界面需支持保留原始档位后再接，不将格数换算成精确值。 [来源](https://github.com/Oppzippy/OpenSCQ30/blob/master/tools/soundcore-device-faker/devices/a3035.toml) |
| DEV-DCB0BD123C | soundcore Space Q45 | 配对蓝牙 | 无法判断 | 找到型号专用 RFCOMM UUID 与 A3040 状态报文；上游只提供五格电量，不证实每格对应的百分比边界。产品界面需支持保留原始档位后再接，不将格数换算成精确值。 [来源](https://github.com/Oppzippy/OpenSCQ30/blob/master/tools/soundcore-device-faker/devices/a3040.toml) |
| DEV-4880F8720E | vivo TWS 3e | 配对蓝牙 | 开发完（仅通用） | 系统电量 → 标准 BLE Battery Service（若可枚举）；没有可用值就显示无数据。未证明该型号一定上报电量。 [来源](https://learn.microsoft.com/en-us/windows-hardware/design/accessory-guidelines/bluetooth-accessory-guidelines/bluetooth-accessory-guidelines-battery-profiles-services) |
| DEV-98FD0EC82E | vivo TWS 4 Hi-Fi | 配对蓝牙 | 开发完（仅通用） | 系统电量 → 标准 BLE Battery Service（若可枚举）；没有可用值就显示无数据。未证明该型号一定上报电量。 [来源](https://learn.microsoft.com/en-us/windows-hardware/design/accessory-guidelines/bluetooth-accessory-guidelines/bluetooth-accessory-guidelines-battery-profiles-services) |
| DEV-47297DC5DC | Xiaomi/Redmi Redmi Buds 5 Pro | 配对蓝牙/BLE 厂商广播 | 无法判断 | 上游实测广播读数不等于已配对身份；未证实能从广播绑定到同一 Windows 设备。Fast Pair 实测存在异常读数。 [来源](https://github.com/ncr/omarchy-headphones/blob/main/PROTOCOL.md) |
| DEV-C9D83A972B | Xiaomi/Redmi Redmi Buds 6 Pro | 配对蓝牙 | 开发完（仅通用） | 系统电量 → 标准 BLE Battery Service（若可枚举）；没有可用值就显示无数据。未证明该型号一定上报电量。 [来源](https://learn.microsoft.com/en-us/windows-hardware/design/accessory-guidelines/bluetooth-accessory-guidelines/bluetooth-accessory-guidelines-battery-profiles-services) |
| DEV-B3C10AF6BE | Xiaomi/Redmi Xiaomi Buds 5 Pro | 配对蓝牙 | 开发完（仅通用） | 系统电量 → 标准 BLE Battery Service（若可枚举）；没有可用值就显示无数据。未证明该型号一定上报电量。 [来源](https://learn.microsoft.com/en-us/windows-hardware/design/accessory-guidelines/bluetooth-accessory-guidelines/bluetooth-accessory-guidelines-battery-profiles-services) |
| DEV-6CC56AEF11 | Corsair Virtuoso RGB Wireless SE | 2.4 GHz USB 接收器 | 无法判断 | 原装 SE 接收器的具体 Windows 集合和断连后的数据有效性未独立核实；不能从其他 Virtuoso 版本外推。 [来源](https://github.com/Sapd/HeadsetControl) |
| DEV-A578B48A50 | Corsair Virtuoso RGB Wireless XT | 2.4 GHz USB 接收器 | 无法判断 | XT 接收器与 SE 不共用验收；未核实可跨关机、充电、Bluetooth/2.4G 并用切换的精确状态报文。 [来源](https://github.com/Sapd/HeadsetControl) |
| DEV-4705C569BB | Corsair VOID PRO RGB Wireless | 2.4 GHz USB 接收器 | 无法判断 | 未验证 VOID PRO 精确接收器版本及关机后缓存；不复用 Virtuoso 路由。 [来源](https://github.com/battery-hub/battery-hub/blob/main/README.md) |
| DEV-F94624B6FE | HyperX Cloud Alpha Wireless | 2.4 GHz USB 接收器 | 开发完 | 原版 HP 03F0:098D 只打开 FF43:0202 唯一 31/32B 的 0x21 收发报告；查无线状态 02 前后两次并验证电量回包 0B。无麦克风/有线/Alpha 2 路由。余电待真机。 [来源](https://lore-kernel.gnuweeb.org/linux-input/20261125012602.177917-1-miffe%40miffe.org/) |
| DEV-5AC8CF7205 | HyperX Cloud Flight Wireless | 2.4 GHz USB 接收器 | 无法判断 | 必须分别核验 Flight、Flight S 和品牌版本；原版 Windows 候选未达到收包身份和掉线门槛。 [来源](https://github.com/notjiccu/wireless-device-battery-monitor/blob/main/src/drivers/hyperx.cpp) |
| DEV-7B6A039A95 | HyperX Cloud II Wireless | 2.4 GHz USB 接收器 | 无法判断 | Cloud II 原装的 HP/Kingston 接收器分别核对；缺少允许无歧义启用的本批专门实现。 [来源](https://github.com/Sapd/HeadsetControl) |
| DEV-6E8A918A93 | JBL Quantum 350 Wireless | 2.4 GHz USB 接收器 | 开发完 | 只接原装 0ECB:206B、MI03、Generic Desktop Usage 0、64B Feature 集合；描述符确认两个 GET 报告，读数前后查 0x68 无线在线；本项目待实物。 [来源](https://github.com/krisgfx9/Wireless-Device-Battery-Monitor/issues/259) |
| DEV-B86B99E342 | JBL Quantum 610 Wireless | 2.4 GHz USB 接收器 | 开发完 | 只接原装 0ECB:205C、MI05 且精确声明 0x49/0x68 Feature 的唯一集合；校验回包 ID、前后链路，不解析填充；上游 Linux 实帧，Windows 待实物。 [来源](https://github.com/Tymon3310/jbl-quantum-linux/blob/main/docs/QUANTUM610_PACKETS.md) |
| DEV-09CF15AE6B | JBL Quantum 650 Wireless | 2.4 GHz USB 接收器 | 开发完 | 只接 0ECB:2125、FF12、64B 且具备 Feature 88 / Input 86 的唯一集合；只请求电量子字段，检查报文/状态/范围，不外推 650X 或 USB 有线。 [来源](https://github.com/notjiccu/wireless-device-battery-monitor/blob/main/src/drivers/jbl.cpp) |
| DEV-B4BA1E5740 | Logitech G G533 Wireless | 2.4 GHz USB 接收器 | 无法判断 | 型号精确 HID++ 接收器仍需证明在线数据和电池特征标识，不能沿用鼠标的 HID++ 估算曲线。 [来源](https://github.com/notjiccu/wireless-device-battery-monitor/blob/main/src/drivers/logitech.cpp) |
| DEV-9D27DA7B04 | Logitech G G733 LIGHTSPEED | 2.4 GHz USB 接收器 | 无法判断 | 接收器电量协议与 G HUB 同开和掉线判据未核实；不能使用通用 Logitech 耳机读取假设。 [来源](https://github.com/notjiccu/wireless-device-battery-monitor/blob/main/src/drivers/logitech.cpp) |
| DEV-E77A16DDEF | Logitech G G935 Wireless | 2.4 GHz USB 接收器 | 无法判断 | 先区分原生百分比与型号专用电压推算；当前未安全纳入。 [来源](https://github.com/notjiccu/wireless-device-battery-monitor/blob/main/src/drivers/logitech.cpp) |
| DEV-FB4672DC47 | Razer Barracuda X（2022） | 2.4 GHz USB 接收器 | 无法判断 | 2022 Airoha 独立协议，尚未验证断连前后读数与收包约束，不套通用 Razer；不读有线或其他年份。 [来源](https://github.com/notjiccu/wireless-device-battery-monitor) |
| DEV-4FC626E311 | Razer BlackShark V2 HyperSpeed | 2.4 GHz USB 接收器 | 无法判断 | BlackShark HyperSpeed 私有音频协议；需要精确接收器对答及实时/缓存区分，不套键鼠 Feature。 [来源](https://github.com/notjiccu/wireless-device-battery-monitor) |
| DEV-61A8DC6E5D | Razer BlackShark V2 Pro（2023） | 2.4 GHz USB 接收器 | 无法判断 | 有 2023 PA 协议事实，尚需确认精确 Windows 读包和掉线状态，不外推 2020/其他平台。 [来源](https://github.com/HeyOkay/HaloBattery/blob/main/docs/protocols.md#razer-blackshark-v2-pro-2023) |
| DEV-FE2B2BDADF | SteelSeries Arctis Nova 5 | 2.4 GHz USB 接收器 | 无法判断 | Nova 5 使用与 Nova 7 不同的报文字段，上游 Windows 路由缺少本批需要的同 SKU 接收器实帧和在线状态证据。 [来源](https://github.com/HeyOkay/HaloBattery/blob/main/docs/protocols.md#steelseries-arctis-and-gamebuds-other-models) |
| DEV-373B79AA7A | SteelSeries Arctis Nova 7 | 2.4 GHz USB 接收器 | 开发完 | 只接上游实测的 1038:22A1 固件、MI03 / FFC0:0001、非编号输入输出报告；校验 0xB0 回包和在线字段，不外推 Gen2、7P/7X 或旧档位固件。 [来源](https://github.com/HeyOkay/HaloBattery/blob/main/docs/protocols.md#steelseries-arctis-nova-7) |
| DEV-5AEE8193FC | SteelSeries Arctis Nova Pro Wireless | 2.4 GHz USB 基站 | 无法判断 | 基站版本和接口不同，上游资料缺少对佩戴电池与备用电池的精确同 PID 原包证明，暂不读取基站。 [来源](https://github.com/HeyOkay/HaloBattery/blob/main/docs/protocols.md#steelseries-arctis-nova-pro-wireless-103812e0-103812e5-x) |
| DEV-20C4CC9EEE | ATK Blazing Sky F1 Ultimate | 2.4G 原装接收器 | 无法判断 | F1 Ultimate 变体所配高回报率接收器不唯一，需精确 PID/实际设备身份和在线电量。 [来源](https://github.com/HeyOkay/HaloBattery/blob/main/docs/protocols.md) |
| DEV-0AE2D07B55 | ATK Blazing Sky X1 Pro | 2.4G 原装接收器 | 无法判断 | X1 Pro 需精确原装接收器、准确 CID/MID 和在线状态，不使用 X1 系列猜测。 [来源](https://github.com/OpenMouse-Project/mouse-protocol/blob/93c4cc601d448ea481eb59d7b785eec75ae16ec2/src/drivers/atk/hid.ts) |
| DEV-AD58D0A5C7 | ATK Blazing Sky X1 Ultimate | 2.4G 原装接收器 | 无法判断 | X1 Ultimate 原装接收器身份/查电模式仍需用真实读数确定，不继承 X1 Pro。 [来源](https://github.com/OpenMouse-Project/mouse-protocol/blob/93c4cc601d448ea481eb59d7b785eec75ae16ec2/src/drivers/atk/hid.ts) |
| DEV-D3697D46B7 | AULA 狼蛛 V9 Ultra | 2.4G 原装接收器 | 无法判断 | V9 Ultra 没有本型号的确切原装接收器、型号/在线字节和实测电量；不能套 V9 Pro+。 [来源](https://www.aulastar.com/aula-hub/) |
| DEV-370463945C | AULA 狼蛛 X9 Ultra | 2.4G 原装接收器 | 无法判断 | 上游 X9 Ultra 可见同厂商接收器与会话命令，但 PID 可能与 V9 型号共享；还需精确身份、在线及休眠行为。 [来源](https://github.com/notjiccu/wireless-device-battery-monitor) |
| DEV-82EBFBD097 | CHERRY XTRFY 无线鼠标（046A:0330，具体 SKU 待核） | 2.4G 1K 接收器 | 无法判断 | XTRFY 接收器 PID 046A:0330 尚不能辨认配对 SKU；不把接收器名当鼠标身份。 [来源](https://github.com/notjiccu/wireless-device-battery-monitor#supported-devices) |
| DEV-BB1F0A59F1 | Dell MS5320W | 蓝牙 | 开发完（仅通用） | 系统电量 → 标准 BLE Battery Service（若可枚举）；没有可用值就显示无数据。未证明该型号一定上报电量。 [来源](https://learn.microsoft.com/en-us/windows-hardware/design/accessory-guidelines/bluetooth-accessory-guidelines/bluetooth-accessory-guidelines-battery-profiles-services) |
| DEV-F78BED7B24 | Keychron M3（4K） | 2.4G 原装接收器 | 无法判断 | M3 4K 缺确切硬件证据，M5 Ultra-Link 的型号或连接协商不能继承。 [来源](https://www.keychron.com/pages/keychron-wireless-bluetooth-and-wired-mice) |
| DEV-CB8E594C0D | Keychron M6（4K） | 2.4G 原装接收器 | 无法判断 | M6 4K 不等于上游已有协议线索的 M6 8K / D028 组合，需独立 PID 和回复证据。 [来源](https://github.com/csutcliff/keychron-battery-dkms/blob/d88195ecad7769fb81b3294905c44bcacbbf8739/keychron_battery.c) |
| DEV-8CF3074CE1 | MCHOSE 迈从 M7 | 2.4G 原装接收器 | 无法判断 | M7 缺 SKU 级原装接收器/协议，不能沿用 G 系或 A7 的读数。 [来源](https://www.mchose.store/pages/user-manual) |
| DEV-AE2594AC4B | VGN Dragonfly F1 Pro | 2.4G 原装接收器 | 无法判断 | Dragonfly F1 Pro 零售版及接收器变体需要确切身份，不继承 F1 同族或 Dragonfly3。 [来源](https://github.com/HeyOkay/HaloBattery/blob/main/docs/protocols.md) |
| DEV-D39637038F | VXE R1 SE | 2.4G 原装接收器 | 无法判断 | R1 SE 不是上游已确认的 R1 SE+ 或这次接入的 R1 Pro Max；待证精确 CID/MID、无线端点和真实读数。 [来源](https://github.com/OpenMouse-Project/mouse-protocol/blob/93c4cc601d448ea481eb59d7b785eec75ae16ec2/src/drivers/atk/hid.ts) |
| DEV-A7CEEAF633 | 京东京造 K3 Pro Max（公开页 K3ProMax） | 蓝牙 | 开发完（仅通用） | 系统电量 → 标准 BLE Battery Service（若可枚举）；没有可用值就显示无数据。未证明该型号一定上报电量。 [来源](https://learn.microsoft.com/en-us/windows-hardware/design/accessory-guidelines/bluetooth-accessory-guidelines/bluetooth-accessory-guidelines-battery-profiles-services) |
| DEV-EE8F9A33F1 | AJAZZ 黑爵 AK820 Max | 蓝牙 | 开发完（仅通用） | 系统电量 → 标准 BLE Battery Service（若可枚举）；没有可用值就显示无数据。未证明该型号一定上报电量。 [来源](https://learn.microsoft.com/en-us/windows-hardware/design/accessory-guidelines/bluetooth-accessory-guidelines/bluetooth-accessory-guidelines-battery-profiles-services) |
| DEV-93526ED495 | ATK A87 Pro | 2.4G 原装接收器 | 无法判断 | A87 Pro 原装接收器需专属协议证据，不继承 V75X。 [来源](https://www.atkgear.com.cn/keyboard/atk-a87) |
| DEV-3E1E6658F5 | ATK Z87 | 2.4G 原装接收器 | 无法判断 | Z87 无线规格不代表电量端点开放，需实际 PID/描述符和回包。 [来源](https://www.atk.store/collections/keyboards) |
| DEV-3188371D2E | CHERRY KW 9200 MINI | 蓝牙 | 开发完（仅通用） | 系统电量 → 标准 BLE Battery Service（若可枚举）；没有可用值就显示无数据。未证明该型号一定上报电量。 [来源](https://learn.microsoft.com/en-us/windows-hardware/design/accessory-guidelines/bluetooth-accessory-guidelines/bluetooth-accessory-guidelines-battery-profiles-services) |
| DEV-F177936331 | 8BitDo Pro 2 (2DC8:6006) | 蓝牙 DInput | 开发完 | Pro 2 蓝牙 DInput 2DC8:6006，只被动读取其他程序已经开启的 0x01 增强帧；普通补零值不报 0%，不发切换命令。待余电真机。 [来源](https://github.com/HeyOkay/HaloBattery/blob/15a73ac4d88435a771b0060b28171733a43dab06/providers/eightbitdo.py) |
| DEV-722855D1D1 | 8BitDo Pro 3 (2DC8:6009) | USB DInput | 开发完 | Pro 3 USB DInput 原生 2DC8:6009，按物理 USB 父节点和唯一手柄集合读取既有 0x04，未探测或切换输入模式；上游实证为同型号蓝牙，USB 据描述符，待余电真机。 [来源](https://github.com/HeyOkay/HaloBattery/blob/15a73ac4d88435a771b0060b28171733a43dab06/providers/eightbitdo.py) |
| DEV-93B367766F | 8BitDo SF30 Pro (2DC8:6000) | 蓝牙 DInput | 开发完 | SF30 Pro 原生蓝牙 DInput 仅 2DC8:6000 且已有 0x01 增强帧；普通补零值不报 0%，不改模式。待余电真机。 [来源](https://github.com/HeyOkay/HaloBattery/blob/15a73ac4d88435a771b0060b28171733a43dab06/providers/eightbitdo.py) |
| DEV-D46A7E1207 | 8BitDo SN30 Pro (2DC8:6001) | 蓝牙 DInput | 开发完 | SN30 Pro 原生蓝牙 DInput 仅 2DC8:6001 且已有 0x01 增强帧；普通补零值不报 0%，不改模式。待余电真机。 [来源](https://github.com/HeyOkay/HaloBattery/blob/15a73ac4d88435a771b0060b28171733a43dab06/providers/eightbitdo.py) |
| DEV-A1C0881171 | 8BitDo Ultimate 2 Wireless (2DC8:310B / 6012) | 蓝牙 DInput 6012 | 无法判断 | Ultimate 2 蓝牙 6012 的输入格式不是 Pro 2/3；没有可核对的 Windows 主机无切换电量取样，不继承增强帧。 [来源](https://github.com/ascendedent/8bitdo-Linux-Software/blob/main/README.md) |
| DEV-74F8CB2168 | 8BitDo Ultimate 2 Wireless (2DC8:310B / 6012) | USB DInput 6012 | 无法判断 | Ultimate 2 USB 6012 的主机电源、充电和固件回包未经独立验证，不能把 Pro 系列被动字段复用。 [来源](https://github.com/ascendedent/8bitdo-Linux-Software/blob/main/README.md) |
| DEV-D080245337 | BEITONG 北通 宙斯 2 | 2.4GHz 原装接收器 | 无法判断 | 没有此版本已验证的接收器 PID、状态回包及链路在线证据，不套用 KP40D。 [来源](https://github.com/HeyOkay/HaloBattery/blob/main/providers/beitong.py) |
| DEV-C4F1C5E4D2 | BEITONG 北通 KP20 (20BC:5128) | 2.4GHz 原装接收器 | 无法判断 | 5128 有上游状态线索；尚缺接收器留在主机时，手柄关闭/睡眠后仍能辨别当前值而非缓存的证据。 [来源](https://github.com/notjiccu/wireless-device-battery-monitor/blob/main/src/drivers/beitong.cpp) |
| DEV-E9CF3F606D | Flydigi Direwolf 4 | 2.4GHz 原装接收器 | 无法判断 | 现有 Windows 记录需运行飞智 SpaceStationService；未启用厂商 IPC 或默认软件依赖。 [来源](https://github.com/JKWTCN/BatteryMonitor/blob/master/README.en.md) |
| DEV-2F9B4B2407 | Flydigi Vader 4 Pro | 2.4GHz 原装接收器 | 无法判断 | 上游 Windows 实机未发现独立电量通道，只返回虚假的 100% WGI 占位；不沿用 Vader 5 Pro。 [来源](https://github.com/HeyOkay/HaloBattery/issues/191) |
| DEV-AED52E57BE | GameSir Cyclone Pro (3537:1015) | 蓝牙 LE | 开发完（仅通用） | 系统电量 → 标准 BLE Battery Service（若可枚举）；没有可用值就显示无数据。未证明该型号一定上报电量。 [来源](https://learn.microsoft.com/en-us/windows-hardware/design/accessory-guidelines/bluetooth-accessory-guidelines/bluetooth-accessory-guidelines-battery-profiles-services) |
| DEV-274806A658 | GameSir Tarantula Pro | 2.4GHz 原装接收器 | 无法判断 | Tarantula Pro 与 Super Nova 共用 VID/PID，1050 路径在协议记录中未硬件验证；现有 Super Nova 专门路径不扩宽。 [来源](https://github.com/notjiccu/wireless-device-battery-monitor/blob/main/docs/gamesir_sapjoy.md) |
| DEV-230D089BC5 | GuliKit 谷粒 Elves 2 Pro (NS59) | PC 模式蓝牙 | 无法判断 | Elves 2 Pro 的 PC 蓝牙只有官方连接资料，缺对应模式已验证的电量端点与模型身份。 [来源](https://www.gulikit.com/download/) |
| DEV-C42BCE0F59 | GuliKit 谷粒 KK3 MAX (NS39) | 2.4GHz KK3 Hyperlink 适配器 | 无法判断 | KK3 MAX 的原装 2.4G只有官方连接资料，缺对应模式已验证的电量端点与模型身份。 [来源](https://www.gulikit.com/download/) |
| DEV-3CE7E02C90 | GuliKit 谷粒 KK3 MAX (NS39) | PC 模式蓝牙 | 无法判断 | KK3 MAX 的 PC 蓝牙只有官方连接资料，缺对应模式已验证的电量端点与模型身份。 [来源](https://www.gulikit.com/download/) |
| DEV-B694B4C347 | GuliKit 谷粒 KK3 Pro | PC 模式蓝牙 | 无法判断 | KK3 Pro 的 PC 蓝牙只有官方连接资料，缺对应模式已验证的电量端点与模型身份。 [来源](https://www.gulikit.com/download/) |
| DEV-01A7672143 | Machenike 机械师 G5 Pro | 2.4GHz 接收器（SKU 待核） | 无法判断 | G5 Pro尚无原装接收器的精确 SKU、软件接口与有效电量报文，未启用。 [来源](https://global.machenike.com/products/g5pro) |
| DEV-1A5DBBFDA1 | Machenike 机械师 G5 Pro Max | 2.4GHz 接收器（SKU 待核） | 无法判断 | G5 Pro Max尚无原装接收器的精确 SKU、软件接口与有效电量报文，未启用。 [来源](https://global.machenike.com/products/g5pro_max) |
| DEV-8E2B7C4600 | Machenike 机械师 G6 Pro | 2.4GHz 接收器（SKU 待核） | 无法判断 | G6 Pro尚无原装接收器的精确 SKU、软件接口与有效电量报文，未启用。 [来源](https://global.machenike.com/collections/accessories) |
| DEV-2AF152D9EA | Nintendo Joy-Con 2 (L) | 蓝牙／主机无线 | 无法判断 | Joy-Con 2 左的蓝牙／主机无线不能套用一代 057E:2006 的状态帧；保留待证。 [来源](https://www.nintendo.com/sg/hardware/switch2/accessories/index.html) |
| DEV-A9301B1E32 | Nintendo Joy-Con 2 (R) | 蓝牙／主机无线 | 无法判断 | Joy-Con 2 右的蓝牙／主机无线不能套用一代 057E:2007 的状态帧；保留待证。 [来源](https://www.nintendo.com/sg/hardware/switch2/accessories/index.html) |
| DEV-470FD9A995 | Nintendo Nintendo Switch 2 Pro Controller | 蓝牙／主机无线 | 无法判断 | Switch 2 Pro 的蓝牙／主机无线不能套用一代原生 0x30；需要独立实拍确认。 [来源](https://www.nintendo.com/sg/hardware/switch2/accessories/index.html) |
| DEV-A056E860D7 | Valve Steam Controller (2015) | 2.4GHz 原装接收器 | 无法判断 | 2015 年版的旧接收器不是 28DE:1304／1305，不能复用新版 0x43 或活跃槽语义。 [来源](https://store.steampowered.com/app/353370/Steam_Controller/) |
| DEV-24B37CE861 | Xbox Xbox Elite Wireless Controller Series 2 (1797) | USB | 无法判断 | 有线 XInput 不是有效无线电量；此型号没有 WGI 真实剩余容量与同一物理容器的实机记录。 [来源](https://learn.microsoft.com/en-us/gaming/gdk/docs/reference/input/gameinput/interfaces/igameinputdevice/methods/igameinputdevice_getxinputdeviceindex) |
| DEV-A7C9C1619C | Xbox Xbox One S Wireless Controller (1708) | USB | 无法判断 | 有线 XInput 不是有效无线电量；此型号没有 WGI 真实剩余容量与同一物理容器的实机记录。 [来源](https://learn.microsoft.com/en-us/gaming/gdk/docs/reference/input/gameinput/interfaces/igameinputdevice/methods/igameinputdevice_getxinputdeviceindex) |
| DEV-29874036A2 | Xbox Xbox Wireless Controller (Series X\|S / 1914) | USB | 无法判断 | 有线 XInput 不是有效无线电量；此型号没有 WGI 真实剩余容量与同一物理容器的实机记录。 [来源](https://learn.microsoft.com/en-us/gaming/gdk/docs/reference/input/gameinput/interfaces/igameinputdevice/methods/igameinputdevice_getxinputdeviceindex) |
| DEV-C8F4288225 | Apple AirPods 4（主动降噪款） | 配对蓝牙/BLE 厂商广播 | 无法判断 | 尚未核实精确 ANC 硬件变体与配对身份，不能按广播型号或距离归并。 [来源](https://github.com/JKWTCN/BatteryMonitor/blob/master/README.en.md) |
| DEV-6FEA249263 | Apple AirPods Pro 3 | 配对蓝牙 | 开发完（仅通用） | 系统电量 → 标准 BLE Battery Service（若可枚举）；没有可用值就显示无数据。未证明该型号一定上报电量。 [来源](https://learn.microsoft.com/en-us/windows-hardware/design/accessory-guidelines/bluetooth-accessory-guidelines/bluetooth-accessory-guidelines-battery-profiles-services) |
| DEV-12B979296A | HONOR Earbuds 3 Pro | 配对蓝牙 | 开发完（仅通用） | 系统电量 → 标准 BLE Battery Service（若可枚举）；没有可用值就显示无数据。未证明该型号一定上报电量。 [来源](https://learn.microsoft.com/en-us/windows-hardware/design/accessory-guidelines/bluetooth-accessory-guidelines/bluetooth-accessory-guidelines-battery-profiles-services) |
| DEV-0FC9B4C129 | JBL Tune Beam 2 | 配对蓝牙 | 开发完（仅通用） | 系统电量 → 标准 BLE Battery Service（若可枚举）；没有可用值就显示无数据。未证明该型号一定上报电量。 [来源](https://learn.microsoft.com/en-us/windows-hardware/design/accessory-guidelines/bluetooth-accessory-guidelines/bluetooth-accessory-guidelines-battery-profiles-services) |
| DEV-F808567FB2 | Sony WF-1000XM5 | 配对后经典蓝牙 | 无法判断 | 确认 MDR2 服务不等于读到这款 TWS 的可用电量；缺同型号实机电量帧。 [来源](https://github.com/marconvcm/sony-device-center/blob/main/README.md) |
| DEV-005545D6DF | vivo TWS Air2 | 配对蓝牙 | 开发完（仅通用） | 系统电量 → 标准 BLE Battery Service（若可枚举）；没有可用值就显示无数据。未证明该型号一定上报电量。 [来源](https://learn.microsoft.com/en-us/windows-hardware/design/accessory-guidelines/bluetooth-accessory-guidelines/bluetooth-accessory-guidelines-battery-profiles-services) |
| DEV-812B4B8D01 | 通用 3.5 mm 被动模拟耳机 | 3.5 mm 模拟线 | 无法判断 | 模拟音频无数字电量通道。无电量读数；如仅有声卡的端点名也不能确认耳机品牌。 |
| DEV-8CBDC2FD00 | HyperX Cloud Alpha S | 3.5 mm 模拟线 | 无法判断 | 模拟音频无数字电量通道。上游该型号没有电量列；模拟连接不提供数字电量。 [来源](https://github.com/Sapd/HeadsetControl) |
| DEV-59C8E929E8 | Sony WH-1000XM4 | 3.5 mm 模拟线 | 无法判断 | 模拟音频无数字电量通道。有电池但模拟音频线路无法读取剩余量，不等于蓝牙路径。 |
| DEV-046D4D4051V2 | Logitech M510 v2（WPID 4051） | 2.4G Unifying | 开发完 | 以实际 0x0003 型号 4051、设备名和槽位 Unit ID 匹配，读取 0x1000；不沿用 4008，也不外推 v1。 [来源](https://github.com/pwr-Solaar/Solaar/issues/3156) |
