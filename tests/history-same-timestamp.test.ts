import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { defaults, type Device, type HistoryDay, type HistoryPoint, type Reading, type Sample } from '../src/model';
import { Monitor } from '../src/monitor';

const date = new Date();
date.setHours(12, 0, 0, 0);
const time = date.getTime();
date.setHours(0, 0, 0, 0);
const day = date.getTime();
const reading = (n: number, power: Reading['power'] = 'discharging'): Reading =>
  ({ low: n, high: n, raw: n, power, source: 'hid' });
const point = (time: number, level: number, power?: Reading['power']) => ({ time, reading: reading(level, power) });

function fixture(points: HistoryPoint[] = [], buckets: HistoryDay[] = []) {
  const directory = mkdtempSync(join(tmpdir(), 'power-history-replace-'));
  writeFileSync(join(directory, 'monitor.json'), JSON.stringify({ version: 1, devices: [], settings: defaults,
    deviceSettings: {}, alerts: {}, watched: [], history: { mouse: points }, historyDays: { mouse: buckets } }));
  const monitor = new Monitor(directory, 'unused-collector', () => {}, () => {});
  const device: Device = { id: 'mouse', name: 'Mouse', connection: 'USB', art: 'mouse', status: 'stale',
    reason: '', reading: null, lastRead: null, watched: false };
  const row = { device, due: 0, failures: 0 };
  const internals = monitor as unknown as { setSample(row: unknown, sample: Sample, time: number): void };
  const sample = (value: Reading | null, at = time) => internals.setSample(row,
    { status: value ? 'current' : 'stale', reading: value, reason: '' }, at);
  return { monitor, sample, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

test('same-ms failure to success adds one sample; replacing success updates or removes its contribution', () => {
  const { monitor, sample, cleanup } = fixture();
  try {
    sample(null);
    sample(reading(40, 'charging'));
    assert.deepEqual(monitor.history('mouse'), [point(time, 40, 'charging')]);
    assert.deepEqual(monitor.historySummary('mouse', 'week'), [
      { day, lowest: point(time, 40, 'charging'), count: 1, lastCharge: time },
    ]);
    sample(reading(50));
    assert.deepEqual(monitor.history('mouse'), [point(time, 50)]);
    const [bucket] = monitor.historySummary('mouse', 'week');
    assert.deepEqual(bucket?.lowest, point(time, 50));
    assert.equal(bucket?.count, 1);
    assert.equal(bucket?.lastCharge, undefined);
    sample(null);
    assert.deepEqual(monitor.history('mouse'), [{ time, reading: null }]);
    assert.deepEqual(monitor.historySummary('mouse', 'week'), []);
  } finally { cleanup(); }
});

test('replacing the minimum/latest charge preserves older retained extrema and rolled-up count', () => {
  const older = time - 60_000;
  const original = point(time, 30, 'charging');
  const { monitor, sample, cleanup } = fixture([point(older, 55, 'charging'), original],
    [{ day, lowest: original, count: 8, lastCharge: time }]);
  try {
    sample(reading(60));
    const [bucket] = monitor.historySummary('mouse', 'week');
    assert.deepEqual(bucket, { day, lowest: point(older, 55, 'charging'), count: 8, lastCharge: older });
    sample(null);
    assert.deepEqual(monitor.historySummary('mouse', 'week'), [
      { day, lowest: point(older, 55, 'charging'), count: 7, lastCharge: older },
    ]);
  } finally { cleanup(); }
});

test('replacing a reading preserves a minimum and charge known only from the daily roll-up', () => {
  const older = day + 1_000;
  const old = point(older, 25, 'charging');
  const { monitor, sample, cleanup } = fixture([point(time, 35)], [{ day, lowest: old, count: 20, lastCharge: older }]);
  try {
    sample(reading(45));
    assert.deepEqual(monitor.historySummary('mouse', 'week'), [{ day, lowest: old, count: 20, lastCharge: older }]);
    sample(null);
    assert.deepEqual(monitor.historySummary('mouse', 'week'), [{ day, lowest: old, count: 19, lastCharge: older }]);
  } finally { cleanup(); }
});
