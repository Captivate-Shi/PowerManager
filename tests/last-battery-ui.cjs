const { chromium, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');
const { installMock } = require('./studio-review-mock.cjs');

async function run() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--allow-file-access-from-files'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1120, height: 740 }, reducedMotion: 'reduce' });
    const attachBatteryFixture = () => {
      const base = window.powerManager.snapshot.bind(window.powerManager);
      let publish;
      window.powerManager.onSnapshot = handler => { publish = handler; return () => {}; };
      const make = async status => {
        const snapshot = await base();
        return { ...snapshot, demo: false, collector: 'ready', devices: [{
          id: 'mouse', name: '验收鼠标', art: 'mouse', watched: true, connection: 'USB',
          status, reason: status === 'current' ? '设备读数正常' : '设备未连接',
          lastRead: Date.now() - 1000, reading: { low: 42, high: 42, raw: 42, power: 'discharging', source: 'hid' },
        }] };
      };
      window.powerManager.snapshot = () => make('offline');
      window.useFreshReading = async () => publish(await make('current'));
    };
    await page.addInitScript({ content: '(' + installMock.toString() + ')();(' + attachBatteryFixture.toString() + ')();' });
    await page.goto(pathToFileURL(resolve('dist/ui/index.html')).href);
    const hero = page.getByRole('region', { name: '主设备' });
    await expect(hero.locator('[data-last-battery]')).toHaveText('上次电量');
    await expect(hero.getByRole('meter', { name: '上次电量', exact: true })).toHaveAttribute('aria-valuetext', '42%');
    await hero.getByRole('button', { name: '查看详情' }).click();
    const detail = page.getByRole('region', { name: '设备详情' });
    await expect(detail.locator('[data-last-battery]')).toBeVisible();
    await page.evaluate(() => window.useFreshReading());
    await expect(detail.locator('[data-last-battery]')).toHaveCount(0);
    await expect(detail.getByRole('meter', { name: '电量', exact: true })).toHaveAttribute('aria-valuetext', '42%');
    await page.getByRole('button', { name: '返回总览' }).click();
    await expect(hero.locator('[data-last-battery]')).toHaveCount(0);
    console.log('Offline history is labelled in overview and detail; live readings are not.');
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
