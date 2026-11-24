const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { once } = require('node:events');
const { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { _electron, expect } = require('@playwright/test');

const root = join(__dirname, '..');
const output = process.env.POWER_MANAGER_QA_DIR || join(root, 'qa');
const profiles = join(output, '.profiles');
mkdirSync(profiles, { recursive: true });
const version = require('../package.json').version;
const packageRoot = join(root, 'out', version, 'PowerManager-H5-win32-x64');
const pack = process.argv.includes('--packaged');
const real = process.argv.includes('--real');
const executablePath = pack ? join(packageRoot, 'PowerManager-H5.exe') : require('electron');

async function launch(profile, ...flags) {
  const local = join(profiles, profile);
  mkdirSync(local, { recursive: true });
  return _electron.launch({
    cwd: root, executablePath, args: [...(pack ? [] : [root]), ...flags],
    env: { ...process.env, LOCALAPPDATA: local },
  });
}
const screenshot = (window, name) => window.screenshot({ path: join(output, name + '.png'), animations: 'disabled' });
function till(window, title) {
  return window.getByRole('heading', { name: title, exact: true, level: 1 }).waitFor();
}
async function resize(app, width, height) {
  return app.evaluate(({ BrowserWindow }, size) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setSize(size.width, size.height);
    window.center();
  }, { width, height });
}

async function emitTray(app, eventName) {
  const handled = await app.evaluate(async ({ Tray }, event) => {
    const { Session } = process.getBuiltinModule('node:inspector');
    const session = new Session();
    session.connect();
    const post = (method, params) => new Promise((resolve, reject) => {
      session.post(method, params, (error, result) => error ? reject(error) : resolve(result));
    });
    globalThis.__powerManagerTrayPrototype = Tray.prototype;
    try {
      const prototype = await post('Runtime.evaluate', { expression: 'globalThis.__powerManagerTrayPrototype' });
      const collection = await post('Runtime.queryObjects', { prototypeObjectId: prototype.result.objectId });
      const emitted = await post('Runtime.callFunctionOn', {
        objectId: collection.objects.objectId,
        functionDeclaration: 'function (event) { const tray = Array.from(this).find(item => item.listenerCount(event)); return !!tray && tray.emit(event); }',
        arguments: [{ value: event }],
        returnByValue: true,
      });
      return emitted.result.value;
    } finally {
      delete globalThis.__powerManagerTrayPrototype;
      session.disconnect();
    }
  }, eventName);
  assert.equal(handled, true, 'Electron tray event must reach the app');
}
async function verifyDemo() {
  const app = await launch('demo', '--demo', '--force-device-scale-factor=1');
  let desktopResult;
  try {
    const main = await app.firstWindow();
    const failures = [];
    main.on('pageerror', error => failures.push(String(error)));
    await till(main, '我的桌面');
    await resize(app, 1600, 1000);
    await expect(main.getByText('5 台在线 · 2 台未连接')).toBeVisible();
    await main.getByRole('button', { name: /^无线鼠标/ }).hover();
    await screenshot(main, '01-overview-1600');
    await main.getByRole('button', { name: '设备', exact: true }).click();
    await till(main, '我的设备');
    await expect(main.getByRole('table')).toBeVisible();
    await screenshot(main, '02-devices-1600');
    await main.getByRole('button', { name: 'DualSense 手柄', exact: true }).dblclick();
    await till(main, 'DualSense 手柄');
    await expect(main.getByRole('group', { name: 'DualSense 手柄近 24 小时电量曲线' })).toBeVisible();
    await expect(main.getByText('阶梯区间表示设备上报的电量范围')).toBeVisible();
    await main.getByRole('button', { name: '读取蓝牙电量', exact: true }).click();
    await main.getByRole('button', { name: '确认读取蓝牙电量' }).click();
    await main.getByRole('dialog').waitFor({ state: 'hidden' });
    await main.evaluate(() => window.scrollTo(0, 0));
    await main.mouse.move(5, 5);
    await screenshot(main, '12-device-detail');
    await main.keyboard.press('Escape');
    await till(main, '我的设备');
    const detailSource = main.getByRole('button', { name: 'DualSense 手柄', exact: true });
    await expect(detailSource).toBeFocused();
    await detailSource.press('Enter');
    await till(main, 'DualSense 手柄');
    await main.getByRole('button', { name: '调整提醒' }).press('Enter');
    await expect(main.getByRole('spinbutton', { name: '设备低电量阈值' })).toBeVisible();
    await main.keyboard.press('Escape');
    await expect(detailSource).toBeFocused();
    await main.getByRole('searchbox', { name: '搜索设备' }).or(main.getByRole('textbox', { name: '搜索设备' })).fill('蓝牙');
    assert.equal(await main.getByRole('button', { name: 'DualSense 手柄', exact: true }).count(), 1);
    await main.getByRole('searchbox', { name: '搜索设备' }).clear();
    await main.getByRole('button', { name: '编辑设备名称' }).click();
    await main.getByRole('textbox', { name: '设备名称' }).fill('测试手柄');
    await main.getByRole('button', { name: '保存名称' }).click();
    await main.getByRole('heading', { name: '测试手柄', exact: true }).waitFor();
    await main.getByRole('button', { name: '编辑设备名称' }).click();
    await main.getByRole('textbox', { name: '设备名称' }).clear();
    await main.getByRole('button', { name: '保存名称' }).click();
    await main.getByRole('heading', { name: 'DualSense 手柄', exact: true }).waitFor();

    await main.getByRole('button', { name: '提醒', exact: true }).click();
    await till(main, '提醒中心');
    await screenshot(main, '03-alerts-1600');
    const pendingToast = app.waitForEvent('window');
    const focusedBefore = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.id);
    await main.getByRole('button', { name: '预览低电量' }).click();
    const low = await pendingToast;
    await low.getByRole('main', { name: '桌面电量提醒' }).waitFor();
    const locations = await app.evaluate(({ BrowserWindow, screen }) => {
      const popup = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('surface=toast'));
      const bounds = popup.getBounds();
      const area = screen.getDisplayMatching(bounds).workArea;
      return { right: area.x + area.width - bounds.x - bounds.width, bottom: area.y + area.height - bounds.y - bounds.height,
        current: BrowserWindow.getFocusedWindow()?.id };
    });
    assert.deepEqual([locations.right, locations.bottom], [12, 8]);
    if (focusedBefore !== undefined) assert.equal(locations.current, focusedBefore);
    await screenshot(low, '07-toast-low');
    const closedLow = low.waitForEvent('close');
    await low.getByRole('button', { name: '关闭通知' }).click();
    await closedLow;

    const pendingCritical = app.waitForEvent('window');
    await main.getByRole('button', { name: '预览紧急提醒' }).click();
    const critical = await pendingCritical;
    await critical.getByRole('button', { name: /电量告急/ }).waitFor();
    await screenshot(critical, '08-toast-critical');
    const closedCritical = critical.waitForEvent('close');
    await critical.getByRole('button', { name: '关闭通知' }).click();
    await closedCritical;

    const lowPreview = async () => {
      const popup = app.waitForEvent('window');
      await main.getByRole('button', { name: '预览低电量' }).click();
      return popup;
    };
    const dismissed = await lowPreview();
    const closedBody = dismissed.waitForEvent('close');
    await dismissed.getByRole('button', { name: /电量较低/ }).click();
    await closedBody;
    await till(main, '提醒中心');
    const linked = await lowPreview();
    await linked.getByRole('button', { name: '查看详情' }).click();
    await till(main, 'DualSense 手柄');
    await main.getByRole('heading', { name: 'DualSense 手柄', exact: true }).waitFor();

    const longName = '设备名称边界'.repeat(13) + '测试';
    await main.getByRole('button', { name: '编辑设备名称' }).click();
    await main.getByRole('textbox', { name: '设备名称' }).fill(longName);
    await main.getByRole('button', { name: '保存名称' }).click();
    await main.getByRole('heading', { name: longName, exact: true }).waitFor();
    const pendingLong = app.waitForEvent('window');
    await main.getByRole('button', { name: '提醒测试' }).click();
    const longToast = await pendingLong;
    const toastName = longToast.getByRole('button', { name: /电量较低/ }).locator('strong');
    assert.equal(await toastName.evaluate(node => node.scrollWidth > node.clientWidth && getComputedStyle(node).textOverflow === 'ellipsis'), true);
    await screenshot(longToast, '16-long-name-toast');
    await toastName.hover();
    const fullName = longToast.locator('main > span').filter({ hasText: longName });
    await expect(fullName).toBeVisible();
    assert.equal(await fullName.evaluate(node => {
      const bounds = node.getBoundingClientRect();
      return bounds.top >= 0 && bounds.bottom <= innerHeight && node.scrollHeight <= node.clientHeight;
    }), true);
    await screenshot(longToast, '17-long-name-tooltip');
    await longToast.getByRole('button', { name: '关闭通知' }).click();
    await main.getByRole('button', { name: '编辑设备名称' }).click();
    await main.getByRole('textbox', { name: '设备名称' }).clear();
    await main.getByRole('button', { name: '保存名称' }).click();
    await main.getByRole('heading', { name: 'DualSense 手柄', exact: true }).waitFor();

    await main.getByRole('button', { name: '提醒', exact: true }).click();
    for (const [label, key] of [['全屏提示音', 'fullscreenSound'], ['仅提示音', 'soundOnly'], ['右下角弹窗', 'desktopToasts']]) {
      const field = main.getByRole('switch', { name: label, exact: true });
      const checked = await field.getAttribute('aria-checked');
      const afterTwoClicks = await field.evaluate(async (node, key) => {
        node.click();
        node.click();
        return (await window.powerManager.snapshot()).settings[key];
      }, key);
      assert.equal(afterTwoClicks, checked === 'true');
      await expect(field).toHaveAttribute('aria-checked', checked);
      await field.click();
      await expect(field).toHaveAttribute('aria-checked', String(checked !== 'true'));
      assert.equal((await main.evaluate(() => window.powerManager.snapshot())).settings[key], checked !== 'true');
      await field.press('Space');
      await expect(field).toHaveAttribute('aria-checked', checked);
    }

    const displays = await app.evaluate(({ screen }) => screen.getAllDisplays().map(item => item.id));
    desktopResult = { focusedMainRetained: focusedBefore === undefined ? null : locations.current === focusedBefore,
      availableDisplays: displays.length, secondaryDisplayChecked: false };
    if (displays.length > 1) {
      const old = await app.evaluate(({ BrowserWindow, screen }) => {
        const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
        const bounds = win.getBounds();
        const home = screen.getDisplayMatching(bounds);
        const other = screen.getAllDisplays().find(item => item.id !== home.id);
        const work = other.workArea;
        win.setBounds({ x: work.x + 10, y: work.y + 10, width: Math.min(work.width - 20, 1280),
          height: Math.min(work.height - 20, 720) });
        return { bounds, target: other.id };
      });
      const queued = app.waitForEvent('window');
      await main.getByRole('button', { name: '预览低电量' }).click();
      const otherToast = await queued;
      await otherToast.getByRole('main', { name: '桌面电量提醒' }).waitFor();
      const actual = await app.evaluate(({ BrowserWindow, screen }) => {
        const popup = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('surface=toast'));
        return screen.getDisplayMatching(popup.getBounds()).id;
      });
      assert.equal(actual, old.target);
      const closed = otherToast.waitForEvent('close');
      await otherToast.getByRole('button', { name: '关闭通知' }).click();
      await closed;
      await app.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setBounds(bounds), old.bounds);
      desktopResult.secondaryDisplayChecked = true;
    }

    await main.getByRole('button', { name: '记录', exact: true }).click();
    await till(main, '电量记录');
    await main.getByRole('group', { name: 'DualSense 手柄近 24 小时电量曲线', exact: true }).waitFor();
    await screenshot(main, '04-history-1600');
    await main.getByRole('button', { name: '设置', exact: true }).click();
    await till(main, '设置');
    await screenshot(main, '05-settings-1600');
    assert.equal(await main.getByText('开发者模式', { exact: true }).count(), 0);
    const rejected = await main.evaluate(async () => {
      const settings = window.powerManager.snapshot;
      const initial = (await settings()).settings.zoom;
      const responses = [];
      for (const patch of [{ zoom: 74 }, { trayZoom: 151 }, { zoom: 90.5 }, { developer: true }]) {
        responses.push((await window.powerManager.command({ type: 'settings', patch })).ok);
      }
      return { initial, current: (await settings()).settings.zoom, responses };
    });
    assert.deepEqual(rejected.responses, [false, false, false, false]);
    assert.equal(rejected.initial, rejected.current);
    const mainScale = main.getByRole('spinbutton', { name: '主界面缩放百分比' });
    await mainScale.fill('125');
    await main.getByRole('button', { name: '应用', exact: true }).filter({ visible: true }).first().click();
    await expect.poll(() => main.evaluate(() => devicePixelRatio)).toBe(1.25);
    await main.getByRole('button', { name: '主界面恢复 100%' }).click();
    await expect.poll(() => main.evaluate(() => devicePixelRatio)).toBe(1);
    await expect(mainScale).toHaveValue('100');

    await resize(app, 720, 520);
    await mainScale.fill('150');
    await main.getByRole('button', { name: '应用', exact: true }).first().click();
    await expect.poll(() => main.evaluate(() => devicePixelRatio)).toBe(1.5);
    await main.getByRole('button', { name: '总览', exact: true }).click();
    await till(main, '我的桌面');
    assert.equal(await main.getByRole('navigation').evaluate(nav => nav.scrollHeight <= nav.clientHeight), true);
    assert.equal(await main.getByRole('navigation').getByRole('button').evaluateAll(buttons =>
      buttons.every(button => button.getBoundingClientRect().bottom <= innerHeight)), true);
    const pixels = await app.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('surface=main'));
      return (await window.webContents.capturePage()).toPNG().toString('base64');
    });
    writeFileSync(join(output, '18-minimum-window-navigation.png'), Buffer.from(pixels, 'base64'));
    for (const [tab, heading] of [['设备', '我的设备'], ['提醒', '提醒中心'], ['记录', '电量记录'], ['设置', '设置']]) {
      await main.getByRole('button', { name: tab, exact: true }).click();
      await till(main, heading);
      assert.equal(await main.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, tab);
    }
    await main.getByRole('button', { name: '主界面恢复 100%' }).click();
    await expect.poll(() => main.evaluate(() => devicePixelRatio)).toBe(1);
    await expect(mainScale).toHaveValue('100');

    await main.getByRole('button', { name: '总览', exact: true }).click();
    await resize(app, 1280, 720);
    assert.equal(await main.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await screenshot(main, '09-overview-1280');
    await main.evaluate(() => {
      window.qaOverlayPress = new Promise(resolve => {
        const observer = new MutationObserver(() => {
          const overlay = document.querySelector('[class^="_overlay_"]');
          if (!overlay) return;
          observer.disconnect();
          overlay.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, isPrimary: true }));
          resolve(true);
        });
        observer.observe(document.body, { childList: true, subtree: true });
      });
    });
    await main.getByRole('button', { name: '查找设备', exact: true }).first().click();
    assert.equal(await main.evaluate(() => Promise.race([window.qaOverlayPress, new Promise(resolve => setTimeout(() => resolve(false), 1500))])), true);
    await expect(main.getByRole('dialog')).toHaveCount(0);
    await main.getByRole('button', { name: '查找设备', exact: true }).first().click();
    await main.getByRole('button', { name: '添加到监测', exact: true }).click();
    await main.getByText('已监测', { exact: false }).first().waitFor();
    await main.keyboard.press('Escape');
    await main.getByRole('dialog').waitFor({ state: 'hidden' });
    await main.keyboard.press('Tab');
    assert.equal(await main.evaluate(() => document.activeElement.matches(':focus-visible')), true);
    await main.getByRole('button', { name: '设备', exact: true }).click();
    const speaker = main.getByRole('button', { name: '蓝牙音箱', exact: true });
    await speaker.click();
    const removeSpeaker = async () => {
      await main.getByRole('button', { name: '更多操作', exact: true }).click();
      await main.getByRole('menuitem', { name: '停止监测', exact: true }).click();
      await main.getByRole('dialog', { name: '停止监测设备？' }).waitFor();
    };
    await removeSpeaker();
    await main.keyboard.press('Escape');
    await speaker.waitFor();
    await removeSpeaker();
    await main.getByRole('dialog').getByRole('button', { name: '停止监测', exact: true }).click();
    await speaker.waitFor({ state: 'hidden' });
    assert.deepEqual(failures, []);
  } finally { await app.close(); }

  const trayApp = await launch('demo-tray', '--demo', '--background', '--force-device-scale-factor=1');
  try {
    await emitTray(trayApp, 'click');
    const tray = await trayApp.firstWindow();
    await tray.getByRole('main', { name: '托盘面板' }).waitFor();
    await emitTray(trayApp, 'click');
    await emitTray(trayApp, 'click');
    assert.equal(await trayApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(win => win.isVisible()).length), 1);
    await expect(tray.getByRole('heading', { name: /^5 个设备在线/ })).toBeVisible();
    const traySort = tray.getByRole('combobox', { name: '托盘设备排序' });
    await traySort.press('Space');
    await tray.getByRole('option', { name: '低电量优先' }).click();
    await expect(traySort).toContainText('低电量优先');
    await expect(tray.getByRole('button', { name: /DualSense 手柄/ })).toBeVisible();
    await tray.getByRole('button', { name: /无线鼠标/ }).hover();
    await screenshot(tray, '06-tray');
    await tray.getByRole('button', { name: '置顶面板' }).click();
    await tray.getByRole('button', { name: '取消置顶' }).waitFor();
    const resized = await trayApp.evaluate(({ BrowserWindow }) => {
      const pane = BrowserWindow.getAllWindows()[0];
      const old = pane.getBounds();
      pane.setBounds({ x: old.x - 16, y: old.y - 16, width: old.width + 32, height: old.height + 16 });
      const current = pane.getBounds();
      return pane.isResizable() && pane.isMovable() && current.width > old.width && current.x < old.x;
    });
    assert.equal(resized, true);
    await tray.getByRole('button', { name: '折叠离线' }).click();
    assert.equal(await tray.getByText('触控笔', { exact: true }).count(), 0);
    await tray.getByRole('button', { name: '静音 1 小时' }).click();
    await tray.getByRole('button', { name: '恢复提醒' }).waitFor();
    const next = trayApp.waitForEvent('window');
    await emitTray(trayApp, 'double-click');
    const main = await next;
    await till(main, '我的桌面');
    await tray.getByRole('button', { name: /DualSense 手柄/ }).click();
    await till(main, 'DualSense 手柄');
    await main.getByRole('heading', { name: 'DualSense 手柄', exact: true }).waitFor();
    await main.getByRole('button', { name: '设置', exact: true }).click();
    await main.getByRole('spinbutton', { name: '托盘浮窗缩放百分比' }).fill('125');
    await main.getByRole('button', { name: '应用', exact: true }).last().click();
    await expect.poll(() => tray.evaluate(() => devicePixelRatio)).toBe(1.25);
    assert.equal(await main.evaluate(() => devicePixelRatio), 1);
    await main.getByRole('button', { name: '提醒', exact: true }).click();
    await main.getByRole('combobox', { name: '全局静音时长' }).click();
    await main.getByRole('option', { name: '30 分钟', exact: true }).click();
    await tray.getByRole('button', { name: '恢复提醒' }).click();
    await expect(tray.getByRole('button', { name: '静音 30 分钟' })).toBeVisible();
    await tray.getByRole('button', { name: '取消置顶', exact: true }).click();
    await emitTray(trayApp, 'double-click');
    await expect.poll(() => trayApp.evaluate(({ BrowserWindow }) => {
      const pane = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('surface=tray'));
      return pane?.isVisible();
    })).toBe(false);
  } finally { await trayApp.close(); }

  const scaled = await launch('demo-scaled', '--demo', '--force-device-scale-factor=1.5');
  try {
    const main = await scaled.firstWindow();
    await till(main, '我的桌面');
    await resize(scaled, 1280, 720);
    assert.equal(await main.evaluate(() => devicePixelRatio), 1.5);
    assert.equal(await main.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await screenshot(main, '10-overview-150-percent');
  } finally { await scaled.close(); }
  writeFileSync(join(output, 'demo-result.json'), JSON.stringify(desktopResult, null, 2));
}
async function verifyThresholds() {
  const app = await launch('threshold-' + Date.now(), '--demo', '--force-device-scale-factor=1');
  try {
    const main = await app.firstWindow();
    const headset = '蓝牙头戴耳机';
    const go = name => main.getByRole('button', { name, exact: true }).click();
    const detail = main.getByRole('region', { name: '设备预览' });
    const chooseHeadset = () => main.getByRole('button', { name: '蓝牙头戴耳机', exact: true }).click();
    const input = detail.getByRole('spinbutton', { name: '设备低电量阈值' });
    const apply = () => detail.getByRole('button', { name: '应用', exact: true }).click();

    await go('设备');
    await chooseHeadset();
    await expect(input).toHaveValue('20');
    await input.hover();
    const bounds = await input.boundingBox();
    assert.ok(bounds);
    await main.mouse.click(bounds.x + bounds.width - 14, bounds.y + bounds.height / 4);
    await expect(input).toHaveValue('21');
    await input.press('ArrowDown');
    await input.press('ArrowUp');
    await expect(input).toHaveValue('21');
    await input.press('ArrowDown');
    await expect(input).toHaveValue('20');
    await input.fill('95');
    await input.press('ArrowUp');
    await expect(input).toHaveValue('95');
    await input.fill('1');
    await input.press('ArrowDown');
    await expect(input).toHaveValue('1');
    await input.fill('0');
    await apply();
    assert.equal(await main.evaluate(async () => (await window.powerManager.snapshot()).deviceSettings.headset?.low), undefined);
    await input.fill('15');
    await apply();
    await expect(detail.getByText('自定义 15% · 紧急线 10%')).toBeVisible();

    await go('提醒');
    const normal = main.locator('[data-level="low"]');
    const critical = main.locator('[data-level="critical"]');
    await expect(normal.getByRole('button', { name: headset, exact: true })).toHaveCount(0);
    await expect(normal.getByRole('button', { name: 'DualSense 手柄', exact: true })).toBeVisible();
    const globalLow = main.getByRole('spinbutton', { name: '全局低电量阈值' });
    const globalCritical = main.getByRole('spinbutton', { name: '全局紧急阈值' });
    await globalLow.fill('19');
    await globalCritical.fill('19');
    await go('应用');
    await expect(main.getByRole('alert')).toContainText('紧急阈值必须低于低电量阈值');
    await globalLow.fill('25');
    await globalCritical.fill('20');
    await go('应用');
    await expect(main.getByRole('alert')).toHaveCount(0);
    await expect(critical.getByRole('button', { name: headset, exact: true })).toBeVisible();
    await expect(critical.getByRole('button', { name: 'DualSense 手柄', exact: true })).toBeVisible();

    await critical.getByRole('button', { name: headset, exact: true }).click();
    await expect(input).toHaveValue('15');
    await expect(detail.getByText(/直接进入紧急提醒/)).toBeVisible();
    await detail.getByRole('switch', { name: '静音此设备' }).click();
    await go('提醒');
    const headsetRow = critical.getByRole('button', { name: headset, exact: true }).locator('../..');
    await expect(headsetRow.getByText('已静音', { exact: true })).toBeVisible();
    const rules = await main.evaluate(async () => (await window.powerManager.snapshot()).deviceSettings);
    assert.equal(rules.headset.muted, true);
    assert.equal(rules.dualsense?.muted, undefined);

    await globalCritical.fill('10');
    await go('应用');
    await go('设备');
    await chooseHeadset();
    await detail.getByRole('button', { name: '恢复全局阈值', exact: true }).click();
    await expect(input).toHaveValue('25');
    await input.press('ArrowUp');
    await expect(input).toHaveValue('26');
    await input.press('ArrowDown');
    await screenshot(main, '14-device-threshold');
  } finally { await app.close(); }
}
async function waitForCollector(window, status, timeout = 15000) {
  await expect.poll(() => window.evaluate(async () => (await window.powerManager.snapshot()).collector),
    { timeout, intervals: [100, 250, 500] }).toBe(status);
}
async function verifyReal() {
  const collector = pack ? join(packageRoot, 'resources', 'collector.exe')
    : join(root, '.native', 'collector.exe');
  const holder = spawn(collector, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  const holderExit = once(holder, 'close');
  const lines = createInterface({ input: holder.stdout });
  holder.stdin.write('{"action":"hello","id":1}\n');
  const [hello] = await Promise.race([once(lines, 'line'), holderExit]);
  const handshake = JSON.parse(hello);
  assert.equal(handshake.result?.protocol, 1, handshake.error || '无法取得实机采集锁');
  const profileName = 'live-' + Date.now();
  const reportPath = join(profiles, profileName, 'PowerManager-H5', 'compatibility-report.json');
  const app = await launch(profileName);
  try {
    const main = await app.firstWindow();
    await till(main, '我的桌面');
    await waitForCollector(main, 'occupied');
    const sceneReply = Promise.race([once(lines, "line").then(([line]) => JSON.parse(line)),
      holderExit.then(([code]) => { throw new Error("Collector exited during scene query: " + code); })]);
    holder.stdin.write(JSON.stringify({ action: "scene", id: 2 }) + "\n");
    const { result: scene } = await sceneReply;
    assert.ok(["desktop", "fullscreen", "quiet"].includes(scene?.mode));
    assert.ok(scene.allowed === null || typeof scene.allowed === "boolean");
    const inventory = await main.evaluate(() => window.powerManager.command({ type: 'compatibility', context: 'QA inventory' }));
    assert.equal(inventory.ok, true);
    assert.equal(JSON.parse(readFileSync(reportPath, 'utf8')).capture, 'inventory');
    holder.stdin.end();
    await holderExit;
    await waitForCollector(main, 'ready', 25_000);
    const before = await main.evaluate(() => window.powerManager.snapshot());
    await main.getByRole('button', { name: '立即刷新' }).click();
    const found = await main.evaluate(() => window.powerManager.command({ type: 'discover' }));
    assert.equal(found.ok, true);
    const after = await main.evaluate(() => window.powerManager.snapshot());
    await app.evaluate(({ powerMonitor }) => powerMonitor.emit('suspend'));
    await expect.poll(() => main.evaluate(async () => {
      const state = await window.powerManager.snapshot();
      return state.devices.every(item => item.status === 'offline' || item.status === 'stale');
    })).toBe(true);
    await app.evaluate(({ powerMonitor }) => powerMonitor.emit('resume'));
    await expect.poll(() => main.evaluate(async () => {
      const state = await window.powerManager.snapshot();
      return !state.refreshing && state.devices.every(item => item.status !== 'stale');
    }), { timeout: 10000 }).toBe(true);
    await screenshot(main, '11-live-overview');
    await main.getByRole('button', { name: '设置', exact: true }).click();
    await main.getByRole('tab', { name: '诊断' }).click();
    await main.getByLabel('兼容性反馈说明（选填）').fill('本机验收，未接入待测 VGN 或 Logitech');
    await main.getByRole('button', { name: '生成兼容性报告' }).click();
    await main.getByText('兼容性报告已保存，可在诊断目录查看').waitFor();
    const rawReport = readFileSync(reportPath, 'utf8');
    const report = JSON.parse(rawReport);
    assert.equal(report.capture, 'live');
    assert.ok(report.recentSamples.length > 0);
    assert.ok(Array.isArray(report.logitechSlotAttempts));
    for (const attempt of report.recentSamples.filter(item => item.transport === '2.4 GHz 共享接收器')) {
      assert.equal(attempt.vid, 0x1532);
      assert.equal(attempt.pid, 0x00b8);
    }
    assert.doesNotMatch(rawReport, /"(?:devicePath|serial|containerId|unitId|rawReport|endpointKey)"\s*:/i);
    writeFileSync(join(output, 'compatibility-sample.json'), rawReport);
    await screenshot(main, '15-compatibility-report');
    assert.equal((await main.evaluate(() => window.powerManager.command({ type: 'settings', patch: { muteMinutes: 30 } }))).ok, true);
    assert.equal(JSON.parse(readFileSync(join(profiles, profileName, 'PowerManager-H5', 'monitor.json'), 'utf8')).settings.muteMinutes, 30);
    const parent = await app.evaluate(() => process.pid);
    assert.ok(Number.isInteger(parent));
    const script = "$ProgressPreference = 'SilentlyContinue'; (Get-CimInstance Win32_Process -Filter \"Name = 'collector.exe'\" | " +
      "Where-Object ParentProcessId -eq " + parent + ").ProcessId";
    const command = Buffer.from(script, 'utf16le').toString('base64');
    const findChild = () => Number(execFileSync('powershell.exe', ['-NoProfile', '-EncodedCommand', command],
      { encoding: 'utf8', windowsHide: true }).trim());
    const original = findChild();
    assert.ok(original > 0, '找不到 Electron 主进程的采集子进程，主进程 PID ' + parent);
    process.kill(original);
    await waitForCollector(main, 'retrying', 4000);
    await waitForCollector(main, 'ready', 20_000);
    const recovered = findChild();
    assert.ok(recovered > 0 && recovered !== original, '恢复后的采集进程 PID 应与原进程不同');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
    const result = {
      devicesBefore: before.devices.map(({ name, status, reading, connection }) => ({ name, status, reading, connection })),
      devicesAfter: after.devices.map(({ name, status, reading, connection }) => ({ name, status, reading, connection })),
      discoveredDevices: found.found.length, hiddenWindowAppAlive: true, leaseConflictRecovered: true, collectorCrashRecovered: true, suspendResumeEventsHandled: true,
    };
    writeFileSync(join(output, 'live-result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (holder.exitCode === null) holder.stdin.end();
    await app.close();
  }
}
async function verifyAutomaticToast() {
  const stage = mkdtempSync(join(profiles, 'alert-fixture-'));
  const bin = join(stage, '.native');
  mkdirSync(bin);
  cpSync(join(root, 'dist'), join(stage, 'dist'), { recursive: true });
  cpSync(join(root, '.native', 'collector-fixture.exe'), join(bin, 'collector.exe'));
  writeFileSync(join(stage, 'package.json'), JSON.stringify({ name: 'powermanager-h5', main: 'dist/main.cjs' }));
  const profile = join(stage, 'PowerManager-H5');
  mkdirSync(profile);
  const legacySettings = join(profile, 'monitor.json');
  writeFileSync(legacySettings, JSON.stringify({ version: 1, settings: { developer: true, zoom: 100 },
    deviceSettings: {}, alerts: {}, watched: [], devices: [], history: {} }));
  const app = await _electron.launch({
    cwd: stage, executablePath: require('electron'), args: [stage, '--force-device-scale-factor=1'],
    env: { ...process.env, LOCALAPPDATA: stage },
  });
  try {
    await expect.poll(() => app.windows().some(window => window.url().includes('surface=main'))).toBe(true);
    const home = app.windows().find(window => window.url().includes('surface=main'));
    await till(home, '我的桌面');
    await expect.poll(() => app.windows().some(window => window.url().includes('surface=toast'))).toBe(true);
    const popup = app.windows().find(window => window.url().includes('surface=toast'));
    await popup.getByRole('button', { name: /Fixture Mouse.*电量告急/ }).waitFor();
    await expect.poll(() => home.evaluate(async () => !!(await window.powerManager.snapshot()).alerts['fixture-mouse']?.criticalAt)).toBe(true);
    await screenshot(popup, '13-auto-toast-fixture');
    const closed = popup.waitForEvent('close');
    const pendingLow = app.waitForEvent('window');
    await popup.getByRole('button', { name: '查看详情' }).click();
    await closed;
    await till(home, 'Fixture Mouse');
    await home.getByRole('heading', { name: 'Fixture Mouse', exact: true }).waitFor();
    const low = await pendingLow;
    await low.getByRole('button', { name: /Fixture Keyboard.*电量较低/ }).waitFor();
    const closedLow = low.waitForEvent('close');
    await low.getByRole('button', { name: '关闭通知' }).click();
    await closedLow;
    await home.getByRole('button', { name: '总览', exact: true }).click();
    await home.getByRole('button', { name: '立即刷新' }).click();
    assert.equal(app.windows().filter(window => window.url().includes('surface=toast')).length, 0);
    const settings = JSON.parse(readFileSync(legacySettings, 'utf8')).settings;
    assert.equal(Object.hasOwn(settings, 'developer'), false);
    assert.equal(settings.zoom, 100);
    assert.equal(settings.muteMinutes, 60);
    const count = 16;
    for (let i = 0; i < count; i++) {
      const opened = app.waitForEvent('window');
      await home.evaluate(() => window.powerManager.command({ type: 'preview', severity: 'low' }));
      const example = await opened;
      await example.getByRole('button', { name: '关闭通知' }).click();
      await expect.poll(() => app.windows().filter(window => window.url().includes('surface=toast')).length).toBe(0);
    }
    await home.getByRole('button', { name: '设置', exact: true }).click();
    await home.getByRole('tab', { name: '诊断' }).click();
    await home.getByLabel('兼容性反馈说明（选填）').fill('V98 Pro V3 2.4 GHz fixture');
    await home.getByRole('button', { name: '生成兼容性报告' }).click();
    await home.getByText('兼容性报告已保存，可在诊断目录查看').waitFor();
    const report = JSON.parse(readFileSync(join(profile, 'compatibility-report.json'), 'utf8'));
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.capture, 'live');
    assert.equal(report.context, 'V98 Pro V3 2.4 GHz fixture');
    assert.equal(report.hidInterfaces[0].pid, 0x024f);
    assert.equal((await home.evaluate(() => window.powerManager.command({ type: 'settings', patch: { muteMinutes: 120 } }))).ok, true);
    assert.equal(JSON.parse(readFileSync(legacySettings, 'utf8')).settings.muteMinutes, 120);
  } finally { await app.close(); }
}
async function verifyDemoAndThresholds() {
  await verifyDemo();
  await verifyThresholds();
  await verifyDeviceCountsAndMute();
}
async function verifyDeviceCountsAndMute() {
  const app = await launch('device-counts-' + Date.now(), '--demo', '--force-device-scale-factor=1');
  try {
    const main = await app.firstWindow();
    const button = name => main.getByRole('button', { name, exact: true });
    const noHorizontalOverflow = async () => {
      const dimensions = await main.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
      assert.ok(dimensions.content <= dimensions.viewport, JSON.stringify(dimensions));
    };
    const publish = (devices, collector = 'ready') => app.evaluate(({ BrowserWindow }, snapshot) => {
      BrowserWindow.getAllWindows()[0].webContents.send('state', snapshot);
    }, { ...baseline, devices, collector });
    await till(main, '我的桌面');
    const baseline = await main.evaluate(() => window.powerManager.snapshot());
    const healthy = baseline.devices.find(device => device.id === 'mouse');
    assert.ok(healthy);
    await resize(app, 1240, 820);
    await publish([healthy], 'starting');
    await expect(main.getByRole('status')).toContainText('正在读取设备和电量');
    await expect(button('立即刷新')).toBeDisabled();
    await expect(main.getByRole('region', { name: '主设备' })).toHaveCount(0);
    await screenshot(main, '19-startup-skeleton');
    await button('设备').click();
    await expect(main.getByRole('searchbox')).toHaveCount(0);
    await button('总览').click();
    await publish([], 'occupied');
    await expect(main.getByRole('status')).toContainText('自动接管');
    await publish([]);
    await expect(main.getByText('尚未监测到外设', { exact: true })).toBeVisible();
    await noHorizontalOverflow();
    await publish([{ ...healthy, status: 'no_radio_reply' }]);
    await expect(main.getByText('上次电量', { exact: true })).toBeVisible();
    await publish([healthy]);
    await expect(main.getByRole('region', { name: '主设备' }).getByText(healthy.name)).toBeVisible();
    await expect(main.getByText('暂无其他设备')).toBeVisible();
    await screenshot(main, '20-one-device');

    const many = Array.from({ length: 48 }, (_, index) => {
      const seed = index < 8 ? baseline.devices.find(device => device.id === 'dualsense') : healthy;
      return { ...seed, id: 'boundary-' + index, status: index >= 40 ? 'offline' : 'current',
        name: '测试外设 ' + String(index + 1).padStart(2, '0') + (index === 47 ? ' ' + '长名称'.repeat(20) : '') };
    });
    await publish(many);
    await expect(main.getByText('40 台在线 · 8 台未连接')).toBeVisible();
    await expect(main.getByRole('region', { name: '主设备' }).getByText('建议充电')).toBeVisible();
    await screenshot(main, '21-many-devices');
    await main.getByRole('button', { name: '管理提醒' }).click();
    await till(main, '提醒中心');
    await button('设备').click();
    await expect(main.getByRole('table', { name: '设备（48）' })).toBeVisible();
    await main.getByRole('searchbox').fill('测试外设 48');
    await expect(main.getByRole('table', { name: '设备（1）' })).toBeVisible();
    await resize(app, 720, 520);
    await noHorizontalOverflow();
    await button('记录').click();
    const history = main.getByRole('group', { name: '选择对比设备' });
    await history.getByRole('button', { name: '设备', exact: true }).press('Space');
    await expect(main.getByRole('menuitemcheckbox')).toHaveCount(48);
    const last = main.getByRole('menuitemcheckbox', { name: many.at(-1).name });
    await last.focus();
    await expect(last).toBeFocused();
    await last.press('Space');
    await expect(history.getByRole('button', { name: '移除对比：' + many.at(-1).name })).toBeVisible();
    await screenshot(main, '22-history-picker-many');
    await noHorizontalOverflow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.5));
    await expect.poll(() => main.evaluate(() => devicePixelRatio)).toBe(1.5);
    await noHorizontalOverflow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));

    await publish(baseline.devices);
    await button('提醒').click();
    const duration = main.getByRole('combobox', { name: '全局静音时长' });
    const choose = async label => {
      await duration.click();
      await main.getByRole('option', { name: label, exact: true }).click();
      await expect(duration).toContainText(label);
    };
    await expect(duration).toContainText('1 小时');
    assert.equal((await main.evaluate(() => window.powerManager.command({ type: 'settings', patch: { muteMinutes: 16 } }))).ok, false);
    await choose('15 分钟');
    const before = Date.now();
    await button('静音 15 分钟').click();
    const deadline = (await main.evaluate(() => window.powerManager.snapshot())).mutedUntil;
    assert.ok(deadline >= before + 15 * 60_000 && deadline <= Date.now() + 15 * 60_000);
    await choose('2 小时');
    assert.equal((await main.evaluate(() => window.powerManager.snapshot())).mutedUntil, deadline);
    await button('恢复提醒').click();
    await expect(button('静音 2 小时')).toBeVisible();
    await choose('30 分钟');
    await expect(button('静音 30 分钟')).toBeVisible();
  } finally { await app.close(); }
}
const verify = process.argv.includes('--synthetic') ? verifyAutomaticToast : real ? verifyReal : verifyDemoAndThresholds;
verify().then(() => console.log('Electron verification passed')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
