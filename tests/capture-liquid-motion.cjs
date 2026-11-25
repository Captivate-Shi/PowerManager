// Record the built renderer, with only the device bridge replaced by the Mock.
const { chromium, expect } = require('@playwright/test');
const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { pathToFileURL } = require('node:url');
const out = resolve(process.env.LIQUID_REVIEW_OUT || 'review-captures');
const frames = join(out, 'frames');
mkdirSync(frames,{recursive:true});
const button = (scope,name) => scope.getByRole('button',{name,exact:true});
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--allow-file-access-from-files','--no-sandbox']});
  try {
    const w=1440,h=900;
    const p=await browser.newPage({viewport:{width:w,height:h},locale:'zh-CN'});
    await p.addInitScript(require('./studio-review-mock.cjs').installMock,{portable:true,historyDelay:530});
    const errors=[];p.on('pageerror',err=>errors.push(err.message));
    await p.goto(pathToFileURL(resolve('dist/ui/index.html')).href);
    await p.evaluate(async()=>{
      await document.fonts.ready; studioReview.ready();
      const cursor=document.createElement('div');
      Object.assign(cursor.style,{position:'fixed',left:'0',top:'0',zIndex:'99999',pointerEvents:'none',width:'18px',height:'21px'});
      cursor.innerHTML='<svg width="18" height="21" viewBox="0 0 18 21"><path d="M2 1.5v15l4-3.5 3.2 6 2.8-1.5-3-5.7h6z" fill="white" stroke="#10131b" stroke-width="1.5" stroke-linejoin="round"/></svg>';
      document.body.append(cursor);
      window.addEventListener('pointermove',e=>{cursor.style.transform='translate('+ (e.clientX-2)+'px,'+(e.clientY-1)+'px)';},{passive:true});
    });
    const nav=p.getByRole('navigation',{name:'主导航'});
    const rail=p.getByRole('region',{name:'切换设备'});
    const pause=ms=>p.waitForTimeout(ms);
    const aim=async el=>{await el.scrollIntoViewIfNeeded(); const r=await el.boundingBox(); if(!r)throw Error('Unreachable control'); await p.mouse.move(r.x+r.width/2,r.y+r.height/2,{steps:10});};
    const act=async el=>{await aim(el);await pause(130);await p.mouse.down();await pause(65);await p.mouse.up();};
    await expect(rail.locator('[data-liquid-selection="row"]')).toHaveAttribute('data-refracting','true');
    await pause(900);
    await p.mouse.move(w/2,70);
    const cdp=await p.context().newCDPSession(p);
    const records=[];
    cdp.on('Page.screencastFrame',({data,metadata,sessionId})=>{
      const frame='f'+String(records.length).padStart(5,'0')+'.jpg';
      writeFileSync(join(frames,frame),data,'base64');
      records.push({frame,t:metadata.timestamp});
      void cdp.send('Page.screencastFrameAck',{sessionId}).catch(()=>{});
    });
    await cdp.send('Page.startScreencast',{format:'jpeg',quality:93,maxWidth:w,maxHeight:h,everyNthFrame:1});
    const cues=[];
    const cue=name=>cues.push({name,t:Date.now()/1000});
    cue('顶部标签');
    await pause(650);
    for(const name of ['设备','提醒','记录','设置','总览']){await act(button(nav,name));await pause(690);}
    // Real clicks during an active animation (do not wait for the transition to finish).
    await aim(button(nav,'提醒'));await p.mouse.down();await p.mouse.up();await pause(85);
    const home=await button(nav,'总览').boundingBox();
    await p.mouse.click(home.x+home.width/2,home.y+home.height/2);await pause(850);
    cue('总览展台');
    for(const name of ['机械键盘','Xbox 无线手柄','DualSense']){
      const item=button(rail,name);
      await act(item);await expect(item).toHaveAttribute('aria-pressed','true');await pause(830);
    }
    cue('总览列表');
    await act(button(rail,'列表模式'));await pause(810);
    for(const name of ['头戴耳机','无线鼠标','DualSense']){
      const item=button(rail,name);
      await act(item);await expect(item).toHaveAttribute('aria-pressed','true');await pause(650);
    }
    cue('设备详情');
    await button(rail,'DualSense').dblclick();
    await expect(button(p,'返回总览')).toBeVisible();
    await pause(720);
    await act(button(p,'调整提醒'));
    const threshold=p.getByRole('region',{name:'设备低电量阈值'});
    await expect(threshold.getByRole('slider')).toBeVisible();
    await pause(600);
    await act(button(threshold,'5%'));
    await expect(threshold.getByRole('slider')).toHaveValue('5');
    await pause(620);
    await act(button(threshold,'恢复全局阈值'));
    await pause(530);
    await p.keyboard.press('Escape');
    await expect(rail).toBeVisible();
    await pause(530);
    cue('设备表格');
    await act(button(nav,'设备'));await pause(650);
    const table=p.getByRole('table');
    for(const name of ['机械键盘','无线鼠标','DualSense']){
      const item=button(table,name);
      await act(item);await expect(item).toHaveAttribute('aria-pressed','true');await pause(680);
    }
    cue('提醒');
    await act(button(nav,'提醒'));await pause(530);
    const queue=p.getByRole('region',{name:'待充电'});
    await expect(queue.locator('[data-liquid-selection]')).toHaveCount(0);
    await act(button(p.getByRole('group',{name:'通知预览级别'}),'电量告急'));
    await pause(850);
    cue('记录');
    await act(button(nav,'记录'));
    const picker=p.getByRole('group',{name:'选择对比设备'});
    await expect(picker).toBeVisible();
    await expect(p.locator('g[data-series="0"]')).toBeVisible();
    await pause(670);
    await act(button(picker,'对比设备'));
    const extra=p.getByRole('menuitemcheckbox',{name:'机械键盘',exact:true});
    await expect(extra).toHaveAttribute('aria-checked','false');
    await aim(extra);await extra.click();
    await p.keyboard.press('Escape');
    await expect(button(picker,'移除对比：机械键盘')).toBeVisible();
    await expect(p.locator('g[data-series="1"]')).toBeVisible();
    await pause(720);
    const range=p.getByRole('combobox',{name:'记录范围'});
    await act(range);
    await act(p.getByRole('option',{name:'7 天',exact:true}));
    await expect(range).toContainText('7 天');
    await pause(1150);
    cue('设置');
    await act(button(nav,'设置'));
    const settings=p.locator('[data-page="settings"]');
    await expect(settings).toBeVisible();
    await pause(550);
    await act(button(settings.getByRole('navigation'),'记录'));
    await pause(550);
    const retention=settings.getByRole('combobox',{name:'记录保留上限'});
    await act(retention);
    await expect(p.getByRole('option',{name:/365 天/})).toBeVisible();
    await pause(820);
    await p.keyboard.press('Escape');
    await act(button(nav,'总览'));
    await expect(rail.locator('[data-liquid-selection="row"]')).toHaveCount(1);
    await expect(nav.locator('[data-liquid-selection="tab"]')).toHaveCount(1);
    expect(errors).toEqual([]);
    await pause(900);
    await p.mouse.move(w-25,75);await pause(100);
    await cdp.send('Page.stopScreencast');
    writeFileSync(join(out,'timeline.json'),JSON.stringify({records,cues,end:Date.now()/1000},null,2));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
