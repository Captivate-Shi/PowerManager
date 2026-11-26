# 余电 PowerManager

余电是 Windows 11 x64 的外设电量监测工具。它在系统托盘后台运行，手柄、鼠标、键盘或无线耳机快没电时会提醒你。

[下载最新版](https://github.com/Captivate-Shi/PowerManager/releases/latest)

从 Electron 或早期 WebView2 测试版升级时，先在 Windows 设置中卸载旧版，再运行安装包。卸载时保留数据。

## 功能

- **电量总览**：在展台或列表中查看电量、连接状态和上次读数。设备连接后可在「设备 → 查找设备」查看。
- **托盘快览**：单击托盘图标看电量，双击打开主窗口。
- **低电量提醒**：可按设备设置阈值，也可设为全屏时只播放提示音。
- **电量记录**：对比最多 3 台设备的电量变化，支持 24 小时、7 天、30 天和 365 天。记录保存在本机，保留天数可在设置里调整。

## 截图

![Windows 实机总览](docs/screenshots/windows-overview.webp)

![三台设备的电量对比，模拟数据](docs/screenshots/history-mock.webp)

![托盘快览，模拟数据](docs/screenshots/quick-panel-mock.webp)

## 性能

0.2.0 使用系统 WebView2。安装包约 7 MB，首次安装时如缺少运行库需联网补装。下表为旧 Electron 版的实测，供对照。

| Windows 11 实测（1.6.1） | 平均 CPU | 平均工作集 | 平均私有内存 |
| --- | ---: | ---: | ---: |
| 主窗口打开，静置 | 0.0185% | 389.2 MiB | 351.9 MiB |
| 主窗口释放，仅后台监测 | 0.0062% | 293.4 MiB | 282.3 MiB |

[测试条件](qa/README.md)

## 设备反馈

找不到设备、电量读不到或读数不对时：

1. 打开「设置 → 诊断 → 生成兼容性报告」，选择有问题的设备。列表里没有设备时，可手动填写型号。
2. 点击「预览兼容性报告」，确认后「保存到本地」。
3. 把报告附到 [GitHub Issues](https://github.com/Captivate-Shi/PowerManager/issues)，写一下连接方式和遇到的问题。

报告不会自动发送。
