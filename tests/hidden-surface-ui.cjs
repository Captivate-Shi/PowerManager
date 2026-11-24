// Browser boundary test: close/recreate renderer against a retained desktop bridge.
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH,
    args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const entry = pathToFileURL(resolve(process.env.POWER_RENDERER_BUILD || 'dist/ui', 'index.html')).href;
  const errors = [];
  async function newRenderer(saved, reading, request) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 920 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ saved, reading, request }) => {
      const mouse = { id: 'mouse', name: '实时鼠标', art: 'mouse', connection: 'USB', watched: false,
        status: 'current', reason: '设备读数正常', lastRead: Date.now(),
        reading: { low: reading, high: reading, raw: reading, power: 'discharging', source: 'hid' } };
      const xbox = { ...mouse, id: 'xbox', name: 'Xbox 实时手柄', art: 'xbox' };
      const snapshot = { devices: [mouse, xbox], settings: { low: 20, critical: 10, muteMinutes: 60, zoom: 100, trayZoom: 100 },
        collector: 'ready', deviceSettings: {}, refreshing: false, alerts: {}, demo: false, mutedUntil: 0 };
      window.observedCold = false;
      new MutationObserver(() => { if (document.querySelector('[data-cold-motion][data-playing], [data-load-state=initial]'))
        window.observedCold = true; }).observe(document, { childList: true, subtree: true, attributes: true });
      window.powerManager = {
        snapshot: async () => snapshot, mainView: async () => saved,
        rememberMainView: async view => { window.saved = view; },
        toast: async () => null, command: async () => ({ ok: true, history: [] }),
        onNavigate: fn => { if (request) queueMicrotask(() => fn(request)); return () => {}; },
        onSnapshot: () => () => {},
      };
    }, { saved, reading, request });
    await page.goto(entry);
    return page;
  }

  try {
    const initial = await newRenderer(undefined, 70);
    await initial.getByRole('button', { name: '列表模式' }).click();
    await initial.getByRole('button', { name: 'Xbox 实时手柄', exact: true }).click();
    await expect.poll(() => initial.evaluate(() => window.saved)).toEqual({
      page: 'overview', selected: undefined, detailId: undefined, featured: 'xbox', mode: 'list',
    });
    const remembered = await initial.evaluate(() => window.saved);
    await initial.close();

    const reopened = await newRenderer(remembered, 58);
    await expect(reopened.locator('[data-mode="list"]')).toBeVisible();
    await expect(reopened.getByRole('button', { name: 'Xbox 实时手柄', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(reopened.getByRole('button', { name: 'Xbox 实时手柄', exact: true })).toContainText(/58/);
    assert.equal(await reopened.evaluate(() => window.observedCold), false);
    await reopened.getByRole('button', { name: '查看详情 · Xbox 实时手柄' }).click();
    await expect(reopened.getByRole('button', { name: '返回总览' })).toBeVisible();
    const detail = await reopened.evaluate(() => window.saved);
    await reopened.close();

    const resumedDetail = await newRenderer(detail, 55);
    await expect(resumedDetail.getByRole('heading', { name: 'Xbox 实时手柄', exact: true })).toBeVisible();
    await expect(resumedDetail.getByRole('button', { name: '返回总览' })).toBeVisible();
    await expect(resumedDetail.getByRole('region', { name: '设备详情' }).getByText('55%', { exact: true })).toBeVisible();
    await resumedDetail.getByRole('button', { name: '返回总览' }).click();
    await expect(resumedDetail.locator('[data-mode="list"]')).toBeVisible();

    const linked = await newRenderer(remembered, 52, 'mouse');
    await expect(linked.getByRole('heading', { name: '实时鼠标', exact: true })).toBeVisible();
    await expect(linked.getByRole('button', { name: '返回设备' })).toBeVisible();
    assert.equal(await linked.evaluate(() => window.observedCold), false);
    assert.deepEqual(errors, []);
    console.log('Main surface recreation: latest warm battery, remembered mode/selection/detail, route override, no cold replay.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
