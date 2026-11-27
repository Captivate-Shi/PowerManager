// Tests the built renderer with a deterministic desktop-host boundary.
const { chromium, expect } = require('@playwright/test');
const { installMock } = require('./studio-review-mock.cjs');
const { pathToFileURL } = require('node:url');
const { resolve, join } = require('node:path');
const { mkdirSync, writeFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const entry = pathToFileURL(resolve('dist/ui/index.html')).href;
const out = process.env.PM_REVIEW_RECORD;
const button = (scope, name) => scope.getByRole('button', { name, exact: true });

async function record(page, flow) {
  if (!out) return flow(async () => {}, async () => {});
  const client = await page.context().newCDPSession(page);
  const frames = [];
  const dest = resolve(out, 'frames');
  mkdirSync(dest, { recursive: true });
  client.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const name = 'frame-' + String(frames.length).padStart(6, '0') + '.jpg';
    frames.push({ name, timestamp: metadata.timestamp ?? Date.now() / 1000 });
    writeFileSync(join(dest, name), data, 'base64');
    void client.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await client.send('Page.startScreencast', { format: 'jpeg', quality: 87, everyNthFrame: 1 });
  await flow(async (caption, ms = 550) => {
    await page.evaluate(caption => {
      let label = document.querySelector('#review-caption');
      if (!label) {
        label = document.createElement('div'); label.id = 'review-caption';
        label.setAttribute('aria-hidden', 'true');
        Object.assign(label.style, { position: 'fixed', inset: 'auto auto 12px 12px', color: '#e8edf4',
          background: '#1d2536', border: '1px solid #53617a', borderRadius: '9px', padding: '9px 13px',
          fontSize: '14px', zIndex: '2147483647', pointerEvents: 'none' });
        document.body.append(label);
      }
      label.textContent = 'Mock 验收 · ' + caption;
    }, caption);
    await page.waitForTimeout(ms);
  }, async name => {
    await page.evaluate(() => { const label = document.querySelector('#review-caption'); if (label) label.hidden = true; });
    await page.screenshot({ path: resolve(out, name + '.png'), caret: 'hide' });
    await page.evaluate(() => { const label = document.querySelector('#review-caption'); if (label) label.hidden = false; });
  });
  await client.send('Page.stopScreencast');
  const lines = frames.map((frame, i) => {
    const duration = i + 1 === frames.length ? 1 : Math.max(0.001, frames[i + 1].timestamp - frame.timestamp);
    return `file '${frame.name}'\noption framerate 1000\nduration ${duration.toFixed(3)}`;
  }).join('\n') + "\nfile '" + frames.at(-1).name + "'\noption framerate 1000\n";
  writeFileSync(join(dest, 'list.txt'), lines);
  const result = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0',
    '-i', join(dest, 'list.txt'), '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264',
    '-threads', '2', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', resolve(out, '余电-设置与交互回归.mp4')], { encoding: 'utf8' });
  if (result.error || result.status) throw Error(result.error || result.stderr);
  await client.detach();
}
async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--allow-file-access-from-files', '--no-sandbox'] });
  try {
    for (const width of out ? [1250] : [1250, 720, 520]) {
      const page = await browser.newPage({ viewport: { width, height: width > 1000 ? 760 : 560 }, locale: 'zh-CN', reducedMotion: out ? 'no-preference' : 'reduce' });
      page.setDefaultTimeout(8000);
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(`(${installMock.toString()})({ historyDelay: 250, longComparisonNames: true });(${(() => {
        const command = powerManager.command;
        let failAdd = true;
        powerManager.command = async request => {
          if (request.type === 'discover') return { ok: true, found: [{
            id: 'unmonitored', name: '新接入外设', connection: '蓝牙', connected: true,
            reading: { low: 45, high: 45, raw: 45, power: 'discharging', source: 'ble' },
          }] };
          if (request.type === 'add' && failAdd) { failAdd = false; return { ok: false, error: '暂时无法添加设备，请重试。' }; }
          return command(request);
        };
      }).toString()})();`);
      const navigate = name => button(page.getByRole('navigation', { name: '主导航' }), name).click();
      const combo = name => page.getByRole('combobox', { name, exact: true });
      const paused = ms => out ? page.waitForTimeout(ms) : Promise.resolve();
      const choose = async (label, option) => { await combo(label).click(); await page.getByRole('option', { name: option, exact: true }).click(); };
      await page.goto(entry); await page.evaluate(() => studioReview.ready());
      await record(page, async (caption, shot) => {
        await caption('总览：展台与列表');
        await button(page, '列表模式').click(); await expect(page.locator('[data-mode]')).toHaveAttribute('data-mode','list'); await paused(650);
        await button(page, '展台模式').click(); await expect(page.locator('[data-mode]')).toHaveAttribute('data-mode','stage'); await paused(650);
        await caption('设备：进入详情后返回');
        await navigate('设备');
        const details = button(page, '查看详情 · DualSense');
        await details.click();
        await expect(button(page, '返回设备')).toBeFocused(); await paused(550);
        await page.keyboard.press('Escape'); await expect(details).toBeFocused(); await paused(400);
        await caption('设备：添加失败在弹窗内提示');
        await button(page,'查找设备').click();
        const find = page.getByRole('dialog',{name:'查找设备'});
        await button(find,'添加到监测').click();
        await expect(find.getByRole('alert')).toContainText('暂时无法添加设备');
        await paused(1000);
        await button(find,'重试添加').click();
        await expect(find.getByText(/已监测/)).toBeVisible();
        await page.keyboard.press('Escape');
        await caption('提醒：弹窗可以自动关闭，也可以一直显示');
        await navigate('提醒');
        await page.getByText('通知与静音', { exact: true }).click();
        await expect(combo('弹窗停留时间')).toHaveText('12 秒（默认）');
        await combo('弹窗停留时间').click(); await shot('余电-弹窗停留选项'); await paused(900);
        await page.getByRole('option', { name: '一直显示', exact: true }).click();
        await expect(combo('弹窗停留时间')).toHaveText('一直显示'); await paused(550);
        const desktop = page.getByRole('switch', { name: '桌面弹窗' });
        await desktop.click(); await expect(combo('弹窗停留时间')).toBeDisabled();
        await desktop.click(); await expect(combo('弹窗停留时间')).toBeEnabled();
        await expect(combo('弹窗停留时间')).toHaveText('一直显示');
        await choose('弹窗停留时间','5 秒'); await expect(combo('弹窗停留时间')).toHaveText('5 秒');
        await caption('记录：三个形状独立于颜色和排序');
        await navigate('记录');
        await button(page, '对比设备').click();
        await page.getByRole('menuitemcheckbox', { name: /^Razer BlackWidow/ }).click();
        const graph = page.getByLabel(/近 24 小时电量曲线/);
        await expect(graph.locator('[data-plot-series-shape]')).toHaveCount(3);
        await expect(graph.locator('[data-plot-series-shape="0"] circle')).toHaveCount(1);
        await expect(graph.locator('[data-plot-series-shape="1"] rect')).toHaveCount(1);
        await expect(graph.locator('[data-plot-series-shape="2"] path')).toHaveCount(1);
        await expect(page.getByRole('group',{name:'选择对比设备'}).locator('[data-series-shape]')).toHaveCount(3);
        if (out) await graph.hover({ position: { x: 550, y: 140 } });
        await shot('余电-三设备形状标记'); await paused(1200);
        await caption('设置：在运行与托盘里调整轮询间隔');
        await navigate('设置');
        const nav = page.getByRole('navigation', { name: '设置分类' });
        await button(nav, '运行与托盘').click();
        const poll = combo('电量轮询间隔');
        await expect(poll).toHaveText('30 秒（推荐）');
        await poll.click();
        await expect(page.getByRole('option')).toHaveCount(4);
        await expect(page.getByText('设备可能在提醒前耗尽电量',{exact:true})).toBeVisible();
        await shot('余电-电量轮询选项'); await paused(1000);
        await page.getByRole('option',{name:'10 分钟',exact:true}).click();
        await expect(poll).toHaveText('10 分钟');
        await expect(page.getByText('设备可能在提醒前耗尽电量',{exact:true})).toBeVisible();
        await shot('余电-低频轮询风险提示'); await paused(1000);
        await choose('电量轮询间隔','30 秒（推荐）');
        await expect(page.getByText('设备可能在提醒前耗尽电量',{exact:true})).toHaveCount(0);
        const pane = page.getByRole('region',{name:'设置内容'});
        await button(nav,'诊断').click(); await paused(450);
        await expect.poll(() => pane.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
        if (width === 1250) {
          const fixed = await page.locator('main > footer').boundingBox();
          const bounds = await pane.boundingBox();
          await page.mouse.move(width - 9, bounds.y + Math.min(bounds.height / 2, 240));
          await page.mouse.wheel(0, -1900);
          await expect.poll(() => pane.evaluate(node => node.scrollTop)).toBe(0);
          await expect(button(nav,'外观')).toHaveAttribute('aria-current','location');
          expect(await page.locator('main > footer').boundingBox()).toEqual(fixed);
        }
        expect(errors).toEqual([]);
        await caption('五个页面、滚动和两项设置已完成 mock 回归', 1350);
      });
      await page.setViewportSize({ width: 460, height: 146 });
      await page.goto(entry + '?surface=toast&kind=critical');
      const toast = page.getByRole('main',{name:'桌面电量提醒'});
      await toast.getByText('电量告急',{exact:false}).click();
      expect(await page.evaluate(() => studioReview.commands.some(c => c.type === 'closeSurface'))).toBe(false);
      if (out) await page.screenshot({path:resolve(out,'余电-告急弹窗.png')});
      await button(toast,'关闭通知').click();
      expect(await page.evaluate(() => studioReview.commands.at(-1)?.type)).toBe('closeSurface');
      await page.close();
      console.log(`${width}px: five pages, modal navigation, duration/polling settings, option warning, shape identity, fixed footer and explicit toast dismissal.`);
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
