const { chromium, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');
const { performance } = require('node:perf_hooks');

(async function () {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH,
    args: ['--no-sandbox', '--allow-file-access-from-files', '--disable-accelerated-video-decode'] });
  const url = pathToFileURL(resolve(__dirname, '../dist/ui/index.html')).href;
  const proof = process.env.MOTION_PROOF;
  const baseline = process.env.MOTION_BASELINE;
  const results = [];
  const ready = '[data-load-state="ready"], [data-load-state="refreshing"]';
  const clip = '[data-cold-motion]';
  async function run(mode, options = {}) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: options.reduced ? 'reduce' : 'no-preference' });
    const requested = [];
    if (options.cpu) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: options.cpu });
    }
    page.on('request', request => { if (request.url().includes('startup-microdust.webm')) requested.push(request.url()); });
    await page.addInitScript(({ mode, delay, broken, late }) => {
      if (broken) {
        const set = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src').set;
        Object.defineProperty(HTMLMediaElement.prototype, 'src', { set(url) {
          return set.call(this, String(url).replace('startup-microdust.webm', 'does-not-exist.webm'));
        } });
      }
      if (late) {
        const native = HTMLVideoElement.prototype.requestVideoFrameCallback;
        HTMLVideoElement.prototype.requestVideoFrameCallback = function(callback) {
          return native.call(this, (...args) => setTimeout(() => callback(...args), 850));
        };
      }
      const mouse = { id: 'local', name: '工作鼠标', art: 'mouse', connection: 'USB', watched: true,
        status: 'stale', reason: '等待新读数', lastRead: Date.now() - 3600000,
        reading: { low: 9, high: 9, raw: 9, power: 'charging', source: 'hid' } };
      const first = { devices: mode === 'warm' ? [mouse] : [],
        settings: { low: 20, critical: 10, muteMinutes: 60, zoom: 100, trayZoom: 100 },
        collector: mode === 'direct-ready' ? 'ready' : 'starting', deviceSettings: {}, refreshing: false, alerts: {}, demo: false, mutedUntil: 0 };
      const metrics = window.metrics = {};
      let handler;
      window.publish = (collector = 'ready') => {
        metrics.publish = performance.now();
        handler?.({ ...first, collector, devices: collector === 'ready' ? [{ ...mouse, status: 'current' }] : [] });
      };
      new MutationObserver(() => {
        if (document.querySelector('[data-load-state="initial"]') && metrics.static == null) metrics.static = performance.now();
        if (document.querySelector('[data-cold-motion][data-playing]') && metrics.motion == null) metrics.motion = performance.now();
        if (document.querySelector('[data-load-state="ready"], [data-load-state="refreshing"]') && metrics.ready == null) metrics.ready = performance.now();
      }).observe(document, { subtree: true, childList: true, attributes: true });
      window.powerManager = {
        snapshot: async () => first, toast: async () => null, command: async () => ({ ok: true }),
        onNavigate: () => () => {}, onSnapshot: callback => { handler = callback; return () => {}; },
      };
      if (delay != null) {
        const start = new MutationObserver(() => {
          if (!document.querySelector('[data-load-state="initial"]')) return;
          start.disconnect();
          setTimeout(() => window.publish(), delay);
        });
        start.observe(document, { subtree: true, childList: true, attributes: true });
      }
    }, { mode, delay: options.delay, broken: options.broken, late: options.late });
    let quality;
    try {
      await page.goto((options.baseline || url) + (options.tray ? '?surface=tray' : ''));
      if (options.motion) {
        const initial = page.locator('[data-load-state="initial"]');
        await expect(initial.getByRole('status')).toHaveText('正在读取设备…');
        for (const name of ['切换设备', '主设备']) await expect(initial.getByRole('region', {name})).toHaveCount(0);
        await expect(initial.getByRole('progressbar')).toHaveCount(0);
        if (proof) await page.screenshot({ path: proof + '/01-static.png' });
        await expect(page.locator(clip + '[data-playing]')).toBeAttached();
        if (proof) {
          await page.waitForTimeout(900);
          await page.screenshot({ path: proof + '/02-motion.png' });
        }
        quality = await page.locator(clip).evaluate(video => {
          const { totalVideoFrames, droppedVideoFrames } = video.getVideoPlaybackQuality();
          return { totalVideoFrames, droppedVideoFrames };
        });
        await page.evaluate(() => window.publish());
        await expect(page.locator('[data-cold-reveal]')).toHaveCount(1);
        await expect(page.getByRole('button', { name: '查看详情' })).toBeEnabled();
        const exit = await page.locator('[data-cold-copy][data-exiting]').evaluate(node => ({
          name: getComputedStyle(node).animationName, hidden: node.getAttribute('aria-hidden'),
        }));
        expect(exit.name).toContain('cold-copy-exit');
        expect(exit.hidden).toBe('true');
        const image = page.locator('img[data-cold-photo][data-cold-photo-loaded]');
        await expect(image).toHaveCount(1);
        expect(await image.evaluate(node => getComputedStyle(node).animationName)).toContain('cold-photo-reveal');
      } else if (options.fallback) {
        const stage = page.locator('[data-load-state="initial"]');
        await expect(stage.getByRole('status')).toBeVisible();
        await page.waitForTimeout(980);
        await expect(page.locator(clip + '[src]')).toHaveCount(0);
        await expect(stage.getByRole('status')).toBeVisible();
        await page.evaluate(() => window.publish());
      } else if (mode === 'warm') {
        await expect(page.getByText(options.tray ? '显示上次记录' : '工作鼠标', {exact: true}).first()).toBeVisible();
        await page.waitForTimeout(350);
        if (!options.tray) await page.evaluate(() => window.publish());
      }
      if (!options.tray) await expect(page.locator(ready)).toBeVisible();
      await page.waitForTimeout(180);
      const timing = await page.evaluate(() => ({ ...window.metrics, firstPaint: performance.getEntriesByName('first-contentful-paint')[0]?.startTime }));
      if (options.motion) {
        if (!timing.motion || timing.motion < timing.static + 140 || requested.length < 1) throw Error(JSON.stringify({timing, requested}));
        await expect(page.locator(clip + '[src]')).toHaveCount(0);
      } else if (options.label !== 'enhanced-bench' && timing.motion != null) throw Error('Unexpected visible motion: ' + JSON.stringify(timing));
      if (options.reduced) await expect(page.locator('[data-cold-copy], [data-cold-reveal], [data-cold-photo]')).toHaveCount(0);
      if (options.noRequest && requested.length) throw Error('Unexpected media request: ' + requested.join());
      results.push({ mode: options.label || mode, ...timing, requests: requested.length, quality });
      if (proof && options.motion) await page.screenshot({ path: proof + '/03-live-ready.png' });
      if (options.motion) {
        const nav = page.getByRole('navigation', { name: '主导航' });
        await nav.getByRole('button', { name: '设备', exact: true }).click();
        await nav.getByRole('button', { name: '总览', exact: true }).click();
        await expect(page.locator('[data-cold-copy], [data-cold-reveal], [data-cold-photo], [data-cold-motion][src]')).toHaveCount(0);
      }
      if ((mode === 'warm' && !options.tray) || mode === 'direct-ready') {
        await expect(page.locator('[data-cold-copy], [data-cold-reveal], [data-cold-photo]')).toHaveCount(0);
      }
    } finally { await page.close(); }
  }
  try {
    for (let i=0;i<5;i++) {
      const before = () => baseline && run('cold', { delay: 430, baseline, label: 'baseline' });
      const after = () => run('cold', { delay: 430, label: 'enhanced-bench' });
      if (i % 2) { await after(); await before(); }
      else { await before(); await after(); }
    }
    await run('cold', { motion: true, label: 'cold-slow' });
    await run('cold', { delay: 45, noRequest: true, label: 'cold-fast' });
    await run('cold', { delay: 430, reduced: true, noRequest: true, label: 'reduced' });
    await run('cold', { broken: true, fallback: true, label: 'media-error' });
    await run('cold', { late: true, fallback: true, label: 'missed-frame-deadline' });
    await run('cold', { cpu: 4, delay: 45, noRequest: true, label: 'cpu4x-fast' });
    await run('warm', { noRequest: true });
    await run('warm', { tray: true, noRequest: true, label: 'tray' });
    await run('direct-ready', { noRequest: true });
    console.log(JSON.stringify(results, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
