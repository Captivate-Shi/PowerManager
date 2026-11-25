# 剩余 P0：真机取证清单

第 14 批复核了余下的 18 条「型号 × 连接」。本批只增加诊断和人工验证入口，不打开新的默认电量轮询。真实电量、休眠和断连未通过验证的条目仍是待接入。

| 型号与范围 | 条数 | 目前缺什么／下一条可用证据 |
| --- | ---: | --- |
| 罗技 M510，表中 WPID 4008 | 1 | **先核对型号。** [Solaar 设备表](https://pwr-solaar.github.io/Solaar/devices/)记录 M510 的不同版本为 1025、4051；[配对实录](https://github.com/pwr-Solaar/Solaar/issues/524)也显示 4008 可是 M185。需实物底标型号与 Unifying 配对的 WPID，不能把其他鼠标读数贴给 M510。 |
| 罗技 Signature K650，零售 Bolt | 1 | 在同一个零售版 B36F 活跃槽位上确认实时设备名、Unit ID 和 1004/1000 能力与结果。企业版 B370 不替代。 [型号库](https://openlogi.org/hidpp/model-ids) |
| 罗技 G915 / G915 TKL，LIGHTSPEED | 2 | 仅证实 1001 电压。每款用对应实物，在不充电的高、中、低状态对比 G HUB 与电压；独立记录接线和低电误差。一个 TKL 样本插拔后测得 68 mV 变化，不足以校准，不以充电时电压触发低电通知。 [TKL 复测](https://github.com/rodolfocamara/battery-widget/blob/main/docs/linux.md#keyboard-battery-why-the-number-is-an-estimate) |
| 雷蛇 BlackWidow V3 Mini、BlackWidow V4 TKL、DeathStalker V2 Pro 全尺寸，原装接收器 | 3 | 诊断仅标记匹配 0271/MI03、02D5/MI02 或 0290/MI02 且符合描述符的候选集合，不发 Feature 查询。需各自 Windows 读取与关机或休眠样本，检查 Synapse 并行；不以已接入的 DeathStalker TKL 替代。 [上游边界](https://github.com/HeyOkay/HaloBattery/blob/main/docs/protocols.md#razer-deathstalker-v2-pro-blackwidow-v3-mini-v4-mini-and-v4-tenkeyless-hyperspeed) |
| 黑爵 MK87PRO，原装接收器 | 1 | 同一接收器插着，分别记录键盘在线、关机、唤醒。确认关机后不会把上一条电量当实时；工作模式不等于无线在线。现有候选仅进诊断。 |
| 迈从 G87，原装接收器 | 1 | 诊断仅标记匹配 HID 集合的候选。公开实测曾在休眠时长期保有旧电量，需要独立在线证明和与 M HUB 并用验证。 [实机记录](https://github.com/evren-oct/vigil-watt/blob/main/docs/hardware/brands/mchose.md) |
| ATK V75X，原装接收器 | 1 | 已证明在线可读，尚未排除缓存回包和轮询唤醒。按[验收方案](atk-v75x-receiver-hardware-gate.md)做，不监听按键，不用有线结果代替。 |
| 雷柏反馈键盘，蓝牙与原装接收器 | 2 | 先拿底标型号。蓝牙时拔原装接收器，接收器时断开该设备蓝牙，各导出一份诊断；先查系统电量和 BLE Battery Service，不按通用 USB 名称发厂商命令。 |
| Xbox Series 1914、One S 1708、Elite 2 1797，蓝牙与 Xbox 无线适配器 | 6 | 先验证 Series 两种连接；两台同款分别配不同电量，并测断线换槽。再用另外两款各自验证。不把 XInput 槽位当设备 ID、不将档位换算成百分比。见 [Xbox 验证](xbox-battery-validation.md)。 |

## 给内测的最小信息

在「设置 → 诊断」选择具体设备，生成兼容报告并先预览，再自行保存。只需要型号、连接方式、固件版本（能看到时）、接收器是否仍插着和复现结果。选不到设备时才填型号；不上传按键内容、序列号、MAC、完整设备路径或厂商账号信息。

同型号实测通过前不勾支持；代码、上游报文、Windows CI 和余电真机验收是不同状态。
