import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Monitor } from '../src/monitor';
import { defaults, limitHistoryRange, type HistoryDay, type Reading } from '../src/model';

test('new retention migrates without inheriting a possibly short legacy viewing range', () => {
  const path = mkdtempSync(join(tmpdir(), 'pm-retention-'));
  let monitor: Monitor | undefined;
  try {
    const file = join(path, 'monitor.json');
    const { historyRetention: _, ...legacy } = defaults;
    const now = Date.now();
    const day = (back: number) => { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - back); return d.getTime(); };
    const reading: Reading = { low: 33, high: 33, raw: 33, source: 'hid', power: 'discharging' };
    const buckets: HistoryDay[] = [40, 10, 4, 0].map(back => ({ day: day(back), lowest: { time: day(back) + 1, reading }, count: 1 }));
    writeFileSync(file, JSON.stringify({ version: 1, devices: [], watched: [], alerts: {}, deviceSettings: {},
      settings: { ...legacy, historyRange: 'day' }, historyDays: { mouse: buckets },
      history: { mouse: [{ time: now - 1000, reading }, { time: now - 86401000, reading }] } }));
    monitor = new Monitor(path, join(path, 'unused.exe'), () => {}, () => {});
    assert.equal(monitor.state.settings.historyRetention, 'year');
    assert.equal(monitor.historySummary('mouse', 'year').length, 4);

    // A blocked atomic write must not discard the late history in memory.
    monitor.state.settings.historyRetention = 'week';
    mkdirSync(file + '.tmp');
    assert.equal(monitor.persist(), false);
    monitor.state.settings.historyRetention = 'year';
    assert.equal(monitor.historySummary('mouse', 'year').length, 4);
    rmSync(file + '.tmp', { recursive:true });

    monitor.state.settings.historyRetention = 'week';
    assert.equal(monitor.persist(), true);
    const stored = JSON.parse(readFileSync(file, 'utf-8'));
    assert.deepEqual(stored.historyDays.mouse.map((item: HistoryDay) => item.day), [day(4), day(0)]);
    assert.equal(stored.history.mouse.length, 1);
    assert.equal(monitor.historySummary('mouse', 'year').length, 2);
    monitor.state.settings.historyRetention = 'year';
    assert.equal(monitor.persist(), true);
    assert.equal(monitor.historySummary('mouse', 'year').length, 2);
    assert.equal(limitHistoryRange('year', 'week'), 'week');
    assert.equal(limitHistoryRange('day', 'week'), 'day');
  } finally {
    monitor?.close();
    rmSync(path, { force: true, recursive: true });
  }
});
