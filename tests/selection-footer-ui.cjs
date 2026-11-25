const { chromium, expect } = require('@playwright/test');
const { mkdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { installMock } = require('./studio-review-mock.cjs');
const entry = pathToFileURL(resolve(process.env.STUDIO_REVIEW_DIST || 'dist/ui/index.html')).href;
const out = process.env.SELECTION_FOOTER_OUT;
const button = (scope,name) => scope.getByRole('button',{name,exact:true});

(async()=>{
 if(out)mkdirSync(out,{recursive:true});
 const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--allow-file-access-from-files','--no-sandbox']});
 try {
  for(const viewport of [{width:1440,height:900},{width:1120,height:590},{width:520,height:430}]){
   const p=await b.newPage({viewport,locale:'zh-CN',reducedMotion:viewport.width===520?'reduce':'no-preference'});
   const errors=[];p.on('pageerror',e=>errors.push(e.message));
   try {
    await p.addInitScript(installMock);
    await p.goto(entry);
    await p.evaluate(async()=>{await document.fonts.ready;studioReview.ready();});
    const navigation=p.getByRole('navigation',{name:'主导航'});
    const rail=p.getByRole('region',{name:'切换设备'});
    const shot=name=>out?p.screenshot({path:resolve(out,name+'.png')}):undefined;
    await button(rail,'列表模式').click();
    const dual=button(rail,'DualSense');
    await dual.dblclick();
    await expect(button(p,'返回总览')).toBeFocused();
    await p.keyboard.press('Escape');
    await expect(dual).toBeFocused();
    const row=dual.locator('..');
    const highlight=row.locator('[data-liquid-selection="row"]');
    const chevron=button(row,'查看详情 · DualSense');
    await expect.poll(()=>highlight.evaluate(el=>el.getAnimations().filter(a=>a.playState==='running').length)).toBe(0);
    const boxes=await row.evaluate(el=>{
      const select=el.querySelector('button[aria-pressed]');
      const lens=el.querySelector('[data-liquid-selection]');
      const chevron=el.querySelector('button[aria-label^="查看详情"]');
      const box=e=>e.getBoundingClientRect();
      return {difference: Math.abs(box(lens).right-box(el).right),
        includesChevron:box(lens).right>=box(chevron).right,
        buttonOutline:getComputedStyle(select).outlineStyle, focusOutline:getComputedStyle(lens).outlineStyle,
        focusVisible:select.matches(':focus-visible')};
    });
    expect(boxes).toMatchObject({includesChevron:true,buttonOutline:'none',focusOutline:'solid',focusVisible:true});
    expect(boxes.difference).toBeLessThanOrEqual(1.1);
    if(viewport.width===1440){await p.mouse.move(1280,680);await p.waitForTimeout(440);await shot('01-总览列表-返回详情后整行选中');}
    await p.keyboard.press('Tab');
    await expect(chevron).toBeFocused();
    expect(await chevron.evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('solid');
    expect(await highlight.evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('none');
    const footer=p.locator('main > footer');
    const footerY=async()=>footer.evaluate(el=>el.getBoundingClientRect().bottom);
    const compare=await footerY();
    await button(navigation,'设置').click();
    const pane=p.getByRole('region',{name:'设置内容'});
    const cat=p.getByRole('navigation',{name:'设置分类'});
    const top=await pane.evaluate(el=>el.scrollTop);
    expect(Math.abs(await footerY()-compare)).toBeLessThan(1);
    if(viewport.width===1120){
      const tab=navigation.locator('[data-nav-indicator]');
      await expect.poll(()=>tab.evaluate(el=>el.getAnimations().length)).toBe(0);
      await shot('02-设置页-滚动前');
    }
    const pbox=await pane.boundingBox();
    await p.mouse.move(pbox.x+pbox.width*.57,pbox.y+pbox.height*.62);
    await p.mouse.wheel(0,750);
    const max=await pane.evaluate(el=>el.scrollHeight-el.clientHeight);
    if(max>1){
      await expect.poll(()=>pane.evaluate(el=>el.scrollTop)).toBeGreaterThan(top+1);
      expect(Math.abs(await footerY()-viewport.height)).toBeLessThan(1);
      expect(await p.evaluate(()=>window.scrollY)).toBe(0);
      if(viewport.width===1120) await shot('03-设置页-滚动后页脚固定');
      await button(cat,'外观').click();
      await expect.poll(()=>pane.evaluate(el=>el.scrollTop)).toBeLessThan(1);
      await button(cat,'诊断').click();
      await expect.poll(()=>pane.evaluate(el=>el.scrollTop)).toBeGreaterThan(1);
      await expect(button(cat,'诊断')).toHaveAttribute('aria-current','location');
    }
    expect(Math.abs(await footerY()-viewport.height)).toBeLessThan(1);
    expect(await pane.evaluate(el=>el.getBoundingClientRect().bottom)).toBeLessThan((await footer.boundingBox()).y);
    expect(await p.evaluate(()=>window.scrollY)).toBe(0);
    expect(errors).toEqual([]);
    console.log(viewport.width+'px: whole-row focus, separate detail focus and bottom-stationary footer; pane scroll range '+max+'px');
   } finally{await p.close()}
  }
 } finally{await b.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
