import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Collector } from '../src/collector';
import { defaults, pollIntervalChoices, type Device, type HistoryPoint, type Reading } from '../src/model';
import { currentReadingAge, delayFor } from '../src/monitor-rules';
import { plotHistory, sampleAt } from '../src/history-plot';
import { Monitor } from '../src/monitor';
import { loadSettings, patchSettings } from '../src/settings-validation';

const reading = (level: number, power: Reading['power'] = 'discharging'): Reading =>
  ({ low: level, high: level, raw: level, source: 'hid', power });
const device = (value: Reading): Device => ({
  id: 'mouse', name: 'Mouse', art: 'mouse', connection: 'USB', status: 'current',
  reason: '设备读数正常', watched: false, lastRead: 0, reading: value,
});

test('the four poll intervals round-trip; malformed values recover defaults or reject edits', () => {
  assert.equal(loadSettings({}).pollIntervalSeconds, 30);
  for (const seconds of pollIntervalChoices) {
    const saved = patchSettings(defaults, { pollIntervalSeconds: seconds });
    assert.equal(loadSettings(JSON.parse(JSON.stringify(saved))).pollIntervalSeconds, seconds);
  }
  for (const invalid of [null, false, '60', 55, 30.5, 3600]) {
    assert.equal(loadSettings({ pollIntervalSeconds: invalid, vol: true }).pollIntervalSeconds, 30);
    assert.throws(() => patchSettings(defaults, { pollIntervalSeconds: invalid }), /间隔无效/);
  }
});

test('only normal cadence stretches; approaching low, charging and retries stay frequent', () => {
  for (const seconds of pollIntervalChoices) {
    const settings = { ...defaults, pollIntervalSeconds: seconds };
    const healthy = device(reading(71));
    const low = device(reading(14));
    const charging = device(reading(78, 'charging'));
    assert.equal(delayFor(healthy, settings, undefined, 0), seconds * 1000);
    assert.ok(currentReadingAge(healthy, settings, undefined) > seconds * 1000);
    assert.equal(delayFor(device(reading(23)), settings, undefined, 0), 12_000);
    assert.equal(delayFor(low, settings, undefined, 0), 12_000);
    assert.equal(delayFor(charging, settings, undefined, 0), 12_000);
    assert.equal(delayFor({ ...healthy, status: 'timeout', reading: null }, settings, undefined, 1), 2_000);
  }
});

test('long scheduled intervals do not create false chart gaps or mask actual missing data', () => {
  for (const interval of [300_000, 600_000] as const) {
    const first = 100_000;
    const last = first + interval + 1_000;
    const onSchedule: HistoryPoint[] = [
      { time: first, reading: reading(75), sampleIntervalMs: interval },
      { time: last, reading: reading(68), sampleIntervalMs: interval },
    ];
    const active = plotHistory(onSchedule, 0, last + 60_000);
    assert.equal(active.runs.length, 1);
    assert.equal(active.gaps.length, 0);
    assert.equal(sampleAt(active, first + interval / 2)?.time, first);

    const overdue = plotHistory(onSchedule, 0, last + interval + 31_000);
    assert.deepEqual(overdue.gaps, [{ start: last, end: last + interval + 31_000, kind: 'unrecorded' }]);
    assert.equal(sampleAt(overdue, last + interval + 30_500, last + interval + 31_000), undefined);

    const interrupted = plotHistory([...onSchedule, { time: last + 60_000, reading: null }], 0, last + interval);
    assert.ok(interrupted.gaps.some(gap => gap.kind === 'invalid'));
  }
});

test('monitor passes live due gates, preserves a sooner slot, advances a shortened slot, and persists the setting', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'pm-interval-test-'));
  const monitor = new Monitor(folder, 'unused-mock-collector', () => {}, () => {});
  t.after(() => { monitor.close(); rmSync(folder, { recursive: true, force: true }); });
  const collector = (monitor as unknown as { collector: Collector }).collector;
  const start = Date.now();
  let clock = start;
  let interval = 30;
  const seen: Array<{ due: Record<string, boolean>; force: boolean }> = [];
  t.mock.method(Date, 'now', () => clock);
  t.mock.method(collector, 'request', async (name: string, { due, force }: { due: Record<string, boolean>; force: boolean }) => {
    assert.equal(name, 'poll');
    seen.push({ due, force });
    return [device(reading(75)), { ...device(reading(22)), id: 'near-low' }].map(d =>
      ({ id: d.id, name: d.name, art: d.art, connection: d.connection, aliases: [], automatic: true, voltage: null,
        sample: force || due[d.id] !== false ? { status: 'current', reason: '', reading: d.reading } : null }));
  });
  const keys = () => seen.at(-1)!.due;
  const change = (seconds: number) => {
    Object.assign(monitor.state.settings, patchSettings(monitor.state.settings, { pollIntervalSeconds: seconds }));
    assert.equal(monitor.persist(), true);
    monitor.applyPollInterval();
    interval = seconds;
  };
  await monitor.poll(); // inventory not yet known
  assert.deepEqual(keys(), {});
  change(600);
  clock = start + 13_000;
  await monitor.poll();
  assert.deepEqual(keys(), { mouse: false, 'near-low': true });
  clock = start + 30_000;
  await monitor.poll();
  assert.equal(keys().mouse, true, 'do not delay the first already-planned mouse reading');
  clock = start + 301_000;
  await monitor.poll();
  assert.equal(keys().mouse, false, 'ten-minute cadence skips the normal device');
  assert.equal(monitor.state.devices.find(d => d.id === 'mouse')?.status, 'current');

  change(60);
  await monitor.poll();
  assert.equal(keys().mouse, true, 'shortening advances an already overdue device');
  await monitor.refresh();
  assert.equal(seen.at(-1)?.force, true, 'manual refresh bypasses the gate');
  const reopened = new Monitor(folder, 'unused-mock-collector', () => {}, () => {});
  try { assert.equal(reopened.state.settings.pollIntervalSeconds, interval); }
  finally { reopened.close(); }
});
