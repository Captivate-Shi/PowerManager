const { chromium, expect } = require('@playwright/test');
const { mkdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { installMock } = require('./studio-review-mock.cjs');
const entry = pathToFileURL(resolve(process.env.STUDIO_REVIEW_DIST || 'dist/ui/index.html')).href;
const out = process.env.SETTINGS_REVIEW_OUT;

(async () => {
  if (out) mkdirSync(out,{recursive:true});
  const browser = await chromium.launch({ executablePath:process.env.CHROMIUM_PATH, args:['--allow-file-access-from-files','--no-sandbox'] });
  try {
    for (const width of [1440, 900, 520]) {
      const page = await browser.newPage({ viewport:{width,height:width===520?430:900}, locale:'zh-CN',
        reducedMotion:width === 520 ? 'reduce' : 'no-preference' });
      try {
        await page.addInitScript(installMock,{});
        await page.goto(entry);
        await page.evaluate(() => studioReview.ready());
        await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'设置',exact:true}).click();
        const geometry = await page.locator('[data-page=settings]').evaluate(settings => {
          const center = el => { const b=el.getBoundingClientRect(); return (b.top + b.bottom) / 2; };
          const offset = (a,b) => Math.abs(center(a)-center(b));
          const rows = [...settings.querySelectorAll('[data-setting-row]')].map(row =>
            offset(row.querySelector('[data-setting-label]'),row.querySelector('[data-setting-control]')));
          const zooms = [...settings.querySelectorAll('#settings-appearance form')].map(row => {
            const slider = row.querySelector('[data-detent-rail]');
            const percentage = row.querySelector('input[type=number]');
            return { control: offset(slider, percentage),
              button: offset(slider,row.querySelector('button[type=submit]')),
              label: offset(slider,row.querySelector('label')),
              stacked: row.querySelector('label').getBoundingClientRect().bottom < slider.getBoundingClientRect().top };
          });
          const palette = settings.querySelector('[aria-label="配色"]');
          const swatches = [...palette.querySelectorAll('label')];
          const compatibilityButton = settings.querySelector('[data-compat-report]');
          return { rows, zooms, swatch:Math.max(...swatches.map(s => offset(s,swatches[0]))),
            paletteDesktop:offset(palette.querySelector(':scope > span'),swatches[0]),
            diagnostics: offset(compatibilityButton.closest('[data-setting-row]').querySelector('[data-setting-label]'), compatibilityButton),
            overflow:document.documentElement.scrollWidth - innerWidth };
        });
        expect(geometry.rows).toHaveLength(6);
        expect(Math.max(...geometry.rows)).toBeLessThan(1);
        expect(geometry.zooms).toHaveLength(2);
        for (const zoom of geometry.zooms) {
          expect(zoom.control).toBeLessThan(1);
          expect(zoom.button).toBeLessThan(1);
          if (width > 660) expect(zoom.label).toBeLessThan(1);
          else expect(zoom.stacked).toBe(true);
        }
        expect(geometry.swatch).toBeLessThan(1);
        if(width > 660) {
          expect(geometry.paletteDesktop).toBeLessThan(1);
          expect(geometry.diagnostics).toBeLessThan(1);
        }
        expect(geometry.overflow).toBeLessThanOrEqual(0);
        if(out) await page.screenshot({path:resolve(out,'设置逐行对齐-'+width+'.png')});
        const retention = page.getByRole('combobox',{name:'记录保留上限'});
        await expect(retention).toHaveText('365 天');
        await retention.press('Enter');
        for(const [name, estimate] of [['24 小时','836'],['7 天','837'],['30 天','841'],['365 天','905']]){
          const option=page.getByRole('option',{name,exact:true});
          await expect(option).toBeVisible();
          await expect(option).toHaveAccessibleDescription('预计 ≤ '+estimate+' KB/台');
        }
        if(out && width === 1440) await page.screenshot({path:resolve(out,'各档存储估算.png')});
        await page.keyboard.press('Escape');
        await expect(retention).toBeFocused();
        await expect(retention).toHaveText('365 天');
        console.log(width+' px: '+JSON.stringify(geometry));
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode=1; });
