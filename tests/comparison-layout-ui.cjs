// End-to-end geometry regression for comparison, with controllable IPC responses.
const { chromium, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');
const { mkdirSync } = require('node:fs');
const { installMock } = require('./studio-review-mock.cjs');

const output = process.env.COMPARISON_REVIEW_OUT;
const app = pathToFileURL(resolve('dist/ui/index.html')).href;

async function run() {
  if (output) mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH,
    args: ['--allow-file-access-from-files', '--no-sandbox'] });
  try {
    for (const width of [1250, 760, 520]) {
      const page = await browser.newPage({ viewport: { width, height: 650 }, reducedMotion: 'reduce' });
      try {
        await page.addInitScript(installMock, { portable: true });
        await page.goto(app);
        await page.evaluate(() => {
          window.studioReview.ready();
          const command = window.powerManager.command;
          const gates = Object.create(null);
          window.chartQa = {
            waiting: id => !!gates[id],
            finish: id => gates[id](),
          };
          window.powerManager.command = args => {
            if (args.type !== 'history') return command(args);
            return new Promise(done => { gates[args.id] = () => {
              delete gates[args.id];
              void command(args).then(done);
            }; });
          };
        });
        await page.getByRole('button', { name: '记录', exact: true }).click();
        const controller = page.getByRole('group', { name: '选择对比设备' });
        const section = page.getByRole('region', { name: '电量对比记录' });
        const plot = section.locator('[aria-busy]');
        const summary = section.getByRole('table', { name: /记录摘要/ });
        const rects = () => page.evaluate(() => {
          const pick = selector => {
            const box = document.querySelector(selector).getBoundingClientRect();
            return [box.x, box.y, box.width, box.height];
          };
          return {
            controls: pick('[aria-label="选择对比设备"]'), plot: pick('[aria-label="电量对比记录"] [aria-busy]'),
            legend: pick('[aria-label="图例"]'), summary: pick('table[aria-label*="记录摘要"]'), footer: pick('main > footer'),
            scroll: [window.scrollX, window.scrollY, document.documentElement.scrollHeight, document.documentElement.clientWidth],
          };
        });
        const waiting = id => expect.poll(() => page.evaluate(id => window.chartQa.waiting(id), id)).toBe(true);
        const finish = id => page.evaluate(id => window.chartQa.finish(id), id);
        const compareStable = (before, after) => {
          expect({ ...after, controls: after.controls[1], summary: after.summary.slice(0, 3) })
            .toEqual({ ...before, controls: before.controls[1], summary: before.summary.slice(0, 3) });
        };
        await waiting('mouse'); await waiting('dual');
        await expect(plot.getByRole('status', { name: '正在加载电量历史' })).toBeVisible();
        await expect(summary.locator('[data-pending="true"]')).toHaveCount(2);
        if (output && width === 1250) await page.screenshot({ path: resolve(output, '01-first-loading.png'), fullPage: true });
        await page.evaluate(() => window.scrollTo(0, 120));
        const initial = await rects();
        expect(initial.scroll[1]).toBeGreaterThan(0);
        await finish('dual');
        await expect(plot.getByLabel(/近 24 小时电量曲线/)).toBeVisible();
        await expect(summary.locator('[data-pending="true"]')).toHaveCount(1);
        expect(await rects()).toEqual(initial);
        await finish('mouse');
        await expect(plot).toHaveAttribute('aria-busy', 'false');
        expect(await rects()).toEqual(initial);
        if (output && width === 1250) await page.screenshot({ path: resolve(output, '02-first-settled.png'), fullPage: true });

        await page.evaluate(() => window.scrollTo(0, 0));
        const before = await rects();
        await controller.getByRole('button', { name: '对比设备', exact: true }).click();
        await page.getByRole('menuitemcheckbox', { name: '机械键盘', exact: true }).click();
        await waiting('keyboard');
        await expect(section.getByText('正在更新，暂显示已有记录')).toBeVisible();
        await expect(summary.locator('[data-summary-device="keyboard"]')).toHaveAttribute('data-pending', 'true');
        const add = await rects();
        compareStable(before, add);
        if (output && width === 1250) await page.screenshot({ path: resolve(output, '03-add-loading.png'), fullPage: true });
        await page.evaluate(() => window.scrollTo(0, 120));
        const addScroll = await rects();
        expect(addScroll.scroll[1]).toBeGreaterThan(0);
        await finish('keyboard');
        await expect(plot).toHaveAttribute('aria-busy', 'false');
        expect(await rects()).toEqual(addScroll);
        await page.evaluate(() => window.scrollTo(0, 0));
        await controller.getByRole('button', { name: '移除对比：机械键盘' }).click();
        expect(await rects()).toEqual(before);
        if (output && width === 1250) await page.screenshot({ path: resolve(output, '04-removed.png'), fullPage: true });
        console.log(width + 'px: comparison shell, legend, summary top, footer and scroll stayed stable.');
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
