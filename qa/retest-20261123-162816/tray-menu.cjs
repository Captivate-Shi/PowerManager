const { _electron,expect }=require(require('node:path').resolve('node_modules/@playwright/test'));
const fs=require('node:fs'),path=require('node:path');
(async()=>{
const app=await _electron.launch({executablePath:path.resolve('out/1.4.0/PowerManager-H5-win32-x64/PowerManager-H5.exe'),args:['--demo'],
env:{...process.env,LOCALAPPDATA:fs.mkdtempSync(path.join(__dirname,'.profiles','tray-menu-'))}});
const done=[];
try{
const main=await app.firstWindow();
await main.locator('h1').waitFor();
await app.evaluate(({Tray})=>{
 const original=Tray.prototype.setContextMenu;
 Tray.prototype.setContextMenu=function(menu){globalThis.qaTrayMenu=menu;return original.call(this,menu)};
});
await main.getByRole('button',{name:'提醒',exact:true}).click();
await main.getByRole('button',{name:'静音 1 小时',exact:true}).click();
await main.getByRole('button',{name:'恢复提醒',exact:true}).click();
const menu=label=>app.evaluate(async (_,label)=>{
 const menu=globalThis.qaTrayMenu;
 if(label==='list')return menu?.items.map(i=>i.label);
 const item=menu?.items.find(i=>i.label===label);
 if(!item)return false;
 if(label==='退出')setTimeout(()=>item.click({},null,null),100);
 else item.click({},null,null);
 return true;
},label);
const call=async label=>{if(!(await menu(label)))throw Error('Missing menu: '+label);done.push(label)};
const heading=async title=>expect(main.locator('h1')).toHaveText(title);
const vis=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=main')).isVisible());
const labels=await menu('list'); console.log(labels); if(!labels)throw Error('Tray context menu missing');
const trayPromise=app.waitForEvent('window');await call('托盘面板');const tray=await trayPromise;
await tray.getByRole('main',{name:'托盘面板'}).waitFor();
await tray.getByRole('button',{name:'关闭托盘面板'}).click();
await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=tray')).isVisible())).toBe(false);
await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=main')).close());
await expect.poll(vis).toBe(false);await call('打开主界面');await expect.poll(vis).toBe(true);
const popup=app.waitForEvent('window');await call('测试右下角提醒');const toast=await popup;await toast.getByRole('main').waitFor();await toast.getByRole('button',{name:'关闭通知'}).click();
await call('立即刷新');
const state=()=>main.evaluate(()=>window.powerManager.snapshot());
await call('静音 1 小时');await expect.poll(async()=> (await state()).mutedUntil>Date.now()).toBe(true);
await call('恢复提醒');await expect.poll(async()=> (await state()).mutedUntil>Date.now()).toBe(false);
await call('打开诊断目录');
const closed=app.waitForEvent('close');await call('退出');await closed;
fs.writeFileSync(path.join(__dirname,'tray-menu-result.json'),JSON.stringify({labels,done},null,2));
console.log(done);
}finally{await app.close().catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;})
