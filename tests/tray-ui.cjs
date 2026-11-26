const { chromium, expect } = require('@playwright/test');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox','--allow-file-access-from-files'] });
  const page = await browser.newPage({ viewport: { width: 420, height:565 } });
  try {
    await page.addInitScript(() => {
      const now = Date.now();
      const data = [
        ['dual','DualSense','dualsense','current',42,52],
        ['mouse','无线鼠标','mouse','current',92,92],
        ['empty','无线耳塞','earbuds','current',null,null],
        ['headset','头戴耳机','headset','current',9,9],
        ['xbox','Xbox 无线手柄','xbox','offline',46,46],
        ['keyboard','机械键盘','keyboard','current',17,17],
      ];
      const live = data.map(([id,name,art,status,low,high]) => ({id,name,art,status,connection:'蓝牙',reading:low == null ? null : {
        low,high,raw:low,power:'discharging',source:'hid' },watched:true,lastRead:now-3_600_000,reason:status==='offline'?'未连接':'设备读数正常'}));
      let state = { devices:[{ ...live[0], status:'stale' }], collector:'starting', refreshing:false, mutedUntil:0,
        settings:{low:20,critical:10,repeat:0,snooze:30,fullscreenSound:true,soundOnly:false,voltage:false,startup:false,zoom:100,trayZoom:100,desktopToasts:true,muteMinutes:60},
        deviceSettings:{},alerts:{},demo:false };
      let notify, settle;
      const publish=patch => { state={ ...state, ...patch }; notify?.(state); };
      window.commands=[];
      window.ready=() => publish({collector:'ready',devices:live});
      window.finish=() => { publish({refreshing:false});settle({ok:true}); };
      window.powerManager={image:async()=>null,snapshot:async()=>state,onSnapshot:fn=>{notify=fn;return()=>{};},onNavigate:()=>()=>{},
        command:async cmd=>{
          commands.push(cmd);
          if(cmd.type==='pin') return {ok:true,pinned:true};
          if(cmd.type==='mute') publish({mutedUntil:Date.now()+60000});
          if(cmd.type==='refresh') return new Promise(resolve=>{settle=resolve;publish({refreshing:true});});
          return {ok:true};
        }};
    });
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(pathToFileURL(resolve(process.env.TRAY_DIST || resolve(__dirname,'../dist/ui'),'index.html')).href+'?surface=tray');
    const panel = page.getByRole('main',{name:'托盘面板'});
    const refresh=panel.getByRole('button',{name:'立即刷新'});
    await expect(panel.getByRole('status')).toContainText('正在确认连接');
    await expect(panel.getByRole('status')).not.toContainText('台在线');
    await expect(panel.getByRole('button',{name:/DualSense.*电量42–52%/})).toBeVisible();
    await expect(refresh).toBeDisabled();
    if (process.env.TRAY_PROOF) await page.screenshot({path:process.env.TRAY_PROOF+'/03-实际缓存.png'});
    await page.evaluate(()=>ready());
    await expect(panel.getByRole('status')).toContainText('5 台在线');
    await expect(panel.locator('[data-tray-device]').first()).toHaveAttribute('data-tray-device','headset');
    await expect(panel.locator('[data-tray-device]').nth(1)).toHaveAttribute('data-tray-device','keyboard');
    await expect(panel.getByRole('button',{name:/无线耳塞.*电量未知/})).toBeVisible();
    expect(await panel.locator('[data-tray-device="empty"] [aria-hidden=true]').count()).toBe(1); // Chevron only; no fake level bar.
    const offline=panel.getByRole('button',{name:/未连接设备/});
    await expect(offline).toHaveAttribute('aria-expanded','false');
    if (process.env.TRAY_PROOF) await page.screenshot({path:process.env.TRAY_PROOF+'/02-实际常态.png'});
    await offline.click();
    await expect(panel.getByRole('button',{name:/Xbox 无线手柄.*电量46%/})).toBeVisible();
    await refresh.click();
    await expect(refresh).toBeDisabled();
    await expect(panel.getByRole('status')).toContainText('正在刷新');
    await expect(panel.getByRole('button',{name:/无线鼠标.*92%/})).toBeVisible();
    await page.evaluate(()=>finish());
    await expect(refresh).toBeEnabled();
    await panel.getByRole('button',{name:'置顶面板'}).click();
    await expect(panel.getByRole('button',{name:'取消置顶'})).toHaveAttribute('aria-pressed','true');
    await panel.getByRole('button',{name:/静音/}).click();
    await expect(panel.getByRole('button',{name:'恢复提醒'})).toHaveAttribute('aria-pressed','true');
    await panel.getByRole('button',{name:/头戴耳机/}).click();
    await page.setViewportSize({width:320,height:365});
    const open=panel.getByRole('button',{name:'打开余电'});
    await expect(open).toBeInViewport();
    await open.focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
    expect(await page.evaluate(()=>commands.map(c=>[c.type,c.id||null]))).toEqual([
      ['refresh',null],['pin',null],['mute',null],['open','headset'],['open',null],['closeSurface',null]]);
    expect(errors).toEqual([]);
    console.log('Tray UI: cache-to-live, severity order, unknown, collapsed offline, refresh retention, pin/mute/open/Escape, 320×365 CTA.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
