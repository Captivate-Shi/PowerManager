// Measure visible containment during the lazy-chart history request, not after it settles.
const { chromium, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');
const { mkdirSync } = require('node:fs');
const { installMock } = require('./studio-review-mock.cjs');

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--allow-file-access-from-files', '--no-sandbox'],
  });
  const dist = pathToFileURL(resolve('dist/ui/index.html')).href;
  const output = process.env.LOADING_REVIEW_OUT;
  if (output) mkdirSync(output, { recursive: true });
  try {
    for (const reducedMotion of ['no-preference', 'reduce']) {
      for (const detail of [true, false]) {
        const page = await browser.newPage({ viewport: { width: 1250, height: 760 }, reducedMotion });
        try {
          await page.addInitScript(installMock, { portable: true });
          await page.goto(dist + (detail ? '?detail=mouse' : ''));
          await page.evaluate(() => window.studioReview.ready());
          if (!detail) await page.getByRole('button', { name: '记录', exact: true }).click();
          if (detail) await expect(page.getByRole('heading', { name: /电量趋势/ })).toBeVisible();
          const skeleton = page.locator('[aria-busy="true"]').getByRole('status', { name: '正在加载电量历史' });
          await expect(skeleton).toBeVisible();
          const loading = await skeleton.evaluate(el => {
            const box = el.getBoundingClientRect();
            const plot = el.parentElement.getBoundingClientRect();
            const grid = el.querySelector('svg').getBoundingClientRect();
            const legend = el.parentElement.nextElementSibling.getBoundingClientRect();
            const style = getComputedStyle(el);
            const actor = getComputedStyle(el, '::after');
            return {
              height: box.height, delta: Math.abs(box.height - plot.height), gridBottom: grid.bottom,
              plotBottom: plot.bottom, legendTop: legend.top, background: style.backgroundColor,
              border: style.borderTopWidth, shadow: style.boxShadow, animation: actor.animationName,
            };
          });
          expect(loading.delta).toBeLessThan(1);
          expect(loading.gridBottom).toBeLessThan(loading.plotBottom);
          expect(loading.plotBottom).toBeLessThanOrEqual(loading.legendTop);
          expect(loading.background).toBe('rgba(0, 0, 0, 0)');
          expect(loading.border).toBe('0px');
          expect(loading.shadow).toBe('none');
          expect(loading.animation).toBe('none');
          if (output && reducedMotion === 'no-preference') {
            await skeleton.locator('..').locator('..').screenshot({ path: resolve(output, detail ? '01-detail-loading.png' : '03-history-loading.png') });
          }
          const graph = page.getByLabel(/近 (24|7)/).filter({ has: page.locator('[data-trace]') }).first();
          await expect(graph).toBeVisible();
          expect(Math.abs((await graph.boundingBox()).height - loading.height)).toBeLessThan(1);
          await graph.focus();
          await graph.press('End');
          await expect(graph).toBeFocused();
          expect(await graph.evaluate(node => getComputedStyle(node).outlineStyle)).not.toBe('none');
          if (output && reducedMotion === 'no-preference') {
            await graph.evaluate(node => node.blur());
            await graph.locator('..').locator('..').screenshot({ path: resolve(output, detail ? '02-detail-settled.png' : '04-history-settled.png') });
          }
        } finally { await page.close(); }
      }
    }
  } finally { await browser.close(); }
  console.log('Chart loader has no perimeter; guides stay above legend, transitions keep plot height, keyboard focus works, reduced motion verified.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
