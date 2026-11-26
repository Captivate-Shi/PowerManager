import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { defaults, severity, type Device, type Reading } from '../src/model';
import { Monitor } from '../src/monitor';
import { loadDeviceSettings, loadSettings, patchDeviceSettings, patchSettings } from '../src/settings-validation';

test('starting with critical:101 repairs only invalid global settings and does not flag a healthy sample', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pm-settings-'));
  const path = join(directory, 'monitor.json');
  let monitor: Monitor | undefined;
  try {
    const now = Date.now();
    const reading: Reading = { low: 80, high: 80, raw: 80, source: 'hid', power: 'discharging' };
    const device: Device = { id: 'mouse', name: 'test mouse', art: 'mouse', status: 'current',
      reason: '读数正常', connection: 'USB', watched: false, reading, lastRead: now };
    const custom = { ...defaults, low: 32, zoom: 125, startup: true, historyRetention: 'week' as const };
    writeFileSync(path, JSON.stringify({
      version: 1, settings: { ...custom, critical: 101 },
      devices: [device], watched: [], alerts: {}, deviceSettings: {
        mouse: { alias: '鼠标', low: 101, muted: false, migrationNote: { previous: 40 } },
        keyboard: { alias: '键盘', low: 44, muted: true },
      },
      history: { mouse: [{ time: now, reading }] }, historyDays: {},
    }));
    monitor = new Monitor(directory, join(directory, 'unused.exe'), () => {}, () => {});
    assert.deepEqual(monitor.state.settings, custom);
    assert.equal(severity(device, monitor.state.settings, monitor.state.deviceSettings.mouse), undefined);
    assert.equal(severity({ ...device, reading: { ...reading, low: 5, high: 5 } }, monitor.state.settings,
      monitor.state.deviceSettings.mouse), 'critical');
    assert.deepEqual(monitor.state.deviceSettings.mouse, {
      alias: '鼠标', muted: false, migrationNote: { previous: 40 },
    });
    assert.deepEqual(monitor.state.deviceSettings.keyboard, { alias: '键盘', low: 44, muted: true });
    assert.deepEqual(monitor.history('mouse'), [{ time: now, reading }]);
    monitor.close();
    monitor = undefined;
    const persisted = JSON.parse(readFileSync(path, 'utf8'));
    assert.deepEqual(persisted.settings, custom);
    assert.deepEqual(persisted.deviceSettings, {
      mouse: { alias: '鼠标', muted: false, migrationNote: { previous: 40 } },
      keyboard: { alias: '键盘', low: 44, muted: true },
    });
  } finally {
    monitor?.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test('load repairs threshold order without losing independently valid settings', () => {
  const projected = (settings: Record<string, unknown>) => {
    const { low, critical } = loadSettings(settings);
    return [low, critical];
  };
  assert.deepEqual(projected({ low: 6, critical: 20 }), [6, 5]);
  assert.deepEqual(projected({ low: 2, critical: 2 }), [2, 1]);
  assert.deepEqual(projected({ low: 1, critical: 30 }), [31, 30]);
  assert.deepEqual(projected({ low: 99, critical: 94 }), [95, 94]);
  assert.deepEqual(projected({ low: 95, critical: 94 }), [95, 94]);
  assert.deepEqual(projected({ low: 1, critical: 101 }), [defaults.low, defaults.critical]);
});

test('startup sanitization and the IPC patch use the same setting field validators', () => {
  for (const invalid of [
    { critical: 101 }, { low: '50' }, { repeat: -1 }, { snooze: 4 }, { zoom: 150.5 },
    { trayZoom: 151 }, { muteMinutes: 14 }, { historyRetention: 'forever' }, { desktopSound: 'true' },
  ]) {
    assert.deepEqual(loadSettings({ ...defaults, ...invalid }), defaults);
    assert.throws(() => patchSettings(defaults, invalid));
  }
  assert.throws(() => patchSettings(defaults, { low: 25, critical: 25 }), /告急阈值必须低于/);
  assert.throws(() => patchSettings(defaults, { historyRetention: 'week' }), /需要确认/);
  assert.deepEqual(patchSettings(defaults, { low: 2, critical: 1, historyRetention: 'week' }, true),
    { ...defaults, low: 2, critical: 1, historyRetention: 'week' });
  assert.equal(defaults.historyRetention, 'year');
});


test('device load and IPC share range, type, and trimmed Unicode alias rules', () => {
  const longest = '🖱'.repeat(50);
  const invalid = { low: 101, alias: longest + 'X', muted: 'false' };
  const loaded = loadDeviceSettings({
    invalid, valid: { alias: ' ' + longest + ' ', low: 50, muted: true, extra: [1, 2] },
    malformed: ['unusable'],
  });
  assert.deepEqual(loaded.invalid, {});
  assert.deepEqual(loaded.valid, { alias: longest, low: 50, muted: true, extra: [1, 2] });
  assert.equal(Object.hasOwn(loaded, 'malformed'), false);
  for (const [key, value] of Object.entries(invalid)) {
    assert.throws(() => patchDeviceSettings(loaded.valid, { [key]: value }));
  }
  assert.deepEqual(patchDeviceSettings(loaded.valid, { alias: ' ', low: null, muted: false }),
    { muted: false, extra: [1, 2] });
  assert.deepEqual(patchDeviceSettings(undefined, { alias: ' ' + longest + ' ', low: 1, muted: false }),
    { alias: longest, low: 1, muted: false });
  assert.equal(loaded.valid.low, 50);
});
