import type { CompatibilityPreview } from './compatibility-report';
export type Power = 'discharging' | 'charging' | 'full' | 'unknown';
export type Reading = { low: number; high: number; raw: number; power: Power; source: 'hid' | 'windows' | 'ble' | 'hid_voltage' | 'bluetooth_vendor' };
export type Status = 'current' | 'offline' | 'no_radio_reply' | 'busy' | 'timeout' | 'bad_report' |
  'unavailable' | 'basic_bluetooth' | 'charging_error' | 'stale' | 'unreachable';
export type Sample = { status: Status; reason: string; reading: Reading | null };
export type Art = 'mouse' | 'keyboard' | 'dualsense' | 'xbox' | 'controller' | 'headset' | 'earbuds' | 'stylus' | 'unknown';
export type Device = {
  id: string; name: string; connection: string; art: Art; status: Status; reason: string;
  recognizedName?: string;
  historyUpdatedAt?: number;
  reading: Reading | null; lastRead: number | null; watched: boolean;
};
export type Found = {
  id: string; name: string; connection: string; connected: boolean; automatic: boolean;
  reading: Reading | null; offerBluetooth: boolean; batteryCandidate?: 'ble_bas';
};
export type DiagnosticDevice = {
  key: string; model?: string; label?: string; firmware?: string; firmwareReadable?: boolean; connection?: string; connected: boolean;
};
export type CompatibilitySelection =
  | { kind: 'device'; deviceKey: string; model?: string; firmware?: string }
  | { kind: 'manual'; model: string; firmware?: string };
export type Settings = {
  low: number; critical: number; repeat: number; snooze: number; fullscreenSound: boolean;
  desktopSound: boolean; voltage: boolean; startup: boolean;
  zoom: number; trayZoom: number; desktopToasts: boolean; muteMinutes: MuteMinutes;
  historyRetention: HistoryRange;
};
export const historyRanges = ['day', 'week', 'month', 'year'] as const;
export type HistoryRange = typeof historyRanges[number];
export const isHistoryRangeWithin = (range: HistoryRange, limit: HistoryRange) =>
  historyRanges.indexOf(range) <= historyRanges.indexOf(limit);
export const limitHistoryRange = (range: HistoryRange, limit: HistoryRange) => isHistoryRangeWithin(range, limit) ? range : limit;
export const isHistoryRange = (value: unknown): value is HistoryRange => historyRanges.some(range => range === value);
export type DeviceSettings = { alias?: string; low?: number; muted?: boolean };
export type HistoryPoint = { time: number; reading: Reading | null; invalidThrough?: number };
export function historyPointEnd({ reading, time, invalidThrough }: HistoryPoint) {
  return !reading && invalidThrough !== undefined && Number.isFinite(invalidThrough) ? Math.max(time, invalidThrough) : time;
}
export type HistoryDay = {
  day: number; lowest: { time: number; reading: Reading }; lastCharge?: number; count: number;
};
export type Severity = 'low' | 'critical';
export type AlertState = {
  lowAt?: number; criticalAt?: number; snoozeUntil?: number; ignored?: Severity; recovery?: number; lastNoticeAt?: number;
};
export type Toast = { device: Device; severity: Severity; preview: boolean; detailId?: string };
export type AlertSwitch = 'fullscreenSound' | 'desktopSound' | 'desktopToasts';
export type Snapshot = {
  devices: Device[]; settings: Settings; deviceSettings: Record<string, DeviceSettings>;
  collector: 'starting' | 'ready' | 'occupied' | 'retrying'; refreshing: boolean;
  mutedUntil: number; alerts: Record<string, AlertState>; demo: boolean; error?: string;
};
export function inventoryState(snapshot: Pick<Snapshot, 'devices' | 'collector'>) {
  if (snapshot.collector === 'ready') return 'ready';
  if (snapshot.devices.length) return 'cached';
  return snapshot.collector === 'starting' ? 'cold' : 'unavailable';
}
export type Surface = 'main' | 'tray' | 'toast';
export type MainView = {
  page: 'overview' | 'devices' | 'alerts' | 'history' | 'settings';
  detailId?: string;
  selected?: string;
  featured?: string;
  mode?: 'stage' | 'list';
};
export type Command =
  | { type: 'refresh' | 'discover' | 'diagnostics' | 'diagnosticDevices' | 'mute' | 'pin' | 'closeSurface' }
  | { type: 'diagnosticFirmware'; deviceKey: string }
  | { type: 'open'; id?: string }
  | { type: 'compatibility'; selection: CompatibilitySelection }
  | { type: 'compatibility'; reportToken: string }
  | { type: 'history'; id: string; range?: HistoryRange }
  | { type: 'add' | 'remove' | 'snooze' | 'ignore'; id: string }
  | { type: 'settings'; patch: Partial<Settings>; confirmHistoryShorten?: boolean }
  | { type: 'toggleAlertSetting'; key: AlertSwitch }
  | { type: 'deviceSettings'; id: string; patch: DeviceSettings }
  | { type: 'preview'; severity: Severity; id?: string };
export type CommandResult = { ok: true; history?: HistoryPoint[]; historyDays?: HistoryDay[]; found?: Found[]; message?: string; pinned?: boolean; compatibility?: CompatibilityPreview; diagnosticDevices?: DiagnosticDevice[]; diagnosticFirmware?: { status: 'pending' | 'ready' | 'unavailable' | 'busy'; firmware?: string } } |
  { ok: false; error: string };
export interface DesktopApi {
  snapshot(): Promise<Snapshot>;
  toast(): Promise<Toast | null>;
  toastPresent?(): Promise<void>;
  trayPresent?(): Promise<void>;
  mainPresent?(): Promise<void>;
  windowAction?(action: 'drag' | 'minimize' | 'maximize' | 'close'): Promise<void>;
  mainView?(): Promise<MainView | undefined>;
  rememberMainView?(view: MainView): Promise<void>;
  command(command: Command): Promise<CommandResult>;
  onSnapshot(fn: (state: Snapshot) => void): () => void;
  onNavigate(fn: (id?: string) => void): () => void;
}
export const muteDurations = [15, 30, 60, 120] as const;
type MuteMinutes = typeof muteDurations[number];
export const isMuteDuration = (value: unknown): value is MuteMinutes => muteDurations.some(minutes => minutes === value);
export const muteDurationLabel = (minutes: MuteMinutes) =>
  minutes >= 60 ? (minutes / 60) + ' 小时' : minutes + ' 分钟';
export const defaults: Settings = {
  low: 20, critical: 10, repeat: 0, snooze: 30, fullscreenSound: true,
  desktopSound: false, voltage: false, startup: false,
  zoom: 100, trayZoom: 100, desktopToasts: true, muteMinutes: 60,
  historyRetention: 'year',
};
export const midpoint = (reading: Reading) => Math.ceil((reading.low + reading.high) / 2);
export const percent = (reading: Reading | null) =>
  reading ? (reading.low === reading.high ? '' : '约 ') + midpoint(reading) + '%' : '—';
export const isConnected = (device: Device) => !['offline', 'no_radio_reply', 'stale', 'unreachable'].includes(device.status);
// Presentation only: the HID charge flag does not replace the gauge bucket.
export const isLiveDualSenseFull = (device?: Device) => device?.art === 'dualsense' &&
  device.status === 'current' && device.reading?.source === 'hid' && device.reading.power === 'full';
export const isDualSenseBluetooth = (device: Device) => device.art === 'dualsense' && /蓝牙|bluetooth/i.test(device.connection);
export const threshold = (settings: Settings, deviceSettings?: DeviceSettings) =>
  Math.max(deviceSettings?.low ?? settings.low, settings.critical);
export function severity(device: Device, settings: Settings, rules?: DeviceSettings): Severity | undefined {
  const value = device.reading;
  if (device.status !== 'current' || !value || value.power === 'charging' || value.power === 'full') return;
  if (value.high <= settings.critical) return 'critical';
  if (value.high <= threshold(settings, rules)) return 'low';
}
export function classify(name: string): Art {
  if (/earbud|耳塞|入耳|airpods/i.test(name)) return 'earbuds';
  if (/head(phone|set)|耳机/i.test(name)) return 'headset';
  if (/mouse|鼠标/i.test(name)) return 'mouse';
  if (/keyboard|键盘/i.test(name)) return 'keyboard';
  if (/dualsense/i.test(name)) return 'dualsense';
  if (/xbox/i.test(name)) return 'xbox';
  if (/controller|gamepad|手柄/i.test(name)) return 'controller';
  if (/stylus|触控笔|手写笔/i.test(name)) return 'stylus';
  return 'unknown';
}
