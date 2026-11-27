// Renderer integration against a loopback origin (secure Clipboard API and persistent origin storage).
const { chromium, expect } = require('@playwright/test');
const { extname, resolve, sep } = require('node:path');
const { installMock } = require('./studio-review-mock.cjs');

async function run() {
  const root = resolve('dist/ui');
  const contentTypes = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
  const origin = 'http://localhost:41292';
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1240, height: 820 }, reducedMotion: 'reduce' });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      const file = resolve(root, '.' + url.pathname);
      if (url.origin !== origin || !file.startsWith(root + sep)) return route.abort();
      await route.fulfill({ path: file, contentType: contentTypes[extname(file)] ?? 'application/octet-stream' });
    });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await context.addInitScript(installMock, { portable: true, longComparisonNames: true });
    const launch = async () => {
      const page = await context.newPage();
      await page.goto(origin + '/index.html');
      await page.evaluate(() => window.studioReview.ready());
      return page;
    };
    let page = await launch();
    const history = async () => {
      await page.getByRole('button', { name: '记录', exact: true }).click();
      return page.getByRole('group', { name: '选择对比设备' });
    };
    const pairs = group => group.locator('[data-device][data-series]').evaluateAll(nodes =>
      nodes.map(node => [node.dataset.device, node.dataset.series]));
    let group = await history();
    await expect.poll(() => pairs(group)).toEqual([['dual','1'], ['mouse','0']]);
    await group.getByRole('button', { name: '对比设备' }).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitemcheckbox')).toHaveText([
      /头戴耳机/, /DualSense/, /Razer BlackWidow/, /Razer Viper/, /Xbox/,
    ]);
    await menu.getByRole('menuitemcheckbox', { name: /^Razer BlackWidow/ }).click();
    const three = [['dual','1'], ['keyboard','2'], ['mouse','0']];
    await expect.poll(() => pairs(group)).toEqual(three);
    const graph = page.getByLabel(/近 24 小时电量曲线/);
    await expect(graph.locator('g[data-series]')).toHaveCount(3);
    const seriesColors = () => page.getByLabel(/近 24 小时电量曲线/).locator('g[data-series]').evaluateAll(nodes =>
      Object.fromEntries(nodes.map(node => [node.dataset.series, node.getAttribute('stroke')])));
    const colors = await seriesColors();
    expect(new Set(Object.values(colors)).size).toBe(3);
    if (process.env.COMPARE_SCREENSHOT) await page.screenshot({ path: process.env.COMPARE_SCREENSHOT });
    await group.locator('[data-device="mouse"]').click();
    const two = three.slice(0, 2);
    await expect.poll(() => pairs(group)).toEqual(two);
    await page.close();
    page = await launch();
    group = await history();
    await expect.poll(() => pairs(group)).toEqual(two);
    await expect.poll(seriesColors).toEqual({ 1: colors[1], 2: colors[2] });
    const text = group.locator('[data-device="keyboard"] span').last();
    await expect(text).toBeVisible();
    const box = await text.boundingBox();
    await page.mouse.move(box.x + 3, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 3, box.y + box.height / 2, { steps: 10 });
    // Move off the button before mouseup so it does not also remove the series.
    await page.mouse.move(box.x + box.width, box.y + box.height + 35);
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => getSelection().toString())).toBe('');
    await expect.poll(() => pairs(group)).toEqual(two);
    await expect(page.locator('img').first()).toHaveJSProperty('draggable', false);

    await page.getByRole('button', { name: '设备', exact: true }).click();
    const search = page.getByRole('searchbox', { name: '搜索设备' });
    await search.fill('DualSense');
    await search.press('Control+a');
    await expect.poll(() => search.evaluate(node => [node.selectionStart, node.selectionEnd])).toEqual([0, 9]);
    const detail = page.getByRole('region', { name: '设备预览' });
    await detail.getByRole('button', { name: '更多操作' }).click();
    const copy = page.getByRole('menuitem', { name: '复制设备信息' });
    await copy.focus();
    await copy.press('Enter');
    await expect(page.getByText('已复制设备信息', { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toMatch(/^DualSense\n电量：[^\n]+\n读取状态：设备读数正常$/);
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
