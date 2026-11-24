// Smoke-test the portable HTML without a server or Internet, with production UI + mock commands.
const { chromium, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');

async function main() {
  const target = pathToFileURL(resolve(process.argv[2] || '余电-交互预览-离线Mock.html')).href;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, offline: true, locale: 'zh-CN' });
    const errors = [];
    const http = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/^https?:/.test(request.url())) http.push(request.url()); });
    await page.goto(target);
    const hero = page.getByRole('region', { name: '主设备' });
    await expect(hero.getByText('10–20%', { exact: true })).toBeVisible();
    const nav = page.getByRole('navigation', { name: '主导航' });
    const go = name => nav.getByRole('button', { name, exact: true }).click();
    const photos = await page.locator('img[data-device-art]:visible').evaluateAll(async imgs => {
      await Promise.all(imgs.map(img => img.decode()));
      return imgs.length >= 4 && imgs.every(img => img.src.startsWith('data:image/') && img.naturalWidth > 0);
    });
    expect(photos).toBe(true);
    await page.getByRole('button', { name: '立即刷新', exact: true }).click();
    await expect(hero.getByText('正在更新 · 保留上次读数')).toBeVisible();
    await expect(hero.getByText('20–30%', { exact: true })).toBeVisible();
    await hero.getByRole('button', { name: '查看详情' }).click();
    await expect(page.getByRole('region', { name: '设备详情' })).toBeVisible();
    await go('提醒');
    const toastTransition = page.waitForURL(/surface=toast/);
    await page.getByRole('button', { name: '发送低电量测试通知' }).click();
    await toastTransition;
    await expect(page.getByRole('main', { name: '桌面电量提醒' })).toBeVisible();
    await page.getByRole('button', { name: '关闭通知' }).click();
    await expect(hero.getByText('10–20%', { exact: true })).toBeVisible();
    await nav.getByRole('button', { name: /^(记录|历史)$/ }).click();
    await expect(page.locator('[data-trace=range]:not([d=""])').first()).toBeVisible();
    await go('设置');
    await expect(page.getByRole('slider', { name: '主界面缩放滑块' })).toBeVisible();
    await page.getByRole('radio', { name: '暖钛灰' }).check();
    await expect(page.locator('[data-view=settings]')).toHaveAttribute('data-theme', 'warm');
    expect(errors).toEqual([]);
    expect(http).toEqual([]);
    console.log('Portable HTML verified: offline file://, mock refresh states, embedded art, detail, charts, settings and toast.');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
