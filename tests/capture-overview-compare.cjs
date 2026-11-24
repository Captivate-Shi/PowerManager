// Actual built renderer: overview stage/list selection + controlled compare load.
// Run after build:web with CHROMIUM_PATH. No native hardware or OS behavior is simulated here.
const { chromium, expect } = require('@playwright/test');
const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { installMock } = require('./studio-review-mock.cjs');
const out = resolve(process.env.STUDIO_REVIEW_OUT || 'studio-overview-compare-review');
const dist = pathToFileURL(resolve(process.env.STUDIO_REVIEW_DIST || join(__dirname, '../dist/ui/index.html'))).href;
const desktop = { width:1586, height:850 };
const narrow = { width:520, height:620 };
const media = [];
const button = (scope,name) => scope.getByRole('button',{name,exact:true});
const show = (page, selector) => page.locator(selector);

function gateHistory() {
  const orig = window.powerManager.command;
  const requests = [];
  window.powerManager.command = async c => {
    if (c.type !== 'history' || c.id === 'xbox') return orig(c);
    const res = orig(c);
    return new Promise(resolve => requests.push({ id:c.id, res, resolve, released:false }));
  };
  window.compareQA = {
    pending: id => requests.filter(item => item.id === id && !item.released).length,
    release: id => {
      const item = requests.find(r => r.id === id && !r.released);
      if (!item) throw Error('No pending compare fixture: '+id);
      item.released=true;
      void item.res.then(item.resolve);
    },
  };
}

async function pointerGuide(page) {
  await page.evaluate(() => {
    const dot=document.createElement('span');
    dot.setAttribute('aria-hidden','true');
    Object.assign(dot.style,{position:'fixed',pointerEvents:'none',zIndex:'2147483647',width:'13px',height:'13px',
      opacity:'0',left:'0',top:'0',border:'1px solid #e6edf6',background:'#94afdf40',borderRadius:'50%'});
    document.body.append(dot);
    window.addEventListener('pointermove',e=>{
      dot.style.transform=`translate(${e.clientX-7}px,${e.clientY-7}px)`;
      dot.style.opacity='1';
    },{passive:true});
    window.addEventListener('pointerdown',()=>dot.animate([{boxShadow:'0 0 0 5px #ffdf9180'},{boxShadow:'0 0 0 11px #ffdf9100'}],{duration:350}),{passive:true});
  });
}
async function shot(page,name) {
  await page.screenshot({path:join(out,name+'.png'),caret:'hide'});
  media.push(name+'.png');
}

async function record(page, race) {
  const tmp = mkdtempSync(join(tmpdir(),'yudian-compare-'));
  const c = await page.context().newCDPSession(page);
  const frames = [];
  c.on('Page.screencastFrame', ({data,metadata,sessionId}) => {
    const file = 'frame-'+String(frames.length).padStart(5,'0')+'.jpg';
    writeFileSync(join(tmp,file),data,'base64');
    frames.push({file,t:metadata.timestamp ?? Date.now()/1000});
    void c.send('Page.screencastFrameAck',{sessionId}).catch(()=>{});
  });
  try {
    await c.send('Page.startScreencast',{format:'jpeg',quality:90,maxWidth:desktop.width,maxHeight:desktop.height,everyNthFrame:1});
    const marks=[];
    await race(name=>marks.push({ name,seconds: marks.length ? Math.max(0,Date.now()/1000-frames[0].t) : 0 }));
    await c.send('Page.stopScreencast'); 
    expect(frames.length).toBeGreaterThan(20);
    const concat=frames.map(({file,t},i)=>`file '${file}'\noption framerate 1000\nduration ${i+1<frames.length ? Math.max(.001,frames[i+1].t-t).toFixed(3):'1.100'}`).join('\n')+`\nfile '${frames.at(-1).file}'\noption framerate 1000\n`;
    writeFileSync(join(tmp,'input.txt'),concat);
    const ch=';FFMETADATA1\n'+marks.map((m,i)=>`[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(1000*m.seconds)}\nEND=${Math.round(1000*(marks[i+1]?.seconds??frames.at(-1).t-frames[0].t+1.1))}\ntitle=${m.name}`).join('\n');
    writeFileSync(join(tmp,'chapters.txt'),ch);
    const name='余电-展台列表与对比加载-两段验收.mp4';
    const res=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',join(tmp,'input.txt'),
      '-f','ffmetadata','-i',join(tmp,'chapters.txt'),'-map','0:v:0','-map_metadata','1','-map_chapters','1',
      '-vf','fps=30','-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-movflags','+faststart',join(out,name)],{encoding:'utf8'});
    if(res.error||res.status) throw res.error||Error(res.stderr);
    media.push(name);
    return { path:name, frames:frames.length, chapters:marks };
  } finally {
    await c.detach().catch(()=>{});
    rmSync(tmp,{recursive:true,force:true});
  }
}

async function frame(page) {
  await page.evaluate(() => new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok))));
}
function currentCompareCoords() {
    const target = document.querySelector('section[aria-label="电量对比记录"]');
    const match=(q)=>target?.querySelector(q);
    const box=n=>{ if(!n)return null; const b=n.getBoundingClientRect();return [b.x,b.y,b.width,b.height]; };
    const footer=document.querySelector('main > footer');
    const picker=match('[aria-label="选择对比设备"]');
    const summary=match('table[aria-label="近 24 小时记录摘要"]');
    return {
      plot:box(match('[data-large][aria-busy]')),
      title:box(document.querySelector('main h1')),
      picker:box(picker), guide:box(match('[aria-label="图例"]')), summary:box(summary),
      footer:box(footer), rowCount:summary?.tBodies[0].rows.length ?? 0,
      width:document.documentElement.clientWidth, height:document.documentElement.scrollHeight
    };
}
const coords = page => page.evaluate(currentCompareCoords);
async function watchCompareGeometry(page) {
  await page.evaluate(`(() => {
    const current=${currentCompareCoords.toString()};
    window.__compareFrames=[];
    function sample() {
      const p=current();
      if (p.plot && p.summary && p.guide) window.__compareFrames.push(p);
      window.__compareRaf=requestAnimationFrame(sample);
    }
    window.__compareRaf=requestAnimationFrame(sample);
  })()`);
}
async function stopCompareGeometry(page) {
  return page.evaluate(() => { cancelAnimationFrame(window.__compareRaf); return window.__compareFrames; });
}

function stable(a,b,context) {
  for(const key of ['plot','title','picker','guide','summary','footer']) {
    expect(a[key], context+' initial '+key).not.toBeNull();
    expect(b[key], context+' final '+key).not.toBeNull();
    expect(Math.max(...a[key].map((n,i)=>Math.abs(n-b[key][i]))),context+' geometry '+key).toBeLessThan(1.25);
  }
  expect(b.width,context+' content width').toBe(a.width);
  expect(b.height,context+' scroll height').toBe(a.height);
  expect(b.rowCount,context+' fixed summary rows').toBe(a.rowCount);
}

async function clickModes(page,capture) {
  const rail=page.getByRole('region',{name:'切换设备'});
  const hero=page.getByRole('region',{name:'主设备'});
  const overview=show(page,'[data-view=overview]');
  const stage=button(rail,'展台模式'); const list=button(rail,'列表模式'); const xbox=button(rail,'Xbox 无线手柄');
  const mode=value=>show(page,`[data-mode=${value}]`);
  const detail=page.getByRole('region',{name:'设备详情'});
  await expect(stage).toHaveAttribute('aria-pressed','true');
  await expect(hero.getByRole('heading',{name:'DualSense'})).toBeVisible();
  if(capture){ await shot(page,'01-展台-DualSense'); await page.waitForTimeout(800); }
  await list.click();
  await expect(mode('list')).toBeVisible();
  await expect(list).toHaveAttribute('aria-pressed','true');
  await expect(hero).toHaveCount(0);
  await expect(rail.getByRole('button',{name:'DualSense',exact:true})).toHaveAttribute('aria-pressed','true');
  if(capture){ await shot(page,'02-首页-紧凑列表'); await page.waitForTimeout(1000); }
  await xbox.click();
  await expect(xbox).toHaveAttribute('aria-pressed','true');
  await expect(detail).toHaveCount(0);
  const xboxDetails=button(rail,'查看详情 · Xbox 无线手柄');
  await xboxDetails.click();
  await expect(detail.getByRole('heading',{name:'Xbox 无线手柄',exact:true})).toBeVisible();
  await expect(show(page,'html[data-detail-direction]')).toHaveCount(0);
  if(capture){ await shot(page,'03-列表打开Xbox详情'); await page.waitForTimeout(700); }
  await button(page,'返回总览').click();
  await expect(overview).toBeVisible();
  await expect(mode('list')).toBeVisible();
  await expect(xbox).toHaveAttribute('aria-pressed','true');
  await expect(xboxDetails).toBeFocused();
  if(capture){await shot(page,'04-返回列表保留Xbox'); await page.waitForTimeout(800);}
  await stage.click();
  await expect(mode('stage')).toBeVisible();
  await expect(hero.getByRole('heading',{name:'Xbox 无线手柄'})).toBeVisible();
  await expect(hero.getByRole('meter',{name:'电量'})).toHaveAttribute('aria-valuetext','46%');
  await expect(xbox).toHaveAttribute('aria-pressed','true');
  if(capture){await shot(page,'05-回展台保持Xbox'); await page.waitForTimeout(1250);}
  const box=await xbox.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x+box.width).toBeLessThanOrEqual(page.viewportSize().width+1);
  if(!capture && page.viewportSize().width < 600){
    await list.click();
    await expect(mode('list')).toBeVisible();
    await shot(page,'09-窄窗口-列表');
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
    expect(overflow).toBe(false);
  }
}

async function compare(page,capture) {
  const history=page.getByRole('region',{name:'电量对比记录'});
  const picker=history.getByRole('group',{name:'选择对比设备'});
  const graph=history.getByLabel(/近 24 小时电量曲线/);
  const busy=history.locator('[data-large][aria-busy]');
  const skeleton=history.getByRole('status',{name:'正在加载电量历史'});
  const updating=history.getByText('正在更新，暂显示已有记录',{exact:true});
  const pending=id=>expect.poll(()=>page.evaluate(x=>window.compareQA.pending(x),id)).toBe(1);
  const release=id=>page.evaluate(x=>window.compareQA.release(x),id);
  const nav=page.getByRole('navigation',{name:'主导航'});
  await watchCompareGeometry(page);
  await button(nav,'记录').click();
  await expect(skeleton).toBeVisible();
  await expect(skeleton.getByText('正在加载电量记录',{exact:true})).toBeVisible();
  const spinner=skeleton.locator('span > svg');
  const motion=await spinner.evaluate(el=>getComputedStyle(el).animationName);
  const prefersReduced=await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);
  if(prefersReduced)expect(motion).toBe('none'); else expect(motion).toContain('chart-progress-turn');
  await expect(button(nav,'设置')).toBeEnabled();
  await pending('mouse'); await pending('dual');
  await expect(busy).toHaveAttribute('aria-busy','true');
  await frame(page);
  const initial=await coords(page);
  expect(initial.rowCount).toBe(2);
  await expect(history.locator('tr[data-summary-device][data-pending=true]')).toHaveCount(2);
  if(capture){await shot(page,'06-对比-首次慢速加载'); await page.waitForTimeout(1850);}
  else if(process.env.STUDIO_REVIEW_NARROW_CAPTURE==='1')await shot(page,'10-窄窗口-加载');
  await release('dual'); // deliberately finish second request first
  await expect(graph.locator('path[data-trace=range]:not([d=""])')).toHaveCount(1);
  await expect(graph.locator('path[data-trace=exact]:not([d=""])')).toHaveCount(0);
  await expect(updating).toBeVisible();
  await expect(busy).toHaveAttribute('aria-busy','true');
  await frame(page);
  const partial=await coords(page);
  await expect(history.locator('tr[data-pending=true]')).toHaveCount(1);
  stable(initial,partial,'partial');
  if(capture){await shot(page,'07-对比-一台先返回'); await page.waitForTimeout(1400);}
  await release('mouse');
  await expect(graph.locator('path[data-trace=exact]:not([d=""])')).toHaveCount(1);
  await expect(graph.locator('path[data-trace=range]:not([d=""])')).toHaveCount(1);
  await expect(updating).toHaveCount(0);
  await expect(busy).toHaveAttribute('aria-busy','false');
  await frame(page);
  const settled=await coords(page);
  await expect(history.locator('tr[data-pending=true]')).toHaveCount(0);
  stable(initial,settled,'settled');
  const sampled=await stopCompareGeometry(page);
  expect(sampled.length).toBeGreaterThan(2);
  for(const [i,p] of sampled.entries())stable(initial,p,'render frame '+i);
  if(capture){await shot(page,'08-对比-数据显示完成'); await page.waitForTimeout(1750);}
  else {
    await button(picker,'设备').click();
    await page.getByRole('menuitemcheckbox',{name:'机械键盘',exact:true}).click();
    await pending('keyboard');
    await expect(updating).toBeVisible();
    await expect(graph.locator('path[data-trace=exact]:not([d=""])')).toHaveCount(1);
    await button(picker,'移除对比：机械键盘').click();
    await release('keyboard');
    await expect(graph.locator('path[data-trace=exact]:not([d=""])')).toHaveCount(1);
    await expect(graph.locator('g[data-series="2"]')).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
    if(process.env.STUDIO_REVIEW_NARROW_CAPTURE==='1')await shot(page,'11-窄窗口-数据显示完成');
  }
  return {initial,partial,settled,stableRenderFrames:sampled.length,reducedMotion:prefersReduced};
}

async function main() {
  mkdirSync(out,{recursive:true});
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,ignoreDefaultArgs:['--hide-scrollbars'],
    args:['--allow-file-access-from-files','--no-sandbox','--disable-features=OverlayScrollbar']});
  const errors=[];
  const pageFor=async (viewport,reducedMotion)=>{
    const p=await browser.newPage({viewport,reducedMotion,locale:'zh-CN',timezoneId:'Asia/Shanghai'});
    p.on('pageerror',err=>errors.push(err.message));
    await p.addInitScript(`(${installMock.toString()})({historyDelay:20});(${gateHistory.toString()})();`);
    await p.goto(dist);
    await p.evaluate(()=>window.studioReview.ready());
    await p.evaluate(()=>document.fonts.ready);
    return p;
  };
  try{
    const p=await pageFor(desktop,'no-preference');
    let desktopCoords;
    const captureReady=process.env.STUDIO_COMPARE_NO_VIDEO!=='1';
    if(captureReady)await pointerGuide(p);
    const run=async mark=>{
      mark('首页：展台与紧凑列表，保持所选设备');
      await clickModes(p,captureReady);
      mark('记录：慢速对比，依次返回并保持布局');
      desktopCoords=await compare(p,captureReady);
    };
    const video=captureReady?await record(p,run):await run(()=>{});
    await p.close();
    const q=await pageFor(narrow,'reduce');
    await clickModes(q,false);
    const narrowCoords=await compare(q,false);
    await q.close();
    expect(errors).toEqual([]);
    const report={renderer:'Chromium built renderer, mock preload only',desktop,narrow,video,desktopCoords,narrowCoords,media};
    writeFileSync(join(out,'overview-compare-QA.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
  }finally{await browser.close();}
}
main().catch(err=>{console.error(err);process.exitCode=1;});
