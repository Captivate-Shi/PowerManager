import { app, BrowserWindow, ipcMain, Menu, nativeImage, powerMonitor, screen, shell, Tray, type BrowserWindowConstructorOptions, type IpcMainInvokeEvent } from 'electron';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { demoDiscovery, demoHistory, demoSnapshot, previewDevice } from './demo';
import { classify, isMuteDuration, muteDurationLabel, percent, severity, type Command, type CommandResult, type Device, type DeviceSettings, type Settings,
  type Severity, type Snapshot, type Surface, type Toast } from './model';
import { Monitor } from './monitor';
import { startMetrics } from './metrics';

const isDemo = process.argv.includes('--demo');
const local = process.env.LOCALAPPDATA || app.getPath('appData');
const dataDir = join(local, isDemo ? 'PowerManager-H5-Demo' : 'PowerManager-H5');
mkdirSync(dataDir, { recursive: true });
app.setPath('userData', dataDir);
app.setAppUserModelId('PowerManager.H5');
const documentPath = join(__dirname, 'ui', 'index.html');
const safePage = pathToFileURL(documentPath).href;
const directory = join(__dirname, 'ui', 'assets');
const iconPath = join(directory, 'yudian-app.ico');
const trayIconPath = join(directory, 'yudian-tray.ico');
const lowIconPath = join(directory, 'yudian-tray-low.ico');
const executable = app.isPackaged ? join(process.resourcesPath, 'collector.exe') : join(__dirname, '..', '.native', 'collector.exe');
let snapshot: Snapshot;
let monitor: Monitor | undefined;
let tray: Tray;
const windows: Partial<Record<Surface, BrowserWindow>> = {};
let toast: Toast | null = null;
let toastTimer: NodeJS.Timeout | undefined;
let checking = false;
let stopped = false;
let locked = false;
let suspended = false;
let pinned = false;
let pendingPage: string | undefined;
let toastMonitorId: number | undefined;
let trayClickTimer: NodeJS.Timeout | undefined;
let trayOpening = false;
let lastTrayDoubleClick = 0;
let lastTrayClick = 0;
let balloonDeviceId: string | undefined;
let trayLow: boolean | undefined;
let stopMetrics: (() => void) | undefined;
const offered: { id: string; level: Severity; until: number }[] = [];
const maintenanceId = process.argv.find(value => /^--maintenance-quit=[0-9a-f]{32}$/.test(value))?.split('=')[1];
const gate = join(dirname(process.execPath), '.installer-maintenance');
const gateTime = app.isPackaged ? statSync(gate, { throwIfNoEntry: false })?.mtimeMs : undefined;
let maintenanceExit = false;
let maintenancePending = false;

function maintenanceReply(id: string, result: { display?: 'foreground' | 'tray' | 'closed'; error?: string }) {
  writeFileSync(join(dataDir, '.maintenance-' + id + '.json'), JSON.stringify(result), { flag: 'wx' });
}
async function quitForMaintenance(id: string) {
  if (maintenancePending) return;
  maintenancePending = true;
  const main = windows.main;
  const display = main?.isVisible() && !main.isMinimized() ? 'foreground' : 'tray';
  stopped = true;
  try {
    const error = await monitor?.closeForMaintenance();
    if (error) {
      maintenanceReply(id, { error });
      return;
    }
    maintenanceReply(id, { display });
    maintenanceExit = true;
    app.quit();
  } catch (error) {
    console.error(error);
  } finally {
    maintenancePending = false;
    if (!maintenanceExit) stopped = false;
  }
}

if (!maintenanceId && gateTime !== undefined && Date.now() - gateTime < 300_000) {
  app.exit(0);
} else if (!app.requestSingleInstanceLock({ maintenanceId, executable: process.execPath })) {
  app.quit();
} else if (maintenanceId) {
  try { maintenanceReply(maintenanceId, { display: 'closed' }); app.exit(0); }
  catch (error) { console.error(error); app.exit(1); }
} else {
  app.on('second-instance', (_event, _argv, _cwd, data) => {
    if (object(data) && typeof data.maintenanceId === 'string' && /^[0-9a-f]{32}$/.test(data.maintenanceId)) {
      const id = data.maintenanceId;
      if (typeof data.executable === 'string' && data.executable.toLowerCase() === process.execPath.toLowerCase()) {
        void app.whenReady().then(() => quitForMaintenance(id));
      }
      return;
    }
    if (app.isReady() && !stopped) openMain();
  });
  app.whenReady().then(init).catch(error => { console.error(error); app.exit(1); });
  app.on('before-quit', () => {
    stopped = true;
    stopMetrics?.();
    if (!maintenanceExit) monitor?.close();
  });
  app.on('window-all-closed', () => {});
}

function makeWindow(surface: Surface, options: BrowserWindowConstructorOptions) {
  const window = new BrowserWindow({
    show: false, icon: iconPath, ...options,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true,
      nodeIntegration: false, backgroundThrottling: surface === 'main',
      partition: surface === 'main' ? undefined : 'power-' + surface },
  });
  windows[surface] = window;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.on('closed', () => { if (windows[surface] === window) delete windows[surface]; });
  window.webContents.on('did-finish-load', () => applyZoom(surface));
  void window.loadFile(documentPath, { query: { surface } }).catch(error => {
    if (!window.isDestroyed()) { monitor?.log(String(error)); window.destroy(); }
  });
  return window;
}
function applyZoom(surface: Surface) {
  const window = windows[surface];
  if (!window || window.isDestroyed()) return;
  const requested = surface === 'tray' ? snapshot.settings.trayZoom : surface === 'main' ? snapshot.settings.zoom : 100;
  window.webContents.setZoomFactor((requested ?? 100) / 100);
}

function openMain(id?: string) {
  pendingPage = id;
  let window = windows.main;
  if (!window) {
    const work = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    window = makeWindow('main', {
      width: Math.min(1240, work.width), height: Math.min(820, work.height), minWidth: 720, minHeight: 520,
      title: '余电', titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#15181e', symbolColor: '#f0f3f7', height: 48 },
      backgroundColor: '#15181e', autoHideMenuBar: true,
    });
    window.on('close', event => {
      if (stopped) return;
      event.preventDefault();
      window?.hide();
    });
    window.once('ready-to-show', () => {
      if (pendingPage) window?.webContents.send('navigate', pendingPage);
      window?.show();
    });
  } else if (!window.webContents.isLoadingMainFrame()) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    if (id) window.webContents.send('navigate', id);
  }
}
function placeTray() {
  const window = windows.tray;
  if (!window) return;
  const anchor = tray.getBounds();
  const located = anchor.width > 0 && anchor.height > 0;
  const point = located ? { x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height / 2 } : screen.getCursorScreenPoint();
  const work = screen.getDisplayNearestPoint(point).workArea;
  const size = { width: Math.min(420, work.width), height: Math.min(565, work.height - 10) };
  const center = located ? point.x : work.x + work.width - size.width / 2 - 12;
  const top = located && point.y < work.y + work.height / 2
    ? Math.max(work.y + 4, anchor.y + anchor.height + 4)
    : Math.min(work.y + work.height - 4, located ? anchor.y - 4 : work.y + work.height - 4) - size.height;
  window.setBounds({ ...size, x: Math.round(Math.max(work.x, Math.min(center - size.width / 2, work.x + work.width - size.width))),
    y: Math.round(Math.max(work.y, Math.min(top, work.y + work.height - size.height))) });
}
function showTray() {
  const existing = windows.tray;
  if (existing?.isVisible() || trayOpening) return;
  if (existing) {
    if (!pinned) placeTray();
    existing.show();
    return;
  }
  trayOpening = true;
  const window = makeWindow('tray', {
    width: 420, height: 565, minWidth: 320, minHeight: 365, frame: false, resizable: pinned, skipTaskbar: true,
    alwaysOnTop: true, backgroundColor: '#1b2029',
  });
  window.on('blur', () => setTimeout(() => {
    if (pinned || window.isDestroyed() || window.isFocused() || Date.now() - lastTrayClick < 240) return;
    const icon = tray.getBounds();
    const cursor = screen.getCursorScreenPoint();
    const onIcon = icon.width > 0 && cursor.x >= icon.x && cursor.x <= icon.x + icon.width &&
      cursor.y >= icon.y && cursor.y <= icon.y + icon.height;
    if (!onIcon && !trayClickTimer) window.hide();
  }, 100));
  window.once('closed', () => { trayOpening = false; });
  window.once('ready-to-show', () => {
    if (!trayOpening) return;
    trayOpening = false;
    placeTray();
    window.show();
  });
}

function traySingleClick() {
  lastTrayClick = Date.now();
  if (Date.now() - lastTrayDoubleClick < 180) return;
  clearTimeout(trayClickTimer);
  trayClickTimer = undefined;
  if (windows.tray?.isVisible()) return;
  // Delay opening until Windows has had a chance to emit its double-click event.
  trayClickTimer = setTimeout(() => {
    trayClickTimer = undefined;
    showTray();
  }, (monitor?.doubleClickMs ?? 500) + 15);
}
function trayDoubleClick() {
  lastTrayDoubleClick = Date.now();
  clearTimeout(trayClickTimer);
  trayClickTimer = undefined;
  trayOpening = false;
  if (!pinned) windows.tray?.hide();
  openMain();
}
function placeToast() {
  const window = windows.toast;
  if (!window) return;
  const display = screen.getAllDisplays().find(item => item.id === toastMonitorId) ??
    screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const work = display.workArea;
  const width = Math.min(460, work.width - 16);
  const height = 146;
  window.setBounds({ width, height, x: work.x + work.width - width - 12, y: work.y + work.height - height - 8 });
}
function closeToast() {
  clearTimeout(toastTimer);
  toast = null;
  windows.toast?.destroy();
}
function showPreview(severity: Severity, device = snapshot.devices.find(item => item.art === 'dualsense') ?? snapshot.devices[0]) {
  return showToast({ severity, device: previewDevice(severity, device), preview: true, detailId: device?.id });
}
async function showToast(value: Toast, point?: { x: number; y: number } | null, canShow?: () => boolean): Promise<boolean> {
  if (windows.toast) closeToast();
  toast = value;
  const origin = BrowserWindow.getFocusedWindow() ?? windows.main;
  toastMonitorId = point ? screen.getDisplayNearestPoint(screen.screenToDipPoint(point)).id :
    origin?.isVisible() ? screen.getDisplayMatching(origin.getBounds()).id : undefined;
  const window = makeWindow('toast', {
    width: 460, height: 146, frame: false, transparent: true, skipTaskbar: true, hasShadow: false,
    resizable: false, focusable: false, alwaysOnTop: true,
  });
  return new Promise(resolve => {
    const deadline = setTimeout(() => {
      if (!window.isDestroyed()) window.destroy();
      resolve(false);
    }, 3000);
    window.once('closed', () => {
      clearTimeout(deadline);
      if (toast === value) toast = null;
      resolve(false);
    });
    window.once('ready-to-show', () => {
      clearTimeout(deadline);
      if (canShow && !canShow()) { window.destroy(); resolve(false); return; }
      placeToast();
      window.setAlwaysOnTop(true, 'pop-up-menu');
      window.showInactive();
      window.moveTop();
      toastTimer = setTimeout(closeToast, 12000);
      resolve(true);
    });
  });
}

function broadcast() {
  for (const window of Object.values(windows)) {
    if (!window.isDestroyed() && !window.webContents.isLoadingMainFrame()) window.webContents.send('state', snapshot);
  }
  updateTray();
}
function updateTray() {
  if (!tray) return;
  const low = snapshot.devices.some(device => severity(device, snapshot.settings, snapshot.deviceSettings[device.id]));
  if (trayLow === low) return;
  trayLow = low;
  tray.setImage(nativeImage.createFromPath(low ? lowIconPath : trayIconPath));
  tray.setToolTip(low ? '余电 · 有设备需要充电' : '余电');
}
function refreshTrayMenu() {
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开主界面', click: () => openMain() },
    { label: '托盘面板', click: showTray },
    { label: '测试右下角提醒', click: () => { void showPreview('low'); } },
    { label: '立即刷新', click: () => { void monitor?.poll(true); } },
    { label: snapshot.mutedUntil > Date.now() ? '恢复提醒' : '静音 ' + muteDurationLabel(snapshot.settings.muteMinutes), click: toggleMute },
    { label: '打开诊断目录', click: () => { void shell.openPath(dataDir); } },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]));
}
function toggleMute() {
  const now = Date.now();
  snapshot.mutedUntil = snapshot.mutedUntil > now ? 0 : now + snapshot.settings.muteMinutes * 60_000;
  if (snapshot.mutedUntil && !toast?.preview) closeToast();
  refreshTrayMenu();
  broadcast();
  queueAlerts();
}
function queueAlerts() {
  if (isDemo || locked || suspended || !monitor || stopped || snapshot.collector !== 'ready') return;
  const now = Date.now();
  const eligible = new Map<string, Severity>();
  for (const device of snapshot.devices) {
    const level = monitor.eligible(device);
    if (level) eligible.set(device.id, level);
  }
  for (let index = offered.length - 1; index >= 0; index--) {
    const entry = offered[index];
    if (entry.until <= now || eligible.get(entry.id) !== entry.level) offered.splice(index, 1);
    else eligible.delete(entry.id);
  }
  for (const [id, level] of eligible) offered.push({ id, level, until: now + 45000 });
  void drainAlerts();
}
async function drainAlerts() {
  if (checking || !monitor || locked || suspended || stopped || !offered.length || windows.toast) return;
  checking = true;
  try {
    offered.sort((a, b) => Number(b.level === 'critical') - Number(a.level === 'critical'));
    const item = offered.shift()!;
    const owner = monitor;
    const revision = owner.thresholdAlertRevision(item.id);
    const currentDevice = () => snapshot.devices.find(row => row.id === item.id);
    const valid = () => {
      const current = currentDevice();
      return monitor === owner && snapshot.collector === 'ready' && !locked && !suspended && !stopped && item.until >= Date.now() &&
        owner.thresholdAlertRevision(item.id) === revision && !!current && owner.eligible(current) === item.level;
    };
    if (!valid()) return;
    const scene = await owner.scene();
    const device = currentDevice();
    if (!device || !valid() || scene.mode === 'quiet') return;
    if (item.level === 'low' && offered.some(entry => entry.level === 'critical' && entry.until > Date.now())) {
      if (!offered.some(entry => entry.id === item.id)) offered.push(item);
      return;
    }
    let delivered = false;
    if (scene.mode === 'fullscreen') {
      if (snapshot.settings.fullscreenSound && scene.allowed !== false) delivered = await owner.tone();
    } else if (snapshot.settings.soundOnly && scene.allowed !== false) {
      delivered = await owner.tone();
    } else if (snapshot.settings.desktopToasts && (scene.allowed === true || (scene.allowed === null && scene.shellAccepts))) {
      if (windows.toast) return;
      delivered = await showToast({ device, severity: item.level, preview: false, detailId: device.id }, scene.point, valid);
    }
    if (!delivered && valid() && scene.mode === 'desktop' && !snapshot.settings.soundOnly && scene.allowed !== false) {
      balloonDeviceId = device.id;
      tray.displayBalloon({
        title: item.level === 'critical' ? '外设电量告急' : '外设电量较低',
        content: device.name + ' · 剩余 ' + percent(device.reading),
        iconType: 'warning', noSound: true, respectQuietTime: true,
      });
      delivered = true;
    }
    if (delivered) {
      const state = snapshot.alerts[item.id] ?? {};
      const time = Date.now();
      snapshot.alerts[item.id] = { ...state, lowAt: time, lastNoticeAt: time,
        criticalAt: item.level === 'critical' ? time : state.criticalAt };
      owner.log(device.name + ' ' + item.level + ' 提醒已提交');
      owner.persist();
      broadcast();
    }
  } catch (error) {
    monitor.log(String(error));
  } finally { checking = false; }
}
function canAccess(event: IpcMainInvokeEvent): Surface {
  const frame = event.senderFrame;
  const [surface] = Object.entries(windows).find(([, window]) => window.webContents === event.sender) ?? [];
  if (!surface || !frame || frame !== event.sender.mainFrame || frame.url.split('?')[0] !== safePage) {
    throw new Error('Untrusted renderer');
  }
  return surface as Surface;
}
const actions: Record<Surface, string[]> = {
  main: ['refresh', 'discover', 'diagnostics', 'compatibility', 'mute', 'open', 'history', 'add', 'remove', 'bluetooth',
    'snooze', 'ignore', 'settings', 'toggleAlertSetting', 'deviceSettings', 'preview'],
  tray: ['mute', 'pin', 'refresh', 'open', 'closeSurface'],
  toast: ['open', 'closeSurface'],
};
function validId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 4096;
}
function ranged(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function saveSettings(patch: unknown) {
  if (!object(patch)) throw new Error('设置格式有误');
  const next = { ...snapshot.settings };
  for (const [key, value] of Object.entries(patch)) {
    switch (key) {
      case 'low': case 'critical':
        if (!ranged(value, 1, 95)) throw new Error('阈值需在 1%–95% 之间');
        next[key] = value;
        break;
      case 'repeat': case 'snooze':
        if (!ranged(value, key === 'repeat' ? 0 : 5, 180)) throw new Error('时间间隔无效');
        next[key] = value;
        break;
      case 'muteMinutes':
        if (!isMuteDuration(value)) throw new Error('全局静音时长无效');
        next.muteMinutes = value;
        break;
      case 'zoom': case 'trayZoom':
        if (!ranged(value, 75, 150)) throw new Error('缩放比例需在 75%–150% 之间');
        next[key] = value;
        break;
      case 'fullscreenSound': case 'soundOnly': case 'voltage': case 'startup': case 'desktopToasts':
        if (typeof value !== 'boolean') throw new Error('设置格式有误');
        next[key] = value;
        break;
      default: throw new Error('未知设置');
    }
  }
  if (next.critical >= next.low) throw new Error('紧急阈值必须低于低电量阈值');
  if (!isDemo && next.startup !== snapshot.settings.startup) {
    if (!app.isPackaged) throw new Error('请使用打包版设置随 Windows 登录启动');
    app.setLoginItemSettings({ openAtLogin: next.startup, args: ['--background'] });
    if (app.getLoginItemSettings({ args: ['--background'] }).openAtLogin !== next.startup) throw new Error('无法更新 Windows 登录启动项');
  }
  const muteDurationChanged = next.muteMinutes !== snapshot.settings.muteMinutes;
  Object.assign(snapshot.settings, next);
  applyZoom('main');
  applyZoom('tray');
  monitor?.persist();
  if (muteDurationChanged) refreshTrayMenu();
  broadcast();
  queueAlerts();
}
function saveDeviceSettings(id: string, patch: unknown) {
  if (!object(patch)) throw new Error('设备设置格式有误');
  const next: DeviceSettings = { ...snapshot.deviceSettings[id] };
  for (const [key, value] of Object.entries(patch)) {
    switch (key) {
      case 'alias':
        if (typeof value !== 'string' || value.length > 80) throw new Error('名称最多 80 个字符');
        next.alias = value.trim() || undefined;
        break;
      case 'low':
        if (value === null || value === undefined) { delete next.low; break; }
        if (!ranged(value, 1, 50)) throw new Error('设备阈值需在 1%–50% 之间');
        next.low = value;
        break;
      case 'muted':
        if (typeof value !== 'boolean') throw new Error('设备设置格式有误');
        next.muted = value;
        break;
      default: throw new Error('未知设备设置');
    }
  }
  if (monitor && !monitor.saveDeviceSettings(id, next)) throw new Error('无法保存设备设置，请重试');
  if (next.muted && toast?.device.id === id && !toast.preview) closeToast();
  if (monitor) monitor.publish();
  else {
    snapshot.deviceSettings[id] = next;
    const device = snapshot.devices.find(item => item.id === id)!;
    device.name = next.alias || demoSnapshot().devices.find(item => item.id === id)?.name || device.name;
    broadcast();
  }
}
async function run(surface: Surface, command: Command): Promise<CommandResult> {
  if (stopped) throw new Error('应用正在退出');
  if (!object(command) || !actions[surface].includes(command.type)) throw new Error('操作不可用');
  if ('id' in command && command.id !== undefined && !validId(command.id)) throw new Error('设备标识无效');
  const device = 'id' in command ? snapshot.devices.find(item => item.id === command.id) : undefined;
  switch (command.type) {
    case 'refresh': await monitor?.poll(true); break;
    case 'compatibility': {
      if (!monitor) throw new Error('请在实机模式生成兼容性报告');
      if (typeof command.context !== 'string' || command.context.length > 240) throw new Error('反馈说明最多 240 字');
      await monitor.exportCompatibility(command.context.trim(), app.getVersion());
      return { ok: true, message: '兼容性报告已保存，可在诊断目录查看' };
    }
    case 'diagnostics': {
      const error = await shell.openPath(dataDir);
      if (error) throw new Error('无法打开诊断目录');
      break;
    }
    case 'closeSurface': if (surface === 'toast') closeToast(); else windows.tray?.hide(); break;
    case 'pin':
      pinned = !pinned;
      windows.tray?.setResizable(pinned);
      if (!pinned) placeTray();
      return { ok: true, pinned };
    case 'mute': toggleMute(); break;
    case 'open':
      openMain(device?.id);
      if (surface === 'toast') closeToast();
      if (surface === 'tray' && !pinned) windows.tray?.hide();
      break;
    case 'history':
      if (!device) throw new Error('设备已移除');
      return { ok: true, history: monitor ? monitor.history(device.id) : demoHistory(device) };
    case 'discover': return { ok: true, found: monitor ? await monitor.discover() : demoDiscovery };
    case 'add':
      if (monitor) monitor.add(command.id);
      else {
        const candidate = demoDiscovery.find(item => item.id === command.id);
        if (!candidate?.reading || device) throw new Error('该设备无法添加或已经在监测中');
        snapshot.devices.push({ ...candidate, art: classify(candidate.name), status: 'current',
          reason: '示例读数', lastRead: Date.now(), watched: true });
        broadcast();
      }
      break;
    case 'remove':
      if (monitor) monitor.remove(command.id);
      else if (device?.watched) { snapshot.devices = snapshot.devices.filter(item => item !== device); broadcast(); }
      else throw new Error('这个设备由系统自动监测');
      break;
    case 'bluetooth':
      if (!monitor) return { ok: true, message: '示例模式 · 蓝牙电量读取成功' };
      return { ok: true, message: await monitor.bluetooth(command.id) };
    case 'deviceSettings':
      if (!device) throw new Error('设备已移除');
      saveDeviceSettings(device.id, command.patch);
      break;
    case 'settings': saveSettings(command.patch as Partial<Settings>); break;
    case 'toggleAlertSetting': {
      const { key } = command;
      if (key !== 'fullscreenSound' && key !== 'soundOnly' && key !== 'desktopToasts') throw new Error('提醒开关无效');
      saveSettings({ [key]: !snapshot.settings[key] });
      break;
    }
    case 'preview':
      if (!['low', 'critical'].includes(command.severity)) throw new Error('预览级别无效');
      if (command.id !== undefined && !device) throw new Error('设备已移除');
      if (!await showPreview(command.severity, device)) {
        throw new Error('弹窗未能显示，请关闭预览后重试');
      }
      break;
    case 'snooze':
    case 'ignore': {
      if (!device) throw new Error('设备已移除');
      const level = severity(device, snapshot.settings, snapshot.deviceSettings[device.id]);
      if (!level) throw new Error('设备当前没有低电量提醒');
      const state = snapshot.alerts[device.id] ?? {};
      if (command.type === 'ignore') snapshot.alerts[device.id] = { ...state, ignored: level, snoozeUntil: undefined };
      else snapshot.alerts[device.id] = { ...state, snoozeUntil: Date.now() + snapshot.settings.snooze * 60000, ignored: undefined };
      if (toast?.device.id === device.id && !toast.preview) closeToast();
      monitor?.persist();
      broadcast();
      break;
    }
    default: throw new Error('未知操作');
  }
  return { ok: true };
}
async function init() {
  Menu.setApplicationMenu(null);
  if (isDemo) {
    snapshot = demoSnapshot();
  } else {
    monitor = new Monitor(dataDir, executable, broadcast, queueAlerts);
    snapshot = monitor.state;
    if (app.isPackaged) snapshot.settings.startup = app.getLoginItemSettings({ args: ['--background'] }).openAtLogin;
  }
  ipcMain.handle('snapshot', event => { canAccess(event); return snapshot; });
  ipcMain.handle('initial-route', event => canAccess(event) === 'main' ? pendingPage : undefined);
  ipcMain.handle('toast', event => { if (canAccess(event) !== 'toast') return null; return toast; });
  ipcMain.handle('command', async (event, command: Command) => {
    try { return await run(canAccess(event), command); }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : '操作失败' }; }
  });
  tray = new Tray(nativeImage.createFromPath(trayIconPath));
  tray.on('click', traySingleClick);
  tray.on('double-click', trayDoubleClick);
  tray.on('balloon-click', () => openMain(balloonDeviceId));
  refreshTrayMenu();
  const reposition = () => {
    if (!pinned) placeTray();
    else if (windows.tray && !screen.getAllDisplays().some(display => {
      const panel = windows.tray!.getBounds();
      const area = display.workArea;
      return panel.x < area.x + area.width && panel.x + panel.width > area.x &&
        panel.y < area.y + area.height && panel.y + panel.height > area.y;
    })) placeTray();
    placeToast();
  };
  screen.on('display-added', reposition);
  screen.on('display-removed', reposition);
  screen.on('display-metrics-changed', reposition);
  powerMonitor.on('lock-screen', () => { locked = true; closeToast(); offered.length = 0; });
  powerMonitor.on('unlock-screen', () => { locked = false; monitor?.start(); });
  powerMonitor.on('suspend', () => { suspended = true; closeToast(); offered.length = 0; monitor?.suspend(true); });
  powerMonitor.on('resume', () => { suspended = false; monitor?.suspend(false); });
  const timer = setInterval(() => {
    if (stopped) return;
    if (snapshot.mutedUntil && snapshot.mutedUntil <= Date.now()) { snapshot.mutedUntil = 0; refreshTrayMenu(); broadcast(); }
    if (!monitor) return;
    if (toast && !toast.preview && !checking) {
      checking = true;
      void monitor.scene().then(scene => {
        if (scene.mode !== 'desktop' || scene.allowed === false) closeToast();
      }).catch(() => closeToast()).finally(() => { checking = false; });
    } else void drainAlerts();
  }, 1500);
  app.once('before-quit', () => clearInterval(timer));
  monitor?.start();
  if (monitor && process.env.POWER_MANAGER_DISABLE_METRICS !== '1') {
    stopMetrics = startMetrics(monitor, () => ({
      main: !!windows.main?.isVisible(), tray: !!windows.tray?.isVisible(), toast: !!windows.toast?.isVisible(),
    }));
  }
  const preview = process.argv.find(arg => arg.startsWith('--preview='));
  if (isDemo && preview === '--preview=tray') showTray();
  else if (isDemo && preview === '--preview=critical') void showPreview('critical');
  else if (isDemo && preview === '--preview=low') void showPreview('low');
  else if (!process.argv.includes('--background')) openMain();
}
