// Run with THEME_REVIEW_OUT unset and HISTORY_CURSOR_OUT to record Chromium.
// Everything below the window.powerManager boundary is the actual app renderer.
const { chromium, expect } = require('@playwright/test');
const { installMock } = require('./studio-review-mock.cjs');
const { pathToFileURL } = require('node:url');
const { mkdirSync, mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { execFileSync } = require('node:child_process');
const out=process.env.HISTORY_CURSOR_OUT;
const entry=pathToFileURL(resolve('dist/ui/index.html')).href;
const button=(scope,name)=>scope.getByRole('button',{name,exact:true});
const delay=(page,ms)=>out?page.waitForTimeout(ms):Promise.resolve();
const ready=region=>expect(region.locator('[aria-busy]')).toHaveAttribute('aria-busy','false');

async function record(page,fn) {
  if (!out) return fn();
  mkdirSync(out,{recursive:true});
  const client=await page.context().newCDPSession(page), dir=mkdtempSync(join(tmpdir(),'history-cursor-'));
  const frames=[];
  client.on('Page.screencastFrame',({data,metadata,sessionId})=>{
    const name='frame-'+String(frames.length).padStart(5,'0')+'.jpg';
    writeFileSync(join(dir,name),data,'base64');frames.push({name,t:metadata.timestamp??Date.now()/1000});
    void client.send('Page.screencastFrameAck',{sessionId}).catch(()=>{});
  });
  try {
    await client.send('Page.startScreencast',{format:'jpeg',quality:92,maxWidth:1440,maxHeight:900,everyNthFrame:1});
    await fn();await page.waitForTimeout(700);await client.send('Page.stopScreencast');
    expect(frames.length).toBeGreaterThan(45);
    const lines=frames.map(({name,t},i)=>`file '${name}'\noption framerate 1000\nduration ${(frames[i+1]?Math.max(.001,frames[i+1].t-t):.85).toFixed(3)}`);
    writeFileSync(join(dir,'list.txt'),lines.join('\n')+`\nfile '${frames.at(-1).name}'\noption framerate 1000\n`);
    execFileSync('ffmpeg',['-v','error','-y','-f','concat','-safe','0','-i',join(dir,'list.txt'),'-vf','fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2','-c:v','libx264','-crf','17','-threads','2','-pix_fmt','yuv420p','-movflags','+faststart',join(out,'余电-记录页-真实渲染Mock.mp4')]);
  } finally { await client.detach().catch(()=>{});rmSync(dir,{recursive:true,force:true}); }
}

(async()=>{
  const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--allow-file-access-from-files']});
  const p=await b.newPage({viewport:{width:1440,height:900},locale:'zh-CN',timezoneId:'Asia/Shanghai',reducedMotion:'reduce'});
  const errors=[];p.on('pageerror',e=>errors.push(e.message));
  try {
    await p.clock.setFixedTime(new Date('2026-11-25T20:00:00+08:00'));
    await p.addInitScript(installMock,{portable:true});
    await p.goto(entry);
    await p.evaluate(async()=>{
      await document.fonts.ready;studioReview.ready();
      const api=window.powerManager, original=api.command, end=Date.now(), start=end-1440*60000;
      const mouse=[[0,93],[170,86],[375,82],[570,76],[879,69],[975,67],[1090,61],[1180,87],[1242,92],[1440,91]];
      const ears=[[0,77],[195,69],[405,64],[660,57],[990,49],[1106,45],[1190,56],[1320,67],[1440,65]];
      const dual=[[0,54],[170,52],[370,47],[645,42],[830,38],[1055,34],[1120,29],[1140,27],[1270,25],[1440,21]];
      const pick=(arr,i)=>{
        const right=arr.findIndex(([t])=>t>=i);if(right<=0)return arr[0][1];
        const [[a,v],[bb,w]]=arr.slice(right-1,right+1),u=(i-a)/(bb-a);
        return Math.round(v+(w-v)*u);
      };
      const fixtures=Object.fromEntries([['mouse',mouse],['dual',dual],['headset',ears]].map(([id,arr])=>[
        id, Array.from({length:1441},(_,i)=>{
          if(id==='mouse'&&i>879&&i<975||id==='dual'&&i>1055&&i<1120)return null;
          const low=pick(arr,i),high=id==='dual'?low+ (i>1200?11:12):low;
          const charge=id==='mouse'&&i>=1090&&i<1242||id==='headset'&&i>=1106&&i<1320;
          return {time:start+i*60000,reading:{low,high,raw:low,power:charge?'charging':'discharging',source:'hid'}};
        }).filter(Boolean)
      ]));
      api.command=c=>c.type==='history'&&(c.range??'day')==='day'&&fixtures[c.id] ?
        Promise.resolve({ok:true,history:fixtures[c.id]}) : original(c);
    });
    if(out)await p.evaluate(()=>{
      const cursor=document.createElement('i');cursor.setAttribute('aria-hidden','true');
      Object.assign(cursor.style,{position:'fixed',width:'12px',height:'12px',border:'1px solid #eaf3ff',background:'#cfddf351',borderRadius:'50%',zIndex:'2147483647',pointerEvents:'none',transform:'translate(-50%,-50%)',opacity:'0'});
      document.body.append(cursor);window.addEventListener('pointermove',e=>{cursor.style.left=e.clientX+'px';cursor.style.top=e.clientY+'px';cursor.style.opacity='1';},{passive:true});
    });
    const region=p.getByRole('region',{name:'电量对比记录'});
    const graph=region.getByLabel(/近 24 小时电量曲线/);
    const plot=graph.locator('[data-history-plot]');
    const lane=graph.locator('[data-event-lanes]');
    const tip=graph.getByRole('tooltip');
    const selectThird=async()=>{
      await button(region,'对比设备').click();
      await p.getByRole('menuitemcheckbox',{name:'头戴耳机',exact:true}).click();
      await ready(region);
    };
    const aligned=async()=>{
      await expect(graph.locator('[data-plot-cursor]')).toBeVisible();
      await expect(graph.locator('[data-lane-cursor]')).toBeVisible();
      const a=await graph.locator('[data-plot-cursor]').boundingBox(), bb=await graph.locator('[data-lane-cursor]').boundingBox();
      expect(Math.abs(a.x-bb.x)).toBeLessThan(1);
      return a.x;
    };
    const move=async(x,y,steps=1)=>{
      if(!out)return p.mouse.move(x,y);
      const current=await p.evaluate(()=>[parseFloat(document.body.lastElementChild?.style.left)||0,parseFloat(document.body.lastElementChild?.style.top)||0]);
      if(!current[0]||steps===1)return p.mouse.move(x,y);
      for(let i=1;i<=steps;i++){const k=i/steps;await p.mouse.move(current[0]+(x-current[0])*k,current[1]+(y-current[1])*k);await p.waitForTimeout(22);}
    };
    const shot=async name=>{if(out)await p.screenshot({path:join(out,name+'.png')});};
    await button(p.getByRole('navigation',{name:'主导航'}),'记录').click();
    await ready(region);await selectThird();
    await expect(graph.locator('[data-event-series]')).toHaveCount(3);
    const mouseCharge=lane.locator('[data-event-series="0"] [data-event="charging"]');
    const dualGap=lane.locator('[data-event-series="1"] [data-event="unrecorded"]');
    const earCharge=lane.locator('[data-event-series="2"] [data-event="charging"]');
    const geometry=async()=>{
      const a=await plot.boundingBox();
      const inset=await graph.evaluate(el=>['--plot-left','--plot-right'].map(k=>parseFloat(el.style.getPropertyValue(k))));
      return {x:f=>a.x+inset[0]+(a.width-inset[0]-inset[1])*f,y:a.y+a.height*.48};
    };
    await record(p,async()=>{
      const g=await geometry();await delay(p,1100);
      await move(g.x(.26),g.y);const first=await aligned();await expect(tip.getByText('无线鼠标')).toBeVisible();
      await delay(p,700);await move(g.x(925/1440),g.y,34);expect(await aligned()).toBeGreaterThan(first+200);
      await expect(tip.getByText('无数据',{exact:true})).toBeVisible();await delay(p,1550);await shot('01-缺口和三轨游标');
      await move(g.x(1140.5/1440),g.y,26);await aligned();await expect(tip.getByText('27–39%',{exact:true})).toBeVisible();
      await delay(p,1500);await shot('02-区间读数');
      for (const [target,label,name] of [[mouseCharge,'检测到充电','无线鼠标'],[dualGap,'无数据','DualSense'],[earCharge,'检测到充电','头戴耳机']]){
        const r=await target.boundingBox();await move(r.x+r.width/2,r.y+r.height/2,25);
        await expect(tip.getByText(label,{exact:true})).toBeVisible();await expect(tip.getByText(name,{exact:true})).toBeVisible();
        await aligned();await delay(p,1450);
      }
      await shot('03-耳机充电提示');
      await button(region,'原始采样').click();await expect(graph.locator('[data-range-mid]:not([d=""])')).toHaveCount(0);
      await expect(graph.locator('[data-trace="range"]:not([d=""])')).toHaveCount(1);
      await delay(p,1350);await shot('04-区间柱');
      await button(region,'趋势').click();
      await expect(graph.locator('[data-range-mid]:not([d=""])')).toHaveCount(1);await delay(p,950);
    });
    await mouseCharge.focus();await aligned();await expect(tip.getByText('检测到充电',{exact:true})).toBeVisible();
    await p.keyboard.press('Escape');await expect(graph.locator('[data-plot-cursor]')).toHaveCount(0);
    await graph.focus();await graph.press('End');await aligned();await expect(tip.getByText('21–32%',{exact:true})).toBeVisible();
    await p.setViewportSize({width:520,height:540});
    await expect(lane).toBeVisible();
    await aligned();
    expect(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    console.log('Three lanes; synced plot and lane cursors within 1px; honest ranges/gaps; keyboard; raw view; narrow viewport.');
  } finally {await b.close();}
})().catch(err=>{console.error(err);process.exitCode=1});
