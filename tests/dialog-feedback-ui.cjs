const { chromium, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');
const { mkdirSync } = require('node:fs');

const url = pathToFileURL(resolve(process.env.DIALOG_REVIEW_DIST || 'dist/ui/index.html')).href;
const button = (scope, name) => scope.getByRole('button', { name, exact: true });
const output = process.env.DIALOG_REVIEW_OUT;

(async () => {
  if (output) mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--allow-file-access-from-files', '--no-sandbox'] });
  try {
    for (const width of [1250, 720]) {
      const page = await browser.newPage({ viewport: { width, height: width > 720 ? 760 : 520 }, locale: 'zh-CN', reducedMotion: 'reduce' });
      try {
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.addInitScript(() => {
          const counts = {};
          const reading = { low: 30, high: 30, raw: 30, power: 'unknown', source: 'ble' };
          const state = {
            collector: 'ready', demo: false, refreshing: false, mutedUntil: 0, deviceSettings: {}, alerts: {},
            devices: [{ id: 'one', name: '蓝牙鼠标', connection: '蓝牙', art: 'mouse', status: 'current', reason: '已连接',
              reading, lastRead: Date.now(), watched: true }],
            settings: { low: 20, critical: 10, repeat: 0, snooze: 30, fullscreenSound: true, desktopSound: false,
              voltage: false, startup: false, zoom: 100, trayZoom: 100, desktopToasts: true, muteMinutes: 60, historyRetention: 'year' },
          };
          let notify = () => {};
          window.powerManager = {
            snapshot: async () => structuredClone(state),
            toast: async () => null, onSnapshot: fn => { notify = fn; return () => {}; }, onNavigate: () => () => {},
            command: async command => {
              const count = counts[command.type] = (counts[command.type] ?? 0) + 1;
              if (command.type === 'discover') {
                await new Promise(resolve => setTimeout(resolve, 300));
                if (count === 1) return { ok: false, error: '扫描设备失败，请重新扫描。' };
                return { ok: true, found: [{ id: 'two', name: '新接入外设', connection: '蓝牙', connected: true, reading },
                  { id: 'headset', name: '未读到电量的耳机', connection: '蓝牙', connected: true, automatic: true, reading: null },
                  { id: 'with-battery', name: '等待首次采集的耳机', connection: '蓝牙', connected: true, automatic: true, reading },
                  { id: 'one', name: '蓝牙鼠标', connection: '蓝牙', connected: false, automatic: true, reading: null }] };
              }
              if (command.type === 'add') {
                if (count === 1) return { ok: false, error: '暂时无法添加设备。' };
                window.publishAddedDevice = () => {
                  state.devices.push({ ...state.devices[0], id: 'two', name: '新接入外设' });
                  notify(structuredClone(state));
                };
                return { ok: true };
              }
              if (command.type === 'diagnosticDevices') {
                if (count === 1) return { ok: false, error: '采集程序尚未就绪，请稍后重新扫描。' };
                if (count === 2) return { ok: false, error: '扫描设备失败，请重新扫描。' };
                if (count === 3) return { ok: true, diagnosticDevices: null };
                return { ok: true, diagnosticDevices: [] };
              }
              if (command.type === 'remove') {
                if (count === 1) return { ok: false, error: '未能停止监测。' };
                state.devices = [];
                notify(structuredClone(state));
              }
              return { ok: true };
            },
          };
        });
        await page.goto(url);
        await button(page, '设备').click();
        await button(page, '查找设备').click();
        const find = page.getByRole('dialog', { name: '查找设备' });
        const close = button(find, '关闭对话框');
        await expect(find.getByRole('status')).toHaveText('正在扫描 Windows 设备…');
        const anchor = await close.boundingBox();
        await expect(find.getByRole('alert')).toHaveText('扫描设备失败，请重新扫描。');
        expect(await close.boundingBox()).toEqual(anchor);
        await expect(page.getByText('扫描设备失败，请重新扫描。', { exact: true })).toHaveCount(1);
        await button(find, '重新扫描').click();
        await expect(find.getByText('蓝牙 · 已加入监测', { exact: true })).toHaveCount(1);
        await expect(find.getByText('蓝牙 · 暂未读到电量', { exact: true })).toBeVisible();
        await expect(find.getByText('蓝牙 · 等待首次采集', { exact: true })).toHaveCount(1);
        expect(await close.boundingBox()).toEqual(anchor);
        await button(find, '添加到监测').click();
        await expect(find.getByRole('alert')).toHaveText('暂时无法添加设备。');
        await expect(page.getByText('暂时无法添加设备。', { exact: true })).toHaveCount(1);
        if (output && width === 1250) await page.screenshot({ path: resolve(output, '余电-添加失败可重试.png') });
        await button(find, '重试添加').click();
        await expect(find.getByText('蓝牙 · 等待首次采集', { exact: true })).toHaveCount(2);
        await expect(find.getByText('蓝牙 · 已加入监测', { exact: true })).toHaveCount(1);
        await page.evaluate(() => window.publishAddedDevice());
        await expect(find.getByText('蓝牙 · 已加入监测', { exact: true })).toHaveCount(2);
        await expect(find.getByText(/已加入监测 · (?:未|已)连接/)).toHaveCount(0);
        await expect(find.getByRole('alert')).toHaveCount(0);
        await page.keyboard.press('Escape');

        await button(page, '设置').click();
        await button(page.getByRole('navigation', { name: '设置分类' }), '诊断').click();
        await button(page, '导出兼容性报告').click();
        const diag = page.getByRole('dialog', { name: '导出兼容性报告' });
        const combo = diag.getByRole('combobox', { name: '设备型号' });
        for (const message of ['采集程序尚未就绪，请稍后重新扫描。', '扫描设备失败，请重新扫描。', '未收到设备列表，请重新扫描。']) {
          await expect(diag.getByRole('alert')).toHaveText(message);
          await expect(page.getByText(message, { exact: true })).toHaveCount(1);
          await expect(combo).toBeDisabled();
          await expect(diag.getByText(/未识别到可选设备/)).toHaveCount(0);
          if (output && width === 1250 && message.startsWith('采集')) await page.screenshot({ path: resolve(output, '余电-诊断扫描失败.png') });
          await button(diag, '重新扫描').click();
        }
        await expect(combo).toBeEnabled();
        await expect(diag.getByText(/未识别到可选设备/)).toBeVisible();
        await combo.selectOption('manual');
        await expect(diag.getByRole('textbox', { name: '填写设备型号' })).toBeVisible();
        await page.keyboard.press('Escape');

        await button(page, '设备').click();
        const more = button(page.getByRole('region', { name: '设备预览' }), '更多操作');
        const remove = page.getByRole('dialog', { name: '停止监测设备？' });
        const openRemove = async () => {
          await more.focus();
          await page.keyboard.press('Enter');
          await page.getByRole('menuitem', { name: '停止监测' }).press('Enter');
          await expect(button(remove, '取消')).toBeFocused();
        };
        await openRemove();
        if (output && width === 1250) await page.screenshot({ path: resolve(output, '余电-停止监测确认.png') });
        await page.keyboard.press('Escape');
        await expect(more).toBeFocused();
        await openRemove();
        await button(remove, '取消').click();
        await expect(more).toBeFocused();
        await openRemove();
        await button(remove, '停止监测').click();
        await expect(remove.getByRole('alert')).toHaveText('未能停止监测。');
        await expect(page.getByText('未能停止监测。', { exact: true })).toHaveCount(1);
        await button(remove, '停止监测').click();
        await expect(remove).toHaveCount(0);
        await expect(page.getByRole('main')).toBeFocused();
        expect(errors).toEqual([]);
        console.log(`${width}px: discovery scan and add retry, diagnosis readiness/failure/malformed/empty states, stop cancellation and focus restoration passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
