// Production web renderer; only the preload / device data boundary is mocked.
const { chromium, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');
const { installMock } = require('./studio-review-mock.cjs');
const app = pathToFileURL(resolve(process.env.STUDIO_REVIEW_DIST || 'dist/ui/index.html')).href;
const button = (scope, name) => scope.getByRole('button', { name, exact: true });
const waitFrame = page => page.evaluate(() => new Promise(requestAnimationFrame));

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH,
    args: ['--allow-file-access-from-files', '--no-sandbox'] });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1586, height: 992 }, locale: 'zh-CN' });
    page.on('pageerror', e => errors.push(String(e)));
    await page.addInitScript(installMock, { scenario: 'cold', historyDelay: 320 });
    await page.goto(app);
    await expect(page.getByRole('heading', { name: '正在识别设备' })).toBeVisible();
    const collision = await page.evaluate(async () => {
      studioReview.detect('xbox');
      const end = performance.now() + 310;
      const samples = [];
      while (performance.now() < end) {
        await new Promise(requestAnimationFrame);
        const cold = document.querySelector('[data-cold-copy]');
        const title = document.querySelector('[aria-label="主设备"] h2');
        if (!cold || !title) continue;
        samples.push([Number(getComputedStyle(cold).opacity), Number(getComputedStyle(title.parentElement).opacity)]);
      }
      return samples;
    });
    expect(collision.length).toBeGreaterThan(5);
    expect(collision.every(([a, b]) => a * b <= .005)).toBe(true);
    await page.evaluate(() => studioReview.revealAll());
    const hero = page.getByRole('region', { name: '主设备', exact: true });
    const stage = hero.getByRole('group', { name: '主设备视觉展示' });
    const art = stage.locator('[data-active-stage] img[data-device-art]');
    await expect(art).toHaveAttribute('src', /xbox-hero.webp$/);
    await art.evaluate(node => node.decode());
    const flight = () => page.evaluate(async () => {
      const bounds = () => { const n = document.querySelector('[data-detail-photo-flight]'); if (!n) return;
        const { x, y, width, height } = n.getBoundingClientRect(); return [x,y,width,height]; };
      const trigger = document.querySelector('[aria-label="主设备"] button');
      trigger.focus(); trigger.click();
      const start = performance.now();
      do { await new Promise(requestAnimationFrame); } while (!bounds() && performance.now() - start < 600);
      await new Promise(resolve => setTimeout(resolve, 84));
      const before = bounds();
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true }));
      return { before, after:bounds() };
    });
    const reversed = await flight();
    expect(reversed.before).toBeTruthy();
    expect(reversed.after).toBeTruthy();
    expect(reversed.before.every((n, i) => Math.abs(n - reversed.after[i]) < 2)).toBe(true);
    await expect(page.locator('[data-detail-photo-flight]')).toHaveCount(0);
    await expect(button(hero, '查看详情')).toBeFocused();
    const box = await stage.boundingBox();
    const x = box.x + box.width * .52, y = box.y + box.height * .38;
    const artX = () => art.evaluate(node => node.getBoundingClientRect().x);
    const start = await artX();
    await page.mouse.move(x,y); await page.mouse.down(); await page.mouse.move(x + 100, y, { steps: 6 });
    await waitFrame(page);
    expect(Math.abs(await artX() - start - 100)).toBeLessThan(2);
    await page.mouse.move(x + 28, y, { steps: 6 }); await page.waitForTimeout(130); await page.mouse.up();
    await expect(art).toHaveAttribute('src', /xbox-hero.webp$/);
    await expect.poll(async () => Math.abs(await artX() - start)).toBeLessThan(1);
    // Deterministic tight-timing flick, alongside the real pointer geometry check above.
    const flickX = await stage.evaluate(node => {
      const event = (type, x, timeStamp) => {
        const e = new PointerEvent(type, { bubbles:true, buttons:1, button:0, pointerId:99,
          isPrimary:true, pointerType:'mouse', clientX:x, clientY:260 });
        Object.defineProperty(e, 'timeStamp', { value:timeStamp });
        node.dispatchEvent(e);
      };
      const capture = node.setPointerCapture;
      node.setPointerCapture = () => {};
      event('pointerdown', 500, 1000); event('pointermove', 510, 1010); event('pointermove', 530, 1030);
      const before = node.querySelector('[data-active-stage]').getBoundingClientRect().x;
      event('pointerup', 530, 1033); node.setPointerCapture = capture;
      const after = node.querySelector('[data-departing]').getBoundingClientRect().x;
      return { before, after };
    });
    expect(Math.abs(flickX.before - flickX.after)).toBeLessThan(2);
    await expect(hero.getByRole('heading')).toHaveCount(1);
    await expect(hero.getByRole('heading', {name:'Xbox 无线手柄', exact:true})).toHaveCount(0);
    // Switching back during the flick reuses the outgoing Xbox as-is.
    const stageReversal = await page.evaluate(() => {
      const bounds = node => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return { rect: [x,y,width,height], opacity: Number(getComputedStyle(node).opacity) };
      };
      const prior = document.querySelector('[data-stage-layer=xbox][data-departing]');
      if (!prior) return null;
      const before = bounds(prior);
      document.querySelector('[aria-label="切换设备"] button[title="Xbox 无线手柄"]').click();
      return { before, after: bounds(document.querySelector('[data-stage-layer=xbox][data-active-stage]')) };
    });
    expect(stageReversal).toBeTruthy();
    expect(stageReversal.before.rect.every((n, i) => Math.abs(n - stageReversal.after.rect[i]) < 2)).toBe(true);
    expect(Math.abs(stageReversal.before.opacity - stageReversal.after.opacity)).toBeLessThan(.02);
    await expect(stage.locator('[data-departing]')).toHaveCount(0);
    const nav = page.getByRole('navigation', { name: '主导航' });
    const go = name => button(nav, name).click();
    await go('记录');
    const range = page.getByRole('combobox', { name: '记录范围' });
    await range.click(); await page.getByRole('option', { name:'7 天', exact:true }).click();
    await expect(page.getByLabel(/近 7 天每日最低读数/)).toBeVisible();
    const plot = page.locator('[data-chart-range=week]');
    await expect(plot.locator('[data-daily-point]').first()).toHaveAttribute('r','3.2');
    expect(await plot.locator('[data-daily-range]').evaluateAll(nodes => nodes.some(node => /h6.*V.*h6/.test(node.getAttribute('d'))))).toBe(true);
    await expect(plot.locator('path[data-trace=exact]:not([d=""])')).toHaveCount(0);
    expect(await page.evaluate(() => studioReview.commands.some(c => c.type === 'settings' && c.patch.historyRetention))).toBe(false);
    await go('设置');
    const defaultRange = page.getByRole('combobox',{name:'记录保留上限'});
    await expect(defaultRange).toHaveText('365 天');
    await defaultRange.click(); await page.getByRole('option', { name: '30 天', exact: true }).click();
    await button(page.getByRole('dialog'), '缩短并清理').click();
    await expect(defaultRange).toHaveText('30 天');
    expect(await page.evaluate(() => studioReview.commands.some(c => c.type === 'settings' && c.patch.historyRetention === 'month'))).toBe(true);
    await go('记录'); await expect(range).toHaveText('7 天');

    await page.emulateMedia({ reducedMotion:'reduce' });
    await go('总览'); await button(hero,'查看详情').click();
    await expect(page.locator('[data-detail-photo-flight]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await stage.focus(); await stage.press('ArrowRight');
    await expect(stage.locator('[data-departing]')).toHaveCount(0);
    expect(errors).toEqual([]);
    console.log(JSON.stringify({ coldFrames: collision.length, detailReversal: reversed, directDragPx: 100, flickX, retentionIndependent: true, reducedMotion: true }));
  } finally { await browser.close(); }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
