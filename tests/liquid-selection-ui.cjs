const { chromium,expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');
const { mkdirSync } = require('node:fs');
const { installMock } = require('./studio-review-mock.cjs');
const app=pathToFileURL(resolve('dist/ui/index.html')).href;
const out=process.env.LIQUID_REVIEW_OUT;
const b=(q,name)=>q.getByRole('button',{name,exact:true});
(async()=>{
 if(out)mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--allow-file-access-from-files','--no-sandbox']});
 try {
  for(const [w,h] of [[1440,900],[520,540]]){
   const p=await browser.newPage({viewport:{width:w,height:h},locale:'zh-CN',reducedMotion:'reduce'});
   const errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&m.text().includes('Content Security Policy'))errors.push(m.text())});
   await p.addInitScript(installMock,{portable:true});
   await p.goto(app);await p.evaluate(async()=>{await document.fonts.ready;studioReview.ready();});
   const nav=p.getByRole('navigation',{name:'主导航'});
   const go=async name=>{await b(nav,name).click();await expect(b(nav,name)).toHaveAttribute('aria-current','page');};
   const active=p.locator('main');
   const glass=(scope,kind)=>scope.locator('[data-liquid-selection="'+kind+'"]');
   const valid=async x=>{
    await expect(x).toHaveCount(1);await expect(x).toHaveAttribute('data-refracting','true');
    const proof=await x.evaluate(el=>{
      const css=getComputedStyle(el), id=el.style.getPropertyValue('--lens').match(/#([^")]+)/)?.[1];
      const filter=id&&document.getElementById(id);
      return {applied:css.backdropFilter.includes(id),passedThrough:css.pointerEvents==='none',map:filter?.querySelector('feImage')?.getAttribute('href')?.startsWith('data:image/png;base64,'),w:el.offsetWidth};
    });
    expect(proof).toMatchObject({applied:true,passedThrough:true,map:true});expect(proof.w).toBeGreaterThan(20);
   };
   const shot=async name=>{if(out&&w===1440){await p.mouse.move(w-5,5);await p.screenshot({path:resolve(out,name+'.png')});}};
   await valid(glass(nav,'tab'));
   const rail=p.getByRole('region',{name:'切换设备'});
   await valid(glass(rail,'row'));
   await shot('01-总览展台-玻璃选中');
   await b(rail,'列表模式').click();
   await b(rail,'头戴耳机').click();
   const chosen=b(rail,'头戴耳机');await expect(chosen).toHaveAttribute('aria-pressed','true');
   await valid(glass(rail,'row'));
   await shot('02-总览列表-玻璃选中');
   await go('设备');
   const row=p.locator('tr[data-selected="true"]');
   const layer=glass(row,'row');await valid(layer);
   const [a,s]=await Promise.all([row.boundingBox(),layer.boundingBox()]);
   expect(Math.abs(a.x-s.x)).toBeLessThan(2);expect(Math.abs(a.width-s.width)).toBeLessThan(2);
   await shot('03-设备表格-玻璃选中');
   const mouse=b(active.getByRole('table'),'无线鼠标');await mouse.focus();await mouse.press('Enter');
   await expect(mouse).toHaveAttribute('aria-pressed','true');
   await valid(glass(row,'row'));
   await go('提醒');
   const queue=active.getByRole('region',{name:'待充电'});
   const card=glass(queue,'card');await valid(card);
   const before=await card.locator('..').textContent();expect(before).toContain('DualSense');
   await b(active.getByRole('group',{name:'通知预览级别'}),'电量告急').click();
   const after=await card.locator('..').textContent();expect(after).toContain('头戴耳机');
   await valid(card);await shot('04-提醒-当前预览设备');
   await expect(queue.getByRole('button',{name:/分钟后提醒/})).toHaveCount(2);
   const name=b(queue,'查看详情 · 头戴耳机');await name.click();await expect(b(active,'返回提醒')).toBeFocused();
   await p.keyboard.press('Escape');await expect(name).toBeFocused();
   await p.emulateMedia({forcedColors:'active'});
   await expect(card).not.toHaveAttribute('data-refracting','true');
   expect(await card.evaluate(el=>getComputedStyle(el).backdropFilter)).toBe('none');
   expect(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   expect(errors).toEqual([]);
   console.log(w+'px: exactly one tab lens and one selected lens, table aligned, reminder preview follows actual target, focus and solid fallback passed.');
   await p.close();
  }
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
