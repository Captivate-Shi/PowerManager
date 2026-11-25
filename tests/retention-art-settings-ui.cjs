const { chromium, expect } = require('@playwright/test');
const { mkdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { installMock } = require('./studio-review-mock.cjs');
const entry = pathToFileURL(resolve(process.env.STUDIO_REVIEW_DIST || 'dist/ui/index.html')).href;
const out = process.env.RETENTION_REVIEW_OUT;
const button = (scope, name) => scope.getByRole('button', {name, exact:true});

async function main() {
  if (out) mkdirSync(out, { recursive:true });
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args:['--allow-file-access-from-files','--no-sandbox'] });
  try {
    for (const width of [1440, 900, 520]) {
      const page = await b.newPage({ viewport:{width,height: width > 900 ? 900 : width > 520 ? 670 : 430}, locale:'zh-CN', reducedMotion: width===520 ? 'reduce' : 'no-preference' });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      try {
        await page.addInitScript(installMock,{ historyDelay:125 });
        if(width===1440) await page.addInitScript(() => {
          const native = HTMLImageElement.prototype.decode;
          let release, released = false;
          window.releaseKeyboardArt = () => { released = true; release?.(); };
          HTMLImageElement.prototype.decode = function () {
            const ready = native.call(this);
            return !released && this.src.endsWith('keyboard-hero.webp') ?
              ready.then(() => new Promise(done => { release = done; window.keyboardArtWaiting = true; })) : ready;
          };
        });
        await page.goto(entry); await page.evaluate(() => studioReview.ready());
        const nav = page.getByRole('navigation',{name:'主导航'});
        const go = name => button(nav,name).click();
        if(width===1440) {
          const rail = page.getByRole('region',{name:'切换设备'});
          await button(rail,'列表模式').click();
          const active = page.locator('[data-list-art-layer]:not([data-exiting])');
          await expect(active).toHaveAttribute('data-device-id','dual');
          await expect(page.locator('[data-mode-hero]')).toHaveCount(0);
          await button(rail,'机械键盘').click();
          await expect.poll(() => page.evaluate(() => !!window.keyboardArtWaiting)).toBe(true);
          await page.waitForTimeout(300);
          await expect(active).toHaveAttribute('data-device-id','dual');
          await expect(active.locator('img')).toBeVisible();
          await page.evaluate(() => window.releaseKeyboardArt());
          await expect(active).toHaveAttribute('data-device-id','keyboard');
          await expect(page.locator('[data-list-art-layer][data-exiting]')).toHaveCount(0);
          const rapid = await page.evaluate(async () => {
            const rail = document.querySelector('[aria-label="切换设备"]');
            const click = name => rail.querySelector('button[title="'+name+'"]').click();
            const alpha = id => Number(getComputedStyle(document.querySelector('[data-list-art-layer][data-device-id="'+id+'"]')).opacity);
            click('DualSense'); await new Promise(r => setTimeout(r,78));
            const before = alpha('keyboard');
            click('机械键盘'); await new Promise(requestAnimationFrame);
            return { before, after:alpha('keyboard') };
          });
          expect(rapid.before).toBeGreaterThan(.55);
          expect(Math.abs(rapid.before - rapid.after)).toBeLessThan(.18);
          console.log('Artwork holds the last frame while decoding; rapid reversal opacity:', rapid);
        }

        await go('记录');
        const range = page.getByRole('combobox',{name:'记录范围'});
        await range.click(); await page.getByRole('option',{name:'365 天',exact:true}).click();
        await expect(range).toHaveText('365 天');
        await go('设置');
        const settings = page.locator('[data-page=settings]');
        const geometry = await settings.evaluate(el => {
          const bound = node => node.getBoundingClientRect();
          const box = bound(el), host = bound(el.parentElement);
          const appearance = bound(document.querySelector('#settings-appearance'));
          const settingsInput = bound(document.querySelector('#compat-context'));
          const controls = bound(document.querySelector('#settings-appearance form > div'));
          return { leftDelta:Math.abs(box.left-host.left), width:appearance.width,
            scroll:document.documentElement.scrollWidth, rightDelta:Math.abs(appearance.right-settingsInput.right),
            controlsDelta:Math.abs(controls.right-settingsInput.right) };
        });
        expect(geometry.leftDelta).toBeLessThan(2);
        expect(geometry.width).toBeLessThanOrEqual(654);
        expect(geometry.scroll).toBeLessThanOrEqual(width);
        expect(geometry.rightDelta).toBeLessThan(2);
        expect(geometry.controlsDelta).toBeLessThan(2);
        if(out) await page.screenshot({path:resolve(out,'设置-'+width+'.png')});
        const selector = page.getByRole('combobox',{name:'记录保留上限'});
        await expect(selector).toHaveText('365 天');
        const choose = async name => { await selector.click(); await page.getByRole('option',{name,exact:true}).click(); };
        await choose('7 天');
        const confirm = page.getByRole('dialog',{name:'缩短记录保留期限？'});
        await expect(confirm).toBeVisible();
        await expect(confirm).toContainText('无法恢复');
        if(out && width===1440) await page.screenshot({path:resolve(out,'缩短保留期限确认.png')});
        await button(confirm,'取消').click();
        await expect(selector).toHaveText('365 天');
        expect(await page.evaluate(() => studioReview.commands.filter(c => c.patch?.historyRetention).length)).toBe(0);
        await choose('7 天'); await button(confirm,'缩短并清理').click();
        await expect(selector).toHaveText('7 天');
        expect(await page.evaluate(() => studioReview.commands.some(c => c.patch?.historyRetention==='week' && c.confirmHistoryShorten))).toBe(true);
        await go('记录'); await expect(range).toHaveText('7 天');
        await expect(page.locator('[aria-label="电量对比记录"] [aria-busy]')).toHaveAttribute('aria-busy','false');
        const hint=button(page,'可查看范围说明');
        await hint.focus(); await expect(page.getByRole('tooltip')).toContainText('最多保留 7 天');
        if(out && width===1440) await page.screenshot({path:resolve(out,'记录上限说明.png')});
        await page.keyboard.press('Escape'); await expect(page.getByRole('tooltip')).toHaveCount(0);
        await range.press('Space');
        await expect(page.getByRole('option',{name:'30 天',exact:true})).toHaveAttribute('aria-disabled','true');
        await expect(page.getByRole('option',{name:'365 天',exact:true})).toHaveAttribute('aria-disabled','true');
        if(out && width===1440) await page.screenshot({path:resolve(out,'记录范围上限.png')});
        await page.keyboard.press('Escape'); await expect(range).toHaveText('7 天');
        await go('设置'); await choose('30 天');
        await expect(confirm).toHaveCount(0);
        await expect(selector).toHaveText('30 天');
        await go('记录'); await expect(range).toHaveText('7 天');
        await range.click(); await expect(page.getByRole('option',{name:'30 天',exact:true})).not.toHaveAttribute('aria-disabled','true');
        await expect(page.getByRole('option',{name:'365 天',exact:true})).toHaveAttribute('aria-disabled','true');
        expect(errors).toEqual([]);
        console.log(width, 'px: left category rail with a bounded reading column, cancel/confirm/extend, disabled choices and keyboard tip verified');
      } finally { await page.close(); }
    }
  } finally { await b.close(); }
}
main().catch(e => { console.error(e); process.exitCode=1; });
