// Runs the built renderer, substituting only the WebView host's IPC.
const { chromium, expect } = require('@playwright/test');
const { installMock } = require('./studio-review-mock.cjs');
const { resolve, join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdirSync, writeFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');

const entry = pathToFileURL(resolve('dist/ui/index.html')).href + '?surface=toast';
const art = [
  { id: 'pad', art: 'dualsense', name: 'DualSense', reading: { low: 5, high: 9 } },
  { id: 'mouse', art: 'mouse', name: 'Razer Viper V3 Pro', reading: { low: 3, high: 3 } },
  { id: 'keys', art: 'keyboard', name: 'Logitech MX Keys S', reading: { low: 9, high: 9 } },
];
const alert = (devices, count = devices.length) => {
  const asDevice = (item) => ({ ...item, reading: { ...item.reading, raw: 0, power: 'discharging', source: 'hid' } });
  const device = asDevice([...devices].sort((a,b) => a.reading.high-b.reading.high)[0]);
  return { device, devices: devices.map(asDevice), count, detailId: device.id, severity: 'critical', preview: false };
};

async function main() {
  const out = process.env.PM_TOAST_RECORD;
  if (out) mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH,
    args: ['--allow-file-access-from-files', '--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1050, height: 540 }, locale: 'zh-CN' });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      if (!location.search.includes('surface=toast')) return;
      window.commands = [];
      window.powerManager = {
        onToast(cb) { window.mockToast = cb; return () => { delete window.mockToast; }; },
        toastPresent: async () => {},
        command: async message => { window.commands.push(message); return { ok: true }; },
      };
    });
    // Start on a real file origin for the renderer iframe in Chromium.
    await page.goto(pathToFileURL(resolve('dist/ui/index.html')).href + '?surface=toast');
    await page.setContent(`<style>
      *{box-sizing:border-box}html{color-scheme:dark}body{margin:0;background:radial-gradient(ellipse at 74% 70%,#252c3b,#12141a 70%);color:#eef2fa;font:14px "Noto Sans CJK SC",sans-serif}
      header{position:absolute;left:49px;top:52px}small{color:#a7b0c3;font-size:13px;letter-spacing:.09em}
      h1{font-size:34px;margin:18px 0 3px}p{color:#aab3c2;margin-top:5px;font-size:16px}
      iframe{position:absolute;right:25px;bottom:54px;border:none;width:460px;height:146px}
      footer{position:absolute;bottom:0;left:0;right:0;height:39px;background:#191d25;border-top:1px solid #303748;text-align:right;padding:8px 23px;color:#aab4c7}
      </style><header><small>余电 / 桌面提醒 · MOCK 数据</small><h1></h1><p></p></header>
      <iframe title="余电弹窗" src="${entry}"></iframe><footer>14:32</footer>`);
    const child = page.frames().find(x => x.parentFrame() === page.mainFrame()) ?? await page.waitForEvent('frameattached');
    await expect.poll(() => child.evaluate(() => typeof window.mockToast).catch(() => null)).toBe('function');
    const sequences = [];
    let cdp;
    if (out) {
      cdp = await page.context().newCDPSession(page);
      cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
        const name = String(sequences.length).padStart(5,'0') + '.jpg';
        sequences.push({ name, time: metadata.timestamp ?? Date.now()/1000 });
        writeFileSync(join(out,name),data,'base64');
        await cdp.send('Page.screencastFrameAck',{sessionId}).catch(() => {});
      });
      await cdp.send('Page.startScreencast',{format:'jpeg',quality:93,everyNthFrame:1});
    }
    const card = child.getByRole('main',{name:'桌面电量提醒',includeHidden:true});
    const pictures = child.locator('[data-toast-photo][data-leaving="false"]');
    const updates = [
      [alert(art.slice(0,1)), '单台告急', '单个设备保留大图和详情入口。', 1],
      [alert(art.slice(0,2)), '第二台告急', '设备图错位摆开，最低电量更新。', 2],
      [alert(art), '第三台告急', '合照变成上二下一，卡片不变高。', 3],
      [alert(art,4), '第四台告急', '只出现 +1，三张图不挪。', 3],
      [alert(art,24), '24 台告急', '总数和 +21 更新，不再加图。', 3],
      [alert(art,23), '鼠标开始充电', '移除鼠标，左侧补入下一台；其余设备继续提醒。', 3],
      [alert(art,3), '回到三台告急', '+N 消失，设备图不跳动。', 3],
      [alert([art[2]]), '只剩一台告急', '切回大图和单设备详情。', 1],
    ];
    // After charging, a previously hidden device fills the third image slot.
    const other = { id:'ear', art:'earbuds', name:'无线耳机', reading:{low:10,high:10} };
    updates[5][0] = alert([art[0],art[2],other],23);
    updates[6][0] = alert([art[0],art[2],other]);
    let box, first;
    for (const [value, head, sub, visible] of updates) {
      await page.evaluate(([head,sub]) => { document.querySelector('h1').textContent=head; document.querySelector('p').textContent=sub; },[head,sub]);
      await child.evaluate(t => window.mockToast(t),value);
      await expect(pictures).toHaveCount(visible);
      if (value.count > 1) await expect(card.getByText(value.count+' 台设备电量告急',{exact:true})).toBeVisible();
      else await expect(card.getByRole('button',{name:'设备详情'})).toBeVisible();
      await expect(card.locator('[data-toast-more]')).toHaveCount(value.count > 3 ? 1 : 0);
      if (value.count > 3) await expect(card.getByText('+'+(value.count-3),{exact:true})).toBeVisible();
      if (!box) { await expect.poll(() => card.evaluate(node=>{ const t=getComputedStyle(node).transform; return t==="none"||new DOMMatrix(t).isIdentity; })).toBe(true); box = await card.boundingBox(); first = await pictures.first().elementHandle(); }
      else expect(await card.boundingBox()).toEqual(box);
      if (value.count<=24 && value.devices[0].id==='pad') expect(await first.evaluate(node=>node.isConnected)).toEqual(true);
      if (out && value.count===24) { await page.waitForTimeout(240); await page.screenshot({path:join(out,'余电-24台告急.png')}); }
      if (out) await page.waitForTimeout(1150);
    }
    const detail = card.getByRole('button',{name:'设备详情'});
    await detail.click();
    expect(await child.evaluate(()=>window.commands.at(-1))).toEqual({type:'open',id:'keys'});
    await page.evaluate(() => { document.querySelector('h1').textContent='最后一台开始充电'; document.querySelector('p').textContent='没有待处理的告急设备，整张卡收起。'; });
    await child.evaluate(() => window.mockToast(null));
    await expect(card).toHaveAttribute('data-toast-exiting','true');
    if (out) {
      await page.waitForTimeout(850);
      await cdp.send('Page.stopScreencast');
      let list=sequences.map((x,i)=>`file '${x.name}'\noption framerate 1000\nduration ${(i+1===sequences.length ? .8 : Math.max(.001,sequences[i+1].time-x.time)).toFixed(3)}`).join('\n');
      list += '\nfile '+sequences.at(-1).name+'\noption framerate 1000\n';
      writeFileSync(join(out,'frames.txt'),list);
      const ff=spawnSync('ffmpeg',['-y','-hide_banner','-loglevel','error','-f','concat','-safe','0','-i',join(out,'frames.txt'),
        '-vf','fps=60','-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-movflags','+faststart',join(out,'余电-告急弹窗实际渲染.mp4')],{encoding:'utf8'});
      if(ff.status!==0)throw Error(ff.error||ff.stderr);
    }
    await child.evaluate(value => window.mockToast(value),alert(art));
    await card.getByRole('button',{name:'待充电列表'}).click();
    expect(await child.evaluate(()=>window.commands.at(-1))).toEqual({type:'open',destination:'pendingCharge'});
    const main = await browser.newPage({ viewport: { width: 1250, height: 760 }, locale: 'zh-CN', reducedMotion: 'reduce' });
    await main.addInitScript(`(${installMock.toString()})({});powerManager.onNavigate = cb => { window.deliverRoute = cb; return () => {}; };`);
    await main.goto(entry.split('?')[0]);
    await main.evaluate(() => studioReview.ready());
    const destination = main.getByRole('heading',{name:/^待充电/});
    await main.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'总览'}).waitFor();
    await expect.poll(() => main.evaluate(() => typeof window.deliverRoute)).toBe('function');
    await main.evaluate(() => window.deliverRoute(':pending-charge'));
    await expect(destination).toBeFocused();
    expect(errors).toEqual([]);
    console.log('Grouped toast: 1 / 2 / 3 / +1 / +21, fixed bounds, stable image nodes, charging removal, both action destinations.');
  } finally { await browser.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
