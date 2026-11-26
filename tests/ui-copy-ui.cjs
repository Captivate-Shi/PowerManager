// Verify progressively disclosed help and actionable empty states through the built renderer.
const { chromium, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');
const { mkdirSync } = require('node:fs');
const entry = pathToFileURL(resolve(process.env.POWER_RENDERER_BUILD || resolve(__dirname, '../dist/ui'), 'index.html')).href;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH,
    args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const mouse = { id: 'mouse', name: '无线鼠标', art: 'mouse', connection: 'USB', watched: true,
      status: 'current', lastRead: Date.now(), reading: { low: 79, high: 79, raw: 79, power: 'discharging', source: 'hid' } };
    const state = { collector: 'ready', devices: [], settings: { low: 20, critical: 10, repeat: 0, snooze: 30,
      fullscreenSound: true, soundOnly: false, voltage: false, startup: false, zoom: 100, trayZoom: 100,
      desktopToasts: true, muteMinutes: 60 }, deviceSettings: {}, alerts: {}, refreshing: false, mutedUntil: 0, demo: false };
    let notify;
    window.copyReview = { calls: [], publishDevice: () => { state.devices = [mouse]; notify?.(structuredClone(state)); } };
    window.powerManager = {
      snapshot: async () => structuredClone(state), onSnapshot: fn => { notify = fn; return () => {}; },
      toast: async () => null, onNavigate: () => () => {},
      command: async c => {
        window.copyReview.calls.push(c);
        if (c.type === 'history') return { ok: true, history: [{ time: mouse.lastRead, reading: mouse.reading }] };
        if (c.type === 'discover') return { ok: true, found: [] };
        return { ok: true };
      },
    };
  });
  const main = page.getByRole('main');
  const go = name => page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name, exact: true }).click();
  const removed = [
    '查看设备连接与电量', '待充电设备和通知偏好', '近 24 小时 · 设备记录', '显示、监测与诊断',
    '电量达到提醒阈值时，设备会显示在这里。',
  ];
  const noRepeats = async () => {
    await expect(main.locator('[data-page-heading] h1')).toHaveCount(1);
    await expect(main.locator('[data-page-heading] h1 + p')).toHaveCount(0);
    for (const copy of removed) await expect(page.getByText(copy, { exact: true })).toHaveCount(0);
  };
  const messages = fragment => fragment.locator('p,h3,[role=status]').filter({ visible: true });
  const assertion = async (locator, re) => {
    await expect(messages(locator)).toHaveCount(1);
    await expect(messages(locator)).toHaveText(re);
  };

  try {
    await page.goto(entry);
    const overviewCopy = main.getByText(/尚未监测到外设|尚未发现外设|暂无设备/, { exact: true }).first();
    await expect(overviewCopy).toBeVisible();
    const overviewEmpty = overviewCopy.locator('..');
    await assertion(overviewEmpty, /外设|设备/);
    await overviewEmpty.getByRole('button', { name: '查找设备' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.copyReview.calls.filter(c => c.type === 'discover').length)).toBe(1);
    await expect(dialog.getByText(/暂未发现外设|未发现设备/)).toBeVisible();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await dialog.getByRole('button', { name: '查找设备说明' }).focus();
    await expect(page.getByRole('tooltip')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '重新扫描' }).click();
    await expect.poll(() => page.evaluate(() => window.copyReview.calls.filter(c => c.type === 'discover').length)).toBe(2);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await go('设备');
    await noRepeats();
    const devices = main.getByText('暂无受监测设备', { exact: true }).locator('..');
    await assertion(devices, '暂无受监测设备');
    await expect(devices.getByRole('button', { name: '查找设备' })).toBeVisible();
    await go('提醒');
    await noRepeats();
    const queue = page.getByRole('region', { name: '待充电' });
    await assertion(queue, /暂无待充电设备|无需充电/);
    await go('记录');
    await noRepeats();
    const history = main.getByText('暂无电量记录', { exact: true }).locator('..');
    await assertion(history, '暂无电量记录');
    await history.getByRole('button', { name: '查找设备' }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await go('设置');
    await noRepeats();
    const disclaimer = page.getByText('电量以设备或 Windows 上报为准', { exact: true });
    await expect(disclaimer).toHaveCount(1);
    await expect(main.locator('footer').getByText('电量以设备或 Windows 上报为准', { exact: true })).toBeVisible();

    const runtime = page.getByRole('region', { name: '运行与托盘' });
    const trigger = runtime.getByRole('button', { name: '开机启动说明' });
    await expect(trigger).toBeVisible();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await expect(trigger).toHaveAccessibleDescription(/Windows/);
    await runtime.scrollIntoViewIfNeeded();
    if (process.env.COPY_REVIEW_OUT) {
      mkdirSync(process.env.COPY_REVIEW_OUT, { recursive: true });
      await page.screenshot({ path: resolve(process.env.COPY_REVIEW_OUT, '设置-默认.png') });
    }
    await trigger.hover();
    const tip = page.getByRole('tooltip');
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText(/Windows/);
    if (process.env.COPY_REVIEW_OUT) await page.screenshot({ path: resolve(process.env.COPY_REVIEW_OUT, '设置-悬停说明.png') });
    const noTipPos = await main.boundingBox();
    await page.mouse.move(noTipPos.x + 8, noTipPos.y + 12);
    await expect(tip).toHaveCount(0);
    await trigger.focus();
    await expect(trigger).toBeFocused();
    await expect(tip).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tip).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(tip).toHaveCount(0);

    await page.evaluate(() => window.copyReview.publishDevice());
    await go('设备');
    const search = page.getByRole('searchbox', { name: '搜索设备' });
    await search.fill('does not exist');
    const filterEmpty = main.getByText('未找到匹配设备', { exact: true }).locator('..');
    await assertion(filterEmpty, '未找到匹配设备');
    await filterEmpty.getByRole('button', { name: '清除筛选' }).click();
    await expect(search).toHaveValue('');
    await expect(main.getByRole('table')).toBeVisible();
    await go('记录');
    await expect(page.getByLabel('实际查看时段')).toBeVisible();
    await expect(page.getByText('24 小时', { exact: true })).toBeVisible();
    await go('总览');
    await page.getByRole('region', { name: '主设备' }).getByRole('button', { name: '查看详情' }).click();
    await expect(page.getByText('最近更新时间', { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
    console.log('UI copy: headings, empty actions, hidden help, hover, keyboard focus, Escape, real time preserved.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
