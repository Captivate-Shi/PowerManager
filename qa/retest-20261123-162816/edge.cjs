const { _electron, expect } = require(require('node:path').resolve('node_modules/@playwright/test'));
const fs=require('node:fs'),path=require('node:path');
(async()=>{
 const app=await _electron.launch({executablePath:path.resolve('out/1.4.0/PowerManager-H5-win32-x64/PowerManager-H5.exe'),
 args:['--demo','--force-device-scale-factor=1'],env:{...process.env,LOCALAPPDATA:fs.mkdtempSync(path.join(__dirname,'.profiles','edge-'))}});
 try {
 const p=await app.firstWindow(), b=name=>p.getByRole('button',{name,exact:true});
 const results={toast:[],outside:[]};
 await b('设备').click(); await p.getByRole('button',{name:/DualSense 手柄，/}).click();
 for(const n of [15,40,80]){
  await b('编辑设备名称').click();
  await p.getByRole('textbox',{name:'设备名称'}).fill('测'.repeat(n));
  await b('保存名称').click();
  await expect(p.getByRole('heading',{name:'测'.repeat(n),exact:true})).toBeVisible();
  const pending=app.waitForEvent('window');
  await b('提醒测试').click(); const toast=await pending;
  await toast.getByRole('main').waitFor();
  await toast.waitForTimeout(300);
  const geometry=await toast.evaluate(()=>{
   const rect=e=>({top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom});
   const title=document.querySelector('strong');
   return {window:innerHeight,panel:rect(document.querySelector('main')),title:rect(title),message:rect(title.nextElementSibling)};
  });
  results.toast.push({n,...geometry});
  const png=await app.evaluate(async ({BrowserWindow})=>Array.from((await BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=toast')).webContents.capturePage()).toPNG()));
  fs.writeFileSync(path.join(__dirname,'toast-alias-'+n+'.png'),Buffer.from(png));
  await toast.getByRole('button',{name:'关闭通知'}).click();
  await expect.poll(()=>toast.isClosed()).toBe(true);
 }
 await b('总览').click();
 for(const delay of [0,0,0,50,120,350]){
   await b('查找设备').first().click();
   const dialog=p.getByRole('dialog');
   await expect(dialog).toBeVisible();
   if(delay) await p.waitForTimeout(delay);
   await p.mouse.click(20,120);
   await p.waitForTimeout(80);
   const closed=!(await dialog.isVisible());
   results.outside.push({delay,closed});
   if(!closed) await p.keyboard.press('Escape');
   await expect(dialog).toBeHidden();
 }
 fs.writeFileSync(path.join(__dirname,'edge-result.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify(results,null,2));
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
