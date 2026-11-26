// Mock only: no OS collector, filesystem access, telemetry, or external requests.
function installMock(options = {}) {
  const value = (low, high = low, power = 'discharging') => ({ low, high, raw: low, power, source: 'hid' });
  const now = Date.now();
  const toastQuery = new URLSearchParams(location.search);
  const scenario = options.scenario || (options.walkthrough && toastQuery.get('scenario') === 'warm' ? 'warm' : options.walkthrough ? 'cold' : 'legacy');
  const catalog = [
      { id: 'mouse', art: 'mouse', name: options.longComparisonNames ? 'Razer Viper V3 HyperSpeed' : '无线鼠标', reading: value(92), connection: '无线 2.4G' },
      { id: 'dual', art: 'dualsense', name: 'DualSense', reading: value(10, 20), connection: '蓝牙' },
      { id: 'keyboard', art: 'keyboard', name: options.longComparisonNames ? 'Razer BlackWidow V4 Low-profile TKL HyperSpeed' : '机械键盘', reading: value(67), connection: '无线 2.4G' },
      { id: 'headset', art: 'headset', name: '头戴耳机', reading: value(9), connection: '蓝牙' },
      { id: 'xbox', art: 'xbox', name: 'Xbox 无线手柄', reading: value(46), connection: '蓝牙' },
    ].map(item => ({ ...item, status: 'current', lastRead: now, watched: true, reason: '设备读数正常' }));
  const copies = () => structuredClone(catalog);
  const ranges = ['day', 'week', 'month', 'year'];
  const state = {
    devices: scenario === 'cold' && !toastQuery.has('detail') ? []
      : scenario === 'warm' ? [{ ...catalog[1], status: 'stale', lastRead: now - 3_600_000, reason: '等待读数' }] : copies(),
    settings: { low: 20, critical: 10, repeat: 0, snooze: 30, fullscreenSound: true, desktopSound: false, voltage: false,
      startup: false, zoom: 100, trayZoom: 100, desktopToasts: true, muteMinutes: 60, historyRetention: options.historyRetention || 'year' },
    deviceSettings: {}, alerts: {}, collector: 'starting', refreshing: false, mutedUntil: 0, demo: true,
  };
  const stamp = step => now - (1440 - step) * 60_000;
  const seq = Array.from({ length: 1441 }, (_, i) => i);
  const long = i => now - 86400000 - (6 * 24 - i) * 3600000;
  const week = Array.from({ length: 145 }, (_, i) => i);
  const ease = (i, start, end, from, to) => {
    const u = Math.min(1, Math.max(0, (i - start) / (end - start)));
    return from + (to - from) * u * u * (3 - 2 * u);
  };
  const mouse = [...week.map(i => ({ time: long(i), reading: value(58 + i % 32) })), ...seq.flatMap(i => {
    if (i > 605 && i < 806) return [];
    if (i === 605) return [{ time: stamp(i), reading: null }];
    // Piecewise monotone, rounded raw samples with real dwell intervals. This is not an SVG fixture.
    const pct = i <= 352 ? ease(i, 28, 352, 92, 62)
      : i < 605 ? ease(i, 391, 595, 62, 30)
      : i < 899 ? 28
      : i < 1144 ? ease(i, 899, 1144, 28, 98)
      : ease(i, 1193, 1376, 98, 92);
    return [{ time: stamp(i), reading: value(Math.round(pct), Math.round(pct), i >= 899 && i < 1144 ? 'charging' : 'discharging') }];
  })];
  const range = [...week.map(i => ({ time: long(i), reading: value(30 + i % 20, 40 + i % 20) })), ...seq.map(i => {
    const floor = i < 174 ? 54 : i < 391 ? 47 : i < 625 ? 40 : i < 990 ? 30 : i < 1210 ? 20 : 10;
    return { time: stamp(i), reading: value(floor, floor + 10) };
  })];
  const keyboard = seq.map(i => ({ time: stamp(i), reading: value(Math.round(86 - i * 19 / 1440)) }));
  const headset = seq.map(i => ({ time: stamp(i), reading: value(Math.round(70 - i * 61 / 1440)) }));
  const xbox = seq.map(i => ({ time: stamp(i), reading: value(Math.round(ease(i, 0, 1440, 64, 46))) }));
  const histories = { mouse, dual: range, keyboard, headset, xbox };
  const toastSeverity = toastQuery.get('kind') === 'low' ? 'low' : 'critical';
  const toastDevice = catalog.find(d => d.id === toastQuery.get('device')) ?? catalog[3];
  const shownToastDevice = {
    ...toastDevice,
    ...(toastQuery.get('long') === '1' ? { name: '用于长设备名称验证的无线头戴式蓝牙游戏耳机名称' } : {}),
    ...(options.walkthrough || (scenario !== 'legacy' && toastQuery.has('kind'))
      ? { reading: value(toastSeverity === 'low' ? 15 : 5) }
      : options.portable ? { reading: toastSeverity === 'low' ? value(12, 18) : value(9) } : {}),
  };
  const commands = [];
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  let notify;
  let completeRefresh;
  let inspectionTimer;
  const inspectedAlerts = [];
  const publish = () => notify?.(structuredClone(state));
  const sample = (id, low, high) => {
    const device = state.devices.find(item => item.id === id);
    if (!device) return;
    device.reading = value(low, high);
    device.lastRead = Date.now();
    histories[id]?.push({ time: device.lastRead, reading: device.reading });
    return device;
  };
  const runInspection = (id, low, high) => {
    if (state.refreshing) throw Error('Fixture inspection cannot be conflated with manual refresh');
    const device = sample(id, low, high);
    if (!device) throw Error('Unknown fixture device: ' + id);
    const critical = device.reading.high <= state.settings.critical;
    const lowBand = device.reading.high <= Math.max(state.deviceSettings[id]?.low ?? state.settings.low, state.settings.critical);
    const result = { id, reading: device.reading, severity: critical ? 'critical' : lowBand ? 'low' : null };
    if (result.severity) state.alerts[id] = { ...(state.alerts[id] || {}), [critical ? 'criticalAt' : 'lowAt']: device.lastRead,
      lastNoticeAt: device.lastRead };
    inspectedAlerts.push(result);
    publish();
  };
  const scheduleDemoInspection = () => {
    clearTimeout(inspectionTimer);
    const tick = () => {
      if (!Number.isFinite(state.deviceSettings.dual?.low)) return;
      if (state.refreshing) { inspectionTimer = setTimeout(tick, 700); return; }
      runInspection('dual', 22, 27);
    };
    inspectionTimer = setTimeout(tick, 6500);
  };
  window.studioReview = {
    commands,
    inspections: inspectedAlerts,
    ready: () => { if (!state.devices.length) state.devices = copies(); state.collector = 'ready'; publish(); },
    detect: id => {
      const device = copies().find(item => item.id === id);
      if (!device) throw Error('Unknown fixture device: ' + id);
      state.devices = [device];
      state.collector = 'ready';
      publish();
    },
    revealAll: () => {
      const live = new Map(state.devices.map(item => [item.id, item]));
      state.devices = copies().map(item => live.get(item.id)?.status === 'current' ? live.get(item.id) : item);
      state.collector = 'ready';
      publish();
    },
    runInspection,
    readAs: (id, percent) => {
      const device = state.devices.find(item => item.id === id);
      if (!device) throw Error('Unknown fixture device: ' + id);
      device.reading = percent === null ? null : value(percent);
      device.lastRead = Date.now();
      publish();
    },
    finishRefresh: () => {
      if (!completeRefresh) throw Error('Refresh was not requested');
      state.refreshing = false;
      // Manual re-read refreshes display/history but does not deliver an alert.
      sample('dual', 20, 30);
      publish();
      completeRefresh({ ok: true });
      completeRefresh = undefined;
    },
  };
  window.powerManager = {
    snapshot: async () => structuredClone(state),
    toast: async () => ({ device: shownToastDevice, severity: toastSeverity, preview: true, detailId: shownToastDevice.id }),
    onSnapshot: fn => { notify = fn; return () => { if (notify === fn) notify = undefined; }; },
    onNavigate: fn => {
      const device = toastQuery.get('detail');
      if (options.portable && device && state.devices.some(item => item.id === device)) setTimeout(() => fn(device), 100);
      return () => {};
    },
    command: async command => {
      commands.push(command);
      if (command.type === 'history') {
        if (ranges.indexOf(command.range || 'day') > ranges.indexOf(state.settings.historyRetention)) return { ok:false, error:'查看范围超过记录保留上限' };
        await delay(options.historyDelay || 1100);
        const history = structuredClone(histories[command.id] || []);
        if (!command.range || command.range === 'day') return { ok: true, history };
        const buckets = new Map();
        for (const point of history) {
          if (!point.reading) continue;
          const day = new Date(point.time).setHours(0, 0, 0, 0);
          const bucket = buckets.get(day) ?? { day, lowest: point, count: 0 };
          bucket.count++;
          if (point.reading.low < bucket.lowest.reading.low) bucket.lowest = point;
          if (point.reading.power === 'charging') bucket.lastCharge = point.time;
          buckets.set(day, bucket);
        }
        return { ok: true, historyDays: [...buckets.values()] };
      }
      if (command.type === 'refresh') {
        state.refreshing = true;
        publish();
        if (options.portable) setTimeout(() => window.studioReview.finishRefresh(), 1250);
        return new Promise(done => { completeRefresh = done; });
      }
      if (command.type === 'settings') {
        const limit = command.patch.historyRetention;
        if (limit && ranges.indexOf(limit) < ranges.indexOf(state.settings.historyRetention)) {
          if (!command.confirmHistoryShorten) return { ok:false, error:'缩短保留期限需要确认清理旧记录' };
          const boundary = new Date(now);
          boundary.setHours(0, 0, 0, 0);
          boundary.setDate(boundary.getDate() - ({day:1, week:7, month:30, year:365}[limit] - 1));
          // Keep raw points for the last 24 hours even when the calendar-day summary rolls over.
          const cutoff = Math.min(boundary.getTime(), now - 86_400_000);
          for (const id of Object.keys(histories)) histories[id] = histories[id].filter(point => point.time >= cutoff);
        }
        Object.assign(state.settings, command.patch);
      }
      if (command.type === 'deviceSettings') {
        const next = { ...(state.deviceSettings[command.id] || {}), ...command.patch };
        state.deviceSettings[command.id] = next;
        const device = state.devices.find(item => item.id === command.id);
        if (device && 'alias' in command.patch) {
          device.recognizedName ??= device.name;
          device.name = next.alias?.trim() || device.recognizedName;
        }
        if (options.portable && options.walkthrough && scenario !== 'legacy' && command.id === 'dual' && 'low' in command.patch) {
          scheduleDemoInspection();
        }
      }
      if (command.type === 'toggleAlertSetting') state.settings[command.key] = !state.settings[command.key];
      if (command.type === 'snooze') (state.alerts[command.id] ??= {}).snoozeUntil = now + 30 * 60000;
      if (['settings', 'deviceSettings', 'toggleAlertSetting', 'snooze'].includes(command.type)) publish();
      if (options.portable && command.type === 'preview') {
        const url = new URL(location.href);
        url.search = new URLSearchParams({ surface: 'toast', kind: command.severity, device: command.id || 'dual' });
        location.href = url.href;
      }
      if (options.portable && toastQuery.get('surface') === 'toast' && ['open', 'closeSurface'].includes(command.type)) {
        const url = new URL(location.href);
        url.search = command.type === 'open' ? new URLSearchParams({ detail: command.id ?? 'dual' }) : '';
        location.href = url.href;
      }
      if (options.portable && command.type === 'discover') return { ok: true, found: [] };
      return { ok: true };
    },
  };
  if (options.portable) {
    if (scenario === 'cold' && !toastQuery.has('detail')) {
      setTimeout(() => window.studioReview.detect('xbox'), 1050);
      setTimeout(() => window.studioReview.revealAll(), 2050);
    } else if (scenario === 'warm') {
      setTimeout(() => window.studioReview.revealAll(), 1150);
    } else setTimeout(() => window.studioReview.ready(), 1000);
  }
}

module.exports = { installMock };
