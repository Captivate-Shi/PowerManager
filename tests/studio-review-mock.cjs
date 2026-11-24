// Mock only: no OS collector, filesystem access, telemetry, or external requests.
function installMock(options = {}) {
  const value = (low, high = low, power = 'discharging') => ({ low, high, raw: low, power, source: 'hid' });
  const now = Date.now();
  const state = {
    devices: [
      { id: 'mouse', art: 'mouse', name: '无线鼠标', reading: value(92), connection: '无线 2.4G' },
      { id: 'dual', art: 'dualsense', name: 'DualSense', reading: value(10, 20), connection: '蓝牙' },
      { id: 'keyboard', art: 'keyboard', name: '机械键盘', reading: value(67), connection: '无线 2.4G' },
      { id: 'headset', art: 'headset', name: '头戴耳机', reading: value(9), connection: '蓝牙' },
      { id: 'xbox', art: 'xbox', name: 'Xbox 无线手柄', reading: value(46), connection: '蓝牙' },
    ].map(item => ({ ...item, status: 'current', lastRead: now, watched: true, reason: '设备读数正常' })),
    settings: { low: 20, critical: 10, repeat: 0, snooze: 30, fullscreenSound: true, soundOnly: false, voltage: false,
      startup: false, zoom: 100, trayZoom: 100, desktopToasts: true, muteMinutes: 60 },
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
  const toastQuery = new URLSearchParams(location.search);
  const toastSeverity = toastQuery.get('kind') === 'low' ? 'low' : 'critical';
  const toastDevice = state.devices.find(d => d.id === toastQuery.get('device')) ?? state.devices[3];
  const shownToastDevice = {
    ...toastDevice,
    ...(toastQuery.get('long') === '1' ? { name: '用于长设备名称验证的无线头戴式蓝牙游戏耳机名称' } : {}),
    ...(options.portable ? { reading: toastSeverity === 'low' ? value(12, 18) : value(9) } : {}),
  };
  const commands = [];
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  let notify;
  let completeRefresh;
  const publish = () => notify?.(structuredClone(state));
  window.studioReview = {
    commands,
    ready: () => { state.collector = 'ready'; publish(); },
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
      state.devices[1].reading = value(20, 30);
      state.devices[1].lastRead = Date.now();
      range.push({ time: state.devices[1].lastRead, reading: state.devices[1].reading });
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
        await delay(1100);
        return { ok: true, history: structuredClone(histories[command.id] || []) };
      }
      if (command.type === 'refresh') {
        state.refreshing = true;
        publish();
        if (options.portable) setTimeout(() => window.studioReview.finishRefresh(), 1250);
        return new Promise(done => { completeRefresh = done; });
      }
      if (command.type === 'settings') Object.assign(state.settings, command.patch);
      if (command.type === 'toggleAlertSetting') state.settings[command.key] = !state.settings[command.key];
      if (command.type === 'snooze') (state.alerts[command.id] ??= {}).snoozeUntil = now + 30 * 60000;
      if (['settings', 'toggleAlertSetting', 'snooze'].includes(command.type)) publish();
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
  if (options.portable) setTimeout(() => window.studioReview.ready(), 1000);
}

module.exports = { installMock };
