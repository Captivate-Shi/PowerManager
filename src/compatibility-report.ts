import { randomUUID } from 'node:crypto';

// The collector is not a trusted source of identifiers or arbitrary text. Encode
// each known field explicitly before the report crosses IPC or reaches disk.
type Bag = Record<string, unknown>;
const own = (value: unknown): Bag => value && typeof value === 'object' && !Array.isArray(value) ? value as Bag : {};
function selectInts(value: Bag, keys: readonly string[], min = 0, max = 0xffffffff): Record<string, number> {
  const result: Record<string, number> = {};
  for (const key of keys) {
    const n = value[key];
    if (typeof n === 'number' && Number.isSafeInteger(n) && n >= min && n <= max) result[key] = n;
  }
  return result;
}
function selectFlags(value: Bag, keys: readonly string[]): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const key of keys) if (typeof value[key] === 'boolean') result[key] = value[key];
  return result;
}
const statuses = new Set(['current', 'offline', 'no_radio_reply', 'busy', 'timeout', 'bad_report',
  'unavailable', 'basic_bluetooth', 'charging_error', 'stale', 'unreachable']);
const batterySources = new Set(['hid', 'windows', 'ble', 'ble-bas', 'xinput', 'wgi', 'gameinput']);
const power = new Set(['charging', 'discharging', 'full', 'unknown']);
const gamepadStates = new Set(['ok', 'current', 'ready', 'unknown', 'not_available', 'unsupported', 'unavailable', 'no_battery', 'no_controller', 'not_connected', 'disconnected', 'wired', 'failed', 'error', 'access_denied', 'timeout', 'not_supported', 'not_attempted', 'api_unavailable', 'runtime_unavailable', 'invalid_report', 'no_report', 'sdk_headers_unavailable', 'enumeration_failed', 'activation_failed', 'string_error',
  'truncated', 'not_reported', 'api_error']);
const gamepadLevels = new Set(['empty', 'low', 'medium', 'full', 'unknown']);
const firmwareKind = new Set(['number', 'exact', 'range', 'coarse', 'unknown']);
const connections = new Set(['USB', 'USB（直连或接收器）', 'USB（直连）', '蓝牙', 'Windows 外设', 'Windows 电量',
  '2.4 GHz', '2.4 GHz 共享接收器', 'Bluetooth LE', '蓝牙 LE', 'XInput', 'Windows 游戏手柄', 'Windows 手柄']);
function from(value: unknown, values: Set<string>) {
  return typeof value === 'string' && values.has(value) ? value : undefined;
}
const provider = (value: unknown) =>
  typeof value === 'string' && /^(?:windows|ble|bluetooth|xinput|wgi|gameinput|dualsense|logitech|razer|vgn)(?:-[a-z][a-z0-9-]{0,47}|-[0-9]{4}-[a-f0-9]{4})?$/.test(value) ? value : undefined;
// A diagnostic target is a short ephemeral label, never an enumerator ID.
const target = (value: unknown) => typeof value === 'string' && /^[A-Z]{1,3}[1-9][0-9]{0,3}$/.test(value) ? value : undefined;
const bleReasons = new Set(['candidate', 'not_bluetooth', 'invalid_container', 'platform_unavailable', 'interface_enumeration_failed',
  'no_battery_service', 'multiple_battery_services', 'open_service_failed', 'characteristic_query_failed',
  'no_battery_level', 'multiple_battery_levels', 'battery_level_not_readable', 'gatt_read_failed',
  'invalid_battery_level', 'read_pending', 'worker_busy', 'ok', 'unknown']);
const reasonCode = (value: unknown) => typeof value === 'string' && (bleReasons.has(value) || statuses.has(value) ||
  /^(?:windows|ble|xinput|wgi|gameinput|hid|receiver)_[a-z][a-z0-9_]{0,44}$/.test(value)) ? value : undefined;
const stages = new Set(['inventory', 'discovery', 'match', 'property', 'connect', 'service', 'characteristic', 'open', 'read',
  'decode', 'reply', 'sample', 'identity', 'select', 'windows-property', 'ble-service', 'ble-level', 'xinput-battery']);
const results = new Set(['ok', 'unsupported', 'not_attempted', 'no_property', 'no_service', 'no_characteristic', 'unreachable',
  'access_denied', 'busy', 'timeout', 'bad_report', 'disconnected', 'no_radio_reply', 'no_battery', 'unknown', 'no_match',
  'not_paired', 'invalid_value', 'unavailable', 'ambiguous', 'ambiguous_battery', 'read_failed', 'radio_off']);
function reading(value: unknown) {
  const a = own(value);
  const pct = selectInts(a, ['low', 'high'], 0, 100);
  if (pct.low === undefined || pct.high === undefined || pct.high < pct.low) return null;
  return { ...pct, ...selectInts(a, ['raw']), power: from(a.power, power), source: from(a.source, batterySources),
    resolution: from(a.resolution, firmwareKind) };
}
function outcome(value: unknown) {
  const a = own(value);
  return { status: from(a.status, statuses), ...selectInts(a, ['reportId', 'feature', 'detail', 'millivolts']),
    ...selectInts(a, ['errorCode', 'hresult'], -0x80000000),
    code: from(a.code, results), reasonCode: reasonCode(a.reasonCode), stage: from(a.stage, stages), reading: reading(a.reading) };
}
function limited(value: unknown, max: number, fn: (entry: Bag) => Bag): Bag[] {
  return Array.isArray(value) ? value.slice(-max).filter(v => v && typeof v === 'object' && !Array.isArray(v))
    .map(v => fn(own(v))) : [];
}
function contextForExport(value: string) {
  // Only the explicitly entered note is free text. Mask common accidental
  // identifiers and let the user review the exact remaining contents first.
  return value.trim().slice(0, 240)
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\b(?:[a-z]:[\\/]|\\\\)[^\s，。；]+/gi, '[路径已遮盖]')
    .replace(/\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi, '[蓝牙地址已遮盖]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[设备标识已遮盖]')
    .replace(/[^\s@,，]+@[^\s@,，]+\.[a-z]{2,}/gi, '[邮箱已遮盖]')
    .replace(/((?:序列号|serial(?: number)?|S\/N)\s*[:=：]?\s*)[\w-]+/gi, '$1[已遮盖]');
}
type Metadata = {
  appVersion: string; windowsRelease: string;
  capture: 'live' | 'inventory'; collectorStatus: 'ready' | 'occupied' | 'retrying' | 'starting';
  context: string;
};
export const diagnosticModelLimit = 80;
export const diagnosticFirmwareLimit = 48;
export function diagnosticText(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string' || value.length > limit) return undefined;
  const result = contextForExport(value).trim();
  return result || undefined;
}
export function diagnosticConnection(value: unknown) { return from(value, connections); }
export function diagnosticTag(value: unknown) { return target(value); }
export type DiagnosticSubject = {
  model: string; modelSource: 'device' | 'manual';
  firmware?: string; firmwareSource?: 'device' | 'manual';
  connection?: string; connected?: boolean; target?: string;
};
export function compatibilityJson(metadata: Metadata, snapshot: unknown, generated = new Date(), subject?: DiagnosticSubject) {
  const raw = own(snapshot);
  const timings = (a: Bag) => selectInts(a, ['unixMs', 'unixSeconds'], 0, Number.MAX_SAFE_INTEGER);
  const hardware = (a: Bag) => selectInts(a, ['vid', 'pid', 'revision', 'slot'], 0, 0xffff);
  const sample = (a: Bag) => ({ ...hardware(a), ...timings(a),
    ...selectInts(a, ['elapsedMs', 'count', 'attempts', 'reportId'], 0),
    ...selectInts(a, ['errorCode', 'hresult', 'detail'], -0x80000000),
    ...selectFlags(a, ['identityAvailable', 'connected']),
    connection: from(a.connection, connections), transport: from(a.transport, connections),
    provider: provider(a.provider), stage: from(a.stage, stages), target: target(a.target), reasonCode: reasonCode(a.reasonCode),
    status: from(a.status, statuses), code: from(a.code, results),
    outcome: a.outcome == null ? undefined : outcome(a.outcome) });
  const pad = (a: Bag) => ({ ...sample(a), battery: reading(a.battery),
    ...selectInts(a, ['index', 'batteryType', 'batteryLevel'], 0, 255),
    ...selectInts(a, ['percent'], 0, 100), ...selectInts(a, ['remainingMwh', 'fullMwh']),
    status: from(a.status, gamepadStates), level: from(a.level, gamepadLevels), power: from(a.power, power),
  });
  const gamepads = own(raw.gamepads);
  // Never guess correlation after an inventory-only fallback: its W/H numbering
  // is allocated by a new process. The renderer never receives these handles.
  const subjectTag = metadata.capture === 'live' && subject ? target(subject.target) : undefined;
  let matchingRows = 0;
  const scoped = (value: unknown, max: number, format: (entry: Bag) => Bag): Bag[] => {
    if (!subject) return limited(value, max, format);
    if (!subjectTag || !Array.isArray(value)) return [];
    return limited(value.filter(item => own(item).target === subjectTag), max, entry => {
      matchingRows++;
      const result = format(entry);
      delete result.target;
      return result;
    });
  };
  const schema = selectInts(raw, ['schemaVersion'], 1, 0xffff);
  const details = {
    schemaVersion: 2,
    collectorSchemaVersion: schema.schemaVersion,
    generatedAt: generated.toISOString(),
    appVersion: /^\d+\.\d+\.\d+(?:-[a-z0-9.-]{1,25})?$/i.test(metadata.appVersion) ? metadata.appVersion : undefined,
    windowsRelease: /^\d+(?:\.\d+){1,3}$/.test(metadata.windowsRelease) ? metadata.windowsRelease : undefined,
    capture: metadata.capture,
    collectorStatus: metadata.collectorStatus,
    context: !subject ? contextForExport(metadata.context) : undefined,
    ...selectInts(raw, ['bleEnumerationError']),
    ...selectFlags(raw, ['windowsQuerySucceeded', 'bleQuerySucceeded', 'xinputAvailable', 'wgiAvailable']),
    hidInterfaces: scoped(raw.hidInterfaces, 256, a => ({
      ...hardware(a), ...selectInts(a, ['usagePage', 'usage', 'inputBytes', 'outputBytes', 'featureBytes'], 0, 0xffff),
      ...selectInts(a, ['interfaceNumber'], -1, 0xffff),
      ...selectFlags(a, ['descriptorAvailable']), candidateProvider: provider(a.candidateProvider) ?? null,
    })),
    nativeDevices: scoped(raw.nativeDevices, 256, sample),
    windowsDevices: scoped(raw.windowsDevices, 256, a => ({
      ...hardware(a), ...selectFlags(a, ['connected', 'bleBasListed']), connection: from(a.connection, connections),
      battery: reading(a.battery), status: from(a.status, statuses), code: from(a.code, results),
      provider: provider(a.provider), transport: from(a.transport, connections), target: target(a.target), reasonCode: reasonCode(a.reasonCode), bleReasonCode: reasonCode(a.bleReasonCode),
    })),
    logitechSlotAttempts: scoped(raw.logitechSlotAttempts, 160, sample),
    recentSamples: scoped(raw.recentSamples, 160, sample),
    providerAttempts: scoped(raw.providerAttempts ?? raw.attempts, 160, sample),
    gamepads: {
      wgiStatus: from(gamepads.wgiStatus, gamepadStates), xinputStatus: from(gamepads.xinputStatus, gamepadStates),
      windowsGamingInput: scoped(gamepads.windowsGamingInput, 32, pad), xinput: scoped(gamepads.xinput, 4, pad),
    },
  };
  const selectedDevice = subject && {
    model: diagnosticText(subject.model, diagnosticModelLimit), modelSource: subject.modelSource,
    firmware: diagnosticText(subject.firmware, diagnosticFirmwareLimit), firmwareSource: subject.firmwareSource,
    connection: from(subject.connection, connections), connected: subject.connected,
    evidence: matchingRows ? 'matched' : 'not_correlated',
  };
  return JSON.stringify({ ...details, selectedDevice }, null, 2) + '\n';
}

export type CompatibilityPreview = { token: string; json: string };
export class CompatibilityDraft {
  private active?: CompatibilityPreview & { deadline: number };
  constructor(private now: () => number = () => performance.now()) {}
  create(json: string): CompatibilityPreview {
    const token = randomUUID();
    this.active = { token, json, deadline: this.now() + 10 * 60_000 };
    return { token, json };
  }
  save(token: string, write: (json: string) => void) {
    const active = this.active;
    if (!active || token !== active.token || this.now() >= active.deadline) throw new Error('预览已失效，请重新生成。');
    // Only consume after successful write, so a disk error can be retried.
    write(active.json);
    this.active = undefined;
  }
  clear() { this.active = undefined; }
}
