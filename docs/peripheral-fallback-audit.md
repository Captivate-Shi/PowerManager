# PR #8 电量兜底审计

基线：[设备研发台账](https://github.com/Captivate-Shi/PowerManager/blob/f3cc5d9a976bd38829cda99f8a0bb96ea3c950c6/docs/device-compatibility-ledger.md)，提交 `f3cc5d9a976bd38829cda99f8a0bb96ea3c950c6`。共 **246** 条型号 × 连接，已开发 **124**（其中 **33** 条只有系统/标准蓝牙路径），未判定 **122**。其中 **119** 条还可能需要证据或开发，**3** 条模拟音频没有数字电量通道，应排除。条目不是独立型号数、真实覆盖率或真机验收数。

每条只取**一个主阻塞**；其他缺项仍保留在原台账。归类不修改 PR 代码、当前台账状态或探测范围。

| 主阻塞 | 条数 |
|---|---:|
| 排除：模拟接口没有数字电量通道 | 3 |
| 纠错：型号/PID 矛盾或反馈缺少准确型号 | 4 |
| 身份：活跃设备与反馈值不能唯一绑定 | 35 |
| 新鲜度与共存：有电量候选但关机、休眠或会话未验证 | 20 |
| 语义：仅电压、原生档位或占位值，不能当百分比 | 7 |
| 依赖：只有厂商服务路径，未证实独立读取 | 1 |
| 协议证据：缺精确链路/集合/样本或上游证据冲突 | 52 |
| **合计** | **122** |

## 已有路径能否复用？

| 复用候选 | 条数 | 含义 |
|---|---:|---|
| 同族协议候选 | 26 | 能作为优先验证对象；不能直接扩大 VID/PID、型号、集合或状态门禁 |
| 只复用基础设施 | 38 | 可借 Windows 同身份兜底、采样测试、HID I/O、配对 RFCOMM 等；尚不能继承型号协议或读取结果 |
| 未证有可复用私有路径 | 55 | 不代表没有电量，也不排除该设备已通过系统返回有真实值 |
| 模拟线、不适用 | 3 | 不许以其他连接状态代替本次连接读值 |

**现行兜底**：`native/collector.cpp` 从同设备容器读取 Windows 电量属性或标准 BAS，`batteryFallback` 不把缺失、失联当成有效值。对所有尚未判定的数字连接，这只在系统为**该连接的同一设备**提供有效读数时成立，不为整款型号或品牌兜底打勾。经典蓝牙没有 BAS 不等于没有专有通道；XInput 槽号、广播距离／RSSI、共用接收器、USB 充电时的“100%”不是型号或新鲜度证据。

## 键鼠优先验证的现成族

| 现成路径 | 可优先验证（对应下方编号） | 通过条件 |
|---|---|---|
| Logitech HID++ 2.0 Unifying／LIGHTSPEED | 1、4、5 | 4008 原行应纠错，4051 的 M510 v2 不填回 4008。G915 两版保留原生 1001 电压证据；要做区间须独立跨放电与插拔校准，不能套鼠标曲线。 |
| ROG OMNI 配对后读数 | 15–17、29 | 现成配对表/电量端口帮助缩小范围，但仅 Falchion 具备当前门禁；补该型号的在线硬件 ID 与同槽实报，含换设备/断开复核。 |
| HyperX Haste 2 专用读取 | 22、23 | Core 0AB5 补 Windows 集合；Mini 应纠正 0F98 到待核 0DA0。两者各需自己的在线/断电/唤醒数据，不能仅改 PID。 |
| Keychron M5 数据协议 | 24 | 已有 D048 借鉴的电量 codec，不借用有线的身份逻辑。D028 查 B5/03 活跃配对身份，核验 Windows 同次读数前后以及 M5/M6 换槽。 |
| VXE/ATK CompX | 84–86、93、94 | 复用已校验的事务框架作为候选；每个 SKU 验证精确接口、CID/MID、无线链路与回包，不把 R1 SE+ 等同 R1 SE。 |
| Rapoo 专用被动状态、SteelSeries 鼠标和 VGN 各代 | 25–27、45–47 | 只把同协议当核验对象；Rapoo VT9 PRO 要实证自己的被动帧，Rival 3 要先解决两份报告冲突；VGN 不从一个 391D 或 V98 模型推全族。 |
| AULA | 87、88 | 只有 V9 Pro+、SC580 等各自通过的专用路径；先分离 V9/X9 SKU、唯一在线身份和真实回包。 |

明确**不继承**：ATK V75X USB→5088 无线（无线唤醒/输入活动及新鲜度分别验证）；AJAZZ MK87PRO 不把工作模式位当在线位；MCHOSE G87 的旧值与 M HUB 冲突不可默默吞掉；普通键盘/鼠标输入接口不作为采样源。对已有主动协议也不得为了适配而扩大查询到未知接口；不在后台读取全局输入，不发送改变设备配置的命令。

## 逐行覆盖

按固定提交中 `无法判断` 行原顺序编号；“台账行”是原 Markdown 的行号，稳定追踪请使用 DEV ID。每行的具体证据/缺项保留在台账相应行。

| 编号 | 台账行 | DEV ID | 型号／连接 | 主阻塞 | 复用 |
|---:|---:|---|---|---|---|
| 1 | 11 | DEV-1CAFA27898 | Logitech M510（WPID 4008）／2.4G Unifying | 纠错 | 同族候选 |
| 2 | 41 | DEV-162BBC834F | AJAZZ 黑爵 MK87PRO（0C45:FEFC）／2.4G 原装接收器 | 新鲜度与共存 | 未证 |
| 3 | 45 | DEV-8BBAB2F8E9 | ATK V75X（320F:5088）／2.4G 原装接收器 | 新鲜度与共存 | 未证 |
| 4 | 54 | DEV-E1415436E4 | Logitech G G915 LIGHTSPEED／2.4G LIGHTSPEED | 语义 | 同族候选 |
| 5 | 55 | DEV-F61B7F554D | Logitech G G915 TKL LIGHTSPEED／2.4G LIGHTSPEED | 语义 | 同族候选 |
| 6 | 56 | DEV-E731C6987B | MCHOSE 迈从 G87（41E4:2001 候选）／2.4G 原装接收器 | 新鲜度与共存 | 未证 |
| 7 | 57 | DEV-2040D76407 | Rapoo 雷柏 反馈键盘（型号待确认）／2.4G 原装接收器 | 纠错 | 未证 |
| 8 | 58 | DEV-4B0FE97EAA | Rapoo 雷柏 反馈键盘（型号待确认）／蓝牙 | 纠错 | 未证 |
| 9 | 75 | DEV-665258E17E | Xbox Xbox Elite Wireless Controller Series 2 (1797)／蓝牙 | 身份 | 仅基础设施 |
| 10 | 76 | DEV-5A09018DF3 | Xbox Xbox Elite Wireless Controller Series 2 (1797)／Xbox 无线适配器 | 身份 | 仅基础设施 |
| 11 | 77 | DEV-B31D37B53E | Xbox Xbox One S Wireless Controller (1708)／蓝牙 | 身份 | 仅基础设施 |
| 12 | 78 | DEV-664565011A | Xbox Xbox One S Wireless Controller (1708)／Xbox 无线适配器 | 身份 | 仅基础设施 |
| 13 | 79 | DEV-2C292D5E66 | Xbox Xbox Wireless Controller (Series X\|S / 1914)／蓝牙 | 身份 | 仅基础设施 |
| 14 | 80 | DEV-728CC898D7 | Xbox Xbox Wireless Controller (Series X\|S / 1914)／Xbox 无线适配器 | 身份 | 仅基础设施 |
| 15 | 85 | DEV-C5DE96A056 | ASUS ROG ROG Gladius III Wireless AimPoint／2.4G OMNI | 身份 | 同族候选 |
| 16 | 86 | DEV-869A8AD6F9 | ASUS ROG ROG Harpe Ace Aim Lab Edition／2.4G OMNI | 身份 | 同族候选 |
| 17 | 87 | DEV-9D38CCDA66 | ASUS ROG ROG Keris II Ace／2.4G OMNI | 身份 | 同族候选 |
| 18 | 88 | DEV-F0E8581E2B | CORSAIR DARK CORE RGB PRO SE／2.4G SLIPSTREAM | 协议证据 | 未证 |
| 19 | 89 | DEV-3C76A887C3 | CORSAIR HARPOON RGB WIRELESS／2.4G SLIPSTREAM | 协议证据 | 未证 |
| 20 | 90 | DEV-67229D7389 | CORSAIR SABRE RGB PRO WIRELESS／2.4G SLIPSTREAM | 协议证据 | 未证 |
| 21 | 91 | DEV-4E91A2FCD4 | DAREU 达尔优 EM901X（260D:1074）／2.4G 原装接收器 | 新鲜度与共存 | 未证 |
| 22 | 95 | DEV-2E1FD43A45 | HyperX Pulsefire Haste 2 Core Wireless／2.4G 原装接收器 | 协议证据 | 同族候选 |
| 23 | 96 | DEV-98944A6D2B | HyperX Pulsefire Haste 2 Mini Wireless（03F0:0F98）／2.4G 原装接收器 | 纠错 | 同族候选 |
| 24 | 98 | DEV-E0CAE11F77 | Keychron M5 Ultra-Link 8K（3434:D028）／2.4G 8K 接收器 | 身份 | 同族候选 |
| 25 | 103 | DEV-1F194FA97A | Rapoo 雷柏 VT9 PRO（24AE:1601）／2.4G 原装接收器 | 协议证据 | 同族候选 |
| 26 | 104 | DEV-F41994234C | SteelSeries Rival 3 Wireless（1038:1830）／2.4G 原装接收器 | 协议证据 | 同族候选 |
| 27 | 105 | DEV-10716040FA | VGN Dragonfly3 SE（391D:1A01）／2.4G 原装接收器 | 新鲜度与共存 | 同族候选 |
| 28 | 108 | DEV-FBA50C34AE | AJAZZ 黑爵 AK820 Pro／2.4G 原装接收器 | 协议证据 | 未证 |
| 29 | 110 | DEV-0DE76F1E4D | ASUS ROG ROG Strix Scope II 96 Wireless／2.4G OMNI | 身份 | 同族候选 |
| 30 | 111 | DEV-4FC755DA62 | AULA 狼蛛 F75／2.4G 原装接收器 | 协议证据 | 未证 |
| 31 | 112 | DEV-4C8E2760DB | AULA 狼蛛 F99／2.4G 原装接收器 | 协议证据 | 未证 |
| 32 | 113 | DEV-7B0037C5B5 | CHERRY MX 3.0S Wireless（046A:00EA）／2.4G 原装接收器 | 协议证据 | 未证 |
| 33 | 115 | DEV-D534905A02 | CORSAIR K100 AIR WIRELESS／2.4G SLIPSTREAM | 协议证据 | 未证 |
| 34 | 116 | DEV-30A08DE4A5 | CORSAIR K65 PLUS WIRELESS／2.4G SLIPSTREAM | 协议证据 | 未证 |
| 35 | 117 | DEV-8EC41752AB | CORSAIR K70 CORE TKL WIRELESS／2.4G SLIPSTREAM | 协议证据 | 未证 |
| 36 | 124 | DEV-F93F7822F2 | Lofree 洛斐 Flow Lite84（05AC:024F）／2.4G 原装接收器 | 身份 | 未证 |
| 37 | 125 | DEV-8F392A3673 | Lofree 洛斐 Hyzen（388D:0025）／2.4G 原装接收器 | 新鲜度与共存 | 未证 |
| 38 | 126 | DEV-7C81C8CAF6 | MCHOSE 迈从 G98 Pro／2.4G 原装接收器 | 协议证据 | 未证 |
| 39 | 127 | DEV-F8D91E591A | MCHOSE 迈从 GX87／2.4G 原装接收器 | 协议证据 | 未证 |
| 40 | 128 | DEV-D84BBCD475 | MCHOSE 迈从 K99 V3／2.4G 原装接收器 | 协议证据 | 未证 |
| 41 | 130 | DEV-CFF26C933B | Rapoo 雷柏 E9500G／2.4G 原装接收器 | 协议证据 | 未证 |
| 42 | 131 | DEV-78FDC7B921 | Rapoo 雷柏 V700DIY-75／2.4G 原装接收器 | 协议证据 | 未证 |
| 43 | 132 | DEV-FD98ABC3C7 | Rapoo 雷柏 V700DIY-87／2.4G 原装接收器 | 协议证据 | 未证 |
| 44 | 133 | DEV-C22DE2D3D2 | Rapoo 雷柏 V700DIY-98／2.4G 原装接收器 | 协议证据 | 未证 |
| 45 | 135 | DEV-336A593A62 | VGN N75 V2（391D:2A01）／2.4G 原装接收器 | 协议证据 | 同族候选 |
| 46 | 136 | DEV-22E3F41BF1 | VGN V108（391D:2A02）／2.4G 原装接收器 | 协议证据 | 同族候选 |
| 47 | 137 | DEV-E8FEFF2788 | VGN V87 V2（258A:027B）／2.4G 原装接收器 | 协议证据 | 同族候选 |
| 48 | 140 | DEV-3CB8990021 | 8BitDo Ultimate 2 Wireless (2DC8:310B / 6012)／2.4GHz 310B XInput | 身份 | 仅基础设施 |
| 49 | 141 | DEV-25FCD3DE08 | BEITONG 北通 KP40D (20BC:515C)／2.4GHz 原装接收器 | 新鲜度与共存 | 未证 |
| 50 | 146 | DEV-45A28E6FBA | GameSir Cyclone 2／2.4GHz 原装接收器 | 新鲜度与共存 | 未证 |
| 51 | 147 | DEV-86252B81A8 | GameSir G7 Pro Zenless Zone Zero Edition (3537:105E)／2.4GHz 原装接收器 | 身份 | 仅基础设施 |
| 52 | 148 | DEV-EB58C32925 | GameSir Nova Lite／2.4GHz 原装接收器 | 身份 | 未证 |
| 53 | 149 | DEV-ACAF7A0E18 | GameSir Nova Lite 2／2.4GHz 原装接收器 | 身份 | 未证 |
| 54 | 153 | DEV-E00EB0E606 | Valve Steam Controller（新版，28DE:1304／1305）／2.4GHz 原装 puck | 新鲜度与共存 | 未证 |
| 55 | 154 | DEV-762F845076 | Xbox Xbox One Wireless Controller (1537/1697，各自独立核验)／Xbox 无线适配器 | 身份 | 仅基础设施 |
| 56 | 155 | DEV-587DD55BC1 | Apple AirPods Pro（第 2 代）／配对蓝牙/BLE 厂商广播 | 身份 | 未证 |
| 57 | 156 | DEV-C5FBAF65BD | Apple AirPods（第 2 代）／配对蓝牙/BLE 厂商广播 | 身份 | 未证 |
| 58 | 160 | DEV-D633FC3A87 | HONOR Earbuds 2 Lite／配对后经典蓝牙 | 身份 | 仅基础设施 |
| 59 | 161 | DEV-89A102784E | HONOR Earbuds S2／配对后经典蓝牙 | 身份 | 仅基础设施 |
| 60 | 162 | DEV-7561791074 | HUAWEI FreeBuds 5i／配对后经典蓝牙 | 身份 | 仅基础设施 |
| 61 | 163 | DEV-32B5F815B7 | HUAWEI FreeBuds 6i／配对后经典蓝牙 | 身份 | 仅基础设施 |
| 62 | 164 | DEV-E7953339FD | HUAWEI FreeBuds Pro 4／配对后经典蓝牙 | 身份 | 仅基础设施 |
| 63 | 170 | DEV-59F72C55EA | Samsung Galaxy Buds FE／配对后经典蓝牙 | 新鲜度与共存 | 仅基础设施 |
| 64 | 171 | DEV-CBD94A3ACD | Samsung Galaxy Buds3／配对后经典蓝牙 | 新鲜度与共存 | 仅基础设施 |
| 65 | 172 | DEV-237E9E784A | Samsung Galaxy Buds3 Pro／配对后经典蓝牙 | 新鲜度与共存 | 仅基础设施 |
| 66 | 174 | DEV-D3671EC1DB | Sony WH-1000XM6／配对后经典蓝牙 | 协议证据 | 仅基础设施 |
| 67 | 175 | DEV-1A917A12CD | soundcore Liberty 4 NC／配对蓝牙 | 语义 | 仅基础设施 |
| 68 | 176 | DEV-FA95A9B1CE | soundcore Space One／配对蓝牙 | 语义 | 仅基础设施 |
| 69 | 177 | DEV-DCB0BD123C | soundcore Space Q45／配对蓝牙 | 语义 | 仅基础设施 |
| 70 | 180 | DEV-47297DC5DC | Xiaomi/Redmi Redmi Buds 5 Pro／配对蓝牙/BLE 厂商广播 | 身份 | 未证 |
| 71 | 183 | DEV-6CC56AEF11 | Corsair Virtuoso RGB Wireless SE／2.4 GHz USB 接收器 | 协议证据 | 仅基础设施 |
| 72 | 184 | DEV-A578B48A50 | Corsair Virtuoso RGB Wireless XT／2.4 GHz USB 接收器 | 新鲜度与共存 | 仅基础设施 |
| 73 | 185 | DEV-4705C569BB | Corsair VOID PRO RGB Wireless／2.4 GHz USB 接收器 | 协议证据 | 仅基础设施 |
| 74 | 187 | DEV-5AC8CF7205 | HyperX Cloud Flight Wireless／2.4 GHz USB 接收器 | 协议证据 | 仅基础设施 |
| 75 | 188 | DEV-7B6A039A95 | HyperX Cloud II Wireless／2.4 GHz USB 接收器 | 协议证据 | 仅基础设施 |
| 76 | 192 | DEV-B4BA1E5740 | Logitech G G533 Wireless／2.4 GHz USB 接收器 | 协议证据 | 同族候选 |
| 77 | 193 | DEV-9D27DA7B04 | Logitech G G733 LIGHTSPEED／2.4 GHz USB 接收器 | 新鲜度与共存 | 仅基础设施 |
| 78 | 194 | DEV-E77A16DDEF | Logitech G G935 Wireless／2.4 GHz USB 接收器 | 语义 | 同族候选 |
| 79 | 195 | DEV-FB4672DC47 | Razer Barracuda X（2022）／2.4 GHz USB 接收器 | 新鲜度与共存 | 仅基础设施 |
| 80 | 196 | DEV-4FC626E311 | Razer BlackShark V2 HyperSpeed／2.4 GHz USB 接收器 | 新鲜度与共存 | 仅基础设施 |
| 81 | 197 | DEV-61A8DC6E5D | Razer BlackShark V2 Pro（2023）／2.4 GHz USB 接收器 | 新鲜度与共存 | 仅基础设施 |
| 82 | 198 | DEV-FE2B2BDADF | SteelSeries Arctis Nova 5／2.4 GHz USB 接收器 | 新鲜度与共存 | 仅基础设施 |
| 83 | 200 | DEV-5AEE8193FC | SteelSeries Arctis Nova Pro Wireless／2.4 GHz USB 基站 | 新鲜度与共存 | 仅基础设施 |
| 84 | 201 | DEV-20C4CC9EEE | ATK Blazing Sky F1 Ultimate／2.4G 原装接收器 | 身份 | 同族候选 |
| 85 | 202 | DEV-0AE2D07B55 | ATK Blazing Sky X1 Pro／2.4G 原装接收器 | 身份 | 同族候选 |
| 86 | 203 | DEV-AD58D0A5C7 | ATK Blazing Sky X1 Ultimate／2.4G 原装接收器 | 身份 | 同族候选 |
| 87 | 204 | DEV-D3697D46B7 | AULA 狼蛛 V9 Ultra／2.4G 原装接收器 | 协议证据 | 同族候选 |
| 88 | 205 | DEV-370463945C | AULA 狼蛛 X9 Ultra／2.4G 原装接收器 | 身份 | 同族候选 |
| 89 | 206 | DEV-82EBFBD097 | CHERRY XTRFY 无线鼠标（046A:0330，具体 SKU 待核）／2.4G 1K 接收器 | 身份 | 未证 |
| 90 | 208 | DEV-F78BED7B24 | Keychron M3（4K）／2.4G 原装接收器 | 协议证据 | 未证 |
| 91 | 209 | DEV-CB8E594C0D | Keychron M6（4K）／2.4G 原装接收器 | 协议证据 | 未证 |
| 92 | 210 | DEV-8CF3074CE1 | MCHOSE 迈从 M7／2.4G 原装接收器 | 协议证据 | 未证 |
| 93 | 211 | DEV-AE2594AC4B | VGN Dragonfly F1 Pro／2.4G 原装接收器 | 协议证据 | 同族候选 |
| 94 | 212 | DEV-D39637038F | VXE R1 SE／2.4G 原装接收器 | 协议证据 | 同族候选 |
| 95 | 215 | DEV-93526ED495 | ATK A87 Pro／2.4G 原装接收器 | 协议证据 | 未证 |
| 96 | 216 | DEV-3E1E6658F5 | ATK Z87／2.4G 原装接收器 | 协议证据 | 未证 |
| 97 | 222 | DEV-A1C0881171 | 8BitDo Ultimate 2 Wireless (2DC8:310B / 6012)／蓝牙 DInput 6012 | 协议证据 | 仅基础设施 |
| 98 | 223 | DEV-74F8CB2168 | 8BitDo Ultimate 2 Wireless (2DC8:310B / 6012)／USB DInput 6012 | 协议证据 | 仅基础设施 |
| 99 | 224 | DEV-D080245337 | BEITONG 北通 宙斯 2／2.4GHz 原装接收器 | 协议证据 | 未证 |
| 100 | 225 | DEV-C4F1C5E4D2 | BEITONG 北通 KP20 (20BC:5128)／2.4GHz 原装接收器 | 新鲜度与共存 | 未证 |
| 101 | 226 | DEV-E9CF3F606D | Flydigi Direwolf 4／2.4GHz 原装接收器 | 依赖 | 未证 |
| 102 | 227 | DEV-2F9B4B2407 | Flydigi Vader 4 Pro／2.4GHz 原装接收器 | 语义 | 未证 |
| 103 | 229 | DEV-274806A658 | GameSir Tarantula Pro／2.4GHz 原装接收器 | 身份 | 同族候选 |
| 104 | 230 | DEV-230D089BC5 | GuliKit 谷粒 Elves 2 Pro (NS59)／PC 模式蓝牙 | 协议证据 | 未证 |
| 105 | 231 | DEV-C42BCE0F59 | GuliKit 谷粒 KK3 MAX (NS39)／2.4GHz KK3 Hyperlink 适配器 | 协议证据 | 未证 |
| 106 | 232 | DEV-3CE7E02C90 | GuliKit 谷粒 KK3 MAX (NS39)／PC 模式蓝牙 | 协议证据 | 未证 |
| 107 | 233 | DEV-B694B4C347 | GuliKit 谷粒 KK3 Pro／PC 模式蓝牙 | 协议证据 | 未证 |
| 108 | 234 | DEV-01A7672143 | Machenike 机械师 G5 Pro／2.4GHz 接收器（SKU 待核） | 协议证据 | 未证 |
| 109 | 235 | DEV-1A5DBBFDA1 | Machenike 机械师 G5 Pro Max／2.4GHz 接收器（SKU 待核） | 协议证据 | 未证 |
| 110 | 236 | DEV-8E2B7C4600 | Machenike 机械师 G6 Pro／2.4GHz 接收器（SKU 待核） | 协议证据 | 未证 |
| 111 | 237 | DEV-2AF152D9EA | Nintendo Joy-Con 2 (L)／蓝牙／主机无线 | 协议证据 | 未证 |
| 112 | 238 | DEV-A9301B1E32 | Nintendo Joy-Con 2 (R)／蓝牙／主机无线 | 协议证据 | 未证 |
| 113 | 239 | DEV-470FD9A995 | Nintendo Nintendo Switch 2 Pro Controller／蓝牙／主机无线 | 协议证据 | 未证 |
| 114 | 240 | DEV-A056E860D7 | Valve Steam Controller (2015)／2.4GHz 原装接收器 | 协议证据 | 未证 |
| 115 | 241 | DEV-24B37CE861 | Xbox Xbox Elite Wireless Controller Series 2 (1797)／USB | 身份 | 仅基础设施 |
| 116 | 242 | DEV-A7C9C1619C | Xbox Xbox One S Wireless Controller (1708)／USB | 身份 | 仅基础设施 |
| 117 | 243 | DEV-29874036A2 | Xbox Xbox Wireless Controller (Series X\|S / 1914)／USB | 身份 | 仅基础设施 |
| 118 | 244 | DEV-C8F4288225 | Apple AirPods 4（主动降噪款）／配对蓝牙/BLE 厂商广播 | 身份 | 未证 |
| 119 | 248 | DEV-F808567FB2 | Sony WF-1000XM5／配对后经典蓝牙 | 协议证据 | 仅基础设施 |
| 120 | 250 | DEV-812B4B8D01 | 通用 3.5 mm 被动模拟耳机／3.5 mm 模拟线 | 排除 | 不适用 |
| 121 | 251 | DEV-8CBDC2FD00 | HyperX Cloud Alpha S／3.5 mm 模拟线 | 排除 | 不适用 |
| 122 | 252 | DEV-59C8E929E8 | Sony WH-1000XM4／3.5 mm 模拟线 | 排除 | 不适用 |

