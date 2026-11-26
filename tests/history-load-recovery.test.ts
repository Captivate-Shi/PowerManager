import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
