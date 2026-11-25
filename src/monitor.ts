import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Collector } from './collector';
import { CompatibilityDraft, compatibilityJson } from './compatibility-report';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { release } from 'node:os';

import { canProbeBluetooth, classify, defaults, historyPointEnd, isHistoryRange, isMuteDuration, limitHistoryRange, type AlertState, type Device, type DeviceSettings, type Found, type HistoryDay, type HistoryPoint, type HistoryRange, type Reading, type Sample, type Severity, type Settings, type Snapshot } from './model';
import { day, delayFor, eligible, observeRecovery, recordHistory } from './monitor-rules';
import { accumulateHistoryDay, historyStart } from './history-plot';

const executeFile = promisify(execFile);
const collectorStartupError = '采集程序启动失败，详情见诊断日志。';

function validReading(reading: Reading | null | undefined): reading is Reading {
  return !!reading && Number.isFinite(reading.low) && Number.isFinite(reading.high) && Number.isFinite(reading.raw) &&
    reading.low >= 0 && reading.high <= 100 && reading.low <= reading.high &&
    ['charging', 'discharging', 'full', 'unknown'].includes(reading.power) &&
    ['hid', 'windows', 'ble'].includes(reading.source);
}

// A local reading is only a last-known value. Never restore a live status from disk.
function cachedDevice(value: unknown): Device | null {
  if (!value || typeof value !== 'object') return null;
  const { id, name, connection, art, watched, reading, lastRead } = value as Partial<Device>;
  if (typeof id !== 'string' || !id || typeof name !== 'string' || !name.trim() ||
      typeof connection !== 'string' || typeof watched !== 'boolean') return null;
  const safeArt = art && ['mouse', 'keyboard', 'dualsense', 'xbox', 'controller', 'headset', 'earbuds', 'stylus', 'unknown'].includes(art)
    ? art : classify(name);
  const hasReading = validReading(reading) && typeof lastRead === 'number' && Number.isFinite(lastRead) && lastRead > 0;
  return { id, name, connection, art: safeArt, watched, status: 'stale', reason: '等待新读数',
    reading: hasReading ? reading : null, lastRead: hasReading ? lastRead : null };
}

type StateFile = {
  version: 1; settings: Settings; deviceSettings: Record<string, DeviceSettings>; alerts: Record<string, AlertState>;
  watched: Pick<Found, 'id' | 'name' | 'connection'>[]; devices: Device[]; history: Record<string, HistoryPoint[]>;
  historyDays?: Record<string, HistoryDay[]>;
};
type Observation = {
  id: string; name: string; connection: string; aliases: string[]; art: Device['art']; automatic?: boolean;
  sample: Sample | null; voltage: { millivolts: number | null; status: string; detail: number } | null;
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
  private forceNext = false;
  private pollSequence = 0;
  private thresholdEdits = new Map<string, number>();
  private thresholdAlertRevisions = new Map<string, number>();
  private closed = false;
  private suspended = false;
  private readyOnce = false;
  private dirty = false;
  private lastSave = 0;
  private totals = { polls: 0, failedPolls: 0, pollMs: 0, maxPollMs: 0, saves: 0, saveMs: 0, childExits: 0 };

  constructor(readonly directory: string, private executable: string, private changed: () => void, private evaluate: () => void) {
    mkdirSync(directory, { recursive: true });
    this.file = join(directory, 'monitor.json');
    let initial: StateFile = { version: 1, settings: { ...defaults }, deviceSettings: {}, alerts: {}, watched: [], devices: [], history: {} };
    let loadError: string | undefined;
    if (existsSync(this.file)) {
      try {
        const saved = JSON.parse(readFileSync(this.file, 'utf8')) as StateFile;
        if (saved.version !== 1 || !Array.isArray(saved.devices) || !Array.isArray(saved.watched) ||
            !saved.settings || !saved.deviceSettings || !saved.alerts || !saved.history) throw new Error('Invalid state');
        initial = saved;
      } catch {
        const backup = join(directory, 'monitor-corrupt-' + Date.now() + '.json');
        try {
          renameSync(this.file, backup);
          loadError = '本地存档无法读取，已备份并恢复默认设置。';
        } catch {
          loadError = '本地存档无法读取或备份，暂用默认设置。';
        }
      }
    }
    // Retain the supported settings and drop fields from older versions.
    initial.settings = Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => {
      const saved = initial.settings[key as keyof Settings];
      return [key, typeof saved === typeof fallback ? saved : fallback];
    })) as Settings;
    if (!isMuteDuration(initial.settings.muteMinutes)) initial.settings.muteMinutes = defaults.muteMinutes;
    if (!isHistoryRange(initial.settings.historyRetention)) initial.settings.historyRetention = defaults.historyRetention;
    initial.deviceSettings = Object.assign(Object.create(null), initial.deviceSettings);
    initial.alerts = Object.assign(Object.create(null), initial.alerts);
    initial.history = Object.assign(Object.create(null), initial.history);
    this.historyDays = Object.assign(Object.create(null), initial.historyDays);
    if (!initial.historyDays) {
      for (const [id, points] of Object.entries(initial.history)) {
        const days = this.historyDays[id] = [];
        for (const point of points) accumulateHistoryDay(days, point);
      }
    }
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
      this.state.collector = occupied ? 'occupied' : 'retrying';
      this.state.error = error ? collectorStartupError : this.state.error === collectorStartupError ? undefined : this.state.error;
      if (error) this.log(error);
      if (this.readyOnce) this.markStale();
      this.publish();
      this.schedule(5000, true);
    });
  }

  start() { void this.poll(true); }
  close() {
    this.closed = true;
    this.compatibilityDraft.clear();
    clearTimeout(this.timer);
    this.collector.close();
    this.markStale();
    this.persist();
  }
  async closeForMaintenance() {
    if (!this.persist()) return '无法保存设置或电量历史。';
    this.closed = true;
    this.compatibilityDraft.clear();
    clearTimeout(this.timer);
    if (!await this.collector.closeGracefully()) {
      this.collector.allowRestartAfterClose();
      this.closed = false;
      this.schedule(5000, true);
      return '等待采集程序退出超时。';
    }
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

  async previewCompatibility(context: string, version: string) {
    let report: unknown;
    let capture: 'live' | 'inventory' = 'live';
    try {
      if (this.state.collector !== 'ready') throw new Error('Collector unavailable');
      report = await this.collector.request('compatibility');
    } catch {
      capture = 'inventory';
      const inventory = await executeFile(this.executable, ['--inventory'], { windowsHide: true, timeout: 10_000,
        maxBuffer: 768 * 1024, encoding: 'utf8' });
      report = JSON.parse(inventory.stdout);
    }
    if (this.closed) throw new Error('应用正在退出');
    return this.compatibilityDraft.create(compatibilityJson({
      appVersion: version, windowsRelease: release(), capture, collectorStatus: this.state.collector, context,
    }, report));
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
        item.offerBluetooth &&= row.status === 'basic_bluetooth';
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
    this.data.watched.push({ id, name, connection });
    this.persist();
    void this.poll(true);
  }
  remove(id: string) {
    if (!this.data.watched.some(item => item.id === id)) throw new Error('这个设备由系统自动监测');
    this.data.watched = this.data.watched.filter(item => item.id !== id);
    this.rows.delete(id);
    delete this.data.alerts[id];
    this.persist();
    this.publish();
  }
  async bluetooth(id: string) {
    const row = this.rows.get(id);
    if (!row || !canProbeBluetooth(row.device)) throw new Error('请先通过蓝牙连接 DualSense');
    const result = await this.collector.request<Sample>('bluetooth', { key: id });
    if (this.rows.get(id) === row) {
      this.setSample(row, result, Date.now());
      this.publish();
    }
    return result.status === 'current' ? '已读取蓝牙电量' :
      result.status === 'offline' ? '蓝牙未连接，请唤醒手柄后重试' : result.reason;
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

  poll(force = false): Promise<void> {
    if (this.closed || this.suspended) return Promise.resolve();
    if (this.polling) {
      this.forceNext ||= force;
      return this.polling;
    }
    clearTimeout(this.timer);
    this.state.refreshing = force;
    if (force) this.changed();
    const start = performance.now();
    this.polling = this.collect(force).finally(() => {
      const ms = performance.now() - start;
      this.totals.polls++;
      this.totals.pollMs += ms;
      this.totals.maxPollMs = Math.max(this.totals.maxPollMs, ms);
      this.polling = undefined;
      this.state.refreshing = false;
      if (this.closed || this.suspended) return;
      const runFull = this.forceNext;
      this.forceNext = false;
      if (force) this.changed();
      this.schedule(this.state.collector === 'ready' ? (runFull ? 0 : 1500) : 5000, runFull || this.state.collector !== 'ready');
    });
    return this.polling;
  }
  private schedule(delay: number, full: boolean) {
    if (this.closed || this.suspended) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.poll(full); }, delay);
  }
  private async collect(force: boolean) {
    const sequence = ++this.pollSequence;
    const now = Date.now();
    const due = Object.fromEntries([...this.rows].map(([id, row]) => [id, now >= row.due]));
    try {
      const results = await this.collector.request<Observation[]>('poll', {
        due, force, watched: this.data.watched, voltage: this.state.settings.voltage,
      });
      if (this.closed || this.suspended) return;
      const becameReady = this.state.collector !== 'ready';
      this.readyOnce = true;
      this.state.collector = 'ready';
      if (this.state.error === collectorStartupError) this.state.error = undefined;
      let changed = becameReady;
      const sampledAt = Date.now();
      const seen = new Set<string>();
      const watched = new Set(this.data.watched.map(item => item.id));
      for (const observation of results) {
        if (!observation.automatic && observation.art === 'unknown' && !watched.has(observation.id)) continue;
        seen.add(observation.id);
        changed = this.accept(observation, sampledAt, watched.has(observation.id), !force ? sequence : undefined) || changed;
      }
      for (const [id, row] of this.rows) {
        if (!seen.has(id) && row.device.status !== 'offline') {
          this.setSample(row, { status: 'offline', reading: null, reason: '设备未连接' }, sampledAt);
          changed = true;
        }
      }
      if (this.dirty && (force || sampledAt - this.lastSave >= 60_000)) this.persist();
      if (changed) this.publish();
    } catch (error) {
      if (this.closed || this.suspended) return;
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
    if (row.device.name !== name) {
      row.device.name = name;
      changed = this.dirty = true;
    }
    if (sample && (sample.status !== 'offline' || row.device.status !== 'offline' || row.device.connection !== connection)) {
      row.device.connection = connection;
      const editedAt = this.thresholdEdits.get(id);
      if (editedAt !== undefined && regularPoll !== undefined && regularPoll > editedAt &&
          sample.status === 'current' && sample.reading) this.thresholdEdits.delete(id);
      this.setSample(row, sample, now);
      changed = true;
    }
    if (voltage && this.state.settings.voltage) {
      this.appendLog('dualsense-voltage.tsv', [new Date(now).toISOString(), id, connection,
        sample?.reading?.raw ?? '', sample?.reading?.power ?? '', voltage.millivolts ?? '', voltage.status, voltage.detail].join('\t'));
    }
    return changed;
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
    const unresponsive = sample.status === 'timeout' && row.failures >= 2 && canProbeBluetooth(device);
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
    if (points.at(-1)?.time !== time) accumulateHistoryDay(this.historyDays[device.id] ??= [], point);
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
    if (this.thresholdEdits.has(device.id)) return;
    return eligible(device, this.state.settings, this.state.deviceSettings[device.id],
      this.state.alerts[device.id] ?? {}, this.state.mutedUntil, Date.now());
  }
}
