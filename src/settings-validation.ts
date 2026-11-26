import { defaults, isHistoryRange, isHistoryRangeWithin, isMuteDuration, type DeviceSettings, type Settings } from './model';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function setSetting(settings: Settings, key: string, value: unknown): string | undefined {
  switch (key) {
    case 'low': case 'critical':
      if (!integer(value, key === 'low' ? 2 : 1, key === 'low' ? 95 : 94)) return '阈值范围无效';
      settings[key] = value;
      return;
    case 'repeat': case 'snooze':
      if (!integer(value, key === 'repeat' ? 0 : 5, 180)) return '时间间隔无效';
      settings[key] = value;
      return;
    case 'muteMinutes':
      if (!isMuteDuration(value)) return '全局静音时长无效';
      settings.muteMinutes = value;
      return;
    case 'historyRetention':
      if (!isHistoryRange(value)) return '记录范围无效';
      settings.historyRetention = value;
      return;
    case 'zoom': case 'trayZoom':
      if (!integer(value, 75, 150)) return '缩放比例需在 75%–150% 之间';
      settings[key] = value;
      return;
    case 'fullscreenSound': case 'desktopSound': case 'voltage': case 'startup': case 'desktopToasts':
      if (typeof value !== 'boolean') return '设置格式有误';
      settings[key] = value;
      return;
    default:
      return '未知设置';
  }
}

export function loadSettings(saved: Record<string, unknown>): Settings {
  const settings = { ...defaults };
  if (typeof saved.desktopSound !== "boolean" && saved.soundOnly === true) {
    // A legacy sound-only preference must never gain a popup when upgraded.
    settings.desktopSound = true;
  }
  let savedLowValid = false;
  for (const [key, value] of Object.entries(saved)) {
    const error = setSetting(settings, key, value);
    if (key === 'low') savedLowValid = !error;
  }
  if (settings.critical >= settings.low) {
    // Keep a valid saved low threshold; restore only the conflicting alert.
    // If low was missing/bad, preserve the independently valid critical threshold.
    if (savedLowValid) settings.critical = Math.min(defaults.critical, settings.low - 1);
    else settings.low = settings.critical + 1;
  }
  if (typeof saved.desktopSound !== "boolean" && saved.soundOnly === true) settings.desktopToasts = false;
  return settings;
}

export function patchSettings(previous: Settings, patch: unknown, confirmHistoryShorten = false): Settings {
  if (!isRecord(patch)) throw new Error('设置格式有误');
  const settings = { ...previous };
  for (const [key, value] of Object.entries(patch)) {
    const error = setSetting(settings, key, value);
    if (error) throw new Error(error);
  }
  if (!isHistoryRangeWithin(previous.historyRetention, settings.historyRetention) && !confirmHistoryShorten)
    throw new Error('缩短保留期限需要确认清理旧记录');
  if (settings.critical >= settings.low) throw new Error('告急阈值必须低于低电量阈值');
  return settings;
}

function setDeviceSetting(settings: DeviceSettings, key: string, value: unknown): string | undefined {
  switch (key) {
    case 'alias': {
      if (typeof value !== 'string') return '设备备注格式有误';
      const alias = value.trim();
      if ([...alias].length > 50) return '设备备注最多 50 个字符';
      if (alias) settings.alias = alias;
      else delete settings.alias;
      return;
    }
    case 'low':
      if (value === null || value === undefined) { delete settings.low; return; }
      if (!integer(value, 1, 50)) return '设备阈值需在 1%–50% 之间';
      settings.low = value;
      return;
    case 'muted':
      if (typeof value !== 'boolean') return '设备设置格式有误';
      settings.muted = value;
      return;
    default:
      return '未知设备设置';
  }
}

export function loadDeviceSettings(saved: Record<string, unknown>): Record<string, DeviceSettings> {
  const result: Record<string, DeviceSettings> = Object.create(null);
  for (const [id, value] of Object.entries(saved)) {
    if (!isRecord(value)) continue;
    // Retain unrelated persisted metadata, but do not let invalid known fields
    // (or prototype-like metadata keys) reach monitoring and display.
    const { alias, low, muted, ...metadata } = value;
    delete metadata.__proto__;
    delete metadata['constructor'];
    delete metadata.prototype;
    const settings: DeviceSettings = metadata;
    if (alias !== undefined) setDeviceSetting(settings, 'alias', alias);
    if (low !== undefined) setDeviceSetting(settings, 'low', low);
    if (muted !== undefined) setDeviceSetting(settings, 'muted', muted);
    result[id] = settings;
  }
  return result;
}

export function patchDeviceSettings(previous: DeviceSettings | undefined, patch: unknown): DeviceSettings {
  if (!isRecord(patch)) throw new Error('设备设置格式有误');
  const settings = { ...previous };
  for (const [key, value] of Object.entries(patch)) {
    const error = setDeviceSetting(settings, key, value);
    if (error) throw new Error(error);
  }
  return settings;
}
