const { chromium,expect }=require('@playwright/test');
const { installMock }=require('./studio-review-mock.cjs');
const { pathToFileURL }=require('node:url');
const { resolve }=require('node:path');
const { mkdirSync }=require('node:fs');
(async()=>{
 const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--allow-file-access-from-files']});
 try {
  const p=await b.newPage({viewport:{width:1440,height:900},locale:'zh-CN',reducedMotion:'reduce'});
  await p.addInitScript(installMock,{portable:true});await p.goto(pathToFileURL(resolve('dist/ui/index.html')).href);
  await p.evaluate(()=>{
    studioReview.ready();
    const base=powerManager.command;
    window.failHistory='all';
    powerManager.command=(c)=>c.type==='history'&&(failHistory==='all'||failHistory===c.id)
      ?Promise.resolve({ok:false,error:'Mock failure'}):base(c);
  });
  const nav=p.getByRole('navigation',{name:'主导航'}),go=name=>nav.getByRole('button',{name,exact:true}).click();
  const chart=p.getByRole('region',{name:'电量对比记录'}),retry=chart.getByRole('button',{name:'重试',exact:true});
  await go('记录');
  await expect(chart.getByRole('status')).toHaveText(['电量记录读取失败']);
  await expect(retry).toBeEnabled();
  const out=process.env.COPY_ROUND_OUT;
  if(out) {
    mkdirSync(out,{recursive:true}); await p.mouse.move(1430,64);
    await p.screenshot({path:resolve(out,'余电-电量记录失败.png')});
  }
  await p.evaluate(()=>{window.failHistory='dual';});
  await retry.click();
  await expect(chart.getByText('DualSense：读取失败',{exact:true})).toBeVisible();
  await expect(chart.getByText('电量记录读取失败',{exact:true})).toHaveCount(0);
  await expect(chart.locator('path[data-trace=exact]:not([d=""])')).toHaveCount(1);
  await p.evaluate(()=>{window.failHistory=null;});
  await retry.click();
  await expect(retry).toHaveCount(0);
  await expect(chart.locator('path[data-trace=range]:not([d=""])')).toHaveCount(1);
  console.log('All-failed notice appears once; retry shows surviving series with a named partial error; second retry recovers both.');
 } finally { await b.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
