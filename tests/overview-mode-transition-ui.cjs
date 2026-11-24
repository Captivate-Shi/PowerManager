// Actual built Chromium renderer with the preload collector mocked; no native HID, collector or Electron verification.
const { chromium, expect } = require('@playwright/test');
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { installMock } = require('./studio-review-mock.cjs');
const out = resolve(process.env.STUDIO_REVIEW_OUT || 'studio-wide-list-production-review');
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
  const tmp=mkdtempSync(join(tmpdir(),'yudian-wide-list-production-'));
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
    const media='余电-加宽清单与Q弹转场-正式Mock实录.mp4';
    const result=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',join(tmp,'inputs.txt'),
      '-f','ffmetadata','-i',join(tmp,'chapters.txt'),'-map','0:v:0','-map_metadata','1','-map_chapters','1',
      '-vf','fps=30','-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-movflags','+faststart',join(out,media)],{encoding:'utf8'});
    if(result.error||result.status)throw result.error||Error(result.stderr);
    return {...report,video:{media,frames:series.length,chapters}};
  }finally{
    await c.detach().catch(()=>{}); rmSync(tmp,{recursive:true,force:true});
  }
}

// Mock only at the existing preload boundary. Browser assertions observe the
// compiled app's DOM, geometry and animations without mutating product styles.
const rail=page=>page.getByRole('region',{name:'切换设备',exact:true});
const mode=page=>page.locator('[data-mode]:is([data-mode=stage],[data-mode=list])');
const railButton=(p,name)=>btn(rail(p),name);
const stageButton=p=>railButton(p,'展台模式');
const listButton=p=>railButton(p,'列表模式');
const listArt=p=>p.locator('[data-list-artwork] [data-list-art-layer]:not([data-exiting]) img[data-device-art]');
const stageArt=p=>p.locator('[data-active-stage] img[data-device-art]');
const artFor=(page,kind)=>kind==='list'?listArt(page):stageArt(page);
const dual={id:'dual',name:'DualSense',art:'dualsense',meter:'10–20%'};
const xbox={id:'xbox',name:'Xbox 无线手柄',art:'xbox',meter:'46%'};
const nav=page=>page.getByRole('navigation',{name:'主导航'});
const urlAsset=(subject)=>RegExp('/'+subject.art+'-hero\\.webp$');
const pageErrors=[];
function extendLongDeviceList(extra) {
  const api=window.powerManager;
  const originalSnapshot=api.snapshot.bind(api);
  const originalSubscribe=api.onSnapshot.bind(api);
  function transform(snapshot) {
    const rows=Array.from({length:extra},(_,i)=>({
      ...snapshot.devices[i%snapshot.devices.length], id:'qa-extra-'+i,
      name:'额外设备 '+String(i+1).padStart(2,'0')+' 超长名称用于验证切换时名称及电量不会换行',
      connection:'USB 延长接收器，带较长的连接说明',
      status:'current', reason:'设备读数正常',
      reading:{low:34+i%55,high:36+i%55,raw:34+i%55,power:'discharging',source:'hid'},
    }));
    return {...snapshot,devices:[...snapshot.devices,...rows]};
  }
  api.snapshot=async()=>transform(await originalSnapshot());
  api.onSnapshot=handler=>originalSubscribe(state=>handler(transform(state)));
}
async function open(browser,{reduced=false,viewport=desktop,extra=0}={}) {
  const page=await browser.newPage({viewport,locale:'zh-CN',reducedMotion: reduced?'reduce':'no-preference'});
  page.on('pageerror',error=>pageErrors.push(error.message));
  await page.addInitScript({content:'('+installMock.toString()+')({});'+(extra?'('+extendLongDeviceList.toString()+')('+extra+');':'')});
  await page.goto(url);
  await page.evaluate(()=>window.studioReview.ready());
  await expect(stageArt(page)).toHaveAttribute('src',urlAsset(dual));
  await artDecoded(page,'stage');
  return page;
}
async function artDecoded(page,kind) {
  await expect.poll(()=>artFor(page,kind).evaluate(im=>im.complete&&im.naturalWidth>0)).toBe(true);
}
async function isSettled(page,kind,subject) {
  await expect(mode(page)).toHaveAttribute('data-mode',kind);
  await expect((kind==='list'?listButton:stageButton)(page)).toHaveAttribute('aria-pressed','true');
  await expect(railButton(page,subject.name)).toHaveAttribute('aria-pressed','true');
  await expect(artFor(page,kind)).toHaveAttribute('src',urlAsset(subject));
  await artDecoded(page,kind);
  if(kind==='stage'){
    const hero=page.getByRole('region',{name:'主设备',exact:true});
    await expect(hero.getByRole('heading',{name:subject.name,exact:true})).toBeVisible();
    await expect(hero.getByRole('meter',{name:'电量',exact:true})).toHaveAttribute('aria-valuetext',subject.meter);
  }else{
    await expect(page.getByRole('status',{name:'所选设备状态',exact:true})).toHaveAttribute('data-connection-state','connected');
    await expect(railButton(page,subject.name)).toContainText(subject.meter);
  }
}

// Upper right → centered larger rail and large central → fixed left art must
// be measurable on the actual rendered frames, not inferred from CSS keyframes.
async function startTrace(page) {
  await page.evaluate(()=>{
    const elem=q=>document.querySelector(q);
    const rect=e=>e?(()=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})():null;
    const descriptor=e=>{
      if(!e)return null;
      const photo=e.matches('img')?e:e.querySelector('img');
      if(!photo)return null;
      let alpha=1,visual=true;
      for(let cursor=photo;cursor;cursor=cursor.parentElement){
        const style=getComputedStyle(cursor);
        alpha*=Number(style.opacity);
        if(style.visibility==='hidden'||style.display==='none')visual=false;
      }
      return {asset:photo.currentSrc||photo.src,id:e.dataset.deviceId,box:rect(e),photo:rect(photo),
        alpha,visible:visual&&alpha>.025,loaded:photo.complete&&photo.naturalWidth>0};
    };
    const vertical=e=>{
      if(!e)return null;
      const r=e.getBoundingClientRect();
      return {y:r.y,h:r.height};
    };
    function textLine(e){
      if(!e)return null;
      const range=document.createRange();
      const walker=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);
      const rects=[];
      let width=0;
      while(walker.nextNode()){
        const item=walker.currentNode;
        if(!item.textContent.trim() || item.parentNode!==e)continue;
        range.selectNodeContents(item);
        rects.push(...range.getClientRects());
        width+=range.getBoundingClientRect().width;
      }
      const positions=rects.map(r=>r.bottom);
      return positions.length?{bottom:positions[0],width,lineCount:new Set(positions.map(x=>Math.round(x*16))).size}:null;
    }
    function textOpacity(e) {
      if(!e)return null;
      let alpha=1;
      for(let item=e;item;item=item.parentElement){
        const style=getComputedStyle(item);
        if(style.display==='none'||style.visibility==='hidden')return 0;
        alpha*=Number(style.opacity);
      }
      return alpha;
    }
    const frames=window.__modeFrames=[];
    const image='img[data-device-art]';
    let raf=0;
    const sample=time=>{
      const rail=elem('[aria-label="切换设备"]');
      const m=elem('[data-mode]:is([data-mode=stage],[data-mode=list])');
      const selected=rail?.querySelector('button[aria-pressed="true"]:not([aria-label$="模式"])');
      const stage=elem('[data-active-stage] '+image);
      const list=elem('[data-list-artwork] [data-list-art-layer]:not([data-exiting]) '+image);
      const running=elem('[data-overview-morph]');
      const motionArt=elem('[data-mode-hero]');
      const motionRail=elem('[data-mode-rail]')||rail;
      const modes=rail?.querySelector('[aria-label="总览显示方式"]');
      const header=rail?.querySelector('header');
      const allButton=[...header?.querySelectorAll('button')??[]].find(button=>button.textContent.includes('全部设备'));
      const scroll=rail?.querySelector('[data-mode-rail-scroll], [data-mode-scroll], [aria-busy]');
      const buttons=[...rail?.querySelectorAll('button[aria-pressed]:not([aria-label$="模式"])')??[]];
      const rows=buttons.map(b=>{
        const name=b.querySelector('b');
        const pct=b.querySelector('strong');
        return {id:b.ariaLabel,row:vertical(b.closest('[data-mode-row]')||b),thumb:vertical(b.querySelector('[data-art]')),name:textLine(name),pct:textLine(pct),
          nameWrap:name?getComputedStyle(name).whiteSpace:null,pctWrap:pct?getComputedStyle(pct).whiteSpace:null,
          clipped:name?name.scrollWidth>name.clientWidth+1:false};
      });
      const listStatus=elem('[aria-label="所选设备状态"]');
      const veil=elem('[data-mode-bottom-veil]');
      const veilCSS=veil?getComputedStyle(veil):null;
      const rim=elem('[data-list-selected]');
      const rimBase=rim?getComputedStyle(rim,'::after'):null;
      const rimCSS=rimBase&&rimBase.content!=='none'?rimBase:null;
      const rimMatrix=rimCSS?.transform&&rimCSS.transform!=='none'?new DOMMatrixReadOnly(rimCSS.transform):null;
      const artLayer=elem('[data-list-art-layer]:not([data-exiting])');
      const extras=[...document.querySelectorAll('[data-mode-supplement], [data-mode-extra], [data-list-supplement]')];
      frames.push({t:time,kind:m?.dataset.mode,chosen:selected?.ariaLabel,rail:rect(motionRail),
        stage:descriptor(stage),list:descriptor(list),shared:descriptor(motionArt),running:!!running,
        layers:document.querySelectorAll('[data-mode-hero]').length,clip:rect(elem('[data-list-artwork]')),
        veil:veilCSS?{alpha:textOpacity(veil),gradient:veilCSS.backgroundImage,pointer:veilCSS.pointerEvents}:null,
        rim:rimCSS?{alpha:Number(rimCSS.opacity),x:rimMatrix?.m41??0,sx:rimMatrix?.a??1}:null,
        railMotion:m?.dataset.overviewRailMotion,artFilter:artLayer?getComputedStyle(artLayer).filter:null,
        vertical:{header:vertical(header),modes:vertical(modes),headerBaseline:textLine(allButton),
          scroll:vertical(scroll),scrollTop:scroll?.scrollTop,windowScroll:scrollY,rows},
        supplemental:{status:textOpacity(listStatus),extra:extras.map(el=>({text:el.textContent,alpha:textOpacity(el)}))}});
      raf=requestAnimationFrame(sample);
    };
    raf=requestAnimationFrame(sample);
    window.__modeStop=()=>{cancelAnimationFrame(raf);return frames;};
  });
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
}
const stopTrace=page=>page.evaluate(()=>window.__modeStop());
const last=xs=>xs.at(-1);
async function userSwitch(page,wanted){
  const target=(wanted==='list'?listButton:stageButton)(page);
  await target.click();
}
async function sampleSwitch(page,wanted,subject) {
  await startTrace(page);
  await userSwitch(page,wanted);
  await wait(page,700);
  await isSettled(page,wanted,subject);
  const trace=await stopTrace(page);
  expect(trace.length).toBeGreaterThan(20);
  expect(trace[0].kind).toBe(wanted==='list'?'stage':'list');
  expect(last(trace).kind).toBe(wanted);
  expect(trace.filter(x=>x.chosen!==subject.name)).toHaveLength(0);
  return trace;
}

async function main() {
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/tmp/chromium',
    args:['--allow-file-access-from-files','--no-sandbox']});
  mkdirSync(out,{recursive:true});
  try {
    const page=await open(browser);
    const report=await verifyDesktop(page);
    report.long=await verifyLong(browser);
    if(process.env.STUDIO_REVIEW_SKIP_MEDIA!=='1'){
      await annotatePointer(page);
      report.video=await captureClip(page);
    }
    await page.close();
    report.reduced=await verifyReduced(browser);
    expect(pageErrors).toEqual([]);
    report.renderer=url;
    writeFileSync(join(out,'overview-mode-transition-QA.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
  }finally{await browser.close();}
}

const active=p=>p.locator('[data-overview-morph]');
const transient=p=>p.locator('[data-mode-hero]');
const noTransient=async p=>{
  await expect(active(p)).toHaveCount(0);
  await expect(transient(p)).toHaveCount(0);
};
function summarizeMotion(trace,subject,kind){
  const start=trace[0];
  const end=last(trace);
  const moving=trace.filter(x=>x.running&&x.shared);
  expect(moving.length,'actual render samples with shared art').toBeGreaterThan(10);
  expect(start.running).toBe(false);
  expect(end.running).toBe(false);
  expect(trace.every(f=>f.layers<=1),'only one shared hero, including on retarget').toBe(true);
  for(const frame of trace){
    const visible=[frame.stage,frame.list,frame.shared].filter(x=>x?.visible&&x.loaded);
    expect(visible.length,'no blank frame or replacement duplicate: '+JSON.stringify(frame)).toBe(1);
    expect(visible[0].asset).toMatch(urlAsset(subject));
  }
  for(const frame of moving){
    expect(frame.shared.id).toBe(subject.id);
    expect(frame.shared.box.w).toBeGreaterThan(1);
  }
  const centerX=box=>box.x+box.w/2;
  const heroStart=start.stage??start.list;
  const heroEnd=end.stage??end.list;
  const railLeft=end.rail.x-start.rail.x;
  const railWidth=end.rail.w-start.rail.w;
  const heroDelta=centerX(heroEnd.photo)-centerX(heroStart.photo);
  const firstPhoto=moving[0].shared.photo,lastPhoto=last(moving).shared.photo;
  // Catch the old list fade restarting at the successful handoff: there can
  // be the right element and geometry throughout yet a visible second blink.
  const post=trace.slice(trace.lastIndexOf(last(moving))+1);
  expect(post.length).toBeGreaterThan(5);
  const destAlpha=last(post)[kind].alpha;
  const postHandoffMin=Math.min(...post.map(f=>f[kind].alpha));
  expect(postHandoffMin,'destination art must not dim/replay a fade after the handoff').toBeGreaterThan(destAlpha-.1);
  expect(Math.abs(post[0][kind].alpha-last(moving).shared.alpha),'handoff actual effective opacity').toBeLessThan(.12);
  const photoBounds=moving.map(f=>centerX(f.shared.photo));
  const diff=Math.abs(photoBounds[0]-last(photoBounds));
  expect(diff,'the shared hero physically moves; no stationary crossfade').toBeGreaterThan(160);
  expect((kind==='list'?-1:1)*(last(photoBounds)-photoBounds[0])).toBeGreaterThan(150);
  expect(Math.abs(centerX(heroStart.photo)-centerX(firstPhoto)),'natural join from source geometry').toBeLessThan(150);
  expect(Math.abs(centerX(heroEnd.photo)-centerX(lastPhoto)),'natural join to destination geometry').toBeLessThan(38);
  if(kind==='list'){
    expect(railLeft,'right rail slides toward center').toBeLessThan(-100);
    expect(railWidth,'list expands').toBeGreaterThan(18);
  }else{
    expect(railLeft).toBeGreaterThan(100);
    expect(railWidth).toBeLessThan(-18);
  }
  const overshoot=trace.filter(f=>f.running).map(f=>kind==='list'?f.rail.w-end.rail.w:end.rail.w-f.rail.w);
  const significant=overshoot.map(v=>v>1.5);
  const lobes=significant.filter((v,i)=>v&&!significant[i-1]).length;
  if(kind==='list'){
    // A deliberate +27 desktop target; tight viewports scale the peak to
    // available width. rAF sampling need not hit the exact keyframe.
    expect(Math.max(...overshoot),'Q rebound stronger on the approved wide layout')
      .toBeGreaterThan(end.rail.w>=700 ? 24 : 15);
    expect(Math.max(...overshoot),'restrained elastic widening').toBeLessThan(70);
    expect(lobes,'one bounce; not an oscillation').toBe(1);
  }
  const vertical=summarizeVertical(trace);
  const supplemental=summarizeSupplemental(trace,kind);
  const emphasis=kind==='list'?summarizeVeil(trace):null;
  return {subject:subject.name,destination:kind,sampledFrames:trace.length,movingFrames:moving.length,vertical,supplemental,emphasis,
    rail:{start:start.rail,end:end.rail,xDelta:railLeft,widthDelta:railWidth,widthOvershootPx:Math.max(...overshoot),overshootLobes:lobes},
    hero:{renderedCenterXDelta:heroDelta,sharedPathPx:diff,start:centerX(firstPhoto),end:centerX(lastPhoto),minPostHandoffOpacity:postHandoffMin}};
}


function summarizeVertical(trace,{responsive=false}={}) {
  const src=trace[0];
  const firstById=new Map(src.vertical.rows.map(row=>[row.id,row]));
  const lastById=new Map(last(trace).vertical.rows.map(row=>[row.id,row]));
  const temporaryClip=new Set();
  const drift={railTop:0,headerTop:0,headerHeight:0,headerBaseline:0,modesTop:0,viewportTop:0,viewportHeight:0,rows:0,rowHeights:0,thumbnail:0,name:0,percent:0,nameGlyphWidth:0,percentGlyphWidth:0,scrollTop:0,windowScroll:0};
  const delta=(key,a,b)=>{
    expect(Number.isFinite(a)&&Number.isFinite(b),key+' measurable').toBe(true);
    drift[key]=Math.max(drift[key],Math.abs(a-b));
  };
  expect(firstById.size).toBeGreaterThan(3);
  for(const frame of trace) {
    const a=src.vertical,b=frame.vertical;
    delta('railTop',src.rail.y,frame.rail.y);
    delta('headerTop',a.header.y,b.header.y);
    delta('headerHeight',a.header.h,b.header.h);
    delta('headerBaseline',a.headerBaseline?.bottom,b.headerBaseline?.bottom);
    delta('modesTop',a.modes.y,b.modes.y);
    delta('viewportTop',a.scroll?.y,b.scroll?.y);
    delta('viewportHeight',a.scroll?.h,b.scroll?.h);
    delta('scrollTop',a.scrollTop,b.scrollTop);
    delta('windowScroll',a.windowScroll,b.windowScroll);
    expect(b.rows.length).toBe(firstById.size);
    for(const row of b.rows){
      const before=firstById.get(row.id);
      expect(before,'stable row identity '+row.id).toBeTruthy();
      // Normalise relative to the rail only when narrow layout deliberately stacks the
      // entire rail below the stage (there is no animated intermediate state).
      const origin=responsive?src.rail.y:0;
      const now=responsive?frame.rail.y:0;
      delta('rows',before.row.y-origin,row.row.y-now);
      delta('rowHeights',before.row.h,row.row.h);
      delta('thumbnail',before.thumb?.y-origin,row.thumb?.y-now);
      delta('name',before.name?.bottom-origin,row.name?.bottom-now);
      delta('percent',before.pct?.bottom-origin,row.pct?.bottom-now);
      delta('nameGlyphWidth',before.name?.width,row.name?.width);
      delta('percentGlyphWidth',before.pct?.width,row.pct?.width);
      expect(row.nameWrap,'name has nowrap policy across widths').toBe('nowrap');
      expect(row.pctWrap,'percent has nowrap policy across widths').toBe('nowrap');
      expect(row.name?.lineCount,'name remains single line').toBe(1);
      expect(row.pct?.lineCount,'percentage remains single line').toBe(1);
      if(!before.clipped&&!lastById.get(row.id)?.clipped&&row.clipped)temporaryClip.add(row.id);
    }
  }
  const exceptions=responsive?new Set(['railTop','headerTop','headerBaseline','modesTop','viewportTop','windowScroll']):new Set();
  for(const [key,value] of Object.entries(drift)) {
    if(!exceptions.has(key))expect(value,'maximum vertical drift: '+key).toBeLessThanOrEqual(.75);
  }
  expect([...temporaryClip],'names readable at both endpoints must not briefly truncate during travel').toEqual([]);
  return {rows:firstById.size,scrollOffset:src.vertical.scrollTop,maxDriftPx:drift,temporaryNameClips:temporaryClip.size,frames:trace.length};
}


function summarizeVeil(trace){
  const entering=trace.filter(f=>f.kind==='list'&&f.veil);
  const first=entering[0],settled=last(entering);
  expect(entering.length).toBeGreaterThan(15);
  expect(settled.veil.gradient).toMatch(/gradient/);
  expect(settled.veil.pointer).toBe('none');
  expect(settled.veil.alpha,'veil remains present at settled list').toBeGreaterThan(.2);
  const target=settled.veil.alpha;
  const veilStarts=entering.find(f=>f.veil.alpha>target*.03);
  const veilHalf=entering.find(f=>f.veil.alpha>target*.45);
  const infoStarts=entering.find(f=>f.supplemental.status>.08);
  expect(veilStarts.t-first.t,'veil emerges near beginning of horizontal motion').toBeLessThan(114);
  expect(veilHalf.t-first.t,'veil is apparent well before rail settles').toBeLessThan(270);
  expect(infoStarts.t-veilStarts.t,'floor veil animation is not the later status fade').toBeGreaterThan(230);
  const progress=entering.filter(f=>f.veil.alpha>target*.03&&f.veil.alpha<target*.97);
  expect(progress.length,'at least five rendered intermediate fade states').toBeGreaterThanOrEqual(5);
  const jump=Math.max(...entering.slice(1).map((f,i)=>Math.abs(f.veil.alpha-entering[i].veil.alpha)))/target;
  expect(jump,'no late opacity pop').toBeLessThan(.46);
  const rim=entering.filter(f=>f.rim?.alpha>.08);
  expect(rim.length,'subtle selected-edge response has multiple actual render steps').toBeGreaterThan(3);
  expect(Math.min(...rim.map(f=>f.rim.x)),'selected edge flings sideways').toBeLessThan(-8);
  const dim=Number(settled.artFilter?.match(/brightness\(([\d.]+)\)/)?.[1]);
  expect(dim,'left photo stays deliberately darker than previous .78 brightness').toBeLessThan(.72);
  if(settled.rail.w>=690)expect(settled.rail.x-settled.clip.x-settled.clip.w,'desktop art leaves gap to clear text').toBeGreaterThan(15);
  return {firstVisibleMs:veilStarts.t-first.t,halfMs:veilHalf.t-first.t,infoStartsMs:infoStarts.t-first.t,
    opacitySteps:progress.length,largestStep:jump,rimFrames:rim.length,edgeLeftPx:Math.min(...rim.map(f=>f.rim.x)),
    dimBrightness:dim,steadyVeilOpacity:target};
}

function summarizeSupplemental(trace,kind){
  if(kind==='stage'){
    const reverse=trace.filter(f=>f.kind==='stage');
    expect(reverse.some(f=>f.supplemental.status>.05&&f.supplemental.status<.97),'brief fades away on reverse').toBe(true);
    expect(last(reverse).supplemental.status ?? 0).toBeLessThan(.01);
    expect(Math.max(...last(reverse).supplemental.extra.map(e=>e.alpha))).toBeLessThan(.01);
    return {statusHidden:true,allSupplementalHidden:true};
  }
  const bounds=last(trace).rail;
  const input=trace.filter(f=>f.kind==='list'&&f.supplemental.status!==null);
  expect(input.length).toBeGreaterThan(10);
  const peak=last(input).supplemental.status;
  expect(peak).toBeGreaterThan(.97);
  const initial=input[0].supplemental.status;
  expect(initial,'list-only copy must not snap in while horizontal motion starts').toBeLessThan(.15);
  const lastMoving=input.filter(f=>Math.abs(f.rail.x-bounds.x) + Math.abs(f.rail.w-bounds.w)>2.5);
  expect(lastMoving.length).toBeGreaterThan(8);
  const premature=Math.max(...lastMoving.map(f=>f.supplemental.status));
  expect(premature,'keep list-only copy quiet until horizontal arrival').toBeLessThanOrEqual(.35);
  const extraLast=last(input).supplemental.extra;
  const extraEarlyMax=Math.max(...lastMoving.flatMap(f=>f.supplemental.extra.map(e=>e.alpha)));
  expect(extraLast.some(x=>/20%/.test(x.text)&&x.alpha>.97),'collector-backed setting and read/power metadata appears').toBe(true);
  expect(extraEarlyMax,'connection metadata waits until the width arrives').toBeLessThanOrEqual(.35);
  const gradual=input.some(f=>f.supplemental.status>.08&&f.supplemental.status<.93);
  const gradualExtra=input.some(f=>f.supplemental.extra.some(e=>e.alpha>.08&&e.alpha<.93));
  expect(gradual&&gradualExtra,'show actual opacity interpolation in status and metadata').toBe(true);
  return {initial,peak,maxOpacityBeforeRailSettles:premature,earlyConnectionMax:extraEarlyMax,rowsWithMetadata:extraLast.length};
}

async function interruptible(page,subject) {
  // DOM clicks deliberately use tightly controlled offsets here rather than Playwright's
  // stability wait: later operations must supersede earlier ones before they finish.
  const toggle=async kind=>page.evaluate(which=>{
    const selector=which==='stage'?'展台模式':'列表模式';
    document.querySelector('button[aria-label="'+selector+'"]').click();
  },kind);
  await startTrace(page);
  await toggle('list');
  await expect(active(page)).toHaveCount(1);
  await wait(page,85);
  await toggle('stage');
  await wait(page,75);
  await toggle('list');
  await noTransient(page);
  await isSettled(page,'list',subject);
  const trace=await stopTrace(page);
  expect(trace.every(x=>x.layers<=1&&x.chosen===subject.name)).toBe(true);
  expect(trace.filter(f=>f.shared?.id===subject.id).length).toBeGreaterThan(3);
  const saw=[...new Set(trace.map(f=>f.kind))];
  expect(saw).toContain('list');
  expect(saw).toContain('stage');

  await toggle('stage');
  await expect(active(page)).toHaveCount(1);
  await page.setViewportSize({width:1300,height:870});
  await noTransient(page);
  await isSettled(page,'stage',subject);
  await page.setViewportSize(desktop);
  await wait(page,55);

  await toggle('list');
  await expect(active(page)).toHaveCount(1);
  await btn(nav(page),'设备').click();
  await expect(page.locator('[data-view=devices]')).toBeVisible();
  await noTransient(page);
  await btn(nav(page),'总览').click();
  await noTransient(page);
  await isSettled(page,'list',subject);
  return {rapidFrames:trace.length,rapidFinal:'list',resizeFinal:'stage',routeFinal:'overview/ready'};
}

async function verifyDesktop(page){
  await isSettled(page,'stage',dual);
  const transitions=[];
  transitions.push(summarizeMotion(await sampleSwitch(page,'list',dual),dual,'list'));
  transitions.push(summarizeMotion(await sampleSwitch(page,'stage',dual),dual,'stage'));
  await railButton(page,xbox.name).click();
  await wait(page,460);
  await isSettled(page,'stage',xbox);
  transitions.push(summarizeMotion(await sampleSwitch(page,'list',xbox),xbox,'list'));
  transitions.push(summarizeMotion(await sampleSwitch(page,'stage',xbox),xbox,'stage'));
  const interruptions=await interruptible(page,xbox);
  return {transitions,interruptions};
}

async function verifyLong(browser){
  const page=await open(browser,{viewport:medium,extra:13});
  try{
    const scroller=rail(page).locator('[data-mode-rail-scroll], [data-mode-scroll], [aria-busy]');
    const offset=await scroller.evaluate(el=>{
      const max=el.scrollHeight-el.clientHeight;
      el.scrollTop=Math.round(max*.59);
      return {actual:el.scrollTop,max};
    });
    expect(offset.actual).toBeGreaterThan(100);
    await wait(page,70);
    const forward=summarizeMotion(await sampleSwitch(page,'list',dual),dual,'list');
    const reverse=summarizeMotion(await sampleSwitch(page,'stage',dual),dual,'stage');
    expect(forward.vertical.scrollOffset).toBe(offset.actual);
    expect(reverse.vertical.scrollOffset).toBe(offset.actual);
    return {viewport:medium,offset,forward,reverse};
  }finally{await page.close();}
}

async function verifyReduced(browser){
  const page=await open(browser,{reduced:true,viewport:narrow});
  let samples;
  try {
    await isSettled(page,'stage',dual);
    await startTrace(page);
    await listButton(page).focus();
    await page.keyboard.press('Enter');
    await isSettled(page,'list',dual);
    await expect(listButton(page)).toBeFocused();
    await page.keyboard.press('Tab'); // do not assume button order for reverse activation
    await stageButton(page).focus();
    await page.keyboard.press('Space');
    await isSettled(page,'stage',dual);
    await expect(stageButton(page)).toBeFocused();
    await wait(page,70);
    samples=await stopTrace(page);
    expect(samples.every(x=>!x.running&&!x.layers&&!x.railMotion&&!x.rim)).toBe(true);
    expect(samples.some(x=>x.kind==='list')).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(narrow.width+1);
  } finally { await page.close(); }
  return {viewport:narrow.width,reducedMotion:true,keyboard:['Enter','Space'],frames:samples.length,morphFrames:0,vertical:summarizeVertical(samples,{responsive:true})};
}

async function captureClip(page){
  await isSettled(page,'stage',dual);
  return (await record(page,async mark=>{
    mark('DualSense · 展台往返清单');
    await wait(page,680);
    await userSwitch(page,'list');
    await wait(page,1120);
    await isSettled(page,'list',dual);
    await userSwitch(page,'stage');
    await wait(page,1150);
    await isSettled(page,'stage',dual);
    mark('Xbox · 换一台设备，再走同样转场');
    await railButton(page,xbox.name).click();
    await wait(page,1050);
    await isSettled(page,'stage',xbox);
    await userSwitch(page,'list');
    await wait(page,1270);
    await isSettled(page,'list',xbox);
    await userSwitch(page,'stage');
    await wait(page,970);
    await isSettled(page,'stage',xbox);
    return {};
  })).video;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
