import assert from 'node:assert/strict';
import { test } from 'node:test';
import { historyWindow, plotHistory, sampleAt, toggleHistorySelection, unsampledAfter } from '../src/history-plot';
import type { HistoryPoint, Power } from '../src/model';

const now = 1_800_000_000_000;
const start = now - historyWindow;
const point = (time: number, low: number, high = low, power: Power = 'discharging'): HistoryPoint =>
  ({ time, reading: { low, high, raw: low, power, source: 'hid' } });

test('invalid points split exact and range data without inventing electrical state', () => {
  const data = plotHistory([point(now - 70_000, 31), { time: now - 60_000, reading: null },
    point(now - 50_000, 20, 30, 'charging'), point(now - 40_000, 21, 31, 'charging'),
    point(now - 30_000, 32, 32, 'full'), point(now - 20_000, 53)], start, now);
  assert.deepEqual(data.runs.map(run => [run.kind, run.points.length]), [['exact', 1], ['range', 2], ['exact', 2]]);
  assert.deepEqual(data.gaps, [{ start: now - 60_000, end: now - 50_000, kind: 'invalid' }]);
  assert.deepEqual(data.charging.map(event => event.time), [now - 50_000]);
  assert.equal(sampleAt(data, now - 55_000)?.reading, null);
  assert.deepEqual([sampleAt(data, now - 48_000)?.reading?.low, sampleAt(data, now - 48_000)?.reading?.high], [20, 30]);
});

test('another device’s timestamp and rising values do not fabricate invalid or charging events', () => {
  const a = plotHistory([point(now - 60_000, 42), point(now - 10_000, 59)], start, now);
  const b = plotHistory([point(now - 50_000, 88), point(now - 1_000, 80)], start, now);
  assert.equal(a.runs.length, 1);
  assert.equal(b.runs.length, 1);
  assert.deepEqual([a.gaps.length, b.gaps.length, a.charging.length, b.charging.length], [0, 0, 0, 0]);
});

test('retains only 24 hours and distinguishes a long no-sample interval from invalid data', () => {
  const a = now - unsampledAfter * 4;
  const b = now - unsampledAfter * 2;
  const data = plotHistory([point(b, 70), point(start - 1, 51), point(a, 80), point(now + 1, 50)], start, now);
  assert.deepEqual(data.points.map(sample => sample.time), [a, b]);
  assert.deepEqual(data.gaps, [
    { start: a + unsampledAfter, end: b, kind: 'unrecorded' },
    { start: b + unsampledAfter, end: now, kind: 'unrecorded' },
  ]);
  assert.equal(data.runs.length, 2);
  assert.equal(sampleAt(data, b - 1), undefined);
});

test('an invalid tail stays open; a gap between two charging samples marks separate observations without asserting when charging began', () => {
  const time = now - 60_000;
  const data = plotHistory([point(time, 14, 16, 'charging'), { time: time + 5000, reading: null },
    { time: time + 10_000, reading: null }, point(time + 30_000, 17, 19, 'charging'),
    { time: time + 40_000, reading: null }], start, now);
  assert.deepEqual(data.charging.map(event => event.time), [time, time + 30_000]);
  assert.deepEqual(data.gaps.map(gap => gap.end), [time + 30_000, now]);
});

test('comparison caps at three, keeps a selected device, and selection order is stable', () => {
  assert.deepEqual(toggleHistorySelection(['a'], 'a'), ['a']);
  assert.deepEqual(toggleHistorySelection(['a', 'b'], 'c'), ['a', 'b', 'c']);
  assert.deepEqual(toggleHistorySelection(['a', 'b', 'c'], 'd'), ['a', 'b', 'c']);
  assert.deepEqual(toggleHistorySelection(['a', 'b', 'c'], 'b'), ['a', 'c']);
});

test('timestamp replacements follow the latest stored evidence without making two conflicting events', () => {
  const time = now - 60_000;
  const valid = point(time, 21, 25, 'charging');
  const invalid = { time, reading: null };
  const replaced = plotHistory([invalid, valid], start, now);
  assert.deepEqual([replaced.gaps.length, replaced.charging.length], [0, 1]);
  const reversed = plotHistory([valid, invalid], start, now);
  assert.deepEqual([reversed.gaps.length, reversed.charging.length], [1, 0]);
});
