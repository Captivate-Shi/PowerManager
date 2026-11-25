// Renderer regression: delayed image responses for preloaded and mounted images.
const { chromium, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');
const { installMock } = require('./studio-review-mock.cjs');
const entry = pathToFileURL(resolve(process.env.STUDIO_REVIEW_DIST || 'dist/ui/index.html')).href;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH,
    args: ['--allow-file-access-from-files', '--no-sandbox'] });
  try {
    for (const mode of ['stage', 'list']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      try {
        await page.addInitScript(installMock, {});
        await page.route('**/keyboard-hero.webp', async route => {
          await new Promise(resolve => setTimeout(resolve, 620));
          await route.continue();
        });
        await page.goto(entry);
        await page.evaluate(() => studioReview.ready());
        if (mode === 'list') {
          await page.getByRole('button', { name: '列表模式', exact: true }).click();
          await expect(page.locator('[data-mode-hero]')).toHaveCount(0);
        }
        await page.getByRole('region', { name: '切换设备' }).getByRole('button', { name: '机械键盘', exact: true }).click();
        const result = await page.evaluate(async mode => {
          const start = performance.now();
          let blank = 0, frames = 0, outgoingVisible = false, newReady = false;
          while (performance.now() - start < 1750) {
            await new Promise(requestAnimationFrame);
            const nodes = [...document.querySelectorAll(mode === 'list' ? '[data-list-art-layer]' : '[data-stage-layer]')];
            const visible = nodes.filter(node => {
              const img = node.querySelector('img');
              return Boolean(img?.complete && img.naturalWidth && Number(getComputedStyle(node).opacity) > .07);
            });
            if (!visible.length) blank++;
            frames++;
            outgoingVisible ||= visible.some(node => node.hasAttribute('data-exiting') || node.hasAttribute('data-departing'));
            newReady ||= visible.some(node => (node.dataset.deviceId ?? node.dataset.stageLayer) === 'keyboard');
          }
          return { blank, frames, outgoingVisible, newReady };
        }, mode);
        expect(result.blank).toBe(0);
        expect(result.outgoingVisible).toBe(true);
        expect(result.newReady).toBe(true);
        console.log(mode, result);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
