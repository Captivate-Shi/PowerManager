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

test('smooth history trace passes through measured points without overshooting an extremum', async () => {
  const { exactCurve } = await import('../src/history-curve');
  const curve = exactCurve([[0, 25], [3, 20], [9, 90], [27, 92]]);
  const commands = [...curve.matchAll(/C([\d., -]+)/g)].map(match => match[1].split(' ').map(point => point.split(',').map(Number)));
  assert.equal(commands.length, 3);
  const observed = [[0, 25], [3, 20], [9, 90], [27, 92]];
  commands.forEach(([a, b, end], i) => {
    assert.deepEqual(end, observed[i + 1]);
    for (const point of [a, b]) {
      assert.ok(point[0] > observed[i][0] && point[0] < end[0]);
      assert.ok(point[1] >= Math.min(end[1], observed[i][1]) && point[1] <= Math.max(end[1], observed[i][1]));
    }
  });
  assert.equal(commands[0][1][1], 20);
  assert.equal(commands[1][0][1], 20);
});

test('reduces rounded steps without removing extrema or charging anchors', async () => {
  const { reduceCurve } = await import('../src/history-curve');
  const input = [[0, 5], [1, 5], [2, 4], [3, 4], [4, 3], [5, 4], [6, 4]] as const;
  const summary = reduceCurve([...input], 1.05, new Set([5]));
  assert.deepEqual(summary, [input[0], input[4], input[5], input[6]]);
});

test('smooth reduction stays close to actual rounded samples even near a long-span turn', async () => {
  const { exactCurve, reduceCurve } = await import('../src/history-curve');
  const values = Array.from({ length: 201 }, (_, i) => [i, Math.round(10 + Math.abs(150 - i) * .35)] as const);
  const knots = reduceCurve(values, 1.05, new Set([175]));
  assert.ok(knots.length < 60);
  const segments = [...exactCurve(knots).matchAll(/C([\d., -]+)/g)]
    .map(match => match[1].split(' ').map(point => point.split(',').map(Number)));
  for (let j = 0; j < segments.length; j++) {
    const [a, b, end] = segments[j];
    const [startX, startY] = knots[j];
    for (let i = startX; i <= end[0]; i++) {
      const t = (i - startX) / (end[0] - startX);
      const u = 1 - t;
      const fitted = u ** 3 * startY + 3 * u ** 2 * t * a[1] + 3 * u * t ** 2 * b[1] + t ** 3 * end[1];
      assert.ok(Math.abs(fitted - values[i][1]) <= 1.06, 'observations stay within 1.05% plus SVG rounding');
    }
  }
});
