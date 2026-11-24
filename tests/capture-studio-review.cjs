// V2 visual baseline, with a deterministic mock at its real preload API boundary.
// This script assumes the old known-device silhouette at startup. For current
// renderer builds, use capture-studio-walkthrough.cjs (cold/cached startup).
// Build first. Optional CHROMIUM_PATH, STUDIO_REVIEW_OUT, STUDIO_REVIEW_DIST,
// STUDIO_REVIEW_BASELINE_HTML and FFMPEG_PATH.
const { chromium, expect } = require('@playwright/test');
const { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { installMock } = require('./studio-review-mock.cjs');

const output = resolve(process.env.STUDIO_REVIEW_OUT || 'studio-review-captures');
const dist = pathToFileURL(resolve(process.env.STUDIO_REVIEW_DIST || join(__dirname, '../dist/ui/index.html'))).href;
const viewport = { width: 1586, height: 992 };
const files = [];
const screenshot = async (page, name, fullPage = false) => {
  await page.screenshot({ path: join(output, name + '.png'), fullPage, caret: 'hide' });
  files.push(name + '.png');
};

async function assetCheck(page) {
  return page.locator('img[data-device-art]:visible').evaluateAll(async nodes => {
    await Promise.all(nodes.map(img => img.decode().catch(() => {})));
    return nodes.length > 0 && nodes.every(img => img.complete && img.naturalWidth > 0);
  });
}

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = pathname => hash(readFileSync(pathname));
const assetKeys = {
  stage: 'stage.webp', initialDualSense: 'dualsense-loading.webp', dualsense: 'dualsense-hero.webp',
  xbox: 'xbox-hero.webp', mouse: 'mouse-hero.webp', keyboard: 'keyboard-hero.webp',
  dualsenseThumb: 'dualsense-thumb.webp', xboxThumb: 'xbox-thumb.webp',
  mouseThumb: 'mouse-thumb.webp', keyboardThumb: 'keyboard-thumb.webp',
};
function priorAssets() {
  const path = process.env.STUDIO_REVIEW_BASELINE_HTML;
  if (!path) return null;
  const match = readFileSync(path, 'utf8').match(/const assets = (\{[^\n]+\});/);
  if (!match) throw Error('Unexpected original standalone preview asset schema');
  return JSON.parse(match[1]);
}
function compareAssets(proven) {
  const embedded = priorAssets();
  if (!embedded) return undefined;
  return Object.fromEntries(Object.entries(proven).map(([kind, current]) => {
    const baseline = embedded['./assets/studio-v2/' + assetKeys[kind]];
    return [kind, baseline ? hash(Buffer.from(baseline.split(',')[1], 'base64')) !== current : null];
  }));
}
async function verifyBackground(page) {
  const src = await page.locator('[data-view=overview]').evaluate(async shell => {
    const bg = getComputedStyle(shell, '::before').backgroundImage;
    const uri = bg.match(/url\("(file:[^"]+?\/studio-v2\/stage\.webp)"\)/)?.[1];
    if (!uri) throw Error('The stage image is not included in the actual background paint');
    const image = new Image();
    image.src = uri;
    await image.decode();
    if (image.naturalWidth < 500) throw Error('Unexpected stage dimensions');
    return uri;
  });
  const fromDist = digest(fileURLToPath(src));
  expect(fromDist).toBe(digest(join(__dirname, '../public/assets/studio-v2/stage.webp')));
  return fromDist;
}
const meterPaint = meter => meter.evaluate(node => {
  const props = el => {
    const css = getComputedStyle(el);
    return [css.background, css.opacity, css.transform, css.animationName, el.offsetWidth, el.offsetHeight];
  };
  const after = getComputedStyle(node, '::after');
  return { track: props(node), fill: [...node.children].map(props), railPulse: after.animationName };
});
async function verifyStageAsset(stage, art, variant = 'hero') {
  const photo = stage.locator('img[data-device-art]:visible');
  await expect(photo).toHaveCount(1);
  const { src, width, fallback } = await photo.evaluate(async img => {
    await img.decode();
    return { src: img.currentSrc, width: img.naturalWidth, fallback: img.getAttribute('data-fallback') };
  });
  expect(fallback, 'must not be old fallback art').toBeNull();
  expect(width).toBeGreaterThan(100);
  expect(src).toMatch(new RegExp('/studio-v2/' + art + '-' + variant + '\\.webp$'));
  const source = join(__dirname, '../public/assets/studio-v2', art + '-' + variant + '.webp');
  const hash = digest(fileURLToPath(src));
  expect(hash, 'published asset bytes equal repository source').toBe(digest(source));
  return hash;
}
async function record(page, scenario) {
  const client = await page.context().newCDPSession(page);
  const framesDir = mkdtempSync(join(tmpdir(), 'yudian-studio-'));
  const frames = [];
  client.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const name = 'frame-' + String(frames.length).padStart(5, '0') + '.jpg';
    writeFileSync(join(framesDir, name), data, 'base64');
    frames.push({ name, time: metadata.timestamp ?? Date.now() / 1000 });
    void client.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  try {
    await client.send('Page.startScreencast', { format: 'jpeg', quality: 89, maxWidth: viewport.width, maxHeight: viewport.height, everyNthFrame: 1 });
    const result = await scenario();
    await client.send('Page.stopScreencast');
    expect(frames.length, 'real recorded frames').toBeGreaterThan(8);
    const concat = frames.map((frame, i) => "file '" + frame.name + "'\nduration " +
      (i + 1 < frames.length ? Math.max(.001, frames[i + 1].time - frame.time) : .8)).join('\n') +
      "\nfile '" + frames.at(-1).name + "'\n";
    writeFileSync(join(framesDir, 'concat.txt'), concat);
    const name = '余电-实际渲染交互.mp4';
    const video = spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(framesDir, 'concat.txt'),
      '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-threads', '2',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(output, name),
    ], { encoding: 'utf-8' });
    if (video.error || video.status) throw video.error || Error(video.stderr);
    files.push(name);
    return { ...result, frames: frames.length };
  } finally {
    await client.detach().catch(() => {});
    rmSync(framesDir, { recursive: true, force: true });
  }
}

async function main() {
  mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--allow-file-access-from-files', '--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'no-preference' });
    const errors = [];
    const failed = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('requestfailed', request => { if (request.url().startsWith('file:')) failed.push(request.url()); });
    await page.addInitScript(installMock);
    await page.goto(dist);
    await page.evaluate(() => document.fonts.ready);
    const nav = page.getByRole('navigation', { name: '主导航' });
    const button = (area, name) => area.getByRole('button', { name, exact: true });
    const go = name => name === '记录'
      ? nav.getByRole('button', { name: /^(记录|历史)$/ }).click() : button(nav, name).click();
    const hero = page.getByRole('region', { name: '主设备' });
    const stage = page.getByRole('group', { name: '主设备视觉展示' });
    const rail = page.getByRole('region', { name: '切换设备' });
    const loadState = state => page.locator('[data-load-state=' + state + ']');
    const historyGraph = page.getByLabel(/近 (24|7)/).filter({ has: page.locator('[data-trace]') });
    const exact = graph => graph.locator('path[data-trace=exact]:not([d=""])');
    const range = graph => graph.locator('path[data-trace=range]:not([d=""])');
    const read = (scope, text) => scope.getByText(text, { exact: true });
    const cleanMouse = () => page.mouse.move(viewport.width - 5, viewport.height - 5);
    const chartSkeleton = page.getByRole('status', { name: '正在加载电量历史' });
    const fullScreenshot = (name) => screenshot(page, name, true);

    await expect(loadState('initial')).toBeVisible();
    await expect(loadState('initial').getByRole('status')).toHaveText('正在识别设备');
    await expect(hero).toHaveCount(0);
    await expect(rail).toHaveCount(0);
    await expect(stage).toHaveCount(0);
    const provenAssets = { stage: await verifyBackground(page) };
    const observed = await record(page, async () => {
      await page.waitForTimeout(850);
      await screenshot(page, '06-总览-首次读取');
      await page.evaluate(() => window.studioReview.ready());
      await expect(loadState('ready')).toBeVisible();
      await expect(button(rail, 'DualSense')).toHaveAttribute('aria-pressed', 'true');
      await expect(read(hero, '10–20%')).toBeVisible();
      expect(await assetCheck(page), 'ready device art decodes').toBe(true);
      provenAssets.dualsense = await verifyStageAsset(stage, 'dualsense');
      for (const [name, art] of [['DualSense', 'dualsense'], ['Xbox 无线手柄', 'xbox'], ['无线鼠标', 'mouse'], ['机械键盘', 'keyboard']]) {
        provenAssets[art + 'Thumb'] = await verifyStageAsset(button(rail, name), art, 'thumb');
      }
      const meter = hero.getByRole('meter', { name: '电量' });
      await expect(meter).toHaveAttribute('aria-valuetext', '10–20%');
      const readyMeter = await meterPaint(meter);
      const readyBox = await hero.boundingBox();
      const floor = await stage.locator('[data-art=dualsense][data-loading=false]').evaluate(node => ({
        cast: getComputedStyle(node, '::before').backgroundImage,
        bounce: Number(getComputedStyle(node, '::after').opacity),
      }));
      expect(floor.cast).toMatch(/radial-gradient.*radial-gradient/);
      expect(floor.bounce).toBeGreaterThan(0);
      expect(floor.bounce).toBeLessThan(.25);
      await screenshot(page, '01-总览');
      await page.waitForTimeout(500);
      const refresh = button(page, '立即刷新');
      await refresh.click();
      await expect(loadState('refreshing')).toBeVisible();
      await expect(refresh).toBeDisabled();
      await expect(read(hero, '正在更新 · 保留上次读数')).toBeVisible();
      await expect(read(hero, '10–20%')).toBeVisible();
      await expect(button(rail, 'DualSense')).toHaveAttribute('aria-pressed', 'true');
      await expect(meter).toHaveAttribute('aria-valuetext', '10–20%');
      await expect(hero.getByRole('progressbar')).toHaveCount(0);
      expect(await meterPaint(meter), 'refresh must not change the known battery fill or animate the meter').toEqual(readyMeter);
      expect(await read(hero, '正在更新 · 保留上次读数').evaluate(node => getComputedStyle(node, '::before').animationName)).toContain('status-turn');
      expect(await verifyStageAsset(stage, 'dualsense')).toBe(provenAssets.dualsense);
      const refreshBox = await hero.boundingBox();
      expect(Math.abs(readyBox.height - refreshBox.height)).toBeLessThan(2);
      await cleanMouse();
      await page.waitForTimeout(450);
      await screenshot(page, '07-总览-后台刷新保留读数');
      await page.waitForTimeout(500);
      await page.evaluate(() => window.studioReview.finishRefresh());
      await expect(loadState('ready')).toBeVisible();
      await expect(read(hero, '20–30%')).toBeVisible();
      await expect(button(rail, 'DualSense')).toHaveAttribute('aria-pressed', 'true');
      await expect(meter).toHaveAttribute('aria-valuetext', '20–30%');
      await screenshot(page, '08-总览-同步完成');
      await page.waitForTimeout(700);
      await button(rail, '机械键盘').click();
      await expect(stage.locator('[data-animate=true]')).toBeVisible();
      await cleanMouse();
      await page.waitForTimeout(75);
      const inFlight = await stage.locator('[data-animate=true]').evaluate(node => ({
        transform: getComputedStyle(node).transform,
        opacity: Number(getComputedStyle(node).opacity),
        incoming: node.getAnimations().length,
      }));
      expect(inFlight.incoming).toBeGreaterThan(0);
      expect(inFlight.transform).not.toBe('none');
      expect(inFlight.opacity).toBeGreaterThan(0);
      await screenshot(page, '09-轮播-切换中');
      await expect(stage.locator('[data-animate=true]')).toHaveCount(0);
      await expect(hero.getByRole('heading', { name: '机械键盘' })).toBeVisible();
      await expect(read(hero, '67%')).toBeVisible();
      await expect(button(rail, '机械键盘')).toHaveAttribute('aria-pressed', 'true');
      provenAssets.keyboard = await verifyStageAsset(stage, 'keyboard');
      await expect(meter).toHaveAttribute('aria-valuetext', '67%');
      await screenshot(page, '10-轮播-切换落位');
      await page.waitForTimeout(620);
      const ordered = await rail.locator('button[aria-pressed]').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')).filter(name => name && !name.endsWith('模式')));
      const next = ordered[(ordered.indexOf('机械键盘') + 1) % ordered.length];
      await stage.focus();
      await stage.press('ArrowRight');
      await expect(hero.getByRole('heading', { name: next })).toBeVisible();
      await button(rail, 'Xbox 无线手柄').click();
      await expect(hero.getByRole('heading', { name: 'Xbox 无线手柄' })).toBeVisible();
      await expect(stage.locator('[data-animate=true]')).toHaveCount(0);
      await expect(meter).toHaveAttribute('aria-valuetext', '46%');
      provenAssets.xbox = await verifyStageAsset(stage, 'xbox');
      await cleanMouse();
      await screenshot(page, '19-总览-Xbox无线手柄');
      await page.waitForTimeout(580);
      await button(rail, '无线鼠标').click();
      await expect(hero.getByRole('heading', { name: '无线鼠标' })).toBeVisible();
      await expect(stage.locator('[data-animate=true]')).toHaveCount(0);
      await expect(meter).toHaveAttribute('aria-valuetext', '92%');
      provenAssets.mouse = await verifyStageAsset(stage, 'mouse');
      await cleanMouse();
      await screenshot(page, '20-总览-无线鼠标');
      await page.waitForTimeout(580);
      await button(rail, 'DualSense').click();
      await expect(hero.getByRole('heading', { name: 'DualSense' })).toBeVisible();
      await expect(stage.locator('[data-animate=true]')).toHaveCount(0);
      await button(hero, '查看详情').click();
      const detail = page.getByRole('region', { name: '设备详情' });
      await expect(detail).toBeVisible();
      await expect(button(page, '返回总览')).toBeVisible();
      await expect(range(detail)).toBeVisible();
      expect(await range(detail).getAttribute('d')).toMatch(/[HV]/);
      expect(await assetCheck(page), 'detail art decodes').toBe(true);
      await cleanMouse();
      await fullScreenshot('02-设备详情');
      await page.waitForTimeout(900);
      await button(page, '返回总览').click();
      await expect(button(rail, 'DualSense')).toHaveAttribute('aria-pressed', 'true');
      await expect(button(hero, '查看详情')).toBeFocused();
      await page.waitForTimeout(500);
      const mouse = button(rail, '无线鼠标');
      await mouse.click();
      await expect(stage.locator('[data-animate=true]')).toHaveCount(0);
      await mouse.dblclick();
      await expect(detail).toBeVisible();
      await expect(exact(detail)).toBeVisible();
      const precise = await exact(detail).getAttribute('d');
      expect(precise).toMatch(/C/);
      expect((precise.match(/M/g) ?? []).length).toBeGreaterThan(1);
      expect(precise).not.toMatch(/L/);
      await cleanMouse();
      await fullScreenshot('15-设备详情-精确曲线');
      await page.waitForTimeout(650);
      await go('记录');
      await expect(chartSkeleton).toBeVisible();
      await fullScreenshot('11-历史-局部加载');
      const graph = historyGraph.first();
      await expect(graph).toBeVisible();
      await expect(exact(graph)).toHaveCount(1);
      await expect(range(graph)).toHaveCount(1);
      const exactPath = await exact(graph).getAttribute('d');
      const rangePath = await range(graph).getAttribute('d');
      expect(exactPath).toMatch(/C/);
      expect((exactPath.match(/M/g) ?? []).length).toBeGreaterThan(1);
      expect(rangePath).toMatch(/[HV]/);
      expect(rangePath).not.toMatch(/C/);
      await cleanMouse();
      await fullScreenshot('04-历史-双设备对比');
      await page.waitForTimeout(700);
      return { chartHasExactGap: true, chartHasSteppedRange: true, renderedAssetSHA256: provenAssets, renderedAssetChangedVsV1: compareAssets(provenAssets) };
    });

    await go('设备');
    await expect(page.locator('[data-view=devices]')).toBeVisible();
    await fullScreenshot('12-设备目录');
    await go('提醒');
    await expect(page.locator('[data-view=alerts]')).toBeVisible();
    await expect(page.getByText('头戴耳机', { exact: true }).filter({ visible: true }).first()).toBeVisible();
    await fullScreenshot('03-提醒');
    await page.locator('[data-page=reminders] summary').click();
    await expect(page.getByRole('switch', { name: '全屏提示音' })).toBeVisible();
    await fullScreenshot('14-提醒-展开通知与静音');
    const commands = command => expect.poll(() => page.evaluate(() => window.studioReview.commands)).toContainEqual(command);
    await page.getByRole('slider', { name: '全局紧急阈值' }).fill('23');
    await expect(button(page, '应用阈值')).toBeDisabled();
    await expect(page.getByRole('alert').getByText('紧急阈值需低于低电量阈值。')).toBeVisible();
    expect(await page.evaluate(() => window.studioReview.commands.filter(item => item.type === 'settings'))).toEqual([]);
    await page.getByRole('slider', { name: '全局紧急阈值' }).fill('11');
    await button(page, '应用阈值').click();
    await commands({ type: 'settings', patch: { low: 20, critical: 11 } });
    await go('设置');
    await expect(page.locator('[data-view=settings]')).toBeVisible();
    await fullScreenshot('05-设置');
    const settings = page.locator('[data-page=settings]');
    const appearance = settings.locator('#settings-appearance');
    const mainZoom = appearance.getByRole('spinbutton', { name: '主界面缩放百分比' });
    await mainZoom.fill('115');
    await expect(appearance.getByRole('slider', { name: '主界面缩放滑块' })).toHaveValue('115');
    await button(mainZoom.locator('xpath=ancestor::form'), '应用').click();
    await commands({ type: 'settings', patch: { zoom: 115 } });
    const startup = settings.getByRole('switch', { name: '随 Windows 登录启动' });
    await startup.click();
    await expect(startup).toBeChecked();
    await commands({ type: 'settings', patch: { startup: true } });
    await appearance.getByRole('radio', { name: '暖钛灰' }).check();
    await expect(page.locator('[data-view=settings]')).toHaveAttribute('data-theme', 'warm');
    await go('总览');
    await expect(page.locator('[data-view=overview]')).toHaveAttribute('data-theme', 'warm');
    await button(rail, 'DualSense').click();
    await expect(stage.locator('[data-animate=true]')).toHaveCount(0);
    await cleanMouse();
    await screenshot(page, '16-总览-暖钛灰');
    await go('设置');
    await appearance.getByRole('radio', { name: '冰蓝灰' }).check();
    await go('总览');
    await expect(page.locator('[data-view=overview]')).toHaveAttribute('data-theme', 'ice');
    await button(rail, 'DualSense').click();
    await expect(stage.locator('[data-animate=true]')).toHaveCount(0);
    await cleanMouse();
    await screenshot(page, '17-总览-冰蓝灰');
    await go('设置');
    await appearance.getByRole('radio', { name: '石墨白' }).check();
    await expect(page.locator('[data-view=settings]')).toHaveAttribute('data-theme', 'graphite');

    const toast = await browser.newPage({ viewport: { width: 460, height: 146 }, deviceScaleFactor: 1, locale: 'zh-CN' });
    toast.on('pageerror', error => errors.push(error.message));
    await toast.addInitScript(installMock);
    await toast.goto(dist + '?surface=toast');
    const trayToast = toast.getByRole('main', { name: '桌面电量提醒' });
    await expect(trayToast).toBeVisible();
    await expect(trayToast.getByText('头戴耳机')).toBeVisible();
    await toast.evaluate(() => document.fonts.ready);
    await expect.poll(() => trayToast.evaluate(node => Number(getComputedStyle(node).opacity))).toBe(1);
    const toastPng = await trayToast.screenshot({ path: join(output, '13-桌面弹窗.png'), omitBackground: true });
    const interiorAlpha = await toast.evaluate(async base64 => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + base64;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      return [[.2, .15], [.5, .15], [.8, .15], [.2, .65], [.5, .65], [.8, .65]]
        .map(([x, y]) => ctx.getImageData(Math.floor(x * canvas.width), Math.floor(y * canvas.height), 1, 1).data[3]);
    }, toastPng.toString('base64'));
    expect(interiorAlpha, 'toast interior screenshot pixels opaque').toEqual(Array(6).fill(255));
    files.push('13-桌面弹窗.png');
    await button(trayToast, '查看详情').click();
    await expect.poll(() => toast.evaluate(() => window.studioReview.commands)).toContainEqual({ type: 'open', id: 'headset' });
    await button(trayToast, '关闭通知').click();
    await expect.poll(() => toast.evaluate(() => window.studioReview.commands)).toContainEqual({ type: 'closeSurface' });

    await toast.goto(dist + '?surface=toast&long=1');
    const longName = trayToast.getByText('用于长设备名称验证的无线头戴式蓝牙游戏耳机名称', { exact: true }).first();
    await expect(longName).toBeVisible();
    expect(await longName.evaluate(node => node.clientWidth < node.scrollWidth)).toBe(true);
    await expect(button(trayToast, '关闭通知')).toBeVisible();
    const longToastBox = await trayToast.boundingBox();
    expect(longToastBox.x + longToastBox.width).toBeLessThanOrEqual(460);
    expect(longToastBox.y + longToastBox.height).toBeLessThanOrEqual(146);

    await go('总览');
    const stageBounds = await stage.boundingBox();
    const x = stageBounds.x + stageBounds.width * .55;
    const y = stageBounds.y + stageBounds.height * .37;
    const activeBeforeDrag = await hero.getByRole('heading').textContent();
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 110, y, { steps: 7 });
    await expect(stage).toHaveAttribute('data-dragging', 'true');
    await page.mouse.up();
    await expect(stage).toHaveAttribute('data-dragging', 'false');
    await expect(hero.getByRole('heading')).not.toHaveText(activeBeforeDrag);
    await button(rail, '头戴耳机').click();
    await expect(stage.locator('[data-animate=true]')).toHaveCount(0);
    await expect(hero.getByRole('heading', { name: '头戴耳机' })).toBeVisible();
    const portraitBounds = await stage.locator('img[data-device-art]').first().boundingBox();
    expect(portraitBounds.y + portraitBounds.height, 'portrait art fits carousel clip envelope').toBeLessThanOrEqual(stageBounds.y + stageBounds.height * 1.14 + 2);
    await cleanMouse();
    await screenshot(page, '18-总览-耳机纵向图');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await button(rail, '机械键盘').click();
    await expect(stage.locator('[data-animate=true]')).toHaveCount(0);
    await expect(hero.getByRole('heading', { name: '机械键盘' })).toBeVisible();
    await button(page, '立即刷新').click();
    await expect(loadState('refreshing')).toBeVisible();
    expect(await read(hero, '正在更新 · 保留上次读数').evaluate(node => getComputedStyle(node, '::before').animationName)).toBe('none');
    await button(rail, 'Xbox 无线手柄').click();
    await expect(hero.getByRole('meter', { name: '电量' })).toHaveAttribute('aria-valuetext', '46%');
    await page.evaluate(() => window.studioReview.finishRefresh());
    await expect(loadState('ready')).toBeVisible();
    await expect(button(rail, 'Xbox 无线手柄')).toHaveAttribute('aria-pressed', 'true');
    await expect(hero.getByRole('meter', { name: '电量' })).toHaveAttribute('aria-valuetext', '46%');
    await page.evaluate(() => window.studioReview.readAs('xbox', 0));
    await expect(hero.getByRole('meter', { name: '电量' })).toHaveAttribute('aria-valuetext', '0%');
    await expect(hero.getByRole('meter', { name: '电量' })).toHaveAttribute('aria-valuenow', '0');
    await page.evaluate(() => window.studioReview.readAs('xbox', null));
    await expect(hero.getByRole('meter', { name: '电量' })).toHaveCount(0);
    await expect(hero.getByText('—', { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 800, height: 630 });
    for (const name of ['总览', '设备', '提醒', '记录', '设置']) {
      await go(name);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ' at 800px').toBe(true);
    }
    expect(errors, 'renderer exceptions').toEqual([]);
    expect(failed, 'missing file: assets').toEqual([]);
    const report = { renderer: 'built dist/ui/index.html, Chromium with mock PowerManager preload API', viewport, files, ...observed,
      scope: 'visuals, mock UI and commands; not native collection, Windows shell or device measurement' };
    writeFileSync(join(output, 'capture-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
