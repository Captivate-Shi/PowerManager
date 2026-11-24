import { historyPointEnd, severity, threshold, type AlertState, type Device, type DeviceSettings, type HistoryPoint, type Settings, type Severity } from './model';
import { unsampledAfter } from './history-plot';

export const day = 24 * 60 * 60 * 1000;
export const historyLimit = 7200;
export function observeRecovery(device: Device, settings: Settings, rules: DeviceSettings | undefined, previous: AlertState): AlertState {
  const reading = device.status === 'current' ? device.reading : null;
  const recovered = reading && (reading.power === 'full' || reading.low >= threshold(settings, rules) + 5);
  if (!recovered) return { ...previous, recovery: 0 };
  const recovery = (previous.recovery ?? 0) + 1;
  return recovery >= 2 ? { recovery: 2, lastNoticeAt: previous.lastNoticeAt } : { ...previous, recovery };
}
export function eligible(device: Device, settings: Settings, rules: DeviceSettings | undefined, state: AlertState,
  mutedUntil: number, now: number): Severity | undefined {
  const level = severity(device, settings, rules);
  if (!level || rules?.muted || now < mutedUntil || now < (state.snoozeUntil ?? 0)) return;
  if (state.ignored === 'critical' || state.ignored === level) return;
  const delivered = level === 'critical' ? state.criticalAt : state.lowAt;
  if (state.snoozeUntil && state.snoozeUntil > (delivered ?? 0)) return level;
  if (delivered === undefined || (settings.repeat > 0 && now - delivered >= settings.repeat * 60000)) return level;
}
export function recordHistory(points: HistoryPoint[], point: HistoryPoint): HistoryPoint[] {
  const cutoff = point.time - day;
  const first = points.findIndex(item => historyPointEnd(item) >= cutoff);
  const retained = first < 0 ? [] : first === 0 ? points : points.slice(first);
  const last = retained.at(-1);
  if (last && point.time < last.time) {
    const ordered = retained.filter(item => item.time !== point.time);
    const position = ordered.findIndex(item => item.time > point.time);
    ordered.splice(position < 0 ? ordered.length : position, 0, point);
    return ordered.slice(-historyLimit);
  }
  if (last && !last.reading && !point.reading && point.time - historyPointEnd(last) <= unsampledAfter) {
    return [...retained.slice(0, -1), { ...last, invalidThrough: Math.max(point.time, historyPointEnd(last)) }];
  }
  const end = retained.length - Number(last?.time === point.time);
  return [...retained.slice(Math.max(0, end - historyLimit + 1), end), point];
}
export function delayFor(device: Device, settings: Settings, rules: DeviceSettings | undefined, failures: number) {
  if (device.status === 'current' && device.reading) {
    return device.reading.power === 'charging' || device.reading.low <= threshold(settings, rules) + 10 ? 12_000 : 22_000;
  }
  if (device.status === 'basic_bluetooth') return 10_000;
  const delay = [2_000, 4_000, 8_000, 16_000, 24_000][Math.min(Math.max(failures - 1, 0), 4)];
  return device.status === 'no_radio_reply' ? Math.min(delay, 12_000) : delay;
}
