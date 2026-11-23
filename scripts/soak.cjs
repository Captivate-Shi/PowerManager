const assert = require('node:assert/strict');
const { cpSync, mkdirSync, mkdtempSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { _electron, expect } = require('@playwright/test');
const { summary, readSamples } = require('./summarize-metrics.cjs');

const root = join(__dirname, '..');
const out = join(root, 'qa', 'performance');
const profiles = join(root, 'qa', '.profiles');
const seconds = process.argv[2] === undefined ? 300 : Number(process.argv[2]);
if (!Number.isInteger(seconds) || seconds < 60 || seconds > 86400) throw new Error('Use a duration of 60 to 86400 seconds.');
mkdirSync(out, { recursive: true });
mkdirSync(profiles, { recursive: true });
const profile = mkdtempSync(join(profiles, 'soak-'));
const version = require('../package.json').version;
const executable = join(root, 'out', version, 'PowerManager-H5-win32-x64', 'PowerManager-H5.exe');

async function run() {
  const started = Date.now();
  const app = await _electron.launch({ executablePath: executable, cwd: root, args: [],
    env: { ...process.env, LOCALAPPDATA: profile, POWER_MANAGER_METRICS_INTERVAL_MS: seconds >= 600 ? '60000' : '10000',
      POWER_MANAGER_DISABLE_METRICS: '0' } });
  const file = join(profile, 'PowerManager-H5', 'metrics.jsonl');
  let devices;
  try {
    const main = await app.firstWindow();
    await expect.poll(() => main.evaluate(async () => (await window.powerManager.snapshot()).collector),
      { timeout: 20000 }).toBe('ready');
    devices = await main.evaluate(async () => (await window.powerManager.snapshot()).devices.map(
      item => ({ name: item.name, status: item.status, hasReading: !!item.reading })));
    await main.getByRole('button', { name: '立即刷新', exact: true }).click();
    await main.getByRole('button', { name: '设备', exact: true }).click();
    await main.getByRole('heading', { name: '设备管理', level: 1 }).waitFor();
    await main.getByRole('button', { name: '提醒', exact: true }).click();
    await main.getByRole('heading', { name: '低电量提醒', level: 1 }).waitFor();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
    console.log('Tray soak started, duration ' + seconds + ' seconds. ' + JSON.stringify(devices));
    await delay(Math.max(0, seconds * 1000 - (Date.now() - started)));
    const result = summary(readSamples(file));
    assert.ok(result.sampleCount >= 3);
    assert.ok(result.pollCount > 0);
    assert.equal(result.collectorExits, 0);
    assert.ok(result.backgroundCpu.intervals >= 2);
    cpSync(file, join(out, 'metrics-run.jsonl'));
    writeFileSync(join(out, 'report.json'), JSON.stringify({ ...result, devices }, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
