// Verifies preference switching through the built renderer, not a CSS/token stub.
const { chromium, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const { join } = require('node:path');
const { mkdirSync } = require('node:fs');
const { installMock } = require('./studio-review-mock.cjs');
const key = 'yudian.appearance.palette';
const entry = pathToFileURL(join(__dirname, '../dist/ui/index.html')).href;
const output = process.env.APPEARANCE_REVIEW_OUT;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--allow-file-access-from-files', '--no-sandbox'] });
  try {
    if (output) mkdirSync(output, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 1586, height: 992 } });
    await page.addInitScript(installMock);
    await page.goto(entry);
    await page.evaluate(() => window.studioReview.ready());
    const shell = page.locator('[data-theme]');
    const go = name => page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name, exact: true }).click();
    const tones = () => shell.evaluate(node => ['--amber', '--red', '--green'].map(key => getComputedStyle(node).getPropertyValue(key)));
    const statusTones = await tones();
    const colors = new Set();
    for (const [id, name] of [['graphite','石墨白'], ['ice','冰蓝灰'], ['warm','暖钛灰']]) {
      await go('设置');
      await page.getByRole('radio', { name }).focus();
      await page.keyboard.press('Space');
      await expect(page.getByRole('radio', { name })).toBeChecked();
      await expect(shell).toHaveAttribute('data-theme', id);
      await go('总览');
      colors.add(await shell.evaluate(node => getComputedStyle(node).backgroundColor));
      expect(await tones()).toEqual(statusTones);
      if (output) await page.screenshot({ path: join(output, name + '-总览.png') });
    }
    expect(colors.size).toBe(3);
    await page.reload();
    await expect(shell).toHaveAttribute('data-theme', 'warm');
    await go('设置');
    await expect(page.getByRole('radio', { name: '暖钛灰' })).toBeChecked();
    await page.getByRole('radio', { name: '石墨白' }).focus();
    await page.keyboard.press('Space');
    if (output) await page.screenshot({ path: join(output, '设置-石墨白.png') });
    await page.evaluate(key => localStorage.setItem(key, 'broken'), key);
    await page.reload();
    await expect(shell).toHaveAttribute('data-theme', 'graphite');
    const restricted = await browser.newPage();
    await restricted.addInitScript(installMock);
    await restricted.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage disabled'); } });
    });
    await restricted.goto(entry);
    await expect(restricted.locator('[data-theme]')).toHaveAttribute('data-theme', 'graphite');
    await restricted.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '设置' }).click();
    await restricted.getByRole('radio', { name: '冰蓝灰' }).focus();
    await restricted.keyboard.press('Space');
    await expect(restricted.locator('[data-theme]')).toHaveAttribute('data-theme', 'ice');
    console.log('Appearance: 3 distinct palettes, fixed alert colors, reload persistence, invalid/blocked storage fallback.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
