// Built Chromium renderer; all device data is mocked at the preload boundary.
const { chromium, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');
const { installMock } = require('./studio-review-mock.cjs');

function fixture() {
  const api = window.powerManager;
  const base = api.snapshot();
  let notify;
  const row = (id, name, low, art, status = 'current') => ({
    id, name, connection: '2.4 GHz', art, status, reason: '', watched: true, lastRead: Date.now(),
    reading: low === null ? null : { low, high: low, raw: low, power: 'discharging', source: 'hid' },
  });
  let devices = [
    row('z', 'Zulu Mouse', 42, 'mouse'), row('a', 'Alpha Keyboard', 42, 'keyboard'),
    row('b', 'Beta DualSense', 72, 'dualsense'), row('n', 'Nova Headset', null, 'headset', 'offline'),
  ];
  const snapshot = async () => structuredClone({ ...await base, collector: 'ready', demo: false, devices });
  api.snapshot = snapshot;
  api.onSnapshot = fn => { notify = fn; return () => { if (notify === fn) notify = undefined; }; };
  window.pushOrderFixture = async ({ id, status, percent, power, permute }) => {
    if (permute) devices = [...devices.slice(1), devices[0]];
    const d = devices.find(x => x.id === id);
    if (d) {
      if (status) d.status = status;
      if (percent !== undefined) d.reading = { low: percent, high: percent, raw: percent, power: power ?? 'discharging', source: 'hid' };
      d.lastRead = Date.now();
    }
    notify(await snapshot());
  };
  window.rowMoves = [];
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (frames, options) {
    const animation = animate.call(this, frames, options);
    if (this.dataset.deviceRow) {
      if (window.pauseReorder) { animation.pause(); animation.currentTime = 75; }
      window.rowMoves.push({ id: this.dataset.deviceRow, from: frames[0].transform, animation });
    }
    return animation;
  };
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1430, height: 850 } });
    page.setDefaultTimeout(7000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript({ content: '(' + installMock + ')();(' + fixture + ')();' });
    await page.goto(pathToFileURL(resolve('dist/ui/index.html')).href);
    await page.getByRole('button', { name: '设备', exact: true }).click();
    const rows = page.locator('[data-device-row]');
    const order = (ids) => expect.poll(() => rows.evaluateAll(elements => elements.map(r => r.dataset.deviceRow))).toEqual(ids);
    const moves = () => page.evaluate(() => window.rowMoves.map(({ id, from, animation }) => ({ id, from, state: animation.playState })));
    const push = (update) => page.evaluate(data => window.pushOrderFixture(data), update);
    const choose = async text => {
      await page.getByRole('combobox', { name: '设备排序' }).click();
      await page.getByRole('option', { name: text, exact: true }).click();
    };
    const clearMoves = () => page.evaluate(async () => { await Promise.allSettled(window.rowMoves.filter(x => x.animation.playState !== 'idle').map(x => x.animation.finished)); window.rowMoves = []; });
    await order(['a','b','z','n']);
    await expect(page.getByRole('combobox', { name: '设备排序' })).toContainText('已连接优先');
    const selected = rows.filter({ has: page.getByRole('button', { name: 'Beta DualSense', exact: true }) });
    await selected.getByRole('button', {name: 'Beta DualSense', exact:true}).click();
    await push({ id: 'a', percent: 43, power: 'charging', permute: true });
    await expect(rows.first()).toContainText('43%');
    await order(['a','b','z','n']);
    expect(await moves()).toHaveLength(0);

    const keyboard = rows.filter({hasText:'Alpha Keyboard'});
    for (const [status,label] of [['stale','等待读数'],['no_radio_reply','未连接'],['unreachable','未回应'],['current','充电中']]) {
      await push({ id: 'a', status, permute: true });
      await expect(keyboard.locator('td').nth(3)).toHaveText(label);
      await order(['a','b','z','n']);
    }
    expect(await moves()).toHaveLength(0);
    await page.evaluate(() => { window.pauseReorder = true; });
    await push({ id: 'a', status: 'offline' });
    await order(['b','z','a','n']);
    const moved = await moves();
    expect(moved.map(x => x.id).sort()).toEqual(['a','b','z']);
    expect(moved.find(x => x.id === 'a').from).toMatch(/^translateY\(-/);
    expect(moved.find(x => x.id === 'b').from).toMatch(/^translateY\([1-9]/);
    await expect(selected).toHaveAttribute('data-selected','true');

    // The next update overtakes a still-running animation instead of queuing behind it.
    await page.evaluate(() => { window.pauseReorder = false; });
    await push({ id: 'a', status: 'current' });
    await order(['a','b','z','n']);
    const retargeted = await moves();
    expect(retargeted.length).toBeGreaterThan(3);
    expect(retargeted.slice(0,3).every(x => x.state === 'idle')).toBe(true);
    await clearMoves();
    console.log('State sort and interrupt passed');

    await choose('按电量排序');
    await order(['z','a','b','n']);
    await clearMoves();
    await push({ id: 'a', percent: 42, permute: true });
    await order(['a','z','b','n']);
    expect((await moves()).map(x=>x.id).sort()).toEqual(['a','z']);
    await clearMoves();
    await push({ id: 'a', percent: 42, permute: true });
    await expect(rows.first()).toContainText('42%');
    await order(['a','z','b','n']);
    expect(await moves()).toHaveLength(0);

    await choose('按名称排序');
    await order(['a','b','n','z']);
    await clearMoves();
    await push({ id: 'b', status: 'offline', percent: 10, permute: true });
    await expect(selected).toContainText('10%');
    await order(['a','b','n','z']);
    expect(await moves()).toHaveLength(0);
    await page.emulateMedia({reducedMotion:'reduce'});
    await choose('按电量排序');
    await order(['b','a','z','n']);
    expect(await moves()).toHaveLength(0);
    expect(errors).toEqual([]);
    console.log('Mock renderer passed: 3 deterministic sorts, real reorder only, no animation queue, retained selection, reduced motion.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
