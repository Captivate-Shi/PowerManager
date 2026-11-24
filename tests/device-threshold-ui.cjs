// Against the actual compiled renderer; only preload/collector traffic is mocked.
const { chromium, expect } = require('@playwright/test');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { installMock } = require('./studio-review-mock.cjs');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH,
    args: ['--allow-file-access-from-files', '--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
    await page.addInitScript(installMock);
    await page.goto(pathToFileURL(resolve(process.env.THRESHOLD_UI_ENTRY || 'dist/ui/index.html')).href);
    await page.evaluate(() => window.studioReview.ready());
    await page.getByRole('region', { name: '主设备' }).getByRole('button', { name: '查看详情' }).click();
    await page.getByRole('button', { name: '调整提醒' }).click();
    const editor = page.getByRole('region', { name: '设备低电量阈值' });
    const slider = editor.getByRole('slider');
    const commands = () => page.evaluate(() => window.studioReview.commands.filter(command => command.type === 'deviceSettings'));
    await expect(slider).toHaveAttribute('max', '50');
    await expect(slider).toHaveValue('20');
    await slider.scrollIntoViewIfNeeded();
    const box = await slider.boundingBox();
    await page.mouse.move(box.x + box.width * .4, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .85, box.y + box.height / 2, { steps: 9 });
    await expect(editor.getByText('松开后保存')).toBeVisible();
    const choice = Number(await slider.inputValue());
    expect(choice).toBeGreaterThan(35);
    await page.waitForTimeout(325); // Outlasts the keyboard debounce.
    expect(await commands()).toEqual([]);
    if (process.env.THRESHOLD_UI_CAPTURE) await page.screenshot({ path: process.env.THRESHOLD_UI_CAPTURE });
    await page.mouse.up();
    await expect.poll(commands).toEqual([{ type: 'deviceSettings', id: 'dual', patch: { low: choice } }]);
    await expect(editor.getByText('已保存 · 下次巡检生效')).toBeVisible();
    // Saving switches from the global-provenance line to device-specific state and can move the input.
    await slider.scrollIntoViewIfNeeded();
    const savedBox = await slider.boundingBox();
    await page.mouse.move(savedBox.x + savedBox.width * .25, savedBox.y + savedBox.height / 2);
    await page.mouse.down();
    await expect(editor.getByText('松开后保存')).toBeVisible();
    await slider.dispatchEvent('pointercancel', { pointerId: 1 });
    await expect(slider).toHaveValue(String(choice));
    await page.mouse.up();
    expect((await commands()).length).toBe(1);
    await editor.getByRole('button', { name: '5%', exact: true }).click();
    await expect.poll(commands).toHaveLength(2);
    await slider.focus();
    await slider.press('ArrowRight');
    await slider.press('ArrowRight');
    await expect.poll(commands).toHaveLength(3);
    expect((await commands()).at(-1).patch.low).toBe(7);
    await editor.getByRole('button', { name: '恢复全局阈值' }).click();
    await expect.poll(commands).toHaveLength(4);
    await expect(slider).toHaveValue('20');
    const settingsCommands = () => page.evaluate(() => window.studioReview.commands.filter(command => command.type === 'settings'));
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '设置', exact: true }).click();
    const zoomSlider = page.getByRole('slider', { name: '主界面缩放滑块' });
    const zoomForm = zoomSlider.locator('xpath=ancestor::form');
    const zoomMarks = zoomForm.getByRole('group', { name: '主界面快捷缩放' });
    await expect(zoomMarks.getByRole('button')).toHaveCount(4);
    await zoomMarks.getByRole('button', { name: '125%', exact: true }).click();
    await expect(zoomSlider).toHaveValue('125');
    await expect(zoomForm.getByRole('spinbutton')).toHaveValue('125');
    await zoomSlider.focus();
    await zoomSlider.press('ArrowRight');
    await expect(zoomSlider).toHaveValue('126');
    expect(await settingsCommands()).toEqual([]);
    await zoomForm.getByRole('button', { name: '应用', exact: true }).click();
    await expect.poll(settingsCommands).toEqual([{ type: 'settings', patch: { zoom: 126 } }]);
    await zoomForm.getByRole('button', { name: '主界面恢复 100%' }).click();
    await expect.poll(settingsCommands).toEqual([{ type: 'settings', patch: { zoom: 126 } }, { type: 'settings', patch: { zoom: 100 } }]);
    await expect(zoomSlider).toHaveValue('100');
    console.log('Threshold: hold/release/cancel, keyboard debounce, preset, restore. Zoom: preset/keyboard without writes until Apply; reset.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
