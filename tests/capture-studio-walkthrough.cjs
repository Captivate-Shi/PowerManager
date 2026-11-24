// As-built renderer walkthrough. Only the preload/OS boundary is mocked.
const { chromium, expect } = require('@playwright/test');
const { mkdirSync, mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { installMock } = require('./studio-review-mock.cjs');

const dir = resolve(process.env.STUDIO_REVIEW_OUT || 'studio-walkthrough-captures');
const renderer = pathToFileURL(resolve(process.env.STUDIO_REVIEW_DIST || join(__dirname, '../dist/ui/index.html'))).href;
const viewport = { width: 1586, height: 992 };
const snaps = [];
const chapters = [];
const milestones = [];
const evidence = { tabs: [], inspectionBoundary: 'Mock preload command/state boundary only; native notification not tested.' };
const snapshot = async (page, name, fullPage = false) => {
  await page.screenshot({ path: join(dir, name + '.png'), fullPage, caret: 'hide' });
  snaps.push(name + '.png');
};
const delay = (page, ms = 530) => page.waitForTimeout(ms);
const button = (scope, name) => scope.getByRole('button', {name,exact:true});
const status = (scope, text) => scope.getByRole('status').filter({ hasText: text });
const activeNav = page => page.getByRole('navigation', { name: '主导航' });
const activeArt = page => page.locator('[data-active-stage] img[data-device-art]');
const thresholdWrites = page => page.evaluate(() => window.studioReview.commands.filter(c => c.type === 'deviceSettings' && c.id === 'dual' && 'low' in c.patch));
const localAlerts = page => page.evaluate(() => window.studioReview.inspections);

async function capture(page, run) {
  const client = await page.context().newCDPSession(page);
  const tmp = mkdtempSync(join(tmpdir(), 'yudian-studio-flow-'));
  const frames = [];
  client.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const name = `frame-${String(frames.length).padStart(5, '0')}.jpg`;
    writeFileSync(join(tmp, name), data, 'base64');
    frames.push({ name, time: metadata.timestamp ?? Date.now() / 1000 });
    void client.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  try {
    await client.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: viewport.width, maxHeight: viewport.height, everyNthFrame: 1 });
    await delay(page, 250);
    const clock = () => {
      const now = Date.now() / 1000;
      const first = frames[0]?.time ?? now;
      return +Math.max(0, now - first).toFixed(3);
    };
    const mark = name => chapters.push({ name, actualElapsed: chapters.length ? clock() : 0 });
    const milestone = name => milestones.push({ name, actualElapsed: clock() });
    await run(mark, milestone);
    const end = clock();
    await client.send('Page.stopScreencast');
    expect(frames.length).toBeGreaterThan(90);
    const list = frames.map((f, i) => `file '${f.name}'\noption framerate 1000\nduration ${i + 1 < frames.length ? Math.max(0.001, frames[i + 1].time - f.time).toFixed(3) : Math.max(.8, end - (f.time - frames[0].time)).toFixed(3)}`).join('\n') + `\nfile '${frames.at(-1).name}'\noption framerate 1000\n`;
    writeFileSync(join(tmp, 'list.txt'), list);
    const name = '余电-五个页面完整操作录屏.mp4';
    const time = entry => Math.round(entry * 1000);
    const metadata = ';FFMETADATA1\n' + chapters.map((chapter, i) =>
      `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${time(chapter.actualElapsed)}\nEND=${time(chapters[i+1]?.actualElapsed ?? end)}\ntitle=${chapter.name}`).join('\n') + '\n';
    const metadataPath = join(tmp, 'chapters.txt');
    writeFileSync(metadataPath, metadata);
    const enc = spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(tmp, 'list.txt'), '-f','ffmetadata','-i', metadataPath,
      '-map','0:v:0','-map_metadata','1','-map_chapters','1','-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-threads', '2', '-preset', 'fast', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', join(dir, name)], { encoding: 'utf8' });
    if (enc.error || enc.status) throw enc.error || Error(enc.stderr);
    evidence.video = { file: name, sourceFrames: frames.length, chapters, milestones };
  } finally {
    await client.detach().catch(() => {});
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function addPointerGuide(page) {
  await page.evaluate(() => {
    // Video-only pointer; never modifies production CSS, controls or browser storage.
    const dot = document.createElement('span');
    dot.setAttribute('aria-hidden', 'true');
    Object.assign(dot.style, { pointerEvents:'none', zIndex:'2147483647', position:'fixed',
      top:'0', left:'0', width:'13px', height:'13px', borderRadius:'50%', border:'1px solid #eff5f9',
      background:'#acc4ed35', boxShadow:'0 0 4px #121d2caa', opacity:'0', transform:'translate(-50%,-50%)' });
    document.body.append(dot);
    window.addEventListener('pointermove', ({clientX,clientY}) => {
      dot.style.transform = `translate(${clientX-7}px,${clientY-7}px)`;
      dot.style.opacity = '1';
    }, { passive:true });
    window.addEventListener('pointerdown', () => {
      dot.animate([{ boxShadow:'0 0 0 4px #f3cea07d' }, { boxShadow:'0 0 0 13px #f3cea000' }], {duration:380});
    }, { passive:true });
  });
}

async function main() {
  mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--allow-file-access-from-files', '--no-sandbox'] });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport, deviceScaleFactor:1, locale:'zh-CN', timezoneId:'Asia/Shanghai' });
    page.on('pageerror', err => errors.push(err.message));
    await page.addInitScript(installMock, { scenario: 'cold', historyDelay: 1780 });
    await page.goto(renderer);
    await page.evaluate(() => document.fonts.ready);
    const nav = activeNav(page);
    const jelly = nav.locator('[data-nav-indicator]');
    const active = page.locator('[data-view]').first();
    const hero = page.getByRole('region', { name:'主设备' });
    const rail = page.getByRole('region', { name:'切换设备' });
    const stage = page.getByRole('group', { name:'主设备视觉展示' });
    const meter = hero.getByRole('meter', { name:'电量' });
    const refresh = button(page,'立即刷新');
    const phase = value => page.locator(`[data-load-state=${value}]`);
    const skeleton = scope => scope.getByRole('status', { name:'正在加载电量历史' });
    const graph = scope => scope.getByLabel(/近 24 小时电量曲线/).filter({ has:page.locator('path[data-trace]') }).first();
    const band = (scope, art) => scope.locator(`g[data-series="${art}"] path[data-trace=range]:not([d=""])`);
    const enter = async (label, view, proveAnimation = false) => {
      const target = button(nav, label);
      await target.click();
      await expect(target).toHaveAttribute('aria-current','page');
      await expect(active).toHaveAttribute('data-view',view);
      if (proveAnimation) {
        await expect.poll(() => jelly.evaluate(node => node.getAnimations().some(a => a.playState === 'running')), { timeout: 600 }).toBe(true);
        await snapshot(page, '07-导航-果冻滑移');
      }
      await expect.poll(async () => {
        const a = await jelly.boundingBox(); const b = await target.boundingBox();
        return a && b ? Math.abs(a.x - b.x) : 999;
      }).toBeLessThan(10);
      evidence.tabs.push(label);
    };
    const proveSkeleton = async scope => {
      const loc = skeleton(scope);
      await expect(loc).toBeVisible();
      const css = await loc.evaluate(node => {
        const box = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return { height: box.height, background:style.backgroundColor, shadow:style.boxShadow,
          shimmer:getComputedStyle(node,'::after').animationName };
      });
      expect(css.height).toBeGreaterThan(100);
      expect(css.background).toBe('rgba(0, 0, 0, 0)');
      expect(css.shadow).toBe('none');
      expect(css.shimmer).toBe('none');
    };

    await expect(phase('initial')).toBeVisible();
    await expect(phase('initial').getByRole('heading',{name:'正在识别设备'})).toBeVisible();
    await expect(phase('initial').getByRole('status')).toHaveText('正在识别设备');
    await expect(rail).toHaveCount(0);
    await expect(meter).toHaveCount(0);
    await expect(rail.getByRole('button',{name:'DualSense',exact:true})).toHaveCount(0);
    await expect(activeArt(page)).toHaveCount(0);
    await addPointerGuide(page);
    await capture(page, async (mark, milestone) => {
      mark('总览 · 真冷启动、首台 Xbox、轮播与刷新');
      evidence.tabs.push('总览');
      await delay(page,1350);
      await snapshot(page,'01-总览-冷启动文字');
      await page.evaluate(() => window.studioReview.detect('xbox'));
      await expect(hero.getByRole('heading',{ name:'Xbox 无线手柄' })).toBeVisible();
      await expect(meter).toHaveAttribute('aria-valuetext','46%');
      await expect(activeArt(page)).toHaveAttribute('src',/xbox-hero\.webp$/);
      await snapshot(page,'02-总览-首台发现Xbox');
      await delay(page,1000);
      await page.evaluate(() => window.studioReview.revealAll());
      await button(rail,'机械键盘').click();
      await expect(stage.locator('[data-departing]')).toHaveCount(1);
      await delay(page,130);
      await snapshot(page,'03-总览-轮播中');
      await expect(stage.locator('[data-departing]')).toHaveCount(0);
      await expect(meter).toHaveAttribute('aria-valuetext','67%');
      await delay(page);
      await button(rail,'DualSense').click();
      await expect(meter).toHaveAttribute('aria-valuetext','10–20%');
      await expect(meter).toHaveAttribute('data-scale','interval');
      await expect(meter.locator('[data-battery-band]')).toHaveAttribute('style',/left:\s*10%;\s*width:\s*10%/);
      await expect(stage.locator('[data-departing]')).toHaveCount(0);
      await refresh.click();
      await expect(phase('refreshing')).toBeVisible();
      await expect(meter).toHaveAttribute('aria-valuetext','10–20%');
      await expect(button(rail,'DualSense')).toHaveAttribute('aria-pressed','true');
      await delay(page,850);
      await snapshot(page,'04-总览-刷新保留区间');
      await page.evaluate(() => window.studioReview.finishRefresh());
      await expect(meter).toHaveAttribute('aria-valuetext','20–30%');
      await snapshot(page,'05-总览-刷新完成');
      await delay(page,1100);

      mark('设备 · 打开详情、曲线局部加载、拖动阈值和 5% 快选');
      await enter('设备','devices',true);
      await snapshot(page,'06-设备-目录');
      await delay(page);
      await button(page.getByRole('table'),'DualSense').dblclick();
      const detail = page.getByRole('region',{name:'设备详情'});
      await expect(detail.getByRole('heading',{name:'DualSense',exact:true})).toBeVisible();
      await expect(page.locator('[data-detail-photo-flight]')).toHaveCount(0);
      await proveSkeleton(detail);
      await snapshot(page,'08-详情-图表局部加载',true);
      await expect(band(graph(detail),0)).toBeVisible();
      await snapshot(page,'09-详情-PS5区间电量');
      await delay(page,1190);
      await button(detail,'调整提醒').click();
      const slider = detail.getByRole('slider',{name:'设备低电量阈值'});
      await slider.scrollIntoViewIfNeeded();
      await expect(slider).toBeVisible();
      const presets = detail.getByRole('group',{name:'快速选择低电量阈值'});
      const labels = await presets.getByRole('button').allTextContents();
      expect(labels).toEqual(Array.from({length:10},(_,i)=>`${5*(i+1)}%`));
      const box = await slider.boundingBox();
      const cp = (await thresholdWrites(page)).length;
      await page.mouse.move(box.x + box.width*.39, box.y+box.height/2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width*.85, box.y+box.height/2,{steps:13});
      await delay(page,1000); // longer than keyboard debounce: true drag must still be pending
      expect(await thresholdWrites(page)).toHaveLength(cp);
      await expect(status(detail,'松开后保存')).toBeVisible();
      await snapshot(page,'10-详情-拖动中未保存');
      await page.mouse.up();
      await expect(status(detail,'已保存 · 下次巡检生效')).toBeVisible();
      await expect.poll(() => thresholdWrites(page)).toHaveLength(cp+1);
      await delay(page);
      await button(presets,'35%').click();
      await expect(slider).toHaveValue('35');
      await expect.poll(async () => (await thresholdWrites(page)).at(-1)?.patch.low).toBe(35);
      await expect(status(detail,'已保存 · 下次巡检生效')).toBeVisible();
      expect(await localAlerts(page)).toEqual([]);
      expect(await page.evaluate(() => window.studioReview.commands.some(c => c.type === 'preview'))).toBe(false);
      await snapshot(page,'11-详情-35阈值自动保存');
      milestone('阈值已保存，无即时提醒');
      await delay(page,1800);
      await enter('总览','overview');
      await button(rail,'DualSense').click();
      await refresh.click();
      milestone('手动刷新，仍不发送提醒');
      await expect(phase('refreshing')).toBeVisible();
      expect(await localAlerts(page)).toEqual([]);
      await delay(page,750);
      await page.evaluate(() => window.studioReview.finishRefresh());
      await expect(meter).toHaveAttribute('aria-valuetext','20–30%');
      expect(await localAlerts(page)).toEqual([]);
      await delay(page,840);
      await page.evaluate(() => window.studioReview.runInspection('dual',22,27));
      milestone('独立模拟下一次后台巡检，随后出现待充电设备');
      await expect(meter).toHaveAttribute('aria-valuetext','22–27%');
      expect(await localAlerts(page)).toMatchObject([{ id:'dual',severity:'low',reading:{low:22,high:27} }]);
      await snapshot(page,'12-总览-模拟巡检后更新');
      await delay(page,1180);

      mark('提醒 · 巡检结果、全屏开关与测试通知');
      await enter('提醒','alerts');
      const alerts = page.locator('[data-page=reminders]');
      await expect(alerts.locator('article').filter({ hasText:'DualSense' })).toBeVisible();
      await snapshot(page,'13-提醒-巡检结果');
      await delay(page,950);
      await alerts.locator('summary').click();
      const sound = alerts.getByRole('switch',{name:'全屏提示音'});
      await expect(sound).toBeChecked();
      await sound.click();
      await expect(sound).not.toBeChecked();
      await snapshot(page,'14-提醒-全屏提示音已关闭');
      await delay(page,1030);
      await button(alerts,'发送低电量测试通知').click();
      await expect.poll(() => page.evaluate(() => window.studioReview.commands.some(c => c.type === 'preview' && c.severity === 'low'))).toBe(true);
      const toastFull = `${renderer}?surface=toast&kind=low&device=dual`;
      await page.evaluate(url => {
        const frame = document.createElement('iframe');
        Object.assign(frame.style, { position:'fixed',zIndex:'400',border:'0',width:'460px',height:'146px',right:'16px',bottom:'14px',background:'transparent' });
        frame.title='模拟桌面测试通知'; frame.src=url; document.body.append(frame);
      }, toastFull);
      const iframe = page.frameLocator('iframe[title="模拟桌面测试通知"]');
      const toastInFlow = iframe.getByRole('main',{name:'桌面电量提醒'});
      try {
        await expect(toastInFlow).toBeVisible({timeout:2500});
        await expect(toastInFlow.getByText('15%',{exact:true})).toBeVisible();
        await expect.poll(() => toastInFlow.evaluate(node => Number(getComputedStyle(node).opacity))).toBe(1);
        await snapshot(page,'15-提醒-测试通知层');
        milestone('手动发送测试通知，演示浮窗');
        await delay(page,2200);
        await button(toastInFlow,'关闭通知').click();
        evidence.toastShownInContinuousFlow = true;
      } catch (error) {
        // file:// CSP may block same-file test frame in some Chromium distributions.
        // The standalone 460×146 renderer toast is always verified separately below.
        evidence.toastShownInContinuousFlow = false;
      } finally {
        await page.locator('iframe[title="模拟桌面测试通知"]').evaluate(frame => frame.remove());
      }

      mark('记录 · 局部加载、实际对比与图表键盘读点');
      await enter('记录','history');
      await proveSkeleton(page);
      await snapshot(page,'16-记录-局部加载');
      const chart = graph(page);
      await expect(chart.locator('path[data-trace=exact]:not([d=""])')).toHaveCount(1);
      await expect(chart.locator('path[data-trace=range]:not([d=""])')).toHaveCount(1);
      await delay(page,1200);
      const picker = page.getByRole('group',{name:'选择对比设备'});
      await button(picker,'对比设备').click();
      await page.getByRole('menuitemcheckbox',{name:'机械键盘',exact:true}).click();
      await expect(chart.locator('path[data-trace=exact]:not([d=""])')).toHaveCount(2);
      await delay(page,930);
      await chart.focus();
      await chart.press('End');
      await snapshot(page,'17-记录-三设备对比和读点');
      await delay(page,1280);
      await chart.press('Escape');
      await button(picker,'移除对比：机械键盘').click();
      await expect(chart.locator('path[data-trace=exact]:not([d=""])')).toHaveCount(1);
      await delay(page,680);

      mark('设置 · 缩放预设、暖钛灰与回到总览');
      await enter('设置','settings');
      const settings = page.locator('[data-page=settings]');
      const zoom = settings.getByRole('spinbutton',{name:'主界面缩放百分比'});
      await zoom.fill('110');
      await button(zoom.locator('xpath=ancestor::form'),'应用').click();
      await expect.poll(() => page.evaluate(() => window.studioReview.commands.some(c => c.type === 'settings' && c.patch.zoom === 110))).toBe(true);
      await settings.getByRole('radio',{name:'暖钛灰'}).check();
      await expect(active).toHaveAttribute('data-theme','warm');
      await snapshot(page,'18-设置-缩放与配色');
      await delay(page,1550);
      await enter('总览','overview');
      await expect(active).toHaveAttribute('data-theme','warm');
      await snapshot(page,'19-总览-应用暖钛灰');
      await delay(page,1850);
    });

    const warm = await browser.newPage({ viewport, deviceScaleFactor:1, locale:'zh-CN' });
    warm.on('pageerror', error => errors.push(error.message));
    await warm.addInitScript(installMock, { scenario:'warm' });
    await warm.goto(renderer);
    await expect(warm.locator('[data-load-state=cached]')).toBeVisible();
    const cached = warm.getByRole('region',{name:'主设备'});
    await expect(cached.getByText(/上次电量/)).toBeVisible();
    await expect(cached.getByText('10–20%',{exact:true})).toBeVisible();
    await warm.evaluate(() => document.fonts.ready);
    await snapshot(warm,'20-补充-暖启动上次读数');
    const toast = await browser.newPage({ viewport:{width:460,height:146}, deviceScaleFactor:1, locale:'zh-CN' });
    toast.on('pageerror', error => errors.push(error.message));
    await toast.addInitScript(installMock, { scenario:'legacy', portable:true, walkthrough:true });
    await toast.goto(renderer+'?surface=toast&kind=low&device=dual');
    await expect(toast.getByRole('main',{name:'桌面电量提醒'})).toBeVisible();
    await expect(toast.getByText('DualSense',{exact:true})).toBeVisible();
    await expect(toast.getByText('15%',{exact:true})).toBeVisible();
    await delay(toast,300);
    await snapshot(toast,'21-补充-460x146测试通知');
    expect(errors).toEqual([]);
    evidence.tabs = [...new Set(evidence.tabs)];
    expect(evidence.tabs).toEqual(['总览','设备','提醒','记录','设置']);
    evidence.photos = snaps;
    writeFileSync(join(dir,'完整流程QA.json'), JSON.stringify(evidence,null,2));
    console.log(JSON.stringify(evidence,null,2));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
