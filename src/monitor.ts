import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Collector } from './collector';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { release } from 'node:os';

import { canProbeBluetooth, classify, defaults, isMuteDuration, type AlertState, type Device, type DeviceSettings, type Found, type HistoryPoint, type Sample, type Severity, type Settings, type Snapshot } from './model';
import { day, delayFor, eligible, observeRecovery, recordHistory } from './monitor-rules';

const executeFile = promisify(execFile);

type StateFile = {
  version: 1; settings: Settings; deviceSettings: Record<string, DeviceSettings>; alerts: Record<string, AlertState>;
  watched: Pick<Found, 'id' | 'name' | 'connection'>[]; devices: Device[]; history: Record<string, HistoryPoint[]>;
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
  private rows = new Map<string, Row>();
  private found = new Map<string, Found>();
  private timer?: NodeJS.Timeout;
  private polling?: Promise<void>;
  private forceNext = false;
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
        renameSync(this.file, backup);
        loadError = '本地存档无法读取，已备份并恢复默认设置。';
      }
    }
    // Retain the supported settings and drop fields from older versions.
    initial.settings = Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => {
      const saved = initial.settings[key as keyof Settings];
      return [key, typeof saved === typeof fallback ? saved : fallback];
    })) as Settings;
    if (!isMuteDuration(initial.settings.muteMinutes)) initial.settings.muteMinutes = defaults.muteMinutes;
    initial.deviceSettings = Object.assign(Object.create(null), initial.deviceSettings);
    initial.alerts = Object.assign(Object.create(null), initial.alerts);
    initial.history = Object.assign(Object.create(null), initial.history);
    this.data = initial;
    for (const device of initial.devices) {
      this.rows.set(device.id, { device: { ...device, status: 'stale', reason: '等待新读数' }, due: 0, failures: 0 });
    }
    this.state = { devices: [], settings: initial.settings, deviceSettings: initial.deviceSettings, collector: 'starting',
      refreshing: false, mutedUntil: 0, alerts: initial.alerts, demo: false, error: loadError };
    this.updateDevices();
    this.collector = new Collector(executable, (occupied, error) => {
      if (this.closed) return;
      this.totals.childExits++;
      this.state.collector = occupied ? 'occupied' : 'retrying';
      this.state.error = error ? '采集程序启动失败，详情见诊断日志。' : undefined;
      if (error) this.log(error);
      if (this.readyOnce) this.markStale();
      this.publish();
      this.schedule(5000, true);
    });
  }

  start() { void this.poll(true); }
  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.collector.close();
    this.markStale();
    this.persist();
  }
  async closeForMaintenance() {
    if (!this.persist()) return '无法保存设置或电量历史。';
    this.closed = true;
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
    return (this.data.history[id] ?? []).filter(point => point.time >= Date.now() - day);
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
      const cutoff = Date.now() - day;
      for (const [id, items] of Object.entries(this.data.history)) {
        this.data.history[id] = items.filter(item => item.time >= cutoff);
      }
      this.data.devices = [...this.rows.values()].map(({ device }) => device);
      writeFileSync(this.file + '.tmp', JSON.stringify(this.data), 'utf8');
      renameSync(this.file + '.tmp', this.file);
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
      ...device, name: this.state.deviceSettings[device.id]?.alias || device.name,
    }));
  }

  private exporting?: Promise<string>;

  exportCompatibility(context: string, version: string) {
    this.exporting ??= this.writeCompatibility(context, version).finally(() => { this.exporting = undefined; });
    return this.exporting;
  }

  private async writeCompatibility(context: string, version: string) {
    let report: Record<string, unknown>;
    let capture: 'live' | 'inventory' = 'live';
    try {
      if (this.state.collector !== 'ready') throw new Error('Collector unavailable');
      report = await this.collector.request<Record<string, unknown>>('compatibility');
    } catch {
      capture = 'inventory';
      const inventory = await executeFile(this.executable, ['--inventory'], { windowsHide: true, timeout: 10_000,
        maxBuffer: 768 * 1024, encoding: 'utf8' });
      report = JSON.parse(inventory.stdout);
    }
    const file = join(this.directory, 'compatibility-report.json');
    const metadata = { generatedAt: new Date().toISOString(), appVersion: version, windowsRelease: release(),
      capture, collectorStatus: this.state.collector, context };
    writeFileSync(file + '.tmp', JSON.stringify({ ...metadata, ...report }, null, 2), 'utf8');
    renameSync(file + '.tmp', file);
    return file;
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
    if (!input?.reading || !input.connected || input.automatic || this.data.watched.some(item => item.id === id)) {
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
      let changed = becameReady;
      const sampledAt = Date.now();
      const seen = new Set<string>();
      const watched = new Set(this.data.watched.map(item => item.id));
      for (const observation of results) {
        if (!observation.automatic && observation.art === 'unknown' && !watched.has(observation.id)) continue;
        seen.add(observation.id);
        changed = this.accept(observation, sampledAt, watched.has(observation.id)) || changed;
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

  private accept(observation: Observation, now: number, watched: boolean) {
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
    if (from === to || !(this.rows.has(from) || this.data.history[from] || this.state.deviceSettings[from] || this.state.alerts[from])) return false;
    this.dirty = true;
    const old = this.rows.get(from);
    if (old && !this.rows.has(to)) this.rows.set(to, { ...old, device: { ...old.device, id: to } });
    this.rows.delete(from);
    if (this.data.history[from]) {
      const points = [...(this.data.history[to] ?? []), ...this.data.history[from]];
      this.data.history[to] = [...new Map(points.map(point => [point.time, point])).values()].sort((a, b) => a.time - b.time);
      delete this.data.history[from];
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
    this.data.history[device.id] = recordHistory(this.data.history[device.id] ?? [],
      { time, reading: sample.status === 'current' ? sample.reading : null });
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
  eligible(device: Device): Severity | undefined {
    return eligible(device, this.state.settings, this.state.deviceSettings[device.id],
      this.state.alerts[device.id] ?? {}, this.state.mutedUntil, Date.now());
  }
}
