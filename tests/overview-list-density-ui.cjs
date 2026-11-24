// Actual built Chromium renderer with the preload collector mocked; no native HID, collector or Electron verification.
const { chromium, expect } = require('@playwright/test');
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { installMock } = require('./studio-review-mock.cjs');
const out = resolve(process.env.STUDIO_REVIEW_OUT || 'studio-list-density-review');
const url = pathToFileURL(resolve(process.env.STUDIO_REVIEW_DIST || join(__dirname,'../dist/ui/index.html'))).href;
const desktop={width:1586,height:992}, medium={width:1100,height:800}, narrow={width:520,height:720};
const btn=(s,n)=>s.getByRole('button',{name:n,exact:true});
const wait=(p,ms)=>p.waitForTimeout(ms);

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
  const tmp=mkdtempSync(join(tmpdir(),'yudian-list-density-'));
  const c=await page.context().newCDPSession(page);
  const series=[], chapters=[];
  c.on('Page.screencastFrame',({data,metadata,sessionId})=>{
    const n='frame-'+String(series.length).padStart(5,'0')+'.jpg';
    writeFileSync(join(tmp,n),data,'base64');
    series.push({n,t:metadata.timestamp??Date.now()/1000});
    void c.send('Page.screencastFrameAck',{sessionId}).catch(()=>{});
  });
  try{
    await c.send('Page.startScreencast',{format:'jpeg',quality:94,maxWidth:desktop.width,maxHeight:desktop.height,everyNthFrame:1});
    const report=await task(name=>chapters.push({ name, seconds:chapters.length ? Date.now()/1000-series[0].t : 0 }));
    await c.send('Page.stopScreencast');
    expect(series.length).toBeGreaterThan(20);
    const end=series.at(-1).t-series[0].t+1.2;
    const files=series.map(({n,t},i)=>`file '${n}'\noption framerate 1000\nduration ${i+1<series.length?Math.max(.001,series[i+1].t-t).toFixed(3):'1.200'}`).join('\n')+`\nfile '${series.at(-1).n}'\noption framerate 1000\n`;
    writeFileSync(join(tmp,'inputs.txt'),files);
    const meta=';FFMETADATA1\n'+chapters.map((x,i)=>`[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(x.seconds*1000)}\nEND=${Math.round(1000*(chapters[i+1]?.seconds??end))}\ntitle=${x.name}`).join('\n')+'\n';
    writeFileSync(join(tmp,'chapters.txt'),meta);
    const media='余电-清单数据密度-原速实录.mp4';
    const result=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',join(tmp,'inputs.txt'),
      '-f','ffmetadata','-i',join(tmp,'chapters.txt'),'-map','0:v:0','-map_metadata','1','-map_chapters','1',
      '-vf','fps=30','-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-movflags','+faststart',join(out,media)],{encoding:'utf8'});
    if(result.error||result.status)throw result.error||Error(result.stderr);
    return {...report,video:{media,frames:series.length,chapters}};
  }finally{
    await c.detach().catch(()=>{}); rmSync(tmp,{recursive:true,force:true});
  }
}

// Exercise real compiled renderer with collector snapshots at the preload boundary only.
const LONG='非常长的无线机械键盘名称 用于检查横向收放时完整名称与设备电量仍然可访问';
const T='2026-11-24T08:42:00+08:00';
const date=(t)=>new Intl.DateTimeFormat('zh-CN',{
  month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Shanghai',
}).format(new Date(t));
const samples={
  dual:{id:'dual',name:'DualSense',art:'dualsense',connection:'蓝牙',state:'current',reading:[8,8,'discharging'],at:T,threshold:20,source:'global',tone:'red',modeStatus:'connected',power:/放电|未充电|供电|未上报/},
  xbox:{id:'xbox',name:'Xbox 无线手柄',art:'xbox',connection:'蓝牙',state:'current',reading:[14,19,'discharging'],at:'2026-11-24T08:43:00+08:00',threshold:20,source:'global',tone:'amber',modeStatus:'connected',power:/放电|未充电|供电|未上报/},
  mouse:{id:'mouse',name:'无线鼠标',art:'mouse',connection:'无线 2.4G',state:'current',reading:[92,92,'unknown'],at:'2026-11-24T08:44:00+08:00',threshold:32,source:'override',tone:'normal',modeStatus:'connected',power:/未上报|未确认/},
  keyboard:{id:'keyboard',name:LONG,art:'keyboard',connection:'USB',state:'current',reading:[9,9,'charging'],at:'2026-11-24T08:45:00+08:00',threshold:20,source:'global',tone:'green',modeStatus:'connected',power:/充电中/},
  full:{id:'full',name:'无线耳塞',art:'earbuds',connection:'USB',state:'current',reading:[100,100,'full'],at:'2026-11-24T08:46:00+08:00',threshold:20,source:'global',tone:'green',modeStatus:'connected',power:/已充满/},
  offline:{id:'offline',name:'头戴耳机',art:'headset',connection:'蓝牙',state:'offline',reading:[6,6,'full'],at:'2026-11-23T21:09:00+08:00',threshold:25,source:'override',tone:'offline',modeStatus:'offline',power:/^—$|未确认/},
  cached:{id:'cached',name:'备用手柄',art:'controller',connection:'蓝牙',state:'stale',reading:[7,7,'charging'],at:'2026-11-23T21:31:00+08:00',threshold:20,source:'global',tone:'offline',modeStatus:'pending',power:/^—$|未确认/},
  unknown:{id:'unknown',name:'尚无读数的蓝牙设备',art:'unknown',connection:'蓝牙',state:'no_radio_reply',reading:null,at:null,threshold:20,source:'global',tone:'offline',modeStatus:'pending',power:/^—$|未确认/},
};
const sourceWords={ global:/全局|默认/, override:/自定义|独立|覆盖|设备专用|单设备|设备设置/ };
const statuses={connected:'已连接',offline:'未连接',pending:'连接待确认'};
const sampleList=Object.values(samples);
const label=s=>s.reading ? s.reading[0]===s.reading[1] ? s.reading[0]+'%' : s.reading[0]+'–'+s.reading[1]+'%' : '—';
const rail=page=>page.getByRole('region',{name:'切换设备',exact:true});
const stage=page=>page.getByRole('region',{name:'主设备',exact:true});
const list=page=>page.locator('[data-mode=list]');
const row=(page,s)=>btn(rail(page),s.name);
const brief=page=>list(page).getByRole('status',{name:'所选设备状态',exact:true});
const value=(page,s,k)=>row(page,s).locator('[data-list-field="'+k+'"]');
const all=(page,s)=>row(page,s).locator('[data-mode-extra]');
const overlay=page=>page.locator('[data-overview-morph]');
const errors=[];

function attachFixture(data) {
  const prev=window.powerManager;
  const stamp=t=>t?Date.parse(t):null;
  const devices=data.map(s=>({
    id:s.id,name:s.name,art:s.art,connection:s.connection,status:s.state,
    watched:true,lastRead:stamp(s.at),reason:s.state==='offline'?'设备未连接':s.state==='current'?'设备读数正常':'等待新读数',
    reading:s.reading?{low:s.reading[0],high:s.reading[1],raw:s.reading[0],power:s.reading[2],source:'hid'}:null,
  }));
  const original=prev.snapshot.bind(prev);
  const base=original().then(state=>({...state,collector:'ready',demo:false,devices,deviceSettings:{
    ...state.deviceSettings,...Object.fromEntries(data.filter(s=>s.source==='override').map(s=>[s.id,{low:s.threshold}])),
  }}));
  let handler;
  prev.snapshot=async()=>structuredClone(await base);
  prev.onSnapshot=notify=>{handler=notify;return()=>{if(handler===notify)handler=undefined;};};
  window.densityQA={
    setGlobal:async low=>{
      const snapshot=await base;
      snapshot.settings.low=low;
      handler?.(structuredClone(snapshot));
    },
  };
}

async function start(browser,viewport,{reduced=false}={}) {
  const page=await browser.newPage({viewport,reducedMotion:reduced?'reduce':'no-preference',locale:'zh-CN',timezoneId:'Asia/Shanghai'});
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript({content:'('+installMock.toString()+')({historyDelay:250});('+attachFixture.toString()+')('+JSON.stringify(sampleList)+');'});
  await page.goto(url);
  await expect(stage(page).getByRole('heading',{name:'DualSense',exact:true})).toBeVisible();
  await expect.poll(()=>page.locator('[data-active-stage] img').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
  await page.evaluate(()=>document.fonts.ready);
  return page;
}
async function collapse(page) {
  await btn(rail(page),'展台模式').click();
  await expect(list(page)).toHaveCount(0);
  await expect(overlay(page)).toHaveCount(0);
}
async function expand(page) {
  await btn(rail(page),'列表模式').click();
  await expect(list(page)).toBeVisible();
  await expect(overlay(page)).toHaveCount(0);
  await expect.poll(()=>all(page,samples.dual).evaluate(el=>Number(getComputedStyle(el).opacity))).toBe(1);
}

async function inspectRow(page,s) {
  const el=row(page,s);
  const v=value(page,s,'threshold');
  const t=value(page,s,'last-read');
  const p=value(page,s,'power');
  await expect(el).toHaveAttribute('title',s.name);
  await expect(el).toHaveAccessibleName(s.name);
  await expect(el.locator('strong[data-tone]')).toHaveAttribute('data-tone',s.tone);
  await expect(el.locator('strong[data-tone]')).toContainText(label(s));
  await expect(v).toContainText(s.threshold+'%');
  const provenanceTitle=await v.getAttribute('title');
  expect(provenanceTitle,'threshold label and provenance for '+s.name).toMatch(sourceWords[s.source]);
  expect(provenanceTitle).toContain(s.threshold+'%');
  const when=s.at?date(s.at):'—';
  await expect(t).toContainText(when);
  expect(await t.getAttribute('title')).toContain(s.at?when:'暂无记录');
  await expect(p).toContainText(s.power);
  await expect(p).toHaveAttribute('data-power',s.state==='current'&&s.reading?s.reading[2]:'unconfirmed');
  if(s.state!=='current')await expect(p).toHaveAttribute('title',/未确认/);
  const a11y=await el.getAttribute('aria-description');
  expect(a11y).toMatch(sourceWords[s.source]);
  expect(a11y).toContain(s.threshold+'%');
  expect(a11y).toContain(s.at?when:'暂无记录');
  if(s.reading)expect(a11y).toContain(label(s));
  else expect(a11y).toMatch(/暂无.*读数|电量.*未知|电量.*—/);
  await expect(el).toHaveAccessibleDescription(a11y);
  return {threshold:provenanceTitle,when,charge:await p.getAttribute('title'),battery:label(s)};
}
async function choose(page,s) {
  await row(page,s).click();
  await expect(row(page,s)).toHaveAttribute('aria-pressed','true');
  await expect(brief(page)).toHaveAttribute('data-connection-state',s.modeStatus);
  await expect(brief(page)).toContainText(statuses[s.modeStatus]);
  await expect(page.locator('[data-list-critical]')).toHaveCount(s.tone==='red'?1:0);
  const stageLayer=page.locator('[data-list-art-layer][data-device-id]:not([data-exiting])');
  await expect(stageLayer).toHaveAttribute('data-device-id',s.id);
  if(s.state!=='current')await expect(brief(page)).not.toContainText(/电量告急|充电中|已充满/);
}

async function geometry(page,viewport) {
  const data=await list(page).evaluate(section=>{
    const scroll=section.querySelector('[data-mode-rail-scroll]');
    const bounds=el=>{const r=el?.getBoundingClientRect();return r?{l:r.left,r:r.right,y:r.y,h:r.height}:null;};
    const line=(element)=>{
      const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);
      const record=[];
      const range=document.createRange();
      while(walker.nextNode()){
        if(!walker.currentNode.textContent.trim())continue;
        range.selectNodeContents(walker.currentNode);
        record.push(...range.getClientRects());
      }
      return new Set(record.map(r=>Math.round(r.bottom*16))).size;
    };
    const rows=[...section.querySelectorAll('[data-mode-row]')].map(row=>{
      const name=row.querySelector('b');
      const battery=row.querySelector('strong[data-tone]');
      const metadata=row.querySelector('[data-mode-extra]');
      return {box:bounds(row),nameLine:line(name),nameBounds:bounds(name),nameText: name.textContent,nameClipped:name.scrollWidth>name.clientWidth,
        battery:bounds(battery),batteryLine:line(battery),metadata:bounds(metadata),
        fields:[...metadata.querySelectorAll('[data-list-field]')].map(field=>{
          const inner=field.querySelector(':scope > span');
          return {type:field.dataset.listField,visible:field.getClientRects().length>0,box:bounds(field),
            lines:line(field),display:getComputedStyle(field).display,clipped:inner&&inner.scrollWidth>inner.clientWidth+1};
        })};
    });
    return {innerWidth,htmlWidth:document.documentElement.scrollWidth,scroll:bounds(scroll),rows};
  });
  expect(data.rows).toHaveLength(sampleList.length);
  expect(data.htmlWidth).toBeLessThanOrEqual(data.innerWidth+1);
  for(const row of data.rows){
    expect(row.nameLine,'device name does not wrap').toBe(1);
    // Offline labels include a 10px prefix on the same baseline, so they can
    // report two glyph boxes even while occupying exactly one CSS line.
    expect(row.batteryLine).toBeLessThanOrEqual(2);
    expect(row.battery.l,'name + number do not overlap').toBeGreaterThanOrEqual(row.nameBounds.r-1);
    expect(row.metadata.y,'metadata stays below battery/name line').toBeGreaterThanOrEqual(row.nameBounds.y+row.nameBounds.h);
    const fields=row.fields.filter(f=>f.visible);
    let cursor=row.metadata.l;
    for(const field of fields){
      expect(field.box.l).toBeGreaterThanOrEqual(cursor-.75);
      expect(field.box.r).toBeLessThanOrEqual(row.metadata.r+.75);
      expect(field.lines,field.type+' remains one-line').toBe(1);
      if(field.type!=='connection')expect(field.clipped,field.type+' is not truncated at '+viewport.width).toBe(false);
      cursor=field.box.r;
    }
    if(viewport.width<770)expect(fields.find(f=>f.type==='connection')).toBeUndefined();
  }
  const long=data.rows.find(r=>r.nameText===LONG);
  // Narrower rendering must be allowed to ellipsize while row accessibility
  // (asserted above) continues to expose the actual name and values.
  expect(long.nameClipped).toBe(true);
  return {width:viewport.width,visibleFields:data.rows[0].fields.filter(f=>f.visible).map(f=>f.type),longNameEllipsized:long.nameClipped,
    rows:data.rows.length,rowHeight:data.rows[0].box.h};
}

async function runViewport(browser,viewport,{reduced=false}={}) {
  const page=await start(browser,viewport,{reduced});
  try {
    const before=await row(page,samples.dual).boundingBox();
    const coll=all(page,samples.dual);
    await expect(coll).toHaveAttribute('aria-hidden','true');
    expect(await coll.evaluate(el=>Number(getComputedStyle(el).opacity))).toBe(0);
    await expand(page);
    const rows={};
    for(const s of sampleList)rows[s.id]=await inspectRow(page,s);
    const after=await row(page,samples.dual).boundingBox();
    expect(Math.abs(before.y-after.y),'endpoint row top').toBeLessThan(.75);
    expect(Math.abs(before.height-after.height),'endpoint row height').toBeLessThan(.75);
    const dims=await geometry(page,viewport);
    if(reduced){
      await row(page,samples.keyboard).focus();
      await page.keyboard.press('Enter');
      await expect(row(page,samples.keyboard)).toHaveAttribute('aria-pressed','true');
      await expect(row(page,samples.keyboard)).toBeFocused();
      await expect(value(page,samples.keyboard,'connection')).toBeHidden();
      await expect(row(page,samples.keyboard)).toHaveAccessibleDescription(/连接方式：USB/);
    }
    for(const s of [samples.dual,samples.keyboard,samples.full,samples.offline,samples.cached,samples.unknown])await choose(page,s);
    // Changing the one global value affects default-backed rows only, not overrides
    // or the retained collector timestamp.
    if(!reduced){
      await page.evaluate(()=>window.densityQA.setGlobal(23));
      await inspectRow(page,{...samples.xbox,threshold:23});
      await inspectRow(page,samples.mouse);
      await inspectRow(page,samples.offline);
    }
    await collapse(page);
    return {...dims,reduced,rows};
  } finally {await page.close();}
}

async function clip(browser) {
  const page=await start(browser,desktop);
  try {
    await annotatePointer(page);
    const meta=await record(page,async mark=>{
      mark('总览 · 展开后才显示读数、阈值与充电状态');
      await wait(page,620);
      await expand(page);
      await choose(page,samples.dual);
      await wait(page,1350);
      await choose(page,samples.keyboard);
      await wait(page,1170);
      await choose(page,samples.full);
      await wait(page,930);
      mark('离线与待确认 · 保留上次读数，不冒充实时充电');
      await choose(page,samples.offline);
      await wait(page,1070);
      await choose(page,samples.cached);
      await wait(page,1050);
      await collapse(page);
      await wait(page,880);
      return {};
    });
    return meta.video;
  } finally {await page.close();}
}
(async()=>{
  mkdirSync(out,{recursive:true});
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/tmp/chromium',
    args:['--allow-file-access-from-files','--no-sandbox']});
  try {
    const report={renderer:url,scope:'Chromium compiled mock renderer only. No original hardware/Windows/native Electron.'};
    report.desktop=await runViewport(browser,desktop);
    report.medium=await runViewport(browser,medium);
    report.narrow=await runViewport(browser,narrow,{reduced:true});
    if(process.env.STUDIO_REVIEW_SKIP_MEDIA!=='1')report.video=await clip(browser);
    expect(errors).toEqual([]);
    writeFileSync(join(out,'overview-list-density-QA.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
