// Actual built Chromium renderer with the preload collector mocked; no native HID, collector or Electron verification.
const { chromium, expect } = require('@playwright/test');
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { installMock } = require('./studio-review-mock.cjs');
const out = resolve(process.env.STUDIO_REVIEW_OUT || 'studio-list-status-review');
const url = pathToFileURL(resolve(process.env.STUDIO_REVIEW_DIST || join(__dirname,'../dist/ui/index.html'))).href;
const desktop={width:1586,height:992}, narrow={width:520,height:720};
const shots=[];
const btn=(s,n)=>s.getByRole('button',{name:n,exact:true});
const wait=(p,ms)=>p.waitForTimeout(ms);
const shot=async(p,n)=>{await p.screenshot({path:join(out,n+'.png'),caret:'hide'});shots.push(n+'.png');};

async function annotatePointer(page) {
  await page.evaluate(()=>{
    const dot=document.createElement('span');
    dot.setAttribute('aria-hidden','true');
    Object.assign(dot.style,{width:'12px',height:'12px',position:'fixed',left:'0',top:'0',zIndex:'2147483647',
      background:'#c1daf364',border:'1px solid #dde4f3',opacity:'0',pointerEvents:'none',borderRadius:'50%'});
    document.body.append(dot);
    window.addEventListener('pointermove',e=>{
      dot.style.opacity='1'; dot.style.transform=`translate(${e.clientX-7}px,${e.clientY-7}px)`;
    },{passive:true});
    window.addEventListener('pointerdown',()=>dot.animate([{boxShadow:'0 0 0 4px #f0ce9992'},{boxShadow:'0 0 0 13px #f0ce9900'}],{duration:330}),{passive:true});
  });
}
async function record(page,task) {
  const tmp=mkdtempSync(join(tmpdir(),'yudian-list-status-'));
  const c=await page.context().newCDPSession(page);
  const series=[], chapters=[];
  c.on('Page.screencastFrame',({data,metadata,sessionId})=>{
    const n='frame-'+String(series.length).padStart(5,'0')+'.jpg';
    writeFileSync(join(tmp,n),data,'base64');
    series.push({n,t:metadata.timestamp??Date.now()/1000});
    void c.send('Page.screencastFrameAck',{sessionId}).catch(()=>{});
  });
  try{
    await c.send('Page.startScreencast',{format:'jpeg',quality:89,maxWidth:desktop.width,maxHeight:desktop.height,everyNthFrame:1});
    const report=await task(name=>chapters.push({ name, seconds:chapters.length ? Date.now()/1000-series[0].t : 0 }));
    await c.send('Page.stopScreencast');
    expect(series.length).toBeGreaterThan(20);
    const end=series.at(-1).t-series[0].t+1.2;
    const files=series.map(({n,t},i)=>`file '${n}'\noption framerate 1000\nduration ${i+1<series.length?Math.max(.001,series[i+1].t-t).toFixed(3):'1.200'}`).join('\n')+`\nfile '${series.at(-1).n}'\noption framerate 1000\n`;
    writeFileSync(join(tmp,'inputs.txt'),files);
    const meta=';FFMETADATA1\n'+chapters.map((x,i)=>`[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(x.seconds*1000)}\nEND=${Math.round(1000*(chapters[i+1]?.seconds??end))}\ntitle=${x.name}`).join('\n')+'\n';
    writeFileSync(join(tmp,'chapters.txt'),meta);
    const media='余电-最终版-五页操作实录.mp4';
    const result=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',join(tmp,'inputs.txt'),
      '-f','ffmetadata','-i',join(tmp,'chapters.txt'),'-map','0:v:0','-map_metadata','1','-map_chapters','1',
      '-vf','fps=30','-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-movflags','+faststart',join(out,media)],{encoding:'utf8'});
    if(result.error||result.status)throw result.error||Error(result.stderr);
    return {...report,video:{media,frames:series.length,chapters}};
  }finally{
    await c.detach().catch(()=>{}); rmSync(tmp,{recursive:true,force:true});
  }
}

// Extend the existing preload at its snapshot boundary so the actual renderer and status model
// receive realistic collector data. Do not inject app DOM or decide statuses in the browser fixture.
function attachStatusFixture(scenario) {
  const api=window.powerManager;
  const base=api.snapshot.bind(api);
  const reading=(low,high=low,power='discharging')=>({low,high,raw:low,power,source:'hid'});
  const frozen=new Date('2026-11-24T08:42:00+08:00').getTime();
  const row=(id,art,name,connection,status,value,reason)=>({
    id,art,name,connection,status,reading:value,reason,watched:true,lastRead:value?frozen:null,
  });
  const current=[
    row('dual','dualsense','DualSense','蓝牙','current',reading(8),'设备读数正常'),
    row('xbox','xbox','Xbox 无线手柄','蓝牙','current',reading(14,19),'设备读数正常'),
    row('mouse','mouse','无线鼠标','无线 2.4G','current',reading(92),'设备读数正常'),
    row('keyboard','keyboard','机械键盘','USB','current',reading(9,9,'charging'),'设备读数正常'),
    row('full','earbuds','无线耳塞','USB','current',reading(100,100,'full'),'设备读数正常'),
    row('offline','headset','头戴耳机','蓝牙','offline',reading(6),'设备未连接'),
    row('cached','controller','备用手柄','蓝牙','stale',reading(7,7,'charging'),'等待新读数'),
  ];
  const original=api.command.bind(api);
  const initial=base().then(snapshot=>({...snapshot,demo:false,deviceSettings:{...snapshot.deviceSettings,mouse:{low:32}},
    collector:scenario==='ready'?'ready':'starting',
    devices:scenario==='cold'?[]:scenario==='warm'?current.slice(-1):current,
  }));
  let handler,state;
  const getState=async()=>state??=await initial;
  const publish=()=>handler?.(structuredClone(state));
  api.command=async c=>{
    const output=await original(c);
    if(!output.ok)return output;
    await getState();
    if(c.type==='settings')Object.assign(state.settings,c.patch);
    else if(c.type==='deviceSettings')Object.assign(state.deviceSettings[c.id]??={},c.patch);
    else if(c.type==='toggleAlertSetting')state.settings[c.key]=!state.settings[c.key];
    else return output;
    publish();
    return output;
  };
  api.onSnapshot=fn=>{handler=fn;return()=>{if(handler===fn)handler=undefined;}};
  api.snapshot=async()=>structuredClone(await getState());
  window.listStatusQA={
    ready:async()=>{
      await getState();state.collector='ready';state.devices=current;publish();
    },
    readAs:async(id,pct)=>{
      await getState();state.collector='ready';state.devices=current.map(d=>
        d.id===id?{...d,status:'current',reading:reading(pct),lastRead:Date.now()}:d);
      publish();
    },
  };
}

const region=(page,name)=>page.getByRole('region',{name,exact:true});
const rail=page=>region(page,'切换设备');
const hero=page=>region(page,'主设备');
const detail=page=>region(page,'设备详情');
const exact=(scope,text)=>scope.getByText(text,{exact:true});
const mode=(page,name)=>btn(rail(page),name);
const selected=(page,name)=>btn(rail(page),name);
const list=page=>page.locator('[data-mode=list]');
const settle=async page=>{await page.evaluate(()=>document.fonts.ready);await wait(page,520);};
const denseRange='14–19%';
const noOverflow=async page=>{
  const dimensions=await page.evaluate(()=>({window:innerWidth,html:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
  expect(dimensions.html).toBeLessThanOrEqual(dimensions.window+1);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.window+1);
  return dimensions;
};
const pageErrors=[];
async function open(browser,scenario,opts={}) {
  const page=await browser.newPage({
    viewport:opts.reduced?narrow:desktop,locale:'zh-CN',timezoneId:'Asia/Shanghai',
    reducedMotion:opts.reduced?'reduce':'no-preference',
  });
  page.on('pageerror',e=>pageErrors.push(e.message));
  await page.addInitScript({content:'('+installMock.toString()+')({historyDelay:900,walkthrough:true});('+attachStatusFixture.toString()+')('+JSON.stringify(scenario)+');'});
  if(!opts.defer)await page.goto(url);
  return page;
}

const artwork=page=>page.locator('[data-list-artwork]');
const liveArt=page=>artwork(page).locator('[data-list-art-layer][data-device-id]:not([data-exiting])');
const exiting=page=>artwork(page).locator('[data-list-art-layer][data-exiting]');
const brief=page=>list(page).getByRole('status',{name:'所选设备状态',exact:true});
const detailsFor=(page,name)=>btn(list(page),'查看详情 · '+name);
const critical=page=>list(page).locator('[data-list-critical]');

async function inspectStatus(page, { id,name,status,amount,power,alert=false }) {
  await expect(list(page)).toBeVisible();
  await expect(selected(page,name)).toHaveAttribute('aria-pressed','true');
  await expect(liveArt(page)).toHaveAttribute('data-device-id',id);
  await expect(brief(page)).toContainText(status);
  const number=selected(page,name).locator('strong');
  if(amount)await expect(number).toContainText(amount);
  if(status!=='已连接'){
    await expect(number).toContainText(/^上次\s+\d/);
    await expect(selected(page,name)).toHaveAccessibleDescription(/上次电量：/);
  }
  await expect(brief(page)).toHaveAttribute('data-connection-state',
    status==='已连接'?'connected':status==='未连接'?'offline':'pending');
  if(power)await expect(number).toHaveAttribute('data-tone','green');
  if(id==='xbox')await expect(number).toHaveAttribute('data-tone','amber');
  if(alert)await expect(number).toHaveAttribute('data-tone','red');
  await expect(brief(page)).not.toContainText(/低电量|充电中|正在充电|已充满/);
  if (alert) {
    await expect(critical(page)).toBeVisible();
    await expect(critical(page)).toContainText('电量告急');
  } else await expect(critical(page)).toHaveCount(0);
}

const verifyWidths=async page=>{
  const x=await noOverflow(page);
  const clipping=await rail(page).evaluate(node=>{
    return [...node.querySelectorAll('button')].flatMap(el=>{
      if(!el.getClientRects().length)return [];
      const b=el.getBoundingClientRect();
      return b.x < -1 || b.right>innerWidth+1 ? [{name:el.ariaLabel||el.textContent,x:b.x,right:b.right}] : [];
    });
  });
  expect(clipping).toEqual([]);
  return x;
};

const live={id:'mouse',name:'无线鼠标',status:'已连接',amount:'92%'};
const low={id:'xbox',name:'Xbox 无线手柄',status:'已连接',amount:denseRange};
const red={id:'dual',name:'DualSense',status:'已连接',amount:'8%',alert:true};
const charging={id:'keyboard',name:'机械键盘',status:'已连接',amount:'9%',power:/充电中|正在充电/};
const full={id:'full',name:'无线耳塞',status:'已连接',amount:'100%',power:'已充满'};
const disconnected={id:'offline',name:'头戴耳机',status:'未连接',amount:'6%'};
const stale={id:'cached',name:'备用手柄',status:'连接待确认',amount:'7%'};

async function choose(page,row,{reduced=false}={}) {
  await selected(page,row.name).click();
  await inspectStatus(page,row);
  await expect(detail(page)).toHaveCount(0);
  if(reduced)await expect(exiting(page)).toHaveCount(0);
}

async function exactRapidSwitch(page) {
  // Two replacement selections before the old transition can finish. Stimulate the real
  // DOM button handlers at RAF cadence to test the overlap independent of pointer dwell.
  const baseline=await artwork(page).boundingBox();
  await page.evaluate(()=>{
    const frame=()=>new Promise(r=>requestAnimationFrame(r));
    const btn=n=>[...document.querySelectorAll('button')].find(el=>el.ariaLabel===n);
    window.__switchTrace=[];
    let running=true;
    function sample(){
      const a=document.querySelector('[data-list-artwork]');
      window.__switchTrace.push({
        frame:a?Array.from(['x','y','width','height'],k=>a.getBoundingClientRect()[k]):[],
        layers:a?[...a.querySelectorAll('[data-list-art-layer]')].map(e=>({
          id:e.getAttribute('data-device-id'),out:e.hasAttribute('data-exiting'),
          x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,
        })):[],
      });
      if(running)requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
    window.__finishSwitch=()=>{running=false;return window.__switchTrace;};
    window.__fastClicks=async()=>{
      btn('Xbox 无线手柄').click(); await frame();await frame();
      btn('无线鼠标').click(); await frame();await frame();
      btn('DualSense').click(); await frame();
    };
  });
  await page.evaluate(()=>window.__fastClicks());
  await expect(liveArt(page)).toHaveAttribute('data-device-id','dual');
  await expect(selected(page,'DualSense')).toHaveAttribute('aria-pressed','true');
  await expect(exiting(page)).toHaveCount(0,{timeout:1500});
  const trace=await page.evaluate(()=>window.__finishSwitch());
  expect(trace.length).toBeGreaterThan(4);
  const drift=Math.max(...trace.flatMap(({frame})=>frame.map((n,i)=>Math.abs(n-Object.values(baseline)[i]))));
  expect(drift,'pinned artwork frame must not move or jump').toBeLessThan(1.25);
  expect(Math.max(...trace.map(f=>f.layers.length))).toBe(2);
  const visualLayers=trace.filter(f=>f.layers.length===2);
  expect(visualLayers.length).toBeGreaterThan(1);
  const xDrift=Math.max(...visualLayers.map(f=>Math.abs(f.layers[0].x-f.layers[1].x)));
  expect(xDrift,'both pictures stay on same left side during overlap').toBeLessThan(2);
  expect(trace.at(-1).layers).toHaveLength(1);
  return {sampledFrames:trace.length,overlapFrames:visualLayers.length,pinnedFramePx:drift,maxHorizontalLayerOffsetPx:xDrift};
}

async function loaded(page,mark,capture=false,reduced=false) {
  await expect(hero(page).getByRole('heading',{name:red.name,exact:true})).toBeVisible();
  if(capture) {mark('总览 · 展台、清单与设备状态');await wait(page,480);}
  await mode(page,'列表模式').click();
  await inspectStatus(page,red);
  await settle(page);
  const counts=await verifyWidths(page);
  const rb=await rail(page).boundingBox(), ab=await artwork(page).boundingBox();
  expect(Math.abs(rb.x+rb.width/2-page.viewportSize().width/2),'list is centered').toBeLessThan(12);
  expect(ab.x,'artwork is cut by the left window edge').toBeLessThan(14);
  expect(ab.x+ab.width,'art panel stays left of the centered list on desktop')
    .toBeLessThan(reduced?page.viewportSize().width*.35:rb.x);
  const alertCSS=await critical(page).evaluate(e=>getComputedStyle(e).color);
  const triplet=alertCSS.match(/[\d.]+/g)?.map(Number);
  expect(triplet[0],'critical actual foreground red channel').toBeGreaterThan(triplet[1]+20);
  if(capture){await shot(page,'01-左侧展台与居中清单-告急');await wait(page,1200);}
  const race=reduced?null:await exactRapidSwitch(page);
  await choose(page,low,{reduced});
  if(capture){await settle(page);await shot(page,'02-低电量不告急');await wait(page,700);}
  await choose(page,live,{reduced});
  if(capture){await settle(page);await shot(page,'03-已连接');await wait(page,650);}
  await choose(page,charging,{reduced});
  if(capture){await settle(page);await shot(page,'04-已连接并充电');await wait(page,550);}
  await choose(page,full,{reduced});
  if(capture){await settle(page);await shot(page,'05-已充满');await wait(page,550);}
  // The minimalist brief intentionally has only connection and critical alert. Active power
  // meaning is retained by the number tone and by the centered hero, not relabelled as critical.
  await mode(page,'展台模式').click();
  await expect(hero(page)).toContainText('已充满');
  await mode(page,'列表模式').click();
  await choose(page,charging,{reduced});
  await mode(page,'展台模式').click();
  await expect(hero(page)).toContainText('正在充电');
  await mode(page,'列表模式').click();
  await choose(page,disconnected,{reduced});
  if(capture){await settle(page);await shot(page,'06-明确未连接-上次电量');await wait(page,850);}
  await choose(page,stale,{reduced});
  if(capture){await settle(page);await shot(page,'07-连接待确认-上次电量');await wait(page,950);}
  if(reduced){ await brief(page).scrollIntoViewIfNeeded();await shot(page,'11-窄窗口列表-连接待确认'); }
  await choose(page,low,{reduced});
  if(capture){await wait(page,500);}
  await mode(page,'展台模式').click();
  await expect(hero(page).getByRole('heading',{name:low.name,exact:true})).toBeVisible();
  await expect(hero(page).getByRole('meter',{name:'电量'})).toHaveAttribute('aria-valuetext',denseRange);
  if(capture){await settle(page);await shot(page,'08-回到居中大设备');await wait(page,800);}
  await mode(page,'列表模式').click();
  await inspectStatus(page,low);
  const details=detailsFor(page,low.name);
  await details.click();
  await expect(detail(page).getByRole('heading',{name:low.name,exact:true})).toBeVisible();
  if(capture){await settle(page);await shot(page,'09-从清单进入详情');await wait(page,1100);}
  await btn(page,'返回总览').click();
  await expect(list(page)).toBeVisible();
  await expect(details).toBeFocused();
  await inspectStatus(page,low);
  if(capture){await settle(page);await shot(page,'10-返回清单保留选择');await wait(page,600);}
  if(reduced){
    await expect(page.locator('html[data-detail-direction]')).toHaveCount(0);
    await selected(page,stale.name).focus();
    await page.keyboard.press('Enter');
    await inspectStatus(page,stale);
  }
  await verifyWidths(page);
  return {counts,race,criticalComputedColor:alertCSS,layout:{artworkX:ab.x,listCenterX:rb.x+rb.width/2}};
}

const commandLog=(page,type)=>page.evaluate(t=>window.studioReview.commands.filter(c=>c.type===t),type);
const chart=scope=>scope.getByLabel(/近 24 小时电量曲线/);
const skeleton=scope=>scope.getByRole('status',{name:'正在加载电量历史'});
async function walkthrough(page,mark) {
  const report=await loaded(page,mark,true);
  const nav=page.getByRole('navigation',{name:'主导航'});
  const go=async (name,chapter)=>{
    mark(chapter);
    await btn(nav,name).click();
    await expect(btn(nav,name)).toHaveAttribute('aria-current','page');
  };
  await go('设备','设备 · 查看曲线与调整低电量阈值');
  await settle(page);await wait(page,650);
  await btn(page.getByRole('table'),'DualSense').dblclick();
  const d=detail(page);
  await expect(d.getByRole('heading',{name:'DualSense',exact:true})).toBeVisible();
  await expect(skeleton(d)).toBeVisible();
  await expect(chart(d).locator('path[data-trace=range]:not([d=""])')).toHaveCount(1);
  await wait(page,900);
  await btn(d,'调整提醒').click();
  const slider=d.getByRole('slider',{name:'设备低电量阈值'});
  const preset=d.getByRole('group',{name:'快速选择低电量阈值'});
  await slider.scrollIntoViewIfNeeded();
  expect(await commandLog(page,'deviceSettings')).toHaveLength(0);
  await btn(preset,'35%').click();
  await expect(slider).toHaveValue('35');
  await expect.poll(async()=>(await commandLog(page,'deviceSettings')).at(-1)?.patch.low).toBe(35);
  await expect(exact(d,'已保存 · 下次巡检生效')).toBeVisible();
  expect(await commandLog(page,'preview')).toHaveLength(0);
  await shot(page,'12-设备-滑杆保存35');
  await wait(page,1850);

  await go('提醒','提醒 · 通知偏好和测试提醒');
  const alerts=page.locator('[data-page=reminders]');
  await expect(alerts).toBeVisible();
  await expect(alerts.locator('article').filter({hasText:'DualSense'})).toBeVisible();
  await wait(page,900);
  await alerts.locator('summary').click();
  const sound=alerts.getByRole('switch',{name:'全屏提示音'});
  await expect(sound).toBeChecked();
  await sound.click();
  await expect(sound).not.toBeChecked();
  await expect.poll(async()=> (await commandLog(page,'toggleAlertSetting')).at(-1)?.key).toBe('fullscreenSound');
  await wait(page,900);
  await btn(alerts,'发送低电量测试通知').click();
  await expect.poll(async()=> (await commandLog(page,'preview')).at(-1)).toEqual({type:'preview',severity:'low',id:'xbox'});
  const previewRequest=(await commandLog(page,'preview')).at(-1);
  // Render the real compiled toast surface, in a 460×146 in-flow mock frame.
  await page.evaluate(toastUrl=>{
    const f=document.createElement('iframe');
    Object.assign(f.style,{position:'fixed',zIndex:'500',width:'460px',height:'146px',right:'16px',bottom:'14px',border:'0',background:'transparent'});
    f.title='模拟桌面测试通知'; f.src=toastUrl; document.body.append(f);
  },url+'?'+new URLSearchParams({surface:'toast',kind:previewRequest.severity,device:previewRequest.id}).toString());
  const toast=page.frameLocator('iframe[title="模拟桌面测试通知"]').getByRole('main',{name:'桌面电量提醒'});
  await expect(toast).toBeVisible();
  await expect(exact(toast,'15%')).toBeVisible();
  await expect(exact(toast,low.name)).toBeVisible();
  await expect.poll(()=>toast.evaluate(el=>Number(getComputedStyle(el).opacity))).toBe(1);
  await shot(page,'13-提醒-测试通知');
  await wait(page,1750);
  await btn(toast,'关闭通知').click();
  await page.locator('iframe[title="模拟桌面测试通知"]').evaluate(e=>e.remove());

  await go('记录','历史 · 等待读取、添加设备并比较曲线');
  const history=region(page,'电量对比记录');
  await expect(skeleton(history)).toBeVisible();
  const graph=chart(history);
  await expect(graph.locator('path[data-trace=range]:not([d=""])')).toHaveCount(1);
  await expect(graph.locator('path[data-trace=exact]:not([d=""])')).toHaveCount(1);
  const picker=history.getByRole('group',{name:'选择对比设备'});
  await wait(page,700);
  await btn(picker,'设备').click();
  await page.getByRole('menuitemcheckbox',{name:'机械键盘',exact:true}).click();
  await expect(graph.locator('path[data-trace=exact]:not([d=""])')).toHaveCount(2);
  await wait(page,950);
  await graph.focus();
  await graph.press('End');
  await shot(page,'14-历史-添加第三设备读点');
  await wait(page,1700);
  await graph.press('Escape');

  await go('设置','设置 · 应用暖钛灰与缩放');
  const settings=page.locator('[data-page=settings]');
  const zoom=settings.getByRole('slider',{name:'主界面缩放滑块'});
  await expect(settings).toBeVisible();
  await wait(page,650);
  await settings.getByRole('radio',{name:'暖钛灰'}).check();
  await expect(page.locator('[data-theme=warm]')).toBeVisible();
  const zoomForm=zoom.locator('xpath=ancestor::form');
  await btn(zoomForm,'125%').click();
  const draft=Number(await zoom.inputValue());
  expect(draft).toBe(125);
  expect((await commandLog(page,'settings')).some(c=>c.patch.zoom===draft)).toBe(false);
  await btn(zoomForm,'应用').click();
  await expect.poll(async()=> (await commandLog(page,'settings')).at(-1)?.patch.zoom).toBe(draft);
  await shot(page,'15-设置-配色与缩放已应用');
  await wait(page,1400);
  await btn(nav,'总览').click();
  await expect(page.locator('[data-theme=warm]')).toBeVisible();
  await wait(page,1350);
  return {...report,tabs:['总览','设备','提醒','历史','设置'],zoomApplied:draft,fixtureToastPercent:15};
}

async function verifyStartup(browser) {
  const cold=await open(browser,'cold',{reduced:true});
  const initial=cold.locator('[data-load-state=initial]');
  await expect(initial).toBeAttached();
  await expect(initial.getByRole('status')).toBeVisible();
  await expect(initial.getByRole('status')).toHaveText('正在读取设备…');
  await expect(rail(cold)).toHaveCount(0);
  await expect(hero(cold)).toHaveCount(0);
  await expect(artwork(cold)).toHaveCount(0);
  await expect(cold.locator('[data-cold-motion][src]')).toHaveCount(0);
  await cold.evaluate(()=>window.listStatusQA.ready());
  await expect(hero(cold).getByRole('heading',{name:red.name,exact:true})).toBeVisible();
  await expect(cold.locator('[data-cold-reveal]')).toHaveCount(0);
  await cold.close();

  const warm=await open(browser,'warm',{reduced:true});
  await expect(warm.locator('[data-load-state=cached]')).toBeVisible();
  await expect(warm.locator('[data-cold-copy], [data-cold-motion][src]')).toHaveCount(0);
  await expect(hero(warm).getByRole('heading',{name:stale.name,exact:true})).toBeVisible();
  await mode(warm,'列表模式').click();
  await inspectStatus(warm,stale);
  await warm.evaluate(()=>window.listStatusQA.ready());
  await inspectStatus(warm,stale);
  await verifyWidths(warm);
  await warm.close();
  return {cold:'no invented device, list or progress/photo; real first connected fixture after ready',warm:'cached name and previous reading retained; connection remains unconfirmed; no cold visual'};
}

(async()=>{
  mkdirSync(out,{recursive:true});
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/tmp/chromium',
    args:['--allow-file-access-from-files','--no-sandbox','--disable-accelerated-video-decode']});
  try{
    const desktopPage=await open(browser,'ready');
    let desktopReport;
    if(process.env.STUDIO_REVIEW_SKIP_MEDIA==='1')desktopReport=await loaded(desktopPage,()=>{});
    else {
      await annotatePointer(desktopPage);
      desktopReport=await record(desktopPage,mark=>walkthrough(desktopPage,mark));
    }
    await desktopPage.close();
    const narrowPage=await open(browser,'ready',{reduced:true});
    const narrowReport=await loaded(narrowPage,()=>{},false,true);
    await narrowPage.close();
    const startup=await verifyStartup(browser);
    expect(pageErrors).toEqual([]);
    const output={builtRenderer:url,scope:'Chromium compiled renderer with controlled mock preload; not native Windows/HID',desktop:desktopReport,narrow:narrowReport,startup,shots};
    writeFileSync(join(out,'overview-list-status-QA.json'),JSON.stringify(output,null,2)+'\n');
    console.log(JSON.stringify(output,null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
