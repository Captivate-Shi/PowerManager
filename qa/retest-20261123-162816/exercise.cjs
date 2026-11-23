const { _electron, expect } = require(require('node:path').resolve('node_modules/@playwright/test'));
const fs = require('node:fs'), path = require('node:path');
const output = __dirname;
const exe = path.resolve('out/1.4.0/PowerManager-H5-win32-x64/PowerManager-H5.exe');
const profile = fs.mkdtempSync(path.join(output, '.profiles', 'extra-'));
const results = [], errors = [], coverage = new Set(), actions = [];
const seed = Number(process.env.PM_QA_SEED || 52819);
let state = seed;
const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
const pick = items => items[Math.floor(random() * items.length)];
const run = async () => {
  const app = await _electron.launch({executablePath:exe,args:['--demo','--force-device-scale-factor=1'],
    env:{...process.env,LOCALAPPDATA:profile}});
  try {
    app.on('window', win => win.on('pageerror', error => errors.push(String(error))));
    const p = await app.firstWindow();
    p.on('pageerror', error => errors.push(String(error)));
    p.setDefaultTimeout(2800);
    const b = name => p.getByRole('button',{name,exact:true});
    const go = name => b(name).click();
    const step = async (name, fn) => {
      try { await p.keyboard.press('Escape'); results.push({name, result:await fn() ?? 'pass'}); }
      catch (error) { results.push({name,error:String(error).slice(0,1200)}); }
      console.log(JSON.stringify(results.at(-1)));
    };
    await p.getByRole('heading',{name:'外设电量总览'}).waitFor();
    const snap = () => p.evaluate(() => window.powerManager.snapshot());
    const resize = (w,h) => app.evaluate(({BrowserWindow}, [width,height]) =>
      BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().includes('surface=main')).setSize(width,height),[w,h]);
    await step('搜索边界、全部筛选、空白区与设备键盘入口', async () => {
      await go('查看离线设备');
      const filters = p.locator('[data-filter]');
      const states=[];
      for(let i=0;i<await filters.count();i++){
        await filters.nth(i).click();
        await expect(filters.nth(i)).toHaveAttribute('aria-pressed','true');
        states.push(await filters.nth(i).innerText());
      }
      await filters.first().click();
      const q=p.getByRole('searchbox',{name:'搜索设备'});
      for(const value of ['不存在🧪','a'.repeat(500)]) {
        await q.fill(value); await expect(p.getByText('没有符合筛选条件的设备')).toBeVisible();
      }
      await q.fill('DUALSENSE'); const card=p.getByRole('button',{name:/DualSense 手柄，/});
      await expect(card).toHaveCount(1); await card.press('Enter');
      await expect(p.getByRole('heading',{name:'设备详情',exact:true})).toBeVisible();
      await p.keyboard.press('Escape');
      await expect(p.getByRole('heading',{name:'设备管理',exact:true})).toBeVisible();
      return states;
    });
    await step('名称空白、emoji、长度边界及恢复',async()=>{
      await go('设备'); await p.locator('[data-filter]').first().click();
      await p.getByRole('searchbox').clear();
      await p.getByRole('button',{name:/DualSense 手柄，/}).click();
      for(const input of ['   ','  中文 🔋  ','测'.repeat(100),'']){
        await go('编辑设备名称'); const field=p.getByRole('textbox',{name:'设备名称'});
        await field.fill(input);
        const actual=await field.inputValue(); await go('保存名称');
        await expect(p.getByRole('dialog')).toBeHidden();
        const name=(await snap()).devices.find(x=>x.id==='dualsense').name;
        if(name!==(actual.trim()||'DualSense 手柄')) throw Error(JSON.stringify({actual,name}));
      }
    });
    await step('历史下拉遍历、键盘和曲线悬停',async()=>{
      await go('历史'); const combo=p.getByRole('combobox',{name:'历史设备'});
      await combo.press('Space'); const options=p.getByRole('option'); const names=await options.allTextContents();
      for(const name of names){
        await p.getByRole('option',{name,exact:true}).click();
        await expect(p.getByRole('heading',{name,exact:true})).toBeVisible();
        const chart=p.getByRole('group',{name:new RegExp(name)});
        if(await chart.count()) await chart.first().hover();
        await combo.click();
      }
      await p.keyboard.press('Escape'); await expect(combo).toBeFocused();
      return names;
    });
    await step('稍后提醒、忽略本次和全局静音往返',async()=>{
      await go('提醒');
      await b('稍后提醒').first().click();
      const afterSnooze=(await snap()).alerts;
      await b('忽略本次').last().click();
      const afterIgnore=(await snap()).alerts;
      if(JSON.stringify(afterSnooze)===JSON.stringify(afterIgnore)) throw Error('忽略未更新状态');
      await go('静音 1 小时');
      if(!((await snap()).mutedUntil>Date.now())) throw Error('静音未生效');
      await go('恢复提醒');
      if((await snap()).mutedUntil>Date.now()) throw Error('恢复未生效');
      return {afterSnooze,afterIgnore};
    });
    await step('重新扫描、关闭按钮和点击弹窗外部',async()=>{
      await go('总览'); await b('查找设备').first().click();
      await go('重新扫描');
      await expect(b('重新扫描')).toBeEnabled();
      await go('关闭对话框');
      await expect(p.getByRole('dialog')).toBeHidden();
      await go('总览'); await b('查找设备').first().click();
      await p.mouse.click(4,100);
      await expect(p.getByRole('dialog')).toBeHidden();
    });
    await step('通用预览正文点击与指定设备预览的行为差异',async()=>{
      await go('提醒');
      const popup=app.waitForEvent('window',{timeout:3500});
      await go('预览低电量');
      const generic=await popup;
      await generic.getByRole('button',{name:/电量/}).first().click();
      await expect.poll(()=>generic.isClosed()).toBe(true);
      const genericHeading=await p.locator('h1').innerText();
      await go('设备'); await p.locator('[data-filter]').first().click();
      await p.getByRole('button',{name:/DualSense 手柄，/}).click();
      const next=app.waitForEvent('window',{timeout:3500});
      await go('提醒测试');
      const linked=await next;
      await linked.getByRole('button',{name:/电量/}).first().click();
      await expect(p.getByRole('heading',{name:'设备详情',exact:true})).toBeVisible();
      await expect.poll(()=>linked.isClosed()).toBe(true);
      return {genericHeading, genericNavigated:genericHeading==='设备详情', linkedNavigated:true};
    });
    await step('提醒间隔、稍后时间、声音开关和设备排序全部选项',async()=>{
      const details={};
      await go('提醒');
      for(const [label, key] of [['重复提醒间隔','repeat'],['稍后提醒时间','snooze']]){
        const combo=p.getByRole('combobox',{name:label});
        await combo.click();
        const options=await p.getByRole('option').allTextContents();
        for(const name of options){
          await p.getByRole('option',{name,exact:true}).click();
          const number=Number(name.match(/\d+/)?.[0]||0);
          await expect.poll(async()=> (await snap()).settings[key]).toBe(number);
          await combo.click();
        }
        await p.keyboard.press('Escape');
        details[label]=options;
      }
      for(const [label,key] of [['全屏提示音','fullscreenSound'],['仅提示音','soundOnly'],['右下角弹窗','desktopToasts']]){
        const sw=p.getByRole('switch',{name:label,exact:true});
        const old=(await snap()).settings[key];
        await sw.click();
        await expect.poll(async()=> (await snap()).settings[key]).toBe(!old);
        await sw.press('Space');
        await expect.poll(async()=> (await snap()).settings[key]).toBe(old);
        details[label]=true;
      }
      await go('设备');
      const sort=p.getByRole('combobox',{name:'设备排序'});
      await sort.click();
      const options=await p.getByRole('option').allTextContents();
      for(const name of options){ await p.getByRole('option',{name,exact:true}).click(); await expect(sort).toContainText(name); await sort.click(); }
      await p.keyboard.press('Escape'); details.sort=options;
      return details;
    });
    await step('诊断入口和登录启动开关演示往返',async()=>{
      await go('设置');
      const startup=p.getByRole('switch',{name:'随 Windows 登录启动'});
      const old=(await snap()).settings.startup;
      await startup.click();
      await expect.poll(async()=> (await snap()).settings.startup).toBe(!old);
      await startup.click();
      await expect.poll(async()=> (await snap()).settings.startup).toBe(old);
      const diagnostics=p.getByRole('button',{name:/打开诊断目录/});
      await diagnostics.click();
      return {startupDemo:true,diagnosticsClick:true};
    });
    await step('电压记录开关与诊断目录命令反馈',async()=>{
      await go('设置');
      const voltage=p.getByRole('switch',{name:'记录 DualSense 电池电压'});
      const old=(await snap()).settings.voltage;
      await voltage.press('Space');
      await expect.poll(async()=> (await snap()).settings.voltage).toBe(!old);
      await voltage.click();
      await expect.poll(async()=> (await snap()).settings.voltage).toBe(old);
      return {demoReportDisabled:await b('生成兼容性报告').isDisabled()};
    });
    await step('缩放输入边界、滑块键盘及最小窗口逐页布局',async()=>{
      await resize(720,520); await go('设置');
      const main=p.getByRole('spinbutton',{name:'主界面缩放百分比'});
      const apply=b('应用').first();
      for(const value of ['','74','151','100.5']){
        await main.fill(value); await apply.click();
        if((await snap()).settings.zoom!==100) throw Error('接受了非法缩放 '+value);
      }
      const layouts=[];
      for(const zoom of [75,100,150]){
        await go('设置');
        const slider=p.getByRole('slider',{name:'主界面缩放滑块'});
        if(zoom!==100) await slider.press(zoom===75?'Home':'End'); else await main.fill('100');
        await apply.click();
        await expect.poll(async()=> (await snap()).settings.zoom).toBe(zoom);
        for(const tab of ['总览','设备','提醒','历史','设置']){
          await go(tab);
          const layout=await p.evaluate(()=>{
            const main=document.querySelector('main');
            return {viewport:innerWidth,height:innerHeight,doc:document.documentElement.scrollWidth,
              main:main?.scrollWidth,mainWidth:main?.clientWidth,
              outside:[...document.querySelectorAll('button,input,[role=switch]')].filter(e=>{
                const r=e.getBoundingClientRect(); return r.width>0&&(r.right>innerWidth+1||r.left < -1);
              }).map(e=>[e.getAttribute('aria-label')||e.textContent.trim(),Math.round(e.getBoundingClientRect().right)])};
          });
          layouts.push({zoom,tab,...layout});
          if(zoom===150) await p.screenshot({path:path.join(output,'min-150-'+tab+'.png')});
        }
      }
      await go('设置'); await go('主界面恢复 100%');
      await resize(1240,820);
      return layouts;
    });
    await go('总览');
    await p.evaluate(()=>{
      window.qaTiming={frames:[],long:[],events:[]};
      let last=0;
      new PerformanceObserver(list=>window.qaTiming.long.push(...list.getEntries().map(x=>x.duration))).observe({type:'longtask'});
      new PerformanceObserver(list=>window.qaTiming.events.push(...list.getEntries().map(x=>({name:x.name,duration:x.duration})))).observe({type:'event',durationThreshold:16});
      function frame(now){if(last)window.qaTiming.frames.push(now-last);last=now;requestAnimationFrame(frame)}
      requestAnimationFrame(frame);
    });
    for(let i=0;i<600;i++){
      const kind=pick(['target','target','target','random','double','right','key','wheel','move','nav']);
      const view=p.viewportSize()||await p.evaluate(()=>({width:innerWidth,height:innerHeight}));
      const x=Math.floor(random()*view.width), y=Math.floor(random()*view.height);
      let target;
      if(kind==='target'||kind==='nav'){
        const candidates=await p.evaluate(nav=>[...document.querySelectorAll(nav?'nav button':'button,input,select,[role=option],[role=menuitem],[role=switch]')].flatMap(e=>{
          const label=e.getAttribute('aria-label')||e.textContent.trim()||e.name||e.getAttribute('role');
          if(e.matches(':disabled')||/停止监测|诊断目录|随 Windows 登录启动/.test(label)) return [];
          const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
          return document.elementFromPoint(x,y)?.closest('button,input,select,[role=option],[role=menuitem],[role=switch]')===e?[{x,y,label}]:[];
        }),kind==='nav');
        target=candidates.length?pick(candidates):null;
      }
      const key=kind==='key'?pick(['Tab','Shift+Tab','Escape','Enter','Space','ArrowDown','ArrowUp','Home','End']):null;
      if(target){
        coverage.add(target.label);
        await p.mouse.click(target.x,target.y);
      } else if(kind==='double') await p.mouse.dblclick(x,y);
      else if(kind==='right') await p.mouse.click(x,y,{button:'right'});
      else if(kind==='key') await p.keyboard.press(key);
      else if(kind==='wheel') { await p.mouse.move(x,y); await p.mouse.wheel(0,pick([-1200,-300,300,1200])); }
      else if(kind==='move') await p.mouse.move(x,y);
      else await p.mouse.click(x,y);
      actions.push({kind,key,target:target?.label,x:target?.x??x,y:target?.y??y,view});
      if(i%75===74) {
        const response=await snap();
        console.log('Monkey', i+1, response.devices.length);
      }
    }
    await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await go('总览');
    await expect(p.getByRole('heading',{name:'外设电量总览'})).toBeVisible();
    const timing=await p.evaluate(()=>window.qaTiming);
    const stats=(items)=>{const a=items.sort((x,y)=>x-y);return {n:a.length,p50:a[Math.floor(a.length*.5)]??null,p95:a[Math.floor(a.length*.95)]??null,p99:a[Math.floor(a.length*.99)]??null,max:a.at(-1)??null,over50:a.filter(x=>x>50).length}};
    results.push({name:'monkey',seed,actions:actions.length,targets:[...coverage],frames:stats(timing.frames),longTasks:stats(timing.long),eventTimings:stats(timing.events.map(x=>x.duration)),errors});
  } finally {
    fs.writeFileSync(path.join(output,'extra-result-'+seed+'.json'),JSON.stringify({results,errors,actions},null,2));
    await app.close();
  }
};
run().catch(error=>{console.error(error);process.exitCode=1});
