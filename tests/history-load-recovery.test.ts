import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { defaults, type Device, type Reading } from '../src/model';
import { Monitor } from '../src/monitor';

const reading: Reading = { low: 25, high: 25, raw: 25, power: 'discharging', source: 'hid' };

function fixture() {
  const path = mkdtempSync(join(tmpdir(), 'power-history-recovery-'));
  const file = join(path, 'monitor.json');
  const open = () => new Monitor(path, join(path, 'unused-collector.exe'), () => {}, () => {});
  return { path, file, open };
}

test('one bad device history cannot drop another device, its settings or alerts; recovery commits only once', () => {
  const { path, file, open } = fixture();
  const time = Date.now() - 6000;
  const point = { time, reading };
  const device: Device = { id: 'mouse', name: '原名', connection: 'USB', art: 'mouse', status: 'current',
    reason: '', reading, lastRead: time, watched: false };
  const original = JSON.stringify({ version: 1, devices: [device], watched: [], settings: { ...defaults, low: 45 },
    deviceSettings: { mouse: { alias: '鼠标', low: 30 } }, alerts: { mouse: { ignored: 'low' } },
    history: { broken: { oops: true }, mouse: [point, null] } });
  try {
    writeFileSync(file, original);
    const restored = open();
    assert.match(restored.state.error ?? '', /部分电量历史/);
    assert.equal(restored.state.settings.low, 45);
    assert.equal(restored.state.devices[0]?.name, '鼠标');
    assert.equal(restored.state.devices[0]?.status, 'stale');
    assert.equal(restored.state.deviceSettings.mouse?.low, 30);
    assert.equal(restored.state.alerts.mouse?.ignored, 'low');
    assert.deepEqual(restored.history('mouse'), [point]);
    assert.deepEqual(restored.history('broken'), []);
    assert.equal(restored.historySummary('mouse', 'week')[0]?.count, 1);
    const backups = () => readdirSync(path).filter(name => name.startsWith('monitor-repair-'));
    assert.equal(backups().length, 1);
    assert.equal(readFileSync(join(path, backups()[0]!), 'utf8'), original);

    const reopened = open();
    assert.equal(reopened.state.error, undefined);
    assert.equal(backups().length, 1);
    assert.equal(reopened.historySummary('mouse', 'week')[0]?.count, 1);
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});

test('a malformed daily bucket is rebuilt from raw data without duplicating valid summaries', () => {
  const { path, file, open } = fixture();
  const time = Date.now() - 6000;
  const midnight = new Date(time);
  midnight.setHours(0, 0, 0, 0);
  const point = { time, reading };
  const bucket = { day: midnight.getTime(), lowest: point, count: 7 };
  try {
    writeFileSync(file, JSON.stringify({ version: 1, devices: [], watched: [], settings: defaults, deviceSettings: {}, alerts: {},
      history: { first: [point], second: [point] },
      historyDays: { first: [bucket, null], second: [{ day: bucket.day, lowest: null, count: 1 }], lost: 'oops' } }));
    const restored = open();
    assert.deepEqual(restored.historySummary('first', 'week'), [bucket]);
    assert.deepEqual(restored.historySummary('second', 'week'), [{ ...bucket, count: 1 }]);
    assert.deepEqual(restored.historySummary('lost', 'week'), []);
    assert.doesNotThrow(() => restored.persist());
    assert.equal(restored.persist(), true);
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});

test('a clean legacy history is summarized and migrated on disk without a corruption warning', () => {
  const { path, file, open } = fixture();
  const point = { time: Date.now() - 1000, reading };
  try {
    writeFileSync(file, JSON.stringify({ version: 1, devices: [], watched: [], settings: defaults, deviceSettings: {}, alerts: {},
      history: { mouse: [point] } }));
    const restored = open();
    assert.equal(restored.state.error, undefined);
    assert.equal(restored.historySummary('mouse', 'week')[0]?.count, 1);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).historyDays.mouse[0].count, 1);
    assert.equal(open().historySummary('mouse', 'week')[0]?.count, 1);
    assert.equal(readdirSync(path).some(name => name.startsWith('monitor-repair-')), false);
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});

test('malformed watched entries are removed once without changing valid stored fields', () => {
  const { path, file, open } = fixture();
  const watched = [
    { id: 'mouse', name: 'Mouse', connection: 'USB', extra: { keep: true } },
    { id: 'headset', name: 'Headset', connection: '蓝牙' },
  ];
  const original = JSON.stringify({ version: 1, devices: [], settings: defaults, deviceSettings: {}, alerts: {},
    watched: [null, watched[0], {}, { id: 123, name: 'bad', connection: 'USB' },
      { id: 'broken', name: ' ', connection: 'USB' }, { id: 'no-link', name: 'Bad', connection: null }, watched[1]],
    history: {}, historyDays: {} });
  try {
    writeFileSync(file, original);
    const restored = open();
    assert.match(restored.state.error ?? '', /部分监测设备记录/);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(saved.watched, watched);
    const backups = () => readdirSync(path).filter(name => name.startsWith('monitor-repair-'));
    assert.equal(backups().length, 1);
    assert.equal(readFileSync(join(path, backups()[0]!), 'utf8'), original);
    assert.equal(open().state.error, undefined);
    assert.equal(backups().length, 1);
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});

test('a backup failure preserves the original across normal saves and close; retry protects it first', t => {
  const { path, file, open } = fixture();
  const original = JSON.stringify({ version: 1, devices: [], watched: [null], settings: defaults,
    deviceSettings: {}, alerts: {}, history: {}, historyDays: {} });
  const copy = fs.copyFileSync;
  let backupBlocked = true;
  const mocked = t.mock.method(fs, 'copyFileSync', (...args: Parameters<typeof copy>) => {
    if (backupBlocked && args[0] === file) throw new Error('fixture: backup refused');
    copy(...args);
  });
  syncBuiltinESMExports();
  try {
    writeFileSync(file, original);
    const restored = open();
    assert.match(restored.state.error ?? '', /暂用可用记录/);
    assert.equal(restored.persist(), false);
    restored.close();
    assert.equal(readFileSync(file, 'utf8'), original);
    assert.deepEqual(readdirSync(path), ['monitor.json']);

    const reopened = open();
    backupBlocked = false;
    assert.equal(reopened.persist(), true);
    const backup = readdirSync(path).find(name => name.startsWith('monitor-repair-'));
    assert.ok(backup);
    assert.equal(readFileSync(join(path, backup), 'utf8'), original);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).watched, []);
    reopened.close();
  } finally {
    mocked.mock.restore();
    syncBuiltinESMExports();
    rmSync(path, { recursive: true, force: true });
  }
});

test('cached impossible timestamps do not restore a last-known reading', () => {
  const { path, file, open } = fixture();
  const now = Date.now();
  const device: Device = { id: 'mouse', name: '鼠标', connection: 'USB', art: 'mouse', status: 'current',
    reason: '', reading, lastRead: now, watched: false };
  try {
    writeFileSync(file, JSON.stringify({ version: 1, watched: [], settings: defaults, deviceSettings: {}, alerts: {},
      devices: [{ ...device, lastRead: 1e20 }, { ...device, id: 'future', lastRead: now + 86_400_000 },
        { ...device, id: 'valid' }], history: {}, historyDays: {} }));
    const restored = open();
    assert.deepEqual(restored.state.devices.map(value => [value.id, value.lastRead, value.reading?.low]),
      [['mouse', null, undefined], ['future', null, undefined], ['valid', now, 25]]);
    restored.close();
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});
