const { chromium, expect } = require('@playwright/test');
const { mkdirSync,writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { installMock } = require('./studio-review-mock.cjs');
const entry = pathToFileURL(resolve('dist/ui/index.html')).href;
const out = resolve(process.env.BADGOODS_OUT || '../pm-review-evidence/badgoods');
const btn = (q,name) => q.getByRole('button',{name, exact:true});
(async()=>{
  mkdirSync(out,{recursive:true});
  const b = await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--allow-file-access-from-files']});
  const report = [];
  try {
    for(const width of [1440,900,520]) {
      const height=width===1440?900:width===900?630:430;
      const p=await b.newPage({viewport:{width,height},locale:'zh-CN',reducedMotion:'reduce'});
      const errors=[];
      p.on('pageerror', e => errors.push(e.message));
      await p.addInitScript(installMock,{portable:true,historyDelay:350,historyRetention:'week'});
      await p.goto(entry);
      await p.evaluate(async()=>{await document.fonts.ready; studioReview.ready();});
      const nav=p.getByRole('navigation',{name:'主导航'});
      const main=p.getByRole('main');
      const go=async(name)=>{
        await btn(nav,name).click();await expect(btn(nav,name)).toHaveAttribute('aria-current','page');
        expect(await p.evaluate(()=>window.scrollY)).toBe(0);
      };
      const shot=async name=> {
        if(width===1440) {await p.mouse.move(width-8,64);await p.screenshot({path:resolve(out,name+'.png')});}
      };
      const audit={width};
      await go('总览');
      await expect(main.getByRole('heading',{name:'DualSense',exact:true})).toBeVisible();
      await expect(main.getByText('低电量',{exact:true})).toBeVisible();
      await shot('总览');
      await go('设备');
      const table=main.getByRole('table');
      const dual=table.getByRole('row').filter({has:btn(p,'DualSense')});
      await expect(dual.getByText('低电量',{exact:true}).filter({visible:true})).toHaveCount(1);
      if (width <= 620) {
        const headset=table.getByRole('row').filter({has:btn(p,'头戴耳机')});
        await expect(headset.getByText('电量告急',{exact:true}).filter({visible:true})).toHaveCount(1);
        const mouse=table.getByRole('row').filter({has:btn(p,'无线鼠标')});
        await expect(mouse.locator('small')).toHaveCount(0);
        await headset.locator("td").first().evaluate(el => { el.closest("[data-scroll-pane]").scrollTop = 49; });
        await p.mouse.move(width-8,64);
        await p.screenshot({path:resolve(out,'余电-设备窄窗.png')});
      }
      await shot('设备');
      const search=p.getByRole('searchbox',{name:'搜索设备'});
      await search.fill('不存在的外设');await expect(main.getByText('未找到匹配设备',{exact:true})).toBeVisible();
      await btn(main,'清除筛选').click();await expect(search).toHaveValue('');
      await shot('设备-空态后恢复');
      await go('提醒');
      await expect(main.getByRole('slider',{name:'全局告急阈值'})).toBeVisible();
      const queue=main.getByRole('region',{name:'待充电'});
      const opener=btn(queue,'查看详情 · DualSense');
      await opener.click();await expect(btn(main,'返回提醒')).toBeFocused();
      await p.keyboard.press('Escape');await expect(opener).toBeFocused();
      const soon=opener.locator('xpath=ancestor::article').getByRole('button',{name:'30 分钟后提醒',exact:true});
      await expect(soon).toBeVisible();
      const snoozeArea=main.locator('details').filter({hasText:'通知与静音'});
      await expect(snoozeArea).not.toHaveAttribute('open','');
      await expect(snoozeArea.getByRole('combobox',{name:'稍后提醒时间'})).not.toBeVisible();
      audit.snoozeVisibleLabel=await soon.innerText();
      await shot('提醒');
      if(width===1440) {
        await snoozeArea.locator('summary').click();
        await snoozeArea.getByRole('combobox',{name:'稍后提醒时间'}).click();
        await p.getByRole('option',{name:'15 分钟',exact:true}).click();
        await expect(opener.locator('xpath=ancestor::article').getByRole('button',{name:'15 分钟后提醒',exact:true})).toBeVisible();
      }
      await go('记录');
      const chart=main.getByRole('region',{name:'电量对比记录'});
      await expect(chart.locator('[aria-busy]')).toHaveAttribute('aria-busy','false');
      const range=main.getByRole('combobox',{name:'记录范围'});
      await range.click();
      await expect(p.getByRole('option',{name:'30 天',exact:true})).toBeDisabled();
      await expect(p.getByRole('option',{name:'365 天',exact:true})).toBeDisabled();
      await p.getByRole('option',{name:'7 天',exact:true}).click();
      await expect(chart.locator('[aria-busy]')).toHaveAttribute('aria-busy','false');
      audit.longRangeContainsRawLabel = await main.getByText('原始采样',{exact:true}).count();
      await shot('记录-7天');
      await go('设置');
      const rail=main.getByRole('navigation',{name:'设置分类'});
      const pane=main.getByRole('region',{name:'设置内容'});
      const geometry=()=>pane.evaluate(el=>{
        const nav=el.previousElementSibling;
        const app=document.querySelector('main');
        const content=el.querySelector('section');
        const title=el.querySelector('#settings-history h2');
        const group=title.parentElement;
        const refresh=el.querySelector('#settings-runtime [data-setting-row]:last-child [data-setting-control]');
        const rect=n=>n.getBoundingClientRect();
        return {rail:rect(nav).left,app:rect(app).left+parseFloat(getComputedStyle(app).paddingLeft),
          left:rect(content).left,width:rect(content).width,leftPane:rect(el).left, title:rect(title).top-rect(group).top,
          row:rect(group).top-rect(refresh).bottom, overflow:el.scrollWidth-el.clientWidth};
      });
      audit.geometry=await geometry();
      expect(audit.geometry.rail).toBeCloseTo(audit.geometry.app,0);
      expect(audit.geometry.width).toBeLessThanOrEqual(654);
      expect(audit.geometry.title).toBe(30);
      expect(audit.geometry.row).toBe(12);
      expect(audit.geometry.overflow).toBe(0);
      if(width===1440){
        expect(audit.geometry.left-audit.geometry.leftPane).toBeGreaterThan(110);
        expect(Math.abs((audit.geometry.left+audit.geometry.width/2)-width/2)).toBeLessThan(55);
        await shot('余电-设置内容居中');
        const previous=await p.addStyleTag({content:'[data-page="settings"] [aria-label="设置内容"] > section {margin-inline-start:0!important;}'});
        audit.previous=await geometry();
        await shot('设置-调整前');
        await previous.evaluate(el=>el.remove());
      } else { expect(audit.geometry.left-audit.geometry.leftPane).toBeLessThan(70); }
      const old=await rail.boundingBox();
      await btn(rail,'诊断').press('Enter');
      await expect(pane.getByRole('heading',{name:'诊断',exact:true})).toBeFocused();
      if(width<1440) await expect.poll(()=>pane.evaluate(el=>el.scrollTop)).toBeGreaterThan(10);
      expect(await rail.boundingBox()).toEqual(old);
      await go('设备'); await go('设置');
      await expect(btn(rail,'诊断')).toHaveAttribute('aria-current','location');
      expect(errors).toEqual([]);
      report.push(audit);
      await p.close();
    }
    writeFileSync(resolve(out,'audit.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
  } finally{await b.close();}
})().catch(err=>{console.error(err);process.exitCode=1});
