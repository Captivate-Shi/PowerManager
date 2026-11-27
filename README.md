# 余电 PowerManager

余电监测鼠标、键盘、手柄和耳机的剩余电量，快没电时发提醒。关闭主窗口后，仍会在 Windows 托盘里运行。

[下载最新版](https://github.com/Captivate-Shi/PowerManager/releases/latest) · [外设兼容性](#外设兼容性) · [演示视频](https://raw.githubusercontent.com/Captivate-Shi/PowerManager/main/docs/media/powermanager-demo.mp4)

![余电总览](docs/media/overview.webp)

## 下载与安装

Windows 10 / 11（x64）。发布页提供两种下载：

| 文件 | 用法 |
| --- | --- |
| `PowerManager-Setup-<版本>.exe` | 安装版。可选安装目录和桌面快捷方式；缺少 WebView2 时由安装器处理。 |
| `PowerManager-<版本>-win-x64.zip` | 免安装版。完整解压后运行 `PowerManager.exe`；电脑需已安装 WebView2。换包前先退出托盘里的旧实例。 |

从 0.2.0 或 0.2.1 升级可以覆盖安装，设置和电量记录保留。安装版与免安装版使用同一份本机数据。

## 功能

- **总览**：在展台和列表间切换，查看电量、连接、充电状态与最近更新时间。单击托盘图标打开快览，双击打开主窗口。
- **设备**：看单台外设的电量趋势，设专属低电量阈值，复制设备信息。
- **提醒**：多台告急合并为一张卡，设备开始充电就从卡片移除。告急弹窗可定时关闭或一直显示；桌面弹窗、桌面提示音和全屏提示音分别设置。
- **记录**：同时比较最多三台，区分充电、断连和无数据时段；记住上次选择和配色。
- **设置**：轮询可选 30 秒、1 分钟、5 分钟和 10 分钟，默认 1 分钟。可调整记录保留时间、主题、缩放和登录自启。

![三台设备的电量对比](docs/media/comparison.webp)

## 外设兼容性

0.2.2 的兼容清单已记录 129 项读数路径（按型号和连接方式区分）：96 项专用读取，33 项使用 Windows 或标准蓝牙电量。

| 类型 | 品牌 | 代表型号 |
| --- | --- | --- |
| 手柄 | Sony | DualSense、DualSense Edge、DualShock 4（一代／二代） |
| 手柄 | Nintendo、八位堂、盖世小鸡 | Switch Pro；8BitDo Pro 2、Pro 3、SN30 Pro；GameSir Super Nova、Nova Lite 2 |
| 鼠标 | 罗技 | G502 LIGHTSPEED、G502 X LIGHTSPEED、G502 X PLUS、G305 LIGHTSPEED、G PRO Wireless、PRO X SUPERLIGHT（一代、二代）、MX Master 2S／3S／4、MX Anywhere 3S、Lift |
| 鼠标 | 雷蛇、赛睿 | Viper V3 HyperSpeed、Viper V3 Pro、DeathAdder V3 Pro、Basilisk V3 Pro、Orochi V2；Aerox 3／5／9 Wireless |
| 鼠标 | 雷柏、迈从、狼蛛、VXE | VT0 Air MAX、VT2S Air Max、VT3 双 8K、VT3S MAX 等 VT 系列；A7 V2 Pro、G3 V2；SC580／SC580X；R1 Pro Max |
| 键盘 | 罗技、雷蛇 | MX Keys、MX Keys S、MX Keys Mini、K780、ERGO K860；BlackWidow V3 Mini HyperSpeed、BlackWidow V4 Tenkeyless HyperSpeed、BlackWidow V4 Low-profile TKL HyperSpeed、DeathStalker V2 Pro TKL |
| 键盘 | ROG、VGN、ATK、狼蛛、狼途 | Azoth、Falchion RX Low Profile；V98 Pro V3；V75X；F87 Pro V2D；T98 |
| 耳机 | Sony、OPPO、华为 | WH-1000XM3／XM4／XM5；Enco Clip2、Enco X3、Enco X4、Enco Air3 Pro；FreeClip 2 |
| 耳机 | HyperX、赛睿 | Cloud Alpha Wireless；Arctis Nova 7 |

Windows 真机读数示例：DualSense（蓝牙）、Viper V3 HyperSpeed、BlackWidow V4 Low-profile TKL HyperSpeed。具体连接方式和验证记录见[完整兼容清单](docs/device-compatibility-ledger.md)。

不在表里的设备也会尝试读取 Windows 上报的电量或标准蓝牙电量服务；识别到设备但没有有效读数时显示「无数据」。

## 性能

WebView2 版不再随应用分发浏览器运行库。关掉主窗口后会释放渲染进程，托盘和采集继续运行。

| 场景 | Windows 实测（WebView2 RC10） |
| --- | ---: |
| 主窗口空闲 | CPU 0.081% · 私有工作集 116 MiB |
| 关闭主窗口，后台监测 | CPU 约 0.003% · 私有工作集 9 MiB |
| 冷启动到主窗口显示 | 0.74–1.30 秒 |
| 单击托盘到快览显示 | 中位数 414 毫秒 |
| 切换页面 | P95 23 毫秒 |

[测试版本与测量口径](docs/webview2-performance.md)

## 设备反馈

电量读不到或读错了，在「设置 → 诊断 → 生成兼容性报告」选中设备、预览并保存，到 [GitHub Issues](https://github.com/Captivate-Shi/PowerManager/issues)附上报告和连接方式。报告不会自动发出。
