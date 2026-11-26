// Local renderer smoke test with a mock preload boundary, no hardware/Windows.
const { chromium, expect } = require('@playwright/test');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--allow-file-access-from-files', '--no-sandbox'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 680 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const now = Date.now();
      const read = (low, high = low, power = 'discharging') => ({ low, high, raw: low, power, source: 'hid' });
      const state = { devices: ['Alpha', 'Beta', 'Gamma', 'Delta'].map((name, i) => ({
        id: name, name, art: 'unknown', status: 'current', reason: '读数正常', reading: read(58 + i),
        lastRead: now - 800, watched: false, connection: '无线',
      })), settings: { low: 20, critical: 10, repeat: 0, snooze: 30, fullscreenSound: true,
        desktopSound: false, voltage: false, startup: false, zoom: 100, trayZoom: 100, desktopToasts: true, muteMinutes: 60 },
        deviceSettings: {}, collector: 'ready', refreshing: false, mutedUntil: 0, alerts: {}, demo: true };
      const observations = {
        Alpha: [{ time: now - 95_000, reading: read(54) }, { time: now - 65_000, reading: null },
          { time: now - 30_000, reading: read(52, 60, 'charging') }, { time: now - 5_000, reading: read(53, 61, 'charging') }],
        Beta: [{ time: now - 100_000, reading: read(76) }, { time: now - 45_000, reading: read(78) }],
        Gamma: [{ time: now - 80_000, reading: read(65) }, { time: now - 35_000, reading: read(61) }],
      };
      let listener;
      const pending = [];
      window.testHistory = {
        count: id => pending.filter(entry => !entry.done && entry.id === id).length,
        resolve: (id, success = true, data = observations[id] ?? [], index = 0) => {
          const entry = pending.filter(item => !item.done && item.id === id)[index];
          if (!entry) throw new Error('No pending request for ' + id);
          entry.done = true;
          entry.resolve(success ? { ok: true, history: data } : { ok: false, error: 'fixture failure' });
        },
        setLastRead: (id, value) => {
          state.devices.find(device => device.id === id).lastRead = value;
          listener(structuredClone(state));
        },
        refresh: id => {
          state.devices.find(device => device.id === id).lastRead += 100;
          listener(structuredClone(state));
        },
      };
      window.powerManager = {
        snapshot: async () => structuredClone(state),
        toast: async () => null,
        onSnapshot: fn => { listener = fn; return () => {}; },
        onNavigate: () => () => {},
        command: command => command.type === 'history'
          ? new Promise(resolve => pending.push({ id: command.id, resolve, done: false })) : Promise.resolve({ ok: true }),
      };
    });
    const wait = (id, count = 1) => expect.poll(() => page.evaluate(id => window.testHistory.count(id), id)).toBe(count);
    const resolve = (id, success = true, data, index) => page.evaluate(
      ({ id, success, data, index }) => window.testHistory.resolve(id, success, data, index), { id, success, data, index });
    const picker = page.getByRole('group', { name: '选择对比设备' });
    const openPicker = () => picker.getByRole('button', { name: '对比设备', exact: true }).click();
    const option = name => page.getByRole('menuitemcheckbox', { name, exact: true });
    const add = async name => { await openPicker(); await option(name).click(); };
    await page.goto(pathToFileURL(join(__dirname, '../dist/ui/index.html')).href);
    await page.getByRole('button', { name: '记录', exact: true }).click();
    const skeleton = page.getByRole('status', { name: '正在加载电量历史' });
    await expect(skeleton).toBeVisible();
    await expect(page.getByRole('button', { name: '设置' })).toBeEnabled();
    await wait('Alpha');
    const height = await skeleton.evaluate(node => node.getBoundingClientRect().height);
    const animations = await skeleton.evaluate(node => getComputedStyle(node, '::after').animationName);
    expect(animations).toBe('none');
    await resolve('Alpha');
    const graph = page.getByLabel(/近 24 小时电量曲线/);
    await expect(graph).toBeVisible();
    expect(Math.abs(await graph.evaluate(node => node.getBoundingClientRect().height) - height)).toBeLessThan(2);
    await expect(graph.locator('[data-event-series="0"] [data-event="invalid"]')).toHaveCount(1);
    const charge = graph.locator('[data-event-series="0"] [data-event="charging"]');
    await expect(charge).toHaveCount(1);
    await charge.hover();
    await expect(graph.getByRole('tooltip').getByText('检测到充电')).toBeVisible();
    await graph.locator('[data-event-series="0"] [data-event="invalid"]').hover();
    await expect(graph.getByRole('tooltip').getByText('无有效读数')).toBeVisible();
    await graph.focus();
    await graph.press('End');
    await expect(graph.getByRole('tooltip').getByText('53–61%', { exact: true })).toBeVisible();
    await picker.getByRole('button', { name: '对比设备', exact: true }).focus();
    await expect(graph.getByRole('tooltip').getByText('53–61%', { exact: true })).toHaveCount(0);
    await add('Beta');
    await expect(graph).toBeVisible();
    await expect(page.getByText('正在更新，暂显示已有记录')).toBeVisible();
    await wait('Alpha', 0); // another device's selection does not reload Alpha
    await wait('Beta');
    await resolve('Beta');
    await expect(graph.locator('[data-series="1"]')).toHaveCount(1);
    await expect(graph.locator('[data-event-series="1"] [data-event="invalid"],[data-event-series="1"] [data-event="charging"]')).toHaveCount(0);
    await add('Gamma');
    await openPicker();
    await expect(option('Delta')).toBeDisabled();
    await page.keyboard.press('Escape');
    await wait('Gamma');
    await picker.getByRole('button', { name: '移除对比：Gamma' }).click();
    await resolve('Gamma'); // Old response must not draw a superseded series.
    await expect(graph.locator('[data-series="2"]')).toHaveCount(0);
    await openPicker();
    await expect(option('Delta')).toBeEnabled();
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.testHistory.refresh('Alpha'));
    await wait('Alpha');
    await page.evaluate(() => window.testHistory.refresh('Alpha'));
    await wait('Alpha', 2);
    await resolve('Alpha', false, undefined, 1);
    await resolve('Alpha', true, []); // superseded request cannot clear cached Alpha
    await wait('Beta', 0);
    await expect(page.getByText('Alpha：保留上次记录')).toBeVisible();
    await expect(graph.locator('[data-event-series="0"] [data-event="charging"]')).toHaveCount(1);
    // A malformed cached timestamp must not poison the range label or graph.
    await page.evaluate(() => window.testHistory.setLastRead('Beta', Number.MAX_VALUE));
    await wait('Beta');
    await resolve('Beta');
    await expect(page.getByLabel('实际查看时段')).toBeVisible();
    await expect(graph.locator('[data-series="1"]')).toHaveCount(1);
    await page.setViewportSize({ width: 520, height: 540 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
    if (process.env.HISTORY_QA_SCREENSHOT) await page.screenshot({ path: process.env.HISTORY_QA_SCREENSHOT });
    console.log('history renderer smoke: local skeleton, reduced motion, gap and charge, range tooltip, keyboard blur, async comparison, stale error and no narrow overflow');
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
