// Main entry integration test with the Electron boundary substituted, never a real tray/HID.
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { Module } = require('node:module');
const { test } = require('node:test');

test('real main-process entry serializes exclusive surfaces and preserves IPC', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const tick = ms => t.mock.timers.tick(ms);
  const dir = mkdtempSync(join(tmpdir(), 'power-hidden-entry-'));
  const originalProfile = process.env.LOCALAPPDATA;
  const events = [];
  const windows = [];
  const handles = new Map();
  let tray;
  let resolvePending;
  const geometry = { x: 78, y: 91, width: 1160, height: 745 };

  class Contents extends EventEmitter {
    setWindowOpenHandler() {}
    send(channel, value) { events.push([channel, value]); }
  }
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = new Contents();
      windows.push(this);
      assert.equal(windows.filter(win => !win.destroyed).length, 1, 'only one simulated interactive BrowserWindow can exist');
    }
    async loadFile(path, { query }) {
      this.surface = query.surface;
      this.webContents.mainFrame = { url: pathToFileURL(path).href + '?surface=' + query.surface };
      events.push(['created', this.surface]);
    }
    show() { this.visible = true; this.emit('show'); }
    hide() { if (!this.visible) return; this.visible = false; this.emit('hide'); }
    destroy() { this.hide(); this.destroyed = true; events.push(['destroyed', this.surface]); this.emit('closed'); }
    close() {
      let prevented = false;
      this.emit('close', { preventDefault() { prevented = true; } });
      if (!prevented) this.destroy();
    }
    isVisible() { return !!this.visible; }
    isDestroyed() { return !!this.destroyed; }
    isMinimized() { return false; }
    isMaximized() { return !!this.maximized; }
    maximize() { this.maximized = true; }
    focus() {}
    getNormalBounds() { return geometry; }
    setBounds() {}
    setResizable() {}
  }
  class Tray extends EventEmitter {
    constructor() { super(); tray = this; }
    getBounds() { return { x: 0, y: 0, width: 0, height: 0 }; }
    setContextMenu(menu) { this.menu = menu; }
    setImage() {}
    setToolTip() {}
  }
  const app = new EventEmitter();
  Object.assign(app, { getPath: () => dir, setPath() {}, setAppUserModelId() {}, requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(), isReady: () => true, quit() { app.emit('before-quit'); } });
  const screen = new EventEmitter();
  Object.assign(screen, { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 2000, height: 1200 } }),
    getDisplayNearestPoint: () => screen.getDisplayMatching(), getCursorScreenPoint: () => ({ x: 0, y: 0 }) });
  const fake = { app, powerMonitor: new EventEmitter(), screen, BrowserWindow: Window, Tray,
    ipcMain: { handle: (name, fn) => handles.set(name, fn) },
    nativeImage: { createFromPath() {} }, Menu: { buildFromTemplate: args => args, setApplicationMenu() {} },
    shell: { openPath: () => new Promise(resolve => { resolvePending = resolve; }) } };
  const originalLoader = Module._load;
  const latest = () => windows.find(win => !win.destroyed);
  const authentic = win => ({ sender: win.webContents, senderFrame: win.webContents.mainFrame });
  const command = (win, cmd) => handles.get('command')(authentic(win), cmd);
  const openPanelMenu = () => tray.menu.find(item => item.label === '托盘面板').click();
  const entry = resolve(process.env.POWER_MAIN_BUILD || 'dist/main.cjs');
  try {
    process.env.LOCALAPPDATA = dir;
    process.argv.push('--demo');
    try {
      Module._load = function (name, ...args) { return name === 'electron' ? fake : originalLoader.call(this, name, ...args); };
      require(entry);
    } finally { Module._load = originalLoader; process.argv.pop(); }
    await new Promise(resolve => setImmediate(resolve));
    const main = latest();
    main.emit('ready-to-show');
    main.maximized = true;

    tray.emit('click');
    tick(550);
    openPanelMenu();
    assert.equal(latest(), main);
    assert.equal(main.isVisible(), true);
    assert.equal(windows.length, 1, 'normal tray triggers never hide a shown main');

    const pending = command(main, { type: 'diagnostics' });
    await handles.get('remember-main-view')(authentic(main), { page: 'history', featured: 's', mode: 'list' });
    main.close();
    tray.emit('click');
    tick(20_000);
    assert.equal(latest(), main, 'the other surface waits for authenticated IPC');
    assert.equal(main.isVisible(), false);
    assert.equal(windows.length, 1);
    resolvePending('');
    assert.deepEqual(await pending, { ok: true });
    assert.equal(latest(), main, 'the IPC handler returns before the source window retires');
    tick(1);
    const panel = latest();
    assert.equal(panel.surface, 'tray');
    assert.equal(main.destroyed, true);
    panel.emit('ready-to-show');
    assert.equal(panel.isVisible(), true);
    assert.deepEqual(await command(panel, { type: 'pin' }), { ok: true, pinned: true });
    await command(panel, { type: 'open' });
    assert.equal(panel.isVisible(), false);
    assert.equal(latest(), panel);
    tick(1);
    const reopened = latest();
    assert.equal(reopened.surface, 'main');
    assert.equal(panel.destroyed, true, 'opening the main window also releases a pinned tray');
    assert.deepEqual(reopened.options, { ...reopened.options, ...geometry });
    reopened.emit('ready-to-show');
    assert.equal(reopened.isMaximized(), true);
    assert.equal(await handles.get('main-view')(authentic(reopened)).page, 'history');

    reopened.close();
    tray.emit('click');
    app.emit('second-instance', {}, [], '');
    tick(516);
    assert.equal(latest(), reopened);
    assert.equal(reopened.isVisible(), true, 'recheck the visible main after deferred tray click');

    reopened.close();
    tick(24_999);
    assert.equal(latest(), reopened);
    tick(1);
    assert.equal(latest(), undefined);
    assert.deepEqual(events.filter(([key]) => key === 'created'), [['created', 'main'], ['created','tray'], ['created','main']]);
  } finally {
    Module._load = originalLoader;
    app.emit('before-quit');
    delete require.cache[entry];
    if (originalProfile === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = originalProfile;
    rmSync(dir, { force: true, recursive: true });
  }
});
