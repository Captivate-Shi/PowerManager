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
          id: 'dual', name: 'DualSense', art: 'dualsense', watched: true, connection: '蓝牙',
          status, reason: status === 'current' ? '设备读数正常' : '设备未连接',
          lastRead: Date.now() - 1000, reading: { low: 70, high: 79, raw: 70, power: 'discharging', source: 'hid' },
        }] };
      };
      window.powerManager.snapshot = () => make('offline');
      window.useFreshReading = async () => publish(await make('current'));
    };
    await page.addInitScript({ content: '(' + installMock.toString() + ')();(' + attachBatteryFixture.toString() + ')();' });
    await page.goto(pathToFileURL(resolve('dist/ui/index.html')).href);
    const hero = page.getByRole('region', { name: '主设备' });
    const lastLabel = hero.locator('[data-last-battery]');
    const lastTrack = hero.getByRole('meter', { name: '上次电量', exact: true });
    const lastValue = hero.getByText('70–79%', { exact: true });
    await expect(lastLabel).toHaveText('上次电量');
    await expect(lastTrack).toHaveAttribute('aria-valuetext', '70–79%');
    const valueBox = await lastValue.boundingBox();
    const trackBox = await lastTrack.boundingBox();
    const labelBox = await lastLabel.boundingBox();
    expect(trackBox.x).toBeGreaterThanOrEqual(valueBox.x + valueBox.width);
    expect(Math.abs(trackBox.y + trackBox.height / 2 - (valueBox.y + valueBox.height / 2))).toBeLessThan(2);
    expect(labelBox.y).toBeGreaterThanOrEqual(valueBox.y + valueBox.height);
    await page.setViewportSize({ width: 720, height: 520 });
    const narrowValue = await lastValue.boundingBox();
    const narrowTrack = await lastTrack.boundingBox();
    const narrowLabel = await lastLabel.boundingBox();
    const narrowHero = await hero.boundingBox();
    const narrowButton = await hero.getByRole('button', { name: '查看详情' }).boundingBox();
    expect(narrowTrack.y).toBeGreaterThanOrEqual(narrowValue.y + narrowValue.height);
    expect(narrowLabel.y).toBeGreaterThanOrEqual(narrowTrack.y + narrowTrack.height);
    expect(narrowButton.y + narrowButton.height).toBeLessThanOrEqual(narrowHero.y + narrowHero.height);
    await page.setViewportSize({ width: 1120, height: 740 });
    await hero.getByRole('button', { name: '查看详情' }).click();
    const detail = page.getByRole('region', { name: '设备详情' });
    await expect(detail.locator('[data-last-battery]')).toBeVisible();
    await page.evaluate(() => window.useFreshReading());
    await expect(detail.locator('[data-last-battery]')).toHaveCount(0);
    await expect(detail.getByRole('meter', { name: '电量', exact: true })).toHaveAttribute('aria-valuetext', '70–79%');
    await page.getByRole('button', { name: '返回总览' }).click();
    await expect(hero.locator('[data-last-battery]')).toHaveCount(0);
    console.log('Offline history is labelled in overview and detail; live readings are not.');
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
