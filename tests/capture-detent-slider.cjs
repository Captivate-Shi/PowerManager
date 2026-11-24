// Actual built Chromium renderer with the preload collector mocked (not Windows DPI).
const { chromium, expect } = require('@playwright/test');
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { installMock } = require('./studio-review-mock.cjs');
const out = resolve(process.env.STUDIO_REVIEW_OUT || 'studio-detent-review');
const url = pathToFileURL(resolve(process.env.STUDIO_REVIEW_DIST || join(__dirname,'../dist/ui/index.html'))).href;
const desktop={width:1586,height:992}, narrow={width:520,height:710};
const shots=[];
const btn=(s,n)=>s.getByRole('button',{name:n,exact:true});
const wait=(p,ms)=>p.waitForTimeout(ms);
const shot=async(p,n)=>{await p.screenshot({path:join(out,n+'.png'),caret:'hide'});shots.push(n+'.png');};
const cmds=(page,kind)=>page.evaluate(k=>window.studioReview.commands.filter(x=>x.type===k),kind);

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
  const tmp=mkdtempSync(join(tmpdir(),'yudian-detent-'));
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
    const media='余电-同款滑杆-操作验收.mp4';
    const result=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',join(tmp,'inputs.txt'),
      '-f','ffmetadata','-i',join(tmp,'chapters.txt'),'-map','0:v:0','-map_metadata','1','-map_chapters','1',
      '-vf','fps=30','-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-movflags','+faststart',join(out,media)],{encoding:'utf8'});
    if(result.error||result.status)throw result.error||Error(result.stderr);
    return {...report,video:{media,frames:series.length,chapters}};
  }finally{
    await c.detach().catch(()=>{}); rmSync(tmp,{recursive:true,force:true});
  }
}

async function enterDevice(page,refreshFirst) {
  const nav=page.getByRole('navigation',{name:'主导航'});
  if(refreshFirst) {
    await btn(page,'立即刷新').click();
    await expect(page.locator('[data-load-state=refreshing]')).toBeVisible();
    await page.evaluate(()=>window.studioReview.finishRefresh());
    await expect(page.getByRole('region',{name:'主设备'}).getByRole('meter',{name:'电量'})).toHaveAttribute('aria-valuetext','20–30%');
  }
  await btn(nav,'设备').click();
  await btn(page.getByRole('table'),'DualSense').dblclick();
  const detail=page.getByRole('region',{name:'设备详情'});
  await expect(detail.getByRole('heading',{name:'DualSense',exact:true})).toBeVisible();
  await expect(page.locator('html[data-detail-direction]')).toHaveCount(0);
  await btn(detail,'调整提醒').click();
  const editor=detail.locator('[data-device-threshold]');
  const slider=editor.getByRole('slider',{name:'设备低电量阈值'});
  await slider.scrollIntoViewIfNeeded();
  await expect(slider).toBeVisible();
  return {detail,editor,slider};
}

const minmax=async s=>[Number(await s.getAttribute('min')),Number(await s.getAttribute('max'))];
const presetButtons=scope=>scope.getByRole('button',{name:/^\d+%$/});
async function verifyDetents(slider, scope, label) {
  const rect=await slider.boundingBox();
  const minmaxValue=await minmax(slider);
  const control=scope.locator('[data-detent-slider]');
  await expect(control).toHaveCount(1);
  const rail=await control.locator(':scope > div > span[aria-hidden=true]').boundingBox();
  // Assert the drawn rail and actual native thumb-center travel share the same ends.
  expect(rail.height,label+' visual rail height').toBe(5);
  expect(Math.abs((rail.x-rect.x)*2-(rect.width-rail.width)),label+' centered native axis').toBeLessThan(.8);
  const nativeThumb=rect.width-rail.width;
  expect(nativeThumb,label+' short capsule width').toBeGreaterThan(25);
  expect(nativeThumb,label+' short capsule width').toBeLessThan(34);
  const nodes=await presetButtons(scope).all();
  const dots=await Promise.all(nodes.map(async el=>{
    const [r, name, shape]=await Promise.all([el.boundingBox(),el.getAttribute('aria-label'),el.evaluate(node=>{
      const dot=getComputedStyle(node,'::after');
      return {width:dot.width,height:dot.height,radius:dot.borderRadius};
    })]);
    const v=Number((name||await el.innerText()).replace('%',''));
    return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,v,shape};
  }));
  expect(dots.length,label+' presets').toBeGreaterThan(3);
  expect(dots.every((d,i)=>i===0||d.v>dots[i-1].v),label+' ordered values').toBe(true);
  const xFor=v=>rail.x+rail.width*(v-minmaxValue[0])/(minmaxValue[1]-minmaxValue[0]);
  for(const d of dots){
    expect(Math.abs(xFor(d.v)-d.x),label+' position of '+d.v).toBeLessThan(1.25);
    const vertical=d.y-(rail.y+rail.height/2);
    expect(vertical,label+' dot below rail').toBeGreaterThan(12);
    expect(vertical,label+' dot below rail').toBeLessThan(23);
    expect(d.shape,label+' visible round 6px detent').toEqual({width:'6px',height:'6px',radius:'50%'});
    expect(d.x,label+' within input').toBeGreaterThanOrEqual(rect.x-1);
    expect(d.x,label+' within input').toBeLessThanOrEqual(rect.x+rect.width+1);
  }
  return {dots,xFor,rect,minmax:minmaxValue};
}

async function threshold(page,context,capture) {
  const {editor,slider}=context;
  const expected=Array.from({length:10},(_,i)=>(i+1)*5);
  const metrics=await verifyDetents(slider,editor,'threshold');
  expect(metrics.dots.map(x=>x.v)).toEqual(expected);
  expect(metrics.minmax).toEqual([1,50]);
  await expect(slider).toHaveAttribute('step','1');
  await expect(slider).toHaveValue('20');
  const target=btn(editor,'35%');
  await target.click();
  await expect(slider).toHaveValue('35');
  await expect(target).toHaveAttribute('aria-pressed','true');
  await expect.poll(async()=>(await cmds(page,'deviceSettings')).map(x=>x.patch.low)).toEqual([35]);
  await expect(editor.getByText('已保存 · 下次巡检生效')).toBeVisible();
  if(capture){await page.mouse.move(desktop.width-13,92);await shot(page,'01-设备阈值-35预设');await wait(page,1250);}
  const {rect,xFor}=await verifyDetents(slider,editor,'threshold after preset');
  const y=rect.y+rect.height/2;
  await page.mouse.move(xFor(35),y);
  await page.mouse.down();
  await page.mouse.move(xFor(43),y,{steps:17});
  const free=Number(await slider.inputValue());
  expect(free,'pointer-to-value agrees with the detent/rail axis').toBe(43);
  expect(free%5,'freely parked between two preset dots').not.toBe(0);
  await expect(editor.getByText('松开后保存')).toBeVisible();
  await wait(page,capture?980:350);
  expect((await cmds(page,'deviceSettings')).map(x=>x.patch.low)).toEqual([35]);
  if(capture)await shot(page,'02-设备阈值-自由拖动未保存');
  await page.mouse.up();
  await expect(editor.getByText('已保存 · 下次巡检生效')).toBeVisible();
  await expect.poll(async()=>(await cmds(page,'deviceSettings')).map(x=>x.patch.low)).toEqual([35,free]);
  await expect(slider).toHaveValue(String(free));
  await expect(editor.locator('[data-detent][aria-pressed=true]')).toHaveCount(0);
  if(capture){await shot(page,'03-设备阈值-松手保存');await wait(page,1270);}
  if(!capture){
    await slider.focus(); await slider.press('ArrowLeft');
    await expect.poll(async()=>(await cmds(page,'deviceSettings')).map(x=>x.patch.low)).toEqual([35,free,free-1]);
    await expect(slider).toHaveValue(String(free-1));
    await shot(page,'06-窄窗口-设备阈值键盘');
  }
  return { presets:expected, freeValue:free, minmax:metrics.minmax, writesWhilePressed:0 };
}

async function zoom(page,capture) {
  const nav=page.getByRole('navigation',{name:'主导航'});
  await btn(nav,'设置').click();
  const settings=page.locator('[data-page=settings]');
  const slider=settings.getByRole('slider',{name:'主界面缩放滑块'});
  const form=slider.locator('xpath=ancestor::form');
  const number=form.getByRole('spinbutton',{name:'主界面缩放百分比'});
  await expect(number).toHaveValue('100');
  const detents=await verifyDetents(slider,form,'main zoom');
  expect(detents.minmax).toEqual([75,150]);
  const value=detents.dots.find(d=>d.v===125)?.v??detents.dots.find(d=>d.v>100).v;
  await btn(form,value+'%').click();
  await expect(number).toHaveValue(String(value));
  await expect(slider).toHaveValue(String(value));
  expect((await cmds(page,'settings')).filter(c=>c.patch.zoom!==undefined)).toEqual([]);
  if(capture){await shot(page,'04-设置-缩放预设待应用');await wait(page,1200);}
  const applied=capture?value:value+1;
  if(!capture){
    await slider.focus(); await slider.press('ArrowRight');
    await expect(number).toHaveValue(String(applied));
    expect((await cmds(page,'settings')).filter(c=>c.patch.zoom!==undefined)).toEqual([]);
    await shot(page,'07-窄窗口-缩放键盘草稿');
  }
  await btn(form,'应用').click();
  await expect.poll(async ()=>(await cmds(page,'settings')).filter(c=>c.patch.zoom!==undefined)).toEqual([{type:'settings',patch:{zoom:applied}}]);
  await expect(btn(form,'应用')).toBeDisabled();
  const tray=settings.getByRole('slider',{name:'托盘浮窗缩放滑块'});
  await expect(tray).toHaveValue('100');
  const trayDetents=await verifyDetents(tray,tray.locator('xpath=ancestor::form'),'tray zoom');
  expect(trayDetents.dots.map(d=>d.v)).toEqual(detents.dots.map(d=>d.v));
  if(capture){await shot(page,'05-设置-缩放应用完成');await wait(page,1330);}
  const border=await tray.boundingBox(), w=page.viewportSize().width;
  expect(border.x).toBeGreaterThanOrEqual(0);
  expect(border.x+border.width).toBeLessThanOrEqual(w+1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  return { presets:detents.dots.map(d=>d.v), applied, writesBeforeApply:0, trayNotChanged:true };
}

async function main() {
  mkdirSync(out,{recursive:true});
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--allow-file-access-from-files']});
  const errors=[];
  const setup=async(viewport,reducedMotion)=>{
    const p=await browser.newPage({viewport,reducedMotion,locale:'zh-CN',timezoneId:'Asia/Shanghai'});
    p.on('pageerror',err=>errors.push(err.message));
    await p.addInitScript(installMock);
    await p.goto(url);
    await p.evaluate(()=>window.studioReview.ready());
    await p.evaluate(()=>document.fonts.ready);
    return p;
  };
  try{
    const p=await setup(desktop,'no-preference');
    const detail=await enterDevice(p,true);
    const wantVideo=process.env.STUDIO_DETENT_NO_VIDEO!=='1';
    if(wantVideo)await annotatePointer(p);
    const run=async mark=>{
      mark('设备阈值：圆点快选，自由拖动，松手才保存');
      const device=await threshold(p,detail,wantVideo);
      mark('设置缩放：圆点只改草稿，点应用才提交');
      return {device,zoom:await zoom(p,wantVideo)};
    };
    const wide=wantVideo?await record(p,run):await run(()=>{});
    await p.close();
    const q=await setup(narrow,'reduce');
    const d=await enterDevice(q,false);
    const narrowProof={device:await threshold(q,d,false),zoom:await zoom(q,false)};
    await q.close();
    expect(errors).toEqual([]);
    const proof={scope:'actual renderer at mock preload boundary; hardware and native Windows zoom not verified',wide,narrowProof,desktop,narrow,shots};
    writeFileSync(join(out,'detent-QA.json'),JSON.stringify(proof,null,2));
    console.log(JSON.stringify(proof,null,2));
  }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
