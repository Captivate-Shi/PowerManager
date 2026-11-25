const { chromium, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--allow-file-access-from-files', '--no-sandbox'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 860 }, locale: 'zh-CN', reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      const state = {
        collector: 'ready', demo: false, refreshing: false, mutedUntil: 0, deviceSettings: {}, alerts: {},
        devices: [{
          id: 'dualsense-fixture', name: 'DualSense', connection: '蓝牙', art: 'dualsense',
          status: 'basic_bluetooth', reason: '蓝牙当前未提供电量', reading: null, lastRead: null, watched: false,
        }],
        settings: {
          low: 20, critical: 10, repeat: 0, snooze: 30, fullscreenSound: true, soundOnly: false, voltage: false,
          startup: false, zoom: 100, trayZoom: 100, desktopToasts: true, muteMinutes: 60, historyRetention: 'year',
        },
      };
      let subscriber;
      const publish = (status, source) => {
        const reading = status === 'current' ? {
          low: 50, high: source === 'hid' ? 60 : 50, raw: source === 'hid' ? 5 : 50,
          power: 'charging', source,
        } : null;
        Object.assign(state.devices[0], { status, reading, lastRead: reading ? Date.now() : null,
          reason: reading ? '当前读数' : '蓝牙当前未提供电量' });
        subscriber?.(structuredClone(state));
      };
      const commands = window.commands = [];
      window.nextPassiveSample = publish;
      window.powerManager = {
        snapshot: async () => structuredClone(state),
        toast: async () => null,
        onSnapshot(callback) { subscriber = callback; return () => {}; },
        onNavigate: () => () => {},
        command: async command => {
          commands.push(command);
          if (command.type === 'history') return { ok: true, history: [] };
          if (command.type === 'refresh') publish('current', 'windows');
          return { ok: true };
        },
      };
    });
    await page.goto(pathToFileURL(resolve('dist/ui/index.html')).href);
    const noModeControl = () => expect(page.getByRole('button', { name: /读取蓝牙电量|蓝牙监控|蓝牙增强/ })).toHaveCount(0);
    await page.getByRole('button', { name: '设备', exact: true }).click();
    const preview = page.getByRole('region', { name: '设备预览' });
    await expect(preview.getByText('蓝牙当前未提供电量')).toBeVisible();
    await noModeControl();
    await preview.getByRole('button', { name: '查看详情' }).click();
    const detail = page.getByRole('region', { name: '设备详情' });
    await expect(detail.getByRole('definition').filter({ hasText: '蓝牙当前未提供电量' })).toBeVisible();
    await noModeControl();
    await detail.getByRole('button', { name: '更多操作' }).click();
    await page.getByRole('menuitem', { name: '立即刷新' }).click();
    await expect(detail.getByText('Windows 电量属性')).toBeVisible();
    await page.evaluate(() => window.nextPassiveSample('current', 'hid'));
    await expect(detail.getByText('设备 HID')).toBeVisible();
    await noModeControl();
    expect(await page.evaluate(() => window.commands.filter(c => c.type !== 'history').map(c => c.type))).toEqual(['refresh']);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
