// Captures the built UI, at the same mock preload boundary used by the interaction test.
// Build first. Optional CHROMIUM_PATH points to a local Chrome/Chromium binary.
const { chromium, expect } = require('@playwright/test');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const output = resolve(process.env.HISTORY_REVIEW_OUT || 'review-captures');
const framesDir = join(output, 'frames');
mkdirSync(framesDir, { recursive: true });
const screenshot = (page, name, fullPage = false) => page.screenshot({ path: join(output, name + '.png'), fullPage });

function mock() {
  const value = (low, high = low, power = 'discharging') => ({ low, high, raw: low, power, source: 'hid' });
  const now = Date.now();
  const state = {
    devices: [
      { id: 'mouse', art: 'mouse', name: '无线鼠标', reading: value(92), connection: '无线 2.4G' },
      { id: 'dual', art: 'dualsense', name: 'DualSense', reading: value(10, 20), connection: '蓝牙' },
      { id: 'keyboard', art: 'keyboard', name: '机械键盘', reading: value(67), connection: '无线 2.4G' },
      { id: 'headset', art: 'headset', name: '头戴耳机', reading: value(52), connection: '蓝牙' },
    ].map(item => ({ ...item, status: 'current', lastRead: now, watched: true, reason: '设备读数正常' })),
    settings: { low: 20, critical: 10, repeat: 0, snooze: 30, fullscreenSound: true, soundOnly: false, voltage: false,
      startup: false, zoom: 100, trayZoom: 100, desktopToasts: true, muteMinutes: 60 },
    deviceSettings: {}, alerts: {}, collector: 'starting', refreshing: false, mutedUntil: 0, demo: true,
  };
  const stamp = step => now - (1440 - step) * 60_000;
  const seq = Array.from({ length: 1441 }, (_, i) => i);
  const mouse = seq.flatMap(i => {
    if (i > 650 && i < 830) return [];
    if (i === 650) return [{ time: stamp(i), reading: null }];
    const pct = i < 650 ? 91 - i * .10 : i < 878 ? 27 + (i - 830) * .10 :
      i < 1010 ? 32 + (i - 878) * .35 : 78 + (i - 1010) * 14 / 430;
    return [{ time: stamp(i), reading: value(Math.round(pct), Math.round(pct), i >= 910 && i <= 1020 ? 'charging' : 'discharging') }];
  });
  const range = seq.map(i => {
    const floor = i < 178 ? 58 : i < 392 ? 52 : i < 640 ? 45 : i < 1030 ? 34 : i < 1215 ? 25 : 19;
    return { time: stamp(i), reading: value(floor, floor + 6) };
  });
  const key = seq.map(i => ({ time: stamp(i), reading: value(Math.round(80 - i * 13 / 1440)) }));
  const headphones = seq.map(i => ({ time: stamp(i), reading: value(Math.round(75 - i * 23 / 1440)) }));
  const histories = { mouse, dual: range, keyboard: key, headset: headphones };
  let notify;
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const publish = () => notify?.(structuredClone(state));
  window.reviewMock = {
    ready: () => { state.collector = 'ready'; publish(); },
    refreshHistory: () => { state.devices[0].lastRead = Date.now(); publish(); },
  };
  window.powerManager = {
    snapshot: async () => structuredClone(state), toast: async () => null,
    onSnapshot: fn => { notify = fn; return () => {}; }, onNavigate: () => () => {},
    command: async command => {
      if (command.type === 'history') { await delay(970); return { ok: true, history: histories[command.id] || [] }; }
      if (command.type === 'refresh') {
        state.refreshing = true; publish();
        await delay(2100);
        state.refreshing = false;
        state.devices[1].reading = value(20, 30);
        state.devices[1].lastRead = Date.now();
        publish();
      }
      return { ok: true };
    },
  };
}

async function run() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH,
    args: ['--allow-file-access-from-files', '--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1460, height: 900 }, deviceScaleFactor: 1 });
    const client = await page.context().newCDPSession(page);
    const frames = [];
    client.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      const name = 'frame-' + String(frames.length).padStart(5, '0') + '.jpg';
      writeFileSync(join(framesDir, name), data, 'base64');
      frames.push({ name, time: metadata.timestamp ?? Date.now() / 1000 });
      void client.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    await page.addInitScript(mock);
    await page.goto(pathToFileURL(join(__dirname, '../dist/ui/index.html')).href);
    await expect(page.getByText('正在读取设备…')).toBeVisible();
    const assets = await page.locator('[data-device-art]').evaluateAll(async nodes => {
      await Promise.all(nodes.map(node => node.decode().catch(() => {})));
      return nodes.every(node => node.complete && node.naturalWidth > 0);
    });
    if (!assets) throw Error('Missing authoritative device artwork in dist');
    await client.send('Page.startScreencast', { format: 'jpeg', quality: 83, maxWidth: 1460, maxHeight: 900, everyNthFrame: 1 });
    await page.waitForTimeout(550);
    await screenshot(page, '01-总览-初次读取');
    await page.evaluate(() => window.reviewMock.ready());
    const hero = page.getByRole('region', { name: '主设备' });
    await expect(hero.getByText('10–20%')).toBeVisible();
    await page.waitForTimeout(550);
    await page.getByRole('button', { name: '立即刷新', exact: true }).click();
    await expect(hero.getByText('正在更新 · 保留上次读数')).toBeVisible();
    await expect(hero.getByText('10–20%')).toBeVisible();
    await screenshot(page, '02-总览-刷新保留读数');
    await expect(hero.getByText('20–30%', { exact: true })).toBeVisible();
    await screenshot(page, '03-总览-刷新完成');
    await page.waitForTimeout(450);
    await hero.getByRole('button', { name: '查看详情' }).click();
    await expect(page.getByRole('button', { name: '返回总览' })).toBeVisible();
    await page.locator('[data-series="0"]').last().waitFor({ state: 'attached' });
    await page.waitForTimeout(400);
    await screenshot(page, '04-设备详情-电量曲线', true);
    await page.getByRole('button', { name: '记录', exact: true }).click();
    await expect(page.getByRole('status', { name: '正在加载电量历史' })).toBeVisible();
    await screenshot(page, '05-记录-局部骨架');
    const graph = page.getByLabel(/近 24 小时电量曲线/);
    await expect(graph.locator('[data-series="1"]')).toHaveCount(1);
    await page.mouse.move(1300, 100);
    await screenshot(page, '06-记录-双设备实际曲线');
    await page.waitForTimeout(450);
    await graph.locator('[data-event="invalid"] rect').hover();
    await expect(graph.getByText('无线鼠标 · 无有效读数')).toBeVisible();
    await screenshot(page, '07-记录-缺口悬停');
    await page.waitForTimeout(600);
    await graph.locator('[data-event="charging"]').hover();
    await expect(graph.getByText('无线鼠标 · 采样显示正在充电')).toBeVisible();
    await screenshot(page, '08-记录-充电悬停');
    await page.waitForTimeout(600);
    const picker = page.getByRole('group', { name: '选择对比设备' });
    await picker.getByRole('button', { name: '设备', exact: true }).click();
    await screenshot(page, '09-记录-设备菜单');
    await page.getByRole('menuitemcheckbox', { name: '机械键盘', exact: true }).click();
    await expect(graph.locator('[data-series="2"]')).toHaveCount(1);
    await picker.getByRole('button', { name: '移除对比：机械键盘' }).click();
    await expect(graph.locator('[data-series="2"]')).toHaveCount(0);
    await page.evaluate(() => window.reviewMock.refreshHistory());
    await expect(page.getByText('正在更新，暂显示已有记录')).toBeVisible();
    await expect(graph.locator('[data-series="1"]')).toHaveCount(1);
    await screenshot(page, '10-记录-刷新保留曲线');
    await expect(page.getByText('正在更新，暂显示已有记录')).toHaveCount(0);
    await page.waitForTimeout(650);
    await client.send('Page.stopScreencast');
    if (frames.length > 8) {
      const concat = frames.map((frame, i) => "file '" + frame.name + "'\nduration " +
        (i + 1 < frames.length ? Math.max(.035, frames[i + 1].time - frame.time) : .7)).join('\n') +
        "\nfile '" + frames.at(-1).name + "'\n";
      writeFileSync(join(framesDir, 'concat.txt'), concat);
      const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i',
        join(framesDir, 'concat.txt'), '-vf', 'fps=24,scale=trunc(iw/2)*2:trunc(ih/2)*2', '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart', join(output, '余电-实际渲染交互.mp4')], { encoding: 'utf-8' });
      if (result.error || result.status) throw result.error || Error(result.stderr);
    }
    await page.getByRole('button', { name: '设备', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: '我的设备' })).toBeVisible();
    await screenshot(page, '11-设备列表');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByRole('tab', { name: '外观' })).toBeVisible();
    await screenshot(page, '12-设置-外观');
    console.log('Captured', frames.length, 'renderer frames and 12 screenshots in', output);
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
