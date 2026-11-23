# 外设电量管理器 · Electron

面向 Windows 11 x64 的外设电量监测器。双击便携目录里的 `PowerManager-H5.exe` 打开总览。主窗口关闭后仍在托盘监测，从托盘右键菜单退出应用。

## 使用

- 自动读取兼容的 Razer 接收器和 DualSense。其它设备先在 Windows 中完成配对或连接，再在「设备 → 查找设备」选择支持读取电量的条目。
- 从设备页单击卡片可预览，双击卡片或按 Enter 打开独立详情页。详情提供读数来源、近 24 小时历史和单设备提醒设置。DualSense 的 HID 档位会标出估算值与原始区间。只有确定达到阈值的档位才触发提醒。
- 安装后的本地数据默认位于 `%LOCALAPPDATA%\PowerManager-H5`。旧版的数据保留在原位置。若旧版在监测，退出旧版托盘后 Electron 版会自动恢复采集。
- 「提醒」包含低电量与紧急预览。实际提醒结合 Windows 会话、前台应用和勿扰设置。点击「查看详情」可打开设备详情。点击通知正文或右上角关闭按钮可收起通知。
- DualSense 增强读取仅适用于本次蓝牙连接，在对应设备详情下确认。某些 DirectInput 程序可能受到影响，手柄关机重连可恢复。设置中的电压实验将结果记录在 `dualsense-voltage.tsv`。

## 界面与托盘

- 主窗口和托盘默认 100% 缩放，可在「设置 → 显示大小」分别用滑块或百分比输入调整。
- 托盘图标单击显示面板，双击打开主窗口。面板置顶后可拖动标题栏、拉动窗口边缘调整大小。
- 可在「提醒 → 桌面通知」和托盘右键菜单预览右下角弹窗。关闭自定义弹窗后，普通桌面提醒由 Windows 投递。
- 在线设备环图和历史走势使用 Recharts。ECharts 提供更多渲染器和交互类型，本应用只需要两种图表，采用 Recharts 的 React 组件直接共享主题、键盘提示和响应式布局。历史图仍保留断连缺口。[Recharts](https://recharts.github.io/en-US/api/AreaChart/) · [Apache ECharts](https://echarts.apache.org/en/feature.html)

## 从源码运行和打包

依赖 Node.js 24、pnpm 11.25.0 和支持 C++20 的 x64 MinGW-w64。可使用便携版 [w64devkit](https://github.com/skeeto/w64devkit/releases)。Windows 采集源码和测试均包含在本目录内。首次构建会下载并校验固定版本的 JSON 单头文件。

```powershell
$env:POWER_MANAGER_TOOLCHAIN_BIN = 'C:\tools\w64devkit\bin'
pnpm install --frozen-lockfile
pnpm run dev
pnpm run demo
pnpm run check
pnpm run package
```

`out\1.4.2\PowerManager-H5-win32-x64` 是完整便携目录。解压 ZIP 后，保留目录内所有文件并运行其中的 EXE。登录启动采用 Windows 当前用户的启动项，便携目录移动后请重新设置启动项。

示例模式使用独立的会话目录、固定样例读数和临时设置，可在开发版或打包版传入 `--demo`。可追加 `--preview=tray`、`--preview=low` 或 `--preview=critical` 单独查看相应窗口。

## 提醒优先级与外设支持

普通低电量线默认跟随全局，设备可设置自己的数值并随时恢复全局。紧急线对全部设备优先。自定义值低于或等于紧急线时，该设备达到紧急线后直接显示紧急级别。设备静音只影响该设备，托盘全局静音暂停所有通知。多个通知同时等待时，紧急通知先显示。

[支持范围、读数精度和开源方案调研](COMPATIBILITY.md)

## 兼容性反馈

在「设置」填写可选说明，再点击「生成兼容性报告」。报告写到诊断目录的 `compatibility-report.json`，重复导出会更新这一份报告。适合填写设备完整型号、硬件版本、固件版本、当前连接方式、设备是否唤醒、厂商工具显示的百分比和故障现象。

报告包含 HID 的 VID/PID、接口号、用途页、输入/输出/Feature 报文长度、设备描述符修订号，以及最近的有限次采样、读数范围、报告类型和错误码。罗技还记录槽位是否取得实体标识。报告保存在本机，不自动发送。应用生成的结构化字段不包含 HID 路径、序列号、MAC、原始输入报文或设备别名。请自行检查填写的说明再分享。

采集进程不可用时报告退回到只读 Windows 枚举。便携版也可以仅运行枚举，用来识别暂未适配的外设以及区分同名不同硬件版本。

```powershell
.\resources\collector.exe --inventory
```

## 性能日志

正常运行时每分钟采样一次，保存在诊断目录的 `metrics.jsonl`。文件约 2 MiB 时轮转，保留一份上一代日志。记录各 Electron 进程的 CPU 与内存、主进程的 JS 堆和事件循环活跃率、采集进程的 CPU、内存及句柄数，以及采集次数、失败次数、排队和写盘耗时。采集进程繁忙时跳过当次原生指标。日志只保存在本机。

```powershell
pnpm run metrics
pnpm run soak 300
```

`metrics` 默认汇总当前用户的最近一次会话，也可传入其他日志路径。CPU 按整机逻辑核归一化。内存和句柄趋势比较热身后的首末样本中位数。可用 `pnpm run soak 3600` 延长实机后台验证。验收日志位于 `qa/performance`。

## 验收入口

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-native.ps1 -Test
node scripts/verify.cjs --packaged
node scripts/verify.cjs --synthetic
node scripts/verify.cjs --packaged --real
```

如果打包环境已缓存 Electron 发行 ZIP，可将 `POWER_MANAGER_ELECTRON_ZIP_DIR` 指向该 ZIP 所在目录。

Electron 验收脚本在 `qa` 下保存截图，实机命令额外保存当前设备的读取状态和运行结果。测试使用独立的本地目录，保持正常运行配置。
