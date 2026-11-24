const { chromium, expect } = require('@playwright/test');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH,
    args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const url = pathToFileURL(resolve(__dirname, '../dist/ui/index.html')).href;
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    const state = { devices: [], settings: { low: 20, critical: 10, muteMinutes: 60, zoom: 100, trayZoom: 100 },
      collector: 'starting', deviceSettings: {}, refreshing: false, alerts: {}, demo: false, mutedUntil: 0 };
    const mouse = { id: 'local', name: '工作鼠标', art: 'mouse', connection: 'USB', watched: true,
      status: 'stale', reason: '等待新读数', lastRead: Date.now() - 3_600_000,
      reading: { low: 9, high: 9, raw: 9, power: 'charging', source: 'hid' } };
    let handler, reject;
    window.publish = (mode, collector) => {
      const devices = mode === 'cache' ? [mouse] : mode === 'live' ? [
        { ...mouse, status: 'current', reason: '新读数', reading: { ...mouse.reading, low: 75, high: 75, power: 'discharging' } }
      ] : [];
      handler?.({ ...state, devices, collector });
    };
    window.failInitial = () => reject(new Error('request failed'));
    window.powerManager = {
      snapshot: () => new Promise((_, fail) => { reject = fail; }),
      toast: async () => null,
      command: async () => ({ ok: true, history: [] }),
      onNavigate: () => () => {},
      onSnapshot: handlerIn => { handler = handlerIn; return () => { handler = undefined; }; },
    };
  });
  const phase = value => page.locator('[data-load-state="' + value + '"]');
  const hero = page.getByRole('region', { name: '主设备' });
  try {
    await page.goto(url);
    await expect(page.getByRole('status')).toContainText('正在连接应用主进程');
    await expect(page.locator('[data-device-art]')).toHaveCount(0);
    await page.evaluate(() => window.publish('none', 'starting'));
    await expect(phase('initial')).toBeVisible();
    await expect(phase('initial').getByRole('heading', { name: '正在识别设备' })).toBeVisible();
    await expect(phase('initial').getByRole('status')).toHaveText('正在识别设备');
    await expect(phase('initial').getByRole('progressbar')).toHaveCount(0);
    await expect(page.getByRole('region', { name: '切换设备' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: '主设备' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '查找设备' })).toHaveCount(0);
    await expect(hero.getByRole('meter')).toHaveCount(0);
    await expect(hero.getByRole('button', { name: '查看详情' })).toHaveCount(0);
    await expect(page.locator('[data-device-art]')).toHaveCount(0);
    await expect(page.getByText(/0 台在线/)).toHaveCount(0);
    await page.evaluate(() => window.failInitial());
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(phase('initial')).toBeVisible();
    await page.evaluate(() => window.publish('none', 'retrying'));
    await expect(phase('unavailable')).toBeVisible();
    await expect(page.getByText('暂无法读取设备，等待采集恢复')).toBeVisible();
    await expect(page.getByText('尚未监测到外设')).toHaveCount(0);
    await page.evaluate(() => window.publish('none', 'ready'));
    await expect(page.getByText('尚未监测到外设')).toBeVisible();

    await page.reload();
    await expect(page.getByRole('status')).toContainText('正在连接应用主进程');
    await page.evaluate(() => window.failInitial());
    await expect(page.getByRole('alert')).toContainText('暂时无法连接应用主进程');
    await page.evaluate(() => window.publish('cache', 'starting'));
    await expect(phase('cached')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(hero.getByRole('heading', { name: '工作鼠标' })).toBeVisible();
    await expect(hero.getByRole('meter', { name: '上次电量' })).toHaveAttribute('aria-valuetext', '9%');
    await expect(hero.getByText('上次电量', { exact: false })).toBeVisible();
    await expect(phase('cached').getByText('未连接', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/0 台在线/)).toHaveCount(0);
    await expect(hero.getByRole('progressbar')).toHaveCount(0);
    await hero.getByRole('button', { name: '查看详情' }).click();
    await expect(page.getByText('上次充电状态')).toBeVisible();
    await expect(page.getByText('上次有效电量')).toBeVisible();
    await page.getByRole('button', { name: '返回总览' }).click();
    await page.evaluate(() => window.publish('cache', 'retrying'));
    await expect(phase('cached')).toBeVisible();
    await expect(hero.getByRole('meter', { name: '上次电量' })).toHaveAttribute('aria-valuetext', '9%');
    await page.evaluate(() => window.publish('live', 'ready'));
    await expect(hero.getByRole('meter', { name: '电量', exact: true })).toHaveAttribute('aria-valuetext', '75%');
    await expect(hero.getByText('上次电量', { exact: false })).toHaveCount(0);

    await page.goto(url + '?surface=tray');
    await expect(page.getByRole('status')).toContainText('正在连接应用主进程');
    await page.evaluate(() => window.publish('cache', 'starting'));
    await expect(page.getByRole('status').filter({ hasText: '显示上次记录' })).toBeVisible();
    await expect(page.getByRole('button', { name: /工作鼠标.*上次电量\s*9%/ })).toBeVisible();
    await expect(page.getByText(/0 台在线/)).toHaveCount(0);
    await page.evaluate(() => window.publish('live', 'ready'));
    await expect(page.getByText(/1 台在线/)).toBeVisible();
    console.log('Startup UI: IPC recovery, cold/no devices, retry vs confirmed empty, warm stale details and tray, live replacement.');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
