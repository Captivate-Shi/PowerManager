# 0.1.3 外设读取依据

本次新路径使用公开协议事实重新实现，不引入上游运行时或官方软件依赖。

- [VigilWatt：雷柏 A HUB 协议目录](https://github.com/evren-oct/vigil-watt/blob/c97adc389b60b0e945a62cddacbaaace39887723/docs/hardware/reference/rapoo-catalog.md)与[硬件抓包](https://github.com/evren-oct/vigil-watt/blob/c97adc389b60b0e945a62cddacbaaace39887723/docs/hardware/brands/rapoo.md)。只增加其中有明确 USB 本体/接收器 ID 配对的 `status-report7` 鼠标，不推广到不同协议的键盘、底座或有线模式。实际接收器还必须匹配唯一厂商 HID 集合，提供完整 report 07，逐帧核对帧内本体 PID、无线模式、RF 状态、已知电源标志和百分比范围。厂家目录不是逐型号真机验证，不把厂家目录覆盖数等同于余电验证数。
- [VigilWatt：狼途 T98 上游采集记录](https://github.com/evren-oct/vigil-watt/blob/c97adc389b60b0e945a62cddacbaaace39887723/docs/hardware/devices/langtu.md)。仅试已知 MI_00 厂商接口的 65 字节状态帧，丢弃未知百分比；电量作为设备估算显示，不把固定字节解释为充电状态。VID/PID 有泛用名，保留通用接收器名称。
- [controller-battery：八位堂 Ultimate 2 实测](https://github.com/xuvoxuvo/controller-battery/blob/dcdb6cd9467a626d713af082eb3907b72e93cb3a/docs/protocol.md#5-8bitdo-ultimate-2-wireless)与 [Keymasq 接口观察](https://keymasq.tools/docs/master/input-driver-design/#discovery-and-association)。仅将 `2DC8:6012` 的 Gamepad 34 字节接收器接口作为诊断候选。上游报告了模式混淆，不能用共同 PID 或看起来合理的百分比替代 Windows 模式证明；无模式切换、无手柄写入。北通共享接收器仍须解决断连占位或电量等级语义；Cloud Flight 2 需要配套的持续低开销监听，未复用不适合的间歇轮询。
