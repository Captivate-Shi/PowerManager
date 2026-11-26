const { chromium, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');
const { mkdirSync } = require('node:fs');

const url = pathToFileURL(resolve(process.env.COMPATIBILITY_REVIEW_DIST || 'dist/ui/index.html')).href;
const widthList = [1440, 520];
const output = process.env.COMPATIBILITY_REVIEW_OUT;
const button = (scope, name) => scope.getByRole('button', { name, exact: true });

(async () => {
  if (output) mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--allow-file-access-from-files', '--no-sandbox'] });
  try {
    for (const width of widthList) {
      const p = await browser.newPage({ viewport: { width, height: width > 520 ? 860 : 490 }, locale: 'zh-CN', reducedMotion: 'reduce' });
      try {
        const errors = [];
        p.on('pageerror', e => errors.push(e.message));
        await p.addInitScript(() => {
          const commands = window.commands = [];
          const previews = [];
          const state = {
            collector: 'ready', demo: false, refreshing: false, mutedUntil: 0, deviceSettings: {}, alerts: {},
            devices: [{ id: 'one', name: '蓝牙鼠标', connection: '蓝牙', art: 'mouse', status: 'current', reason: '',
              reading: { low: 30, high: 30, raw: 30, power: 'unknown', source: 'ble' }, lastRead: Date.now(), watched: true }],
            settings: { low: 20, critical: 10, repeat: 0, snooze: 30, fullscreenSound: true, desktopSound: false, voltage: false,
              startup: false, zoom: 100, trayZoom: 100, desktopToasts: true, muteMinutes: 60, historyRetention: 'year' },
          };
          window.powerManager = {
            snapshot: async () => structuredClone(state),
            toast: async () => null, onSnapshot: () => () => {}, onNavigate: () => () => {},
            command: async command => {
              commands.push(command);
              if (command.type === 'diagnosticDevices') return { ok: true, diagnosticDevices: [
                { key: 'recognized', model: 'MX Keys Mini', firmwareReadable: true, connection: '蓝牙', connected: true },
                { key: 'generic', label: '无线游戏手柄', connection: 'USB', connected: true },
              ] };
              if (command.type === 'diagnosticFirmware') {
                const calls = commands.filter(c => c.type === 'diagnosticFirmware');
                return { ok: true, diagnosticFirmware: calls.length === 1 ? { status: 'pending' } : { status: 'ready', firmware: '2.0' } };
              }
              if (command.type === 'compatibility' && 'selection' in command) {
                const token = 'report-' + (previews.length + 1);
                previews.push(token);
                return { ok: true, compatibility: { token, json: JSON.stringify({ reasonCode: 'ble_no_service',
                  model: command.selection.model || 'MX Keys Mini', firmware: command.selection.firmware || '2.0' }) } };
              }
              if (command.type === 'compatibility') return command.reportToken === previews.at(-1)
                ? { ok: true, message: '兼容性报告已保存，可在诊断目录查看' } : { ok: false, error: '保存失败' };
              if (command.type === 'discover') return { ok: true, found: [
                { id: 'bas', name: '待验证蓝牙键盘', connection: '蓝牙', connected: true, reading: null, batteryCandidate: 'ble_bas' },
                { id: 'none', name: '普通 USB 键盘', connection: 'USB', connected: true, reading: null },
              ] };
              return { ok: true };
            },
          };
        });
        await p.goto(url);
        await button(p, '设置').click();
        await button(p.getByRole('navigation',{name:'设置分类'}), '诊断').click();
        const trigger = button(p, '生成兼容性报告');
        expect(await p.evaluate(() => window.commands.some(c => c.type === 'diagnosticDevices'))).toBe(false);
        await expect(p.getByRole('textbox', { name: /兼容性反馈说明|填写设备型号/ })).toHaveCount(0);
        await trigger.click();
        const selectDialog = p.getByRole('dialog', { name: '选择要诊断的设备' });
        const combo = selectDialog.getByRole('combobox', { name: '设备型号' });
        await expect(combo).toBeEnabled();
        await combo.selectOption('recognized');
        await expect(selectDialog.getByRole('textbox', { name: '填写设备型号' })).toHaveCount(0);
        await expect(selectDialog.getByRole('textbox', { name: /固件版本/ })).toHaveCount(0);
        await button(selectDialog, '读取固件版本').click();
        await expect(selectDialog.getByLabel('已识别固件版本')).toHaveText('2.0');
        await expect(selectDialog.getByRole('textbox', { name: /固件版本/ })).toHaveCount(0);
        if (output) await p.screenshot({ path: resolve(output, `识别到的外设和固件-${width}.png`) });
        await button(selectDialog, '预览兼容性报告').click();
        const dialog = p.getByRole('dialog', { name: '兼容性报告预览' });
        await expect(dialog.getByLabel('兼容性报告内容')).toContainText('MX Keys Mini');
        await expect(dialog.getByLabel('兼容性报告内容')).toContainText('2.0');
        await expect(dialog).toContainText('不会自动发送');
        await button(dialog, '返回').click();
        await expect(dialog).toHaveCount(0);
        expect(await p.evaluate(() => window.commands.filter(c => c.reportToken))).toHaveLength(0);
        await combo.selectOption('generic');
        await expect(selectDialog.getByRole('textbox', { name: '填写设备型号' })).toBeVisible();
        await expect(button(selectDialog, '预览兼容性报告')).toBeDisabled();
        await combo.selectOption('manual');
        await selectDialog.getByRole('textbox', { name: '填写设备型号' }).fill('未列出的外设');
        await selectDialog.getByRole('textbox', { name: /固件版本/ }).fill('0.7');
        await button(selectDialog, '预览兼容性报告').click();
        await expect(dialog.getByLabel('兼容性报告内容')).toContainText('未列出的外设');
        await button(dialog, '保存到本地').click();
        await expect(dialog).toHaveCount(0);
        await expect(trigger).toBeFocused();
        await expect(p.getByText('兼容性报告已保存，可在诊断目录查看')).toBeVisible();
        const commands = await p.evaluate(() => window.commands.filter(c => c.type === 'compatibility'));
        expect(commands).toMatchObject([{ selection: { kind:'device', deviceKey:'recognized' } },
          { selection: { kind:'manual', model:'未列出的外设', firmware:'0.7' } }, { reportToken:'report-2' }]);
        await button(p, '设备').click();
        await expect(p.getByText('蓝牙电池服务', { exact: true })).toBeVisible();
        await button(p, '查找设备').click();
        const discover = p.getByRole('dialog', { name: '查找设备' });
        await expect(discover.getByText(/可尝试读取蓝牙电量/)).toBeVisible();
        await expect(discover.getByText(/Windows 暂无可用电量/)).toBeVisible();
        await expect(button(discover, '添加到监测')).toHaveCount(1);
        await button(discover, '添加到监测').click();
        expect(await p.evaluate(() => window.commands.find(c => c.type === 'add'))).toEqual({ type: 'add', id: 'bas' });
        expect(errors).toEqual([]);
      } finally { await p.close(); }
      console.log(`${width}px: recognized device/firmware, manual fallback, confirmation-only save, BAS source, candidate-only monitoring passed`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
