const { chromium, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');
const { installMock } = require('./studio-review-mock.cjs');

async function run() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--allow-file-access-from-files'] });
  try {
    for (const viewport of [{ width: 1320, height: 850 }, { width: 520, height: 420 }]) {
      const page = await browser.newPage({ viewport });
      await page.addInitScript(installMock);
      await page.addInitScript(() => {
        const animate = Element.prototype.animate;
        Element.prototype.animate = function (...args) {
          const animation = animate.apply(this, args);
          if (this.hasAttribute('data-detail-photo-flight')) {
            animation.pause();
            animation.currentTime = 0;
          }
          return animation;
        };
      });
      await page.goto(pathToFileURL(resolve('dist/ui/index.html')).href);
      await page.evaluate(() => window.studioReview.ready());
      const button = (name, scope = page) => scope.getByRole('button', { name, exact: true });
      const rail = page.getByRole('region', { name: '切换设备' });
      const detail = page.locator('[data-full="true"] [data-detail="true"] img[data-device-art]');
      const flight = page.locator('[data-detail-photo-flight]');
      const fitted = locator => locator.evaluate(async image => {
        await image.decode();
        const box = image.getBoundingClientRect();
        const scale = Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight);
        const width = image.naturalWidth * scale;
        const height = image.naturalHeight * scale;
        return { x: box.x + (box.width - width) / 2,
          y: box.y + (box.height - height) * (getComputedStyle(image).objectPosition.endsWith('100%') ? 1 : .5), width, height };
      });
      const matches = async expected => {
        const box = await flight.boundingBox();
        expect(box).not.toBeNull();
        for (const key of ['x', 'y', 'width', 'height']) expect(Math.abs(box[key] - expected[key]), key).toBeLessThan(1);
      };
      const cropped = () => flight.evaluate(node => getComputedStyle(node).clipPath !== 'inset(0%)');
      const seekEnd = () => flight.evaluate(node => {
        const animation = node.getAnimations()[0];
        animation.currentTime = animation.effect.getTiming().duration;
      });
      const complete = async () => {
        await flight.evaluate(node => node.getAnimations()[0].finish());
        await expect(flight).toHaveCount(0);
      };
      const roundTrip = async (source, trigger, back, masked = false) => {
        const origin = await fitted(source);
        await trigger();
        await expect(flight).toHaveCount(1);
        await matches(origin);
        const croppedOrigin = await cropped();
        if (!masked || viewport.width > 770) expect(croppedOrigin).toBe(masked);
        if (masked) {
          const leftInset = await flight.evaluate(node => {
            const insets = getComputedStyle(node).clipPath.match(/[\d.]+%/g);
            return insets[3] ?? insets[1] ?? insets[0];
          });
          expect(leftInset).toBe('0%');
        }
        const destination = await fitted(detail);
        await seekEnd();
        await matches(destination);
        expect(await cropped()).toBe(false);
        await complete();
        await button(back).click();
        await expect(flight).toHaveCount(1);
        await matches(destination);
        await seekEnd();
        await matches(await fitted(source));
        expect(await cropped()).toBe(croppedOrigin);
        await complete();
      };
      const stage = page.locator('[data-active-stage] img[data-device-art]');
      await roundTrip(stage, () => page.getByRole('group', { name: '主设备视觉展示' }).dblclick(), '返回总览');
      await button('列表模式').click();
      await expect(page.locator('[data-overview-morph]')).toHaveCount(0);
      const halfPhoto = page.locator('[data-list-art-layer]:not([data-exiting]) img[data-device-art]');
      const otherRow = button('无线鼠标', rail);
      const background = await otherRow.evaluate(node => getComputedStyle(node).backgroundColor);
      await otherRow.hover();
      expect(await otherRow.evaluate(node => getComputedStyle(node).backgroundColor)).toBe(background);
      await roundTrip(halfPhoto, () => button('DualSense', rail).dblclick(), '返回总览', true);
      const nav = page.getByRole('navigation', { name: '主导航' });
      await button('设备', nav).click();
      if (viewport.width < 600) {
        const positions = await page.getByRole('table', { name: /设备（/ }).evaluate(table => {
          const pane = table.parentElement;
          const title = document.querySelector('[data-page-heading="devices"]');
          const y = () => [title.getBoundingClientRect().top, table.tHead.getBoundingClientRect().top];
          const before = y();
          pane.scrollTop = 80;
          const after = y();
          const amount = pane.scrollTop;
          pane.scrollTop = 0;
          return { before, after, amount };
        });
        expect(positions.amount).toBeGreaterThan(0);
        expect(positions.after).toEqual(positions.before);
      }
      const preview = page.getByRole('region', { name: '设备预览' }).locator('img[data-device-art]');
      await roundTrip(preview, () => button('DualSense').dblclick(), '返回设备');
      await roundTrip(preview, () => preview.dblclick(), '返回设备');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await button('DualSense').dblclick();
      await expect(page.getByRole('region', { name: '设备详情' })).toBeVisible();
      await expect(flight).toHaveCount(0);
      await page.close();
      console.log(viewport.width + 'px: stage, half image and right preview match both endpoints.');
    }
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
