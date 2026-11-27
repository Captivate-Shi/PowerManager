const { chromium, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');
const { installMock } = require('./studio-review-mock.cjs');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--allow-file-access-from-files', '--no-sandbox'] });
  try {
    for (const kind of ['low', 'critical']) {
      const page = await browser.newPage({ viewport: { width: 460, height: 146 }, reducedMotion: 'reduce' });
      await page.addInitScript(installMock, { scenario: 'legacy' });
      await page.goto(pathToFileURL(resolve('dist/ui/index.html')).href + '?surface=toast&kind=' + kind + '&long=1');
      const body = page.locator('[data-toast-body]');
      await expect(body).toBeVisible();
      await body.click();
      await expect(body).toBeVisible();
      expect(await page.evaluate(() => studioReview.commands)).toEqual([]);
      await expect(body).not.toHaveAttribute('role', 'button');
      await page.keyboard.press('Tab');
      const detail = page.getByRole('button', { name: '查看详情', exact: true });
      await expect(detail).toBeFocused();
      await detail.press('Enter');
      expect(await page.evaluate(() => studioReview.commands.at(-1))).toEqual({ type: 'open', id: 'headset' });
      await page.getByRole('button', { name: '关闭通知', exact: true }).click();
      expect(await page.evaluate(() => studioReview.commands.at(-1))).toEqual({ type: 'closeSurface' });
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
