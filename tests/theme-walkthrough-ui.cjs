// Verify real renderer colors and keyboard focus on default body portals.
const { chromium, expect } = require('@playwright/test');
const { installMock } = require('./studio-review-mock.cjs');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');
const entry = pathToFileURL(resolve('dist/ui/index.html')).href;
const button = (scope, name) => scope.getByRole('button', { name, exact: true });
const css = (node,key) => node.evaluate((el,key) => getComputedStyle(el).getPropertyValue(key),key);
const rgb = hex => 'rgb(' + [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)).join(', ') + ')';

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  try {
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', reducedMotion: 'reduce' });
    await p.addInitScript(installMock, { portable: true });
    await p.goto(entry);
    await p.evaluate(() => studioReview.ready());
    const nav = p.getByRole('navigation', { name: '主导航' }), root = p.locator('html');
    const go = name => button(nav,name).click();
    for (const [id,label,raised] of [['graphite','石墨白','#1d222c'],['ice','冰蓝灰','#1c2a3b'],['warm','暖钛灰','#2b251f']]) {
      const overlay = async (pop, portal = true) => {
        await expect(pop).toBeVisible();
        expect(await css(pop,'background-color')).toBe(rgb(raised));
        expect(await css(pop,'color')).toBe(await css(root,'color'));
        if (portal) expect(await pop.evaluate(el => !el.closest('[data-view]'))).toBe(true);
      };
      await go('设置');
      await p.getByRole('radio',{name:label}).check();
      await expect(root).toHaveAttribute('data-main-theme',id);
      const tip = button(p,'开机启动说明');
      await tip.focus(); await overlay(p.getByRole('tooltip'),false); await p.keyboard.press('Escape');
      const retain = p.getByRole('combobox',{name:'记录保留上限'});
      await retain.focus(); await retain.press('Enter');
      const list = p.getByRole('listbox'); await overlay(list);
      await p.keyboard.press('ArrowUp');
      expect(await css(list.locator('[data-highlighted]'),'background-color')).not.toBe(rgb(raised));
      await p.keyboard.press('Escape'); await expect(retain).toBeFocused();
      await retain.click(); await p.getByRole('option',{name:'7 天',exact:true}).click();
      await overlay(p.getByRole('dialog')); await p.keyboard.press('Escape'); await expect(retain).toBeFocused();
      await go('记录');const add=button(p,'对比设备');await add.focus();await add.press('Enter');
      await overlay(p.getByRole('menu',{name:'对比设备'}));await p.keyboard.press('Escape');await expect(add).toBeFocused();
      await go('设备');const search=p.getByRole('searchbox',{name:'搜索设备'});await search.focus();
      expect(await css(search.locator('..'),'outline-color')).toBe(rgb((await css(root,'--focus-ring')).trim()));
      await go('提醒');
      const queue=p.getByRole('region',{name:'待充电'});
      const alert = queue.getByText('9%',{exact:true}).first();
      expect(await css(alert,'color')).toBe(rgb('#ff9d96'));
      await go('总览');
      const hero=p.getByRole('region',{name:'主设备',exact:true});
      await expect(hero.getByText('低电量',{exact:true})).toBeVisible();
      expect(await css(hero.getByText('低电量',{exact:true}),'color')).toBe(rgb('#efb76c'));
    }
    for (const surface of ['tray','toast']) {
      await p.goto(entry + '?surface=' + surface + '&kind=critical&device=headset');
      await p.evaluate(() => studioReview.ready());
      if (surface === 'tray') {
        const badge=p.locator('[data-tray-device="headset"] strong');
        await expect(badge).toBeVisible();expect(await css(badge,'color')).toBe(rgb('#ff9d96'));
      } else {
        const toast=p.getByRole('main',{name:'桌面电量提醒'});
        await expect(toast).toBeVisible();expect((await css(toast,'--toast-accent')).trim()).toBe('#ff9d96');
      }
    }
    console.log('Five tabs, three palettes, popovers, keyboard focus, and main/tray/toast battery colors passed.');
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
