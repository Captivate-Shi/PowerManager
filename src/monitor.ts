import { appendFileSync, constants, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Collector } from './collector';
import { randomUUID } from 'node:crypto';
import { CompatibilityDraft, compatibilityJson, diagnosticConnection, diagnosticFirmwareLimit, diagnosticModelLimit,
  diagnosticTag, diagnosticText, type DiagnosticSubject } from './compatibility-report';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { release } from 'node:os';

import { isDualSenseBluetooth, classify, defaults, historyPointEnd, limitHistoryRange, type AlertState, type Device, type DeviceSettings, type CompatibilitySelection, type CommandResult, type DiagnosticDevice, type Found, type HistoryDay, type HistoryPoint, type HistoryRange, type Reading, type Sample, type Severity, type Settings, type Snapshot } from './model';
import { day, delayFor, eligible, observeRecovery, recordHistory } from './monitor-rules';
import { accumulateHistoryDay, historyStart } from './history-plot';
import { loadDeviceSettings, loadSettings } from './settings-validation';

const executeFile = promisify(execFile);
const maxCurrentReadingAge = 60_000;
const manualRefreshWait = 5000;
const collectorStartupError = '采集程序启动失败，详情见诊断日志。';

function validReading(reading: Reading | null | undefined): reading is Reading {
  return !!reading && Number.isFinite(reading.low) && Number.isFinite(reading.high) && Number.isFinite(reading.raw) &&
    reading.low >= 0 && reading.high <= 100 && reading.low <= reading.high &&
    ['charging', 'discharging', 'full', 'unknown'].includes(reading.power) &&
    ['hid', 'windows', 'ble', 'hid_voltage', 'bluetooth_vendor'].includes(reading.source);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8.64e15;
}

function validHistoryPoint(value: unknown): value is HistoryPoint {
  if (!isRecord(value) || !validTimestamp(value.time)) return false;
  if (value.invalidThrough !== undefined &&
      (!validTimestamp(value.invalidThrough) || value.invalidThrough < value.time)) return false;
  return value.reading === null || validReading(value.reading as Reading | undefined);
}

function validHistoryDay(value: unknown): value is HistoryDay {
  return isRecord(value) && validTimestamp(value.day) &&
    typeof value.count === 'number' && Number.isSafeInteger(value.count) && value.count > 0 &&
    (value.lastCharge === undefined || validTimestamp(value.lastCharge)) &&
    validHistoryPoint(value.lowest) && value.lowest.reading !== null;
}

// Partial history damage is not a reason to discard settings or other devices.
// Keep valid samples and summaries; never iterate a value just because a file
// asserted the expected TypeScript type.
function loadHistory(rawPoints: unknown, rawDays: unknown) {
  const points: Record<string, HistoryPoint[]> = Object.create(null);
  const days: Record<string, HistoryDay[]> = Object.create(null);
  let repaired = !isRecord(rawPoints) || (rawDays !== undefined && !isRecord(rawDays));
  if (isRecord(rawPoints)) {
    for (const [id, value] of Object.entries(rawPoints)) {
      if (!Array.isArray(value)) { repaired = true; continue; }
      const valid = value.filter(validHistoryPoint);
      if (valid.length !== value.length) repaired = true;
      if (valid.length) points[id] = valid;
    }
  }
  if (isRecord(rawDays)) {
    for (const [id, value] of Object.entries(rawDays)) {
      if (!Array.isArray(value)) { repaired = true; continue; }
      const valid = value.filter(validHistoryDay);
      if (valid.length !== value.length) repaired = true;
      if (valid.length) days[id] = valid;
    }
  }
  if (rawDays === undefined || repaired) {
    for (const [id, history] of Object.entries(points)) {
      const recovered: HistoryDay[] = [];
      for (const point of history) accumulateHistoryDay(recovered, point);
      const retained = days[id] ?? [];
      const known = new Set(retained.map(bucket => bucket.day));
      const missing = recovered.filter(bucket => !known.has(bucket.day));
      if (missing.length) days[id] = [...retained, ...missing].sort((a, b) => a.day - b.day);
    }
  }
  return { points, days, repaired };
}

// A local reading is only a last-known value. Never restore a live status from disk.
function cachedDevice(value: unknown): Device | null {
  if (!value || typeof value !== 'object') return null;
  const { id, name, connection, art, watched, reading, lastRead } = value as Partial<Device>;
  if (typeof id !== 'string' || !id || typeof name !== 'string' || !name.trim() ||
      typeof connection !== 'string' || typeof watched !== 'boolean') return null;
  const safeArt = art && ['mouse', 'keyboard', 'dualsense', 'xbox', 'controller', 'headset', 'earbuds', 'stylus', 'unknown'].includes(art)
    ? art : classify(name);
  const hasReading = validReading(reading) && validTimestamp(lastRead) && lastRead > 0 && lastRead <= Date.now();
  return { id, name, connection, art: safeArt, watched, status: 'stale', reason: '等待新读数',
    reading: hasReading ? reading : null, lastRead: hasReading ? lastRead : null };
}

type WatchedDevice = Pick<Found, 'id' | 'name' | 'connection'>;

function validWatchedDevice(value: unknown): value is WatchedDevice {
  return isRecord(value) && typeof value.id === 'string' && !!value.id.trim() &&
    typeof value.name === 'string' && !!value.name.trim() &&
    typeof value.connection === 'string' && !!value.connection.trim();
}

function lowerReading(a: Reading, b: Reading) {
  return a.low < b.low || (a.low === b.low && a.high < b.high);
}

// Correct the contribution of a replaced point rather than counting it twice.
function replaceHistoryDay(days: HistoryDay[], points: HistoryPoint[], old: HistoryPoint, point: HistoryPoint) {
  if (!old.reading) { accumulateHistoryDay(days, point); return; }
  const date = new Date(point.time);
  date.setHours(0, 0, 0, 0);
  const start = date.getTime();
  let index = days.length - 1;
  if (days[index]?.day !== start) index = days.findIndex(bucket => bucket.day === start);
  if (index < 0) { accumulateHistoryDay(days, point); return; }
  const bucket = days[index]!;
  const replacedMin = bucket.lowest.time === old.time;
  const lostMin = replacedMin && (!point.reading || lowerReading(bucket.lowest.reading, point.reading));
  const lostCharge = bucket.lastCharge === old.time && point.reading?.power !== 'charging';
  bucket.count -= Number(!point.reading);
  if (bucket.count <= 0) { days.splice(index, 1); return; }

  if (lostMin || lostCharge) {
    date.setDate(date.getDate() + 1); // Local calendar day, including DST.
    const end = date.getTime();
    const replacement: HistoryDay[] = [];
    if (!lostMin && bucket.lowest.time !== point.time) accumulateHistoryDay(replacement, bucket.lowest);
    if (point.reading) accumulateHistoryDay(replacement, point);
    // Read the pre-replacement array; the raw cap/rolling window may have
    // dropped another point as part of the same write.
    for (let i = points.length - 1; i >= 0; i--) {
      const candidate = points[i]!;
      if (candidate.time < start) break;
      if (candidate.time < end && candidate.time !== point.time) accumulateHistoryDay(replacement, candidate);
    }
    if (lostMin && replacement[0]) bucket.lowest = replacement[0].lowest;
    else if (lostMin) {
      // A legacy aggregate can outlive all its raw points. With its sole
      // known minimum removed, there is no defensible reading to display.
      days.splice(index, 1);
      return;
    }
    if (lostCharge) bucket.lastCharge = replacement[0]?.lastCharge;
  }
  if (point.reading) {
    if ((replacedMin && !lostMin) || lowerReading(point.reading, bucket.lowest.reading)) {
      bucket.lowest = { time: point.time, reading: point.reading };
    }
    if (point.reading.power === 'charging') bucket.lastCharge = Math.max(point.time, bucket.lastCharge ?? 0);
  }
}

type StateFile = {
  version: 1; settings: Settings; deviceSettings: Record<string, DeviceSettings>; alerts: Record<string, AlertState>;
  watched: WatchedDevice[]; devices: Device[]; history: Record<string, HistoryPoint[]>;
  historyDays?: Record<string, HistoryDay[]>;
};
type Observation = {
  id: string; name: string; connection: string; aliases: string[]; art: Device['art']; automatic?: boolean;
  sample: Sample | null; pending?: boolean; sampleSequence?: number | null; voltage: { millivolts: number | null; status: string; detail: number } | null;
};
export type Scene = { mode: 'desktop' | 'fullscreen' | 'quiet'; allowed: boolean | null; shellAccepts?: boolean; point: { x: number; y: number } | null };
type Row = { device: Device; due: number; failures: number };
export type NativeMetrics = { pid: number; cpuSeconds: number | null; rssBytes: number | null; privateBytes: number | null; handles: number | null };

export class Monitor {
  readonly state: Snapshot;
  private collector: Collector;
  private file: string;
  private data: StateFile;
  private historyDays: Record<string, HistoryDay[]>;
  private rows = new Map<string, Row>();
  private found = new Map<string, Found>();
  private timer?: NodeJS.Timeout;
  private polling?: Promise<void>;
  private pollGeneration = 0;
  private nativePending = false;
  private pollSequence = 0;
  private thresholdEdits = new Map<string, number>();
  private thresholdAlertRevisions = new Map<string, number>();
  private closed = false;
  private maintenancePaused = false;
  private suspended = false;
  private readyOnce = false;
  private dirty = false;
  private lastSave = 0;
  private backupRequired?: { prefix: string; savedMessage: string; blockedMessage: string };
  private totals = { polls: 0, failedPolls: 0, pollMs: 0, maxPollMs: 0, saves: 0, saveMs: 0, childExits: 0 };

  constructor(readonly directory: string, private executable: string, private changed: () => void, private evaluate: () => void) {
    mkdirSync(directory, { recursive: true });
    this.file = join(directory, 'monitor.json');
    let initial: StateFile = { version: 1, settings: { ...defaults }, deviceSettings: {}, alerts: {}, watched: [], devices: [], history: {} };
    let loadError: string | undefined;
    let rewriteState = false;
    if (existsSync(this.file)) {
      try {
        const saved: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
        if (!isRecord(saved) || saved.version !== 1 || !Array.isArray(saved.devices) || !Array.isArray(saved.watched) ||
            !isRecord(saved.settings) || !isRecord(saved.deviceSettings) || !isRecord(saved.alerts)) throw new Error('Invalid state');
        const history = loadHistory(saved.history, saved.historyDays);
        const watched = saved.watched.filter(validWatchedDevice);
        const repairedWatched = watched.length !== saved.watched.length;
        initial = { ...(saved as unknown as StateFile), watched, history: history.points, historyDays: history.days };
        rewriteState = saved.historyDays === undefined || history.repaired || repairedWatched;
        if (history.repaired || repairedWatched) {
          const damaged = history.repaired && repairedWatched ? '部分电量历史和监测设备记录'
            : history.repaired ? '部分电量历史' : '部分监测设备记录';
          try {
            copyFileSync(this.file, join(directory, 'monitor-repair-' + Date.now() + '-' + randomUUID() + '.json'), constants.COPYFILE_EXCL);
            loadError = damaged + '无法读取，已备份原文件并保留可用记录。';
          } catch {
            rewriteState = false;
            loadError = damaged + '无法读取或备份，暂用可用记录。';
            this.backupRequired = { prefix: 'monitor-repair-', blockedMessage: loadError,
              savedMessage: damaged + '无法读取，已备份原文件并保留可用记录。' };
          }
        }
      } catch {
        const backup = join(directory, 'monitor-corrupt-' + Date.now() + '-' + randomUUID() + '.json');
        try {
          renameSync(this.file, backup);
          loadError = '本地存档无法读取，已备份并恢复默认设置。';
        } catch {
          loadError = '本地存档无法读取或备份，暂用默认设置。';
          this.backupRequired = { prefix: 'monitor-corrupt-', blockedMessage: loadError,
            savedMessage: '本地存档无法读取，已备份并恢复默认设置。' };
        }
      }
    }
    initial.settings = loadSettings(initial.settings);
    initial.deviceSettings = loadDeviceSettings(initial.deviceSettings);
    initial.alerts = Object.assign(Object.create(null), initial.alerts);
    initial.history = Object.assign(Object.create(null), initial.history);
    this.historyDays = Object.assign(Object.create(null), initial.historyDays);
    initial.historyDays = this.historyDays;
    this.data = initial;
    for (const cached of initial.devices) {
      const device = cachedDevice(cached);
      if (device) this.rows.set(device.id, { device, due: 0, failures: 0 });
    }
    this.state = { devices: [], settings: initial.settings, deviceSettings: initial.deviceSettings, collector: 'starting',
      refreshing: false, mutedUntil: 0, alerts: initial.alerts, demo: false, error: loadError };
    this.updateDevices();
    this.collector = new Collector(executable, (occupied, error) => {
      if (this.closed) return;
      this.totals.childExits++;
      this.diagnosticEpoch++;
      this.diagnosticDevices.clear();
      this.state.collector = occupied ? 'occupied' : 'retrying';
      this.state.error = error ? collectorStartupError : this.state.error === collectorStartupError ? undefined : this.state.error;
      if (error) this.log(error);
      if (this.readyOnce) this.markStale();
      this.publish();
      this.schedule(5000, true);
    });
    // Once committed, a repaired or migrated file does not repeat startup recovery.
    if (rewriteState && !this.persist()) this.dirty = true;
  }

  start() { void this.poll(true); }
  close() {
    this.closed = true;
    this.compatibilityDraft.clear();
    this.diagnosticDevices.clear();
    clearTimeout(this.timer);
    this.collector.close();
    // Shutdown is not a failed device reading. On load, cached devices are
    // already restored as stale, without overwriting the last real sample.
    this.persist();
  }
  async closeForMaintenance() {
    if (!this.persist()) return '无法保存设置或电量历史。';
    this.maintenancePaused = true;
    this.closed = true;
    this.compatibilityDraft.clear();
    this.diagnosticDevices.clear();
    clearTimeout(this.timer);
    if (!await this.collector.closeGracefully()) return '等待采集程序退出超时。';
  }
  resumeAfterMaintenance() {
    if (!this.maintenancePaused) return;
    this.maintenancePaused = false;
    // EOF was already sent. A timed-out child cannot be reused; let it exit
    // before reopening collection. The normal close handler schedules a retry.
    const childStillRunning = !!this.collector.pid;
    this.collector.allowRestartAfterClose();
    if (childStillRunning) this.collector.close();
    this.closed = false;
    this.diagnosticEpoch++;
    this.state.collector = 'retrying';
    this.markStale();
    this.publish();
    if (childStillRunning) this.schedule(5000, true);
    else this.start();
  }
  suspend(value: boolean) {
    this.suspended = value;
    if (value) {
      clearTimeout(this.timer);
      this.markStale();
      this.publish();
    } else this.start();
  }
  history(id: string) {
    const cutoff = Date.now() - day;
    return (this.data.history[id] ?? []).filter(point => historyPointEnd(point) >= cutoff);
  }
  historySummary(id: string, range: Exclude<HistoryRange, 'day'>) {
    const start = historyStart(Date.now(), limitHistoryRange(range, this.state.settings.historyRetention));
    return (this.historyDays[id] ?? []).filter(bucket => bucket.day >= start);
  }
  log(event: string) { this.appendLog('activity.log', new Date().toISOString() + ' ' + event); }
  private appendLog(file: string, line: string) {
    const path = join(this.directory, file);
    try {
      if (statSync(path, { throwIfNoEntry: false })?.size! >= 1024 * 1024) renameSync(path, path + '.1');
      appendFileSync(path, line + '\n', 'utf8');
    } catch (error) { console.error(error); }
  }
  persist() {
    const start = performance.now();
    try {
      const now = Date.now();
      if (this.backupRequired) {
        const backup = this.backupRequired;
        // Keep the original until a separate copy exists. Record the attempt
        // so a read-only profile does not trigger disk retries every poll.
        this.lastSave = now;
        try {
          copyFileSync(this.file, join(this.directory, backup.prefix + now + '-' + randomUUID() + '.json'), constants.COPYFILE_EXCL);
        } catch {
          this.state.error = backup.blockedMessage;
          return false;
        }
        this.backupRequired = undefined;
        this.state.error = backup.savedMessage;
      }
      const cutoff = now - day;
      const history = Object.assign(Object.create(null), this.data.history) as StateFile['history'];
      for (const [id, items] of Object.entries(history)) {
        const kept = items.filter(item => historyPointEnd(item) >= cutoff);
        if (kept.length) history[id] = kept;
        else delete history[id];
      }
      const summaryCutoff = historyStart(now, this.state.settings.historyRetention);
      const historyDays = Object.assign(Object.create(null), this.historyDays) as Record<string, HistoryDay[]>;
      for (const [id, buckets] of Object.entries(historyDays)) {
        if (!buckets.length) delete historyDays[id];
        else if (buckets.some(bucket => bucket.day < summaryCutoff)) {
          const kept = buckets.filter(bucket => bucket.day >= summaryCutoff);
          if (kept.length) historyDays[id] = kept;
          else delete historyDays[id];
        }
      }
      const devices = [...this.rows.values()].map(({ device }) => device);
      // Commit trimmed history only after the atomic on-disk replacement succeeds.
      // A failed setting change can then roll back without erasing the live cache.
      const next = { ...this.data, devices, history, historyDays };
      writeFileSync(this.file + '.tmp', JSON.stringify(next), 'utf8');
      renameSync(this.file + '.tmp', this.file);
      this.data = next;
      this.historyDays = historyDays;
      this.dirty = false;
      this.lastSave = Date.now();
      this.totals.saves++;
      return true;
    } catch (error) {
      this.state.error = '无法保存新版设置或历史，详情见诊断日志。';
      this.log(String(error));
      return false;
    } finally {
      this.totals.saveMs += performance.now() - start;
    }
  }
  publish() {
    this.updateDevices();
    this.changed();
    this.evaluate();
  }
  private updateDevices() {
    this.state.devices = [...this.rows.values()].map(({ device }) => ({
      ...device, recognizedName: device.name, name: this.state.deviceSettings[device.id]?.alias || device.name,
    }));
  }

  private compatibilityDraft = new CompatibilityDraft();
  private diagnosticDevices = new Map<string, { display: DiagnosticDevice; target?: string; nativeId?: string }>();
  private diagnosticDeadline = 0;
  private diagnosticEpoch = 0;
  private diagnosticScan = 0;

  async listDiagnosticDevices(): Promise<DiagnosticDevice[]> {
    let result: unknown;
    const epoch = this.diagnosticEpoch;
    const scan = ++this.diagnosticScan;
    this.diagnosticDevices.clear();
    if (this.state.collector !== 'ready') return [];
    try { result = await this.collector.request('diagnostic_devices'); } catch { return []; }
    if (this.closed || epoch !== this.diagnosticEpoch || scan !== this.diagnosticScan || !Array.isArray(result)) return [];
    const next = new Map<string, { display: DiagnosticDevice; target?: string; nativeId?: string }>();
    for (const candidate of result.slice(0, 256)) {
      if (!candidate || typeof candidate !== 'object') continue;
      const model = diagnosticText(candidate.model, diagnosticModelLimit);
      const label = diagnosticText(candidate.label, diagnosticModelLimit);
      if (!model && !label) continue;
      const key = randomUUID();
      const nativeId = typeof candidate.id === 'string' && candidate.id.length <= 600 ? candidate.id : undefined;
      const display = { key, model, label, firmwareReadable: !!nativeId && candidate.firmwareReadable === true, firmware: diagnosticText(candidate.firmware, diagnosticFirmwareLimit),
        connection: diagnosticConnection(candidate.connection), connected: candidate.connected === true };
      next.set(key, { display, nativeId, target: diagnosticTag(candidate.target) });
    }
    this.diagnosticDevices = next;
    this.diagnosticDeadline = performance.now() + 10 * 60_000;
    return [...next.values()].map(item => item.display);
  }

  async readDiagnosticFirmware(key: string): Promise<NonNullable<Extract<CommandResult, { ok: true }>['diagnosticFirmware']>> {
    const chosen = performance.now() < this.diagnosticDeadline ? this.diagnosticDevices.get(key) : undefined;
    if (!chosen?.nativeId || !chosen.display.firmwareReadable || this.state.collector !== 'ready') return { status: 'unavailable' };
    if (chosen.display.firmware) return { status: 'ready', firmware: chosen.display.firmware };
    try {
      const result = await this.collector.request<{ status?: unknown; firmware?: unknown }>('diagnostic_firmware', { id: chosen.nativeId });
      if (this.diagnosticDevices.get(key) !== chosen) return { status: 'unavailable' };
      const firmware = diagnosticText(result?.firmware, diagnosticFirmwareLimit);
      if (result?.status === 'ready' && firmware) {
        chosen.display.firmware = firmware;
        return { status: 'ready', firmware };
      }
      if (result?.status === 'pending' || result?.status === 'busy') return { status: result.status };
    } catch { /* Manual entry remains available. */ }
    return { status: 'unavailable' };
  }

  private diagnosticSubject(selection: CompatibilitySelection): DiagnosticSubject {
    const chosen = selection.kind === 'device' && performance.now() < this.diagnosticDeadline
      ? this.diagnosticDevices.get(selection.deviceKey) : undefined;
    if (selection.kind === 'device' && !chosen) throw new Error('设备列表已失效，请重新扫描。');
    const model = chosen?.display.model ?? diagnosticText(selection.model, diagnosticModelLimit);
    if (!model) throw new Error('请选择设备型号或填写未识别的型号。');
    const firmware = chosen?.display.firmware ?? diagnosticText(selection.firmware, diagnosticFirmwareLimit);
    return {
      model, modelSource: chosen?.display.model ? 'device' : 'manual',
      firmware, firmwareSource: chosen?.display.firmware ? 'device' : firmware ? 'manual' : undefined,
      connection: chosen?.display.connection, connected: chosen?.display.connected, target: chosen?.target,
    };
  }

  async previewCompatibility(selection: CompatibilitySelection, version: string) {
    const subject = this.diagnosticSubject(selection);
    const epoch = this.diagnosticEpoch;
    let report: unknown;
    let capture: 'live' | 'inventory' = 'live';
    try {
      if (this.state.collector !== 'ready') throw new Error('Collector unavailable');
      report = await this.collector.request('compatibility');
    } catch {
      capture = 'inventory';
      try {
        const inventory = await executeFile(this.executable, ['--inventory'], { windowsHide: true, timeout: 10_000,
          maxBuffer: 768 * 1024, encoding: 'utf8' });
        report = JSON.parse(inventory.stdout);
      } catch {
        // A typed model is still useful when the collector cannot inventory the host.
        report = { windowsQuerySucceeded: false };
      }
    }
    if (this.closed) throw new Error('应用正在退出');
    return this.compatibilityDraft.create(compatibilityJson({
      appVersion: version, windowsRelease: release(), capture, collectorStatus: this.state.collector, context: '',
    }, report, new Date(), capture === 'live' && epoch === this.diagnosticEpoch ? subject : { ...subject, target: undefined }));
  }

  exportCompatibility(token: string) {
    this.compatibilityDraft.save(token, json => {
      const target = join(this.directory, 'compatibility-report.json');
      const temporary = join(this.directory, 'compatibility-report-' + token + '.tmp');
      try {
        writeFileSync(temporary, json, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        renameSync(temporary, target);
      } finally {
        try { rmSync(temporary, { force: true }); } catch { /* target is either unchanged or fully replaced */ }
      }
    });
  }

  async discover() {
    const devices = await this.collector.request<Found[]>('discover');
    for (const item of devices) {
      const row = this.rows.get(item.id)?.device;
      if (row && item.automatic) {
        item.reading = row.status === 'current' ? row.reading : null;
        item.connected = !['offline', 'no_radio_reply', 'stale'].includes(row.status);
      }
    }
    this.found = new Map(devices.map(item => [item.id, item]));
    return devices;
  }
  add(id: string) {
    const input = this.found.get(id);
    if (!input?.connected || (!input.reading && input.batteryCandidate !== 'ble_bas') || input.automatic || this.data.watched.some(item => item.id === id)) {
      throw new Error('该设备无法添加或已经在监测中');
    }
    if (this.data.watched.length >= 128) throw new Error('监测设备已达到上限');
    const { name, connection } = input;
    const previousWatched = this.data.watched;
    this.data.watched = [...previousWatched, { id, name, connection }];
    if (!this.persist()) {
      this.data.watched = previousWatched;
      throw new Error('无法保存设备列表，请重试');
    }
    void this.poll(true);
  }
  remove(id: string) {
    if (!this.data.watched.some(item => item.id === id)) throw new Error('这个设备由系统自动监测');
    const previousWatched = this.data.watched;
    const previousRows = this.rows;
    const previousAlert = this.data.alerts[id];
    this.data.watched = previousWatched.filter(item => item.id !== id);
    this.rows = new Map(previousRows);
    this.rows.delete(id);
    delete this.data.alerts[id];
    if (!this.persist()) {
      this.data.watched = previousWatched;
      this.rows = previousRows;
      if (previousAlert) this.data.alerts[id] = previousAlert;
      throw new Error('无法保存设备列表，请重试');
    }
    this.publish();
  }
  saveAlertAction(id: string, next: AlertState) {
    const previous = this.state.alerts[id];
    this.state.alerts[id] = next;
    if (!this.persist()) {
      if (previous) this.state.alerts[id] = previous;
      else delete this.state.alerts[id];
      throw new Error('无法保存提醒设置，请重试');
    }
  }
  async resourceSample() {
    // Skip native sampling when it would compete with device IO.
    const native = this.state.collector === 'ready' && !this.suspended && this.collector.pid && !this.collector.pendingCount
      ? await this.collector.request<NativeMetrics>('metrics').catch(() => null) : null;
    return { native, counters: { ...this.totals }, rows: this.rows.size,
      historyPoints: Object.values(this.data.history).reduce((sum, points) => sum + points.length, 0),
      pending: this.collector.pendingCount };
  }
  get doubleClickMs() { return this.collector.doubleClickMs; }
  async scene() { return this.collector.request<Scene>('scene'); }
  async tone() { return (await this.collector.request<{ played: boolean }>('tone')).played; }

  async refresh(): Promise<void> {
    if (this.closed || this.suspended) return Promise.resolve();
    if (this.polling || this.nativePending) {
      this.invalidateDiagnosticSession();
      // Interrupt the old IPC, and replace its generation in this same turn.
      // The next request waits for old process exit before touching a device.
      if (this.collector.pid) this.state.collector = 'retrying';
      void this.collector.restart();
    }
    const scan = this.poll(true);
    const generation = this.pollGeneration;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const finished = await Promise.race([
        scan.then(() => true),
        new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), manualRefreshWait); }),
      ]);
      if (!finished && generation === this.pollGeneration && !this.closed && !this.suspended) {
        this.state.refreshing = false;
        this.changed();
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private invalidateDiagnosticSession() {
    this.nativePending = false;
    this.diagnosticEpoch++;
    this.diagnosticDevices.clear();
  }

  poll(force = false): Promise<void> {
    if (this.closed || this.suspended) return Promise.resolve();
    if (force) {
      ++this.pollGeneration;
      this.state.refreshing = true;
      this.changed();
    }
    if (this.polling) return this.polling;
    clearTimeout(this.timer);
    this.polling = this.runPolls(force).finally(() => {
      this.polling = undefined;
      if (this.state.refreshing) {
        this.state.refreshing = false;
        if (!this.closed && !this.suspended) this.changed();
      }
      if (this.closed || this.suspended) return;
      this.schedule(this.state.collector === 'ready' ? 1500 : 5000, false);
    });
    return this.polling;
  }

  private async runPolls(force: boolean) {
    // Replace the desired scan, not the native process. At most one IPC
    // discovery is in flight, and only the latest manual generation is applied.
    while (!this.closed && !this.suspended) {
      const generation = this.pollGeneration;
      const start = performance.now();
      try {
        await this.collect(force, generation);
      } finally {
        const ms = performance.now() - start;
        this.totals.polls++;
        this.totals.pollMs += ms;
        this.totals.maxPollMs = Math.max(this.totals.maxPollMs, ms);
      }
      if (generation === this.pollGeneration) return;
      force = true;
    }
  }

  private schedule(delay: number, full: boolean) {
    if (this.closed || this.suspended) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.poll(full); }, delay);
  }
  private async collect(force: boolean, generation: number) {
    const sequence = ++this.pollSequence;
    const now = Date.now();
    const due = Object.fromEntries([...this.rows].map(([id, row]) => [id, now >= row.due]));
    try {
      const reply = await this.collector.request<Observation[] | { rows: Observation[]; workPending: boolean;
        discoveryPending?: boolean; discoveryAbsent?: unknown } | { restartRequired: true }>('poll', {
        due, force, generation, sequence, watched: this.data.watched, voltage: this.state.settings.voltage,
      });
      if (this.closed || this.suspended || generation !== this.pollGeneration) return;
      if (!Array.isArray(reply) && 'restartRequired' in reply && reply.restartRequired) {
        this.log('采集请求超过 5 分钟，正在重新启动采集程序。');
        this.invalidateDiagnosticSession();
        this.state.collector = 'retrying';
        const deadline = Date.now() - maxCurrentReadingAge;
        for (const row of this.rows.values()) {
          if (row.device.status === 'current' && row.device.lastRead !== null && row.device.lastRead < deadline) {
            this.setSample(row, { status: 'stale', reading: null, reason: '等待新读数' }, Date.now());
          }
        }
        this.publish();
        await this.collector.restart();
        if (generation === this.pollGeneration) ++this.pollGeneration;
        return;
      }
      const results = Array.isArray(reply) ? reply : 'rows' in reply ? reply.rows : undefined;
      if (!Array.isArray(results)) throw new Error('采集程序返回了无效的设备列表');
      const discoveryPending = !Array.isArray(reply) && 'discoveryPending' in reply && reply.discoveryPending === true;
      const absence = !Array.isArray(reply) && 'discoveryAbsent' in reply ? reply.discoveryAbsent : undefined;
      const confirmedAbsent = new Set(Array.isArray(absence) ? absence.filter((id): id is string => typeof id === 'string') : []);
      this.nativePending = !Array.isArray(reply) && 'workPending' in reply
        ? reply.workPending === true : results.some(observation => observation.pending === true);
      const becameReady = this.state.collector !== 'ready';
      const hasReadyInventory = !discoveryPending || results.length > 0 || this.state.collector === 'ready';
      if (hasReadyInventory) {
        this.readyOnce = true;
        this.state.collector = 'ready';
        if (this.state.error === collectorStartupError) this.state.error = undefined;
      }
      let changed = becameReady && hasReadyInventory;
      const sampledAt = Date.now();
      const seen = new Set<string>();
      const watched = new Set(this.data.watched.map(item => item.id));
      for (const observation of results) {
        if (!observation.automatic && observation.art === 'unknown' && !watched.has(observation.id)) continue;
        seen.add(observation.id);
        // Async native results keep the sequence of the scan that started
        // the read, so a pre-edit or manual sample cannot unlock alerts.
        const regular = observation.sampleSequence !== undefined
          ? observation.sampleSequence ?? undefined : !force ? sequence : undefined;
        changed = this.accept(observation, sampledAt, watched.has(observation.id) && !observation.automatic, regular) || changed;
      }
      for (const [id, row] of this.rows) {
        if (seen.has(id)) continue;
        if (discoveryPending && !confirmedAbsent.has(id)) {
          changed = this.expire(row, sampledAt) || changed;
          continue;
        }
        if (row.device.status === 'offline') continue;
        this.setSample(row, { status: 'offline', reading: null, reason: '设备未连接' }, sampledAt);
        changed = true;
      }
      if (this.dirty && (force || sampledAt - this.lastSave >= 60_000)) this.persist();
      if (changed) this.publish();
    } catch (error) {
      if (this.closed || this.suspended || generation !== this.pollGeneration) return;
      this.totals.failedPolls++;
      if (this.state.collector !== 'occupied') {
        this.state.collector = 'retrying';
        this.log(String(error));
        if (this.readyOnce) this.markStale();
      }
      this.publish();
    }
  }

  private accept(observation: Observation, now: number, watched: boolean, regularPoll?: number) {
    const { id, name, connection, art, sample, voltage } = observation;
    let changed = false;
    for (const alias of new Set(observation.aliases)) changed = this.merge(alias, id) || changed;
    let row = this.rows.get(id);
    if (!row) {
      row = { device: { id, name, connection, art: art === 'unknown' ? classify(name) : art, status: 'stale',
        reason: '等待新读数', reading: null, lastRead: null, watched }, due: 0, failures: 0 };
      this.rows.set(id, row);
      changed = this.dirty = true;
    }
    if (row.device.watched !== watched) {
      row.device.watched = watched;
      changed = this.dirty = true;
    }
    if (row.device.name !== name) {
      row.device.name = name;
      changed = this.dirty = true;
    }
    if (sample && (sample.status !== 'offline' || row.device.status !== 'offline' || row.device.connection !== connection)) {
      row.device.connection = connection;
      const editedAt = this.thresholdEdits.get(id);
      if (editedAt !== undefined && regularPoll !== undefined && regularPoll > editedAt &&
          sample.status === 'current' && validReading(sample.reading)) this.thresholdEdits.delete(id);
      this.setSample(row, sample, now);
      changed = true;
    }
    if (!sample) changed = this.expire(row, now) || changed;
    if (voltage && this.state.settings.voltage) {
      this.appendLog('dualsense-voltage.tsv', [new Date(now).toISOString(), id, connection,
        sample?.reading?.raw ?? '', sample?.reading?.power ?? '', voltage.millivolts ?? '', voltage.status, voltage.detail].join('\t'));
    }
    return changed;
  }
  private expire(row: Row, now: number) {
    if (row.device.status !== 'current' || row.device.lastRead === null ||
        now - row.device.lastRead <= maxCurrentReadingAge) return false;
    this.setSample(row, { status: 'stale', reading: null, reason: '等待新读数' }, now);
    return true;
  }
  private merge(from: string, to: string) {
    if (from === to || !(this.rows.has(from) || this.data.history[from] || this.historyDays[from] || this.state.deviceSettings[from] || this.state.alerts[from])) return false;
    this.dirty = true;
    const old = this.rows.get(from);
    if (old && !this.rows.has(to)) this.rows.set(to, { ...old, device: { ...old.device, id: to } });
    this.rows.delete(from);
    const thresholdEdit = this.thresholdEdits.get(from);
    if (thresholdEdit !== undefined) {
      this.thresholdEdits.set(to, Math.max(thresholdEdit, this.thresholdEdits.get(to) ?? -1));
      this.thresholdEdits.delete(from);
      this.thresholdAlertRevisions.set(to, this.thresholdAlertRevision(to) + 1);
    }
    this.thresholdAlertRevisions.delete(from);
    if (this.data.history[from]) {
      const points = [...(this.data.history[to] ?? []), ...this.data.history[from]];
      this.data.history[to] = [...new Map(points.map(point => [point.time, point])).values()].sort((a, b) => a.time - b.time);
      delete this.data.history[from];
    }
    if (this.historyDays[from]) {
      const days = new Map((this.historyDays[to] ?? []).map(bucket => [bucket.day, bucket]));
      for (const incoming of this.historyDays[from]) {
        const existing = days.get(incoming.day);
        if (!existing) { days.set(incoming.day, incoming); continue; }
        const a = incoming.lowest.reading;
        const b = existing.lowest.reading;
        if (a.low < b.low || (a.low === b.low && a.high < b.high)) existing.lowest = incoming.lowest;
        // The same physical device can have overlapping samples under both IDs.
        existing.count = Math.max(existing.count, incoming.count);
        existing.lastCharge = Math.max(existing.lastCharge ?? 0, incoming.lastCharge ?? 0) || undefined;
      }
      this.historyDays[to] = [...days.values()].sort((a, b) => a.day - b.day);
      delete this.historyDays[from];
    }
    if (this.state.deviceSettings[from]) {
      this.state.deviceSettings[to] = { ...this.state.deviceSettings[from], ...this.state.deviceSettings[to] };
      delete this.state.deviceSettings[from];
    }
    if (this.state.alerts[from]) {
      const a = this.state.alerts[from];
      const b = this.state.alerts[to] ?? {};
      this.state.alerts[to] = {
        lowAt: Math.max(a.lowAt ?? 0, b.lowAt ?? 0) || undefined,
        criticalAt: Math.max(a.criticalAt ?? 0, b.criticalAt ?? 0) || undefined,
        snoozeUntil: Math.max(a.snoozeUntil ?? 0, b.snoozeUntil ?? 0) || undefined,
        lastNoticeAt: Math.max(a.lastNoticeAt ?? 0, b.lastNoticeAt ?? 0) || undefined,
        ignored: a.ignored === 'critical' ? a.ignored : b.ignored ?? a.ignored,
      };
      delete this.state.alerts[from];
    }
    return true;
  }
  private setSample(row: Row, sample: Sample, time: number) {
    if (sample.status === 'current' && !validReading(sample.reading)) {
      sample = { status: 'unavailable', reason: '未取得有效电量读数', reading: null };
    }
    this.dirty = true;
    const device = row.device;
    row.failures = sample.reading || sample.status === 'basic_bluetooth' ? 0 : row.failures + 1;
    const unresponsive = sample.status === 'timeout' && row.failures >= 2 && isDualSenseBluetooth(device);
    const status = unresponsive ? 'unreachable' : sample.status;
    if (device.status !== status) this.log(device.name + ' ' + sample.reason);
    device.status = status;
    device.reason = unresponsive ? '手柄未回应 · 请唤醒后重试' : sample.reason;
    if (sample.reading && sample.status === 'current') {
      device.reading = sample.reading;
      device.lastRead = time;
    }
    const rules = this.state.deviceSettings[device.id];
    row.due = time + delayFor(device, this.state.settings, rules, row.failures);
    const point = { time, reading: sample.status === 'current' ? sample.reading : null };
    const points = this.data.history[device.id] ?? [];
    this.data.history[device.id] = recordHistory(points, point);
    device.historyUpdatedAt = time;
    const tail = points.at(-1);
    const replaced = tail?.time === time ? tail : tail && time < tail.time ? points.find(item => item.time === time) : undefined;
    if (replaced) replaceHistoryDay(this.historyDays[device.id] ??= [], points, replaced, point);
    else if (point.reading) accumulateHistoryDay(this.historyDays[device.id] ??= [], point);
    if (this.thresholdEdits.has(device.id)) return;
    const old = this.state.alerts[device.id] ?? {};
    const next = observeRecovery(device, this.state.settings, rules, old);
    if ((old.lowAt || old.criticalAt || old.ignored || old.snoozeUntil) && next.recovery === 2) {
      this.state.alerts[device.id] = next;
      this.persist();
    } else this.state.alerts[device.id] = next;
  }
  private markStale() {
    const now = Date.now();
    for (const row of this.rows.values()) {
      if (row.device.status !== 'offline' && row.device.status !== 'stale') {
        this.setSample(row, { status: 'stale', reading: null, reason: '等待新读数' }, now);
      }
    }
  }
  saveDeviceSettings(id: string, next: DeviceSettings): boolean {
    const previous = this.state.deviceSettings[id];
    const previousAlert = this.state.alerts[id];
    const thresholdChanged = previous?.low !== next.low;
    this.state.deviceSettings[id] = next;
    if (thresholdChanged && previousAlert?.recovery) this.state.alerts[id] = { ...previousAlert, recovery: 0 };
    if (!this.persist()) {
      if (previous) this.state.deviceSettings[id] = previous;
      else delete this.state.deviceSettings[id];
      if (previousAlert) this.state.alerts[id] = previousAlert;
      return false;
    }
    if (thresholdChanged) {
      this.thresholdEdits.set(id, this.pollSequence);
      this.thresholdAlertRevisions.set(id, this.thresholdAlertRevision(id) + 1);
    }
    return true;
  }
  thresholdAlertRevision(id: string) { return this.thresholdAlertRevisions.get(id) ?? 0; }
  eligible(device: Device): Severity | undefined {
    const now = Date.now();
    if (this.thresholdEdits.has(device.id) || device.lastRead === null ||
        device.lastRead > now || now - device.lastRead > maxCurrentReadingAge) return;
    return eligible(device, this.state.settings, this.state.deviceSettings[device.id],
      this.state.alerts[device.id] ?? {}, this.state.mutedUntil, now);
  }
}
