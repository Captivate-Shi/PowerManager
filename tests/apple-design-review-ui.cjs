// As-built renderer: only the preload boundary is mocked.
const { chromium, expect } = require('@playwright/test');
const { mkdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { installMock } = require('./studio-review-mock.cjs');

const app = pathToFileURL(resolve(process.env.STUDIO_REVIEW_DIST || 'dist/ui/index.html')).href;
const out = process.env.DESIGN_REVIEW_OUT;
const button = (scope, name) => scope.getByRole('button', { name, exact: true });

async function main() {
  if (out) mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH,
    args: ['--allow-file-access-from-files', '--no-sandbox'] });
  try {
    for (const [width, height, reducedMotion] of [[1250, 760, 'no-preference'], [760, 600, 'no-preference'], [520, 430, 'reduce']]) {
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion, locale: 'zh-CN' });
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      try {
        await page.addInitScript(installMock, { portable: true, historyDelay: 350 });
        await page.goto(app);
        await page.evaluate(() => window.studioReview.ready());
        const mainNav = page.getByRole('navigation', { name: '主导航' });
        const open = label => button(mainNav, label).click();
        await open('设置');
        const nav = page.getByRole('navigation', { name: '设置分类' });
        for (const [label, id] of [['诊断', 'diagnostics'], ['记录', 'history'], ['运行与托盘', 'runtime']]) {
          await button(nav, label).click();
          await expect(button(nav, label)).toHaveAttribute('aria-current', 'location');
          await expect.poll(() => page.locator('#settings-' + id + ' h2').evaluate(el => {
            const heading = el.getBoundingClientRect();
            const pane = el.closest('[data-scroll-pane]').getBoundingClientRect();
            return heading.top >= pane.top - 2 && heading.bottom <= pane.bottom + 2;
          })).toBe(true);
          // Smooth scrolling may pass other section headings; let it finish.
          await page.waitForTimeout(520);
          await expect(button(nav, label)).toHaveAttribute('aria-current', 'location');
        }
        if (out && width === 1250) await page.screenshot({ path: resolve(out, 'settings-category.png') });
        await page.mouse.move(width - 30, height / 2);
        await page.mouse.wheel(0, -1700);
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
        await expect(button(nav, '外观')).toHaveAttribute('aria-current', 'location');
        if (out && width === 1250) await page.screenshot({ path: resolve(out, 'settings-layout.png') });

        await open('记录');
        const panel = page.getByRole('region', { name: '电量对比记录' });
        const controls = page.getByRole('group', { name: '选择对比设备' });
        const chip = id => controls.locator('[data-device="' + id + '"]');
        const curve = slot => panel.locator('g[data-series="' + slot + '"]');
        const summaryColor = id => panel.locator('[data-summary-device="' + id + '"] i')
          .evaluate(el => getComputedStyle(el).backgroundColor);
        const color = id => chip(id).locator('i').evaluate(el => getComputedStyle(el).backgroundColor);
        const ready = () => expect(panel.locator('[aria-busy]')).toHaveAttribute('aria-busy', 'false');
        await ready();
        await button(controls, '对比设备').click();
        await page.getByRole('menuitemcheckbox', { name: '机械键盘', exact: true }).click();
        await ready();
        const colors = [await color('dual'), await color('keyboard')];
        await chip('mouse').focus();
        await chip('mouse').press('Enter');
        await expect(button(controls, '对比设备')).toBeFocused();
        await expect(chip('mouse')).toHaveCount(0);
        await expect(chip('dual')).toHaveAttribute('data-series', '1');
        await expect(chip('keyboard')).toHaveAttribute('data-series', '2');
        expect([await color('dual'), await color('keyboard')]).toEqual(colors);
        expect([await summaryColor('dual'), await summaryColor('keyboard')]).toEqual(colors);
        await expect(curve(1)).toHaveAttribute('stroke', '#cbbbf1');
        await expect(curve(2)).toHaveAttribute('stroke', '#a2c9ba');
        await open('提醒');
        await open('记录');
        await ready();
        await expect(chip('mouse')).toHaveCount(0);
        await expect(chip('keyboard')).toHaveAttribute('data-series', '2');
        await expect(curve(1)).toHaveAttribute('stroke', '#cbbbf1');
        await expect(curve(2)).toHaveAttribute('stroke', '#a2c9ba');
        await page.getByRole('combobox', { name: '记录范围' }).click();
        await page.getByRole('option', { name: '7 天', exact: true }).click();
        await ready();
        await expect(chip('keyboard')).toHaveAttribute('data-series', '2');
        await expect(curve(1)).toHaveAttribute('stroke', '#cbbbf1');
        const dates = await panel.locator('[data-time-tick] text').allTextContents();
        expect(dates.length).toBeGreaterThan(2);
        expect(new Set(dates).size).toBe(dates.length);
        if (out && width === 1250) await page.screenshot({path: resolve(out, 'history-comparison.png')});
        expect(errors).toEqual([]);
        console.log(width + '×' + height + ' (' + reducedMotion + '): settings scroll and history colors, focus, tab and range verified');
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
