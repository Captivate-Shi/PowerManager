import { defaults, type Art, type Device, type Found, type HistoryPoint, type Reading, type Snapshot } from './model';

const demoReading = (value: number): Reading => ({ low: value, high: value, raw: value, power: 'discharging', source: 'hid' });
const fixture: [Art, string, string, number, boolean][] = [
  ['mouse', '无线鼠标', '无线 2.4G', 92, true],
  ['keyboard', 'Razer 机械键盘', '无线 2.4G', 67, true],
  ['dualsense', 'DualSense 手柄', '蓝牙', 12, true],
  ['xbox', 'Xbox 游戏手柄', '无线 2.4G', 78, true],
  ['headset', '蓝牙头戴耳机', '蓝牙', 18, true],
  ['earbuds', '无线耳机（入耳式）', '蓝牙', 62, false],
  ['stylus', '触控笔', '蓝牙', 36, false],
];
export function demoSnapshot(): Snapshot {
  const now = Date.now();
  const devices: Device[] = fixture.map(([art, name, connection, value, online], index) => ({
    id: art, name, connection, art, status: online ? 'current' : 'offline', reason: online ? '读数正常' : '设备未连接',
    reading: art === 'dualsense' ? { ...demoReading(value), low: 10, high: 20 } : demoReading(value), lastRead: now - (online ? 0 : index === 5 ? 2 : 20) * 3600000, watched: false,
  }));
  return { devices, settings: { ...defaults }, deviceSettings: {}, collector: 'ready',
    refreshing: false, mutedUntil: 0, alerts: {}, demo: true };
}

export const demoDiscovery: Found[] = [
  { id: 'demo-added', name: '蓝牙音箱', connection: '蓝牙', connected: true, automatic: false, reading: demoReading(41), offerBluetooth: false },
  { id: 'demo-unavailable', name: '无线触控板', connection: '蓝牙', connected: true, automatic: false, reading: null, offerBluetooth: false },
];
export function demoHistory(device: Device): HistoryPoint[] {
  if (!device.reading) return [];
  const now = device.lastRead ?? Date.now();
  const last = device.reading.low;
  // Dense synthetic intervals help the demo show explicit gaps and charging,
  // without pretending sparse or interrupted data was a continuous curve.
  return Array.from({ length: 1_441 }, (_, i) => {
    const peak = Math.min(100, last + 37);
    const floor = Math.max(0, last - 13);
    const charging = i >= 740 && i < 865;
    const level = i < 740 ? peak + (floor - peak) * i / 740 :
      charging ? floor + (peak - floor) * (i - 740) / 125 :
      peak + (last - peak) * (i - 865) / 575;
    const value = Math.round(level);
    const lower = Math.floor(value / 10) * 10;
    const reading = { ...demoReading(value), ...device.art === 'dualsense' ? { low: lower, high: Math.min(100, lower + 10) } : {},
      power: charging ? 'charging' as const : 'discharging' as const };
    const invalid = device.art === 'headset' && i >= 560 && i < 700;
    return { time: now - (1440 - i) * 60_000, reading: invalid ? null : reading };
  });
}
export function previewDevice(level: 'low' | 'critical', base?: Device): Device {
  const reading = demoReading(level === 'critical' ? 5 : 15);
  return { ...(base ?? { id: 'preview', name: '示例设备', connection: '', art: 'unknown', watched: false }),
    status: 'current', reason: '测试读数', reading, lastRead: Date.now() };
}
