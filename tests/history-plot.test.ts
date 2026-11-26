import assert from 'node:assert/strict';
import { test } from 'node:test';
import { historyAnchor, historyDateTicks, historyStart, historyWindow, plotHistory, sampleAt, toggleHistorySelection, toggleHistorySlots, unsampledAfter } from '../src/history-plot';
import type { HistoryPoint, Power } from '../src/model';

const now = 1_800_000_000_000;
const start = now - historyWindow;
const point = (time: number, low: number, high = low, power: Power = 'discharging'): HistoryPoint =>
  ({ time, reading: { low, high, raw: low, power, source: 'hid' } });

test('history anchors to valid recent readings, not corrupt or future device timestamps', () => {
  const clock = now - 1000;
  assert.equal(historyAnchor(clock, [null, NaN, Infinity, -Infinity, 8.64e15 + 1, now + 1, now - 2000], now), clock);
  assert.equal(historyAnchor(clock, [now - 560, Number.MAX_VALUE, now - 12, now - 900], now), now - 12);
  assert.equal(historyAnchor(clock, [now], now), now);
});

test('invalid points split exact and range data without inventing electrical state', () => {
  const data = plotHistory([point(now - 70_000, 31), { time: now - 60_000, reading: null },
    point(now - 50_000, 20, 30, 'charging'), point(now - 40_000, 21, 31, 'charging'),
    point(now - 30_000, 32, 32, 'full'), point(now - 20_000, 53)], start, now);
  assert.deepEqual(data.runs.map(run => [run.kind, run.points.length]), [['exact', 1], ['range', 2], ['exact', 2]]);
  assert.deepEqual(data.gaps, [{ start: now - 60_000, end: now - 60_000, kind: 'invalid' }]);
  assert.deepEqual(data.charging.map(event => event.time), [now - 50_000]);
  assert.equal(sampleAt(data, now - 60_000)?.reading, null);
  assert.equal(sampleAt(data, now - 55_000), undefined);
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
    { start: a, end: b, kind: 'unrecorded' },
    { start: b, end: now, kind: 'unrecorded' },
  ]);
  assert.equal(data.runs.length, 2);
  assert.equal(sampleAt(data, b - 1), undefined);
});

test('charging resumes as a separate observation and invalid marks end at the last recorded failure', () => {
  const time = now - 60_000;
  const data = plotHistory([point(time, 14, 16, 'charging'), { time: time + 5000, reading: null },
    { time: time + 10_000, reading: null }, point(time + 30_000, 17, 19, 'charging'),
    { time: time + 40_000, reading: null }], start, now);
  assert.deepEqual(data.charging.map(event => event.time), [time, time + 30_000]);
  assert.deepEqual(data.gaps.map(gap => gap.end), [time + 10_000, time + 40_000]);
});

test('a long gap on either side of a legacy failure does not become a failed reading interval', () => {
  const first = now - 8 * unsampledAfter;
  const failure = first + 4 * unsampledAfter;
  const resumed = now - 1000;
  const data = plotHistory([point(first, 46), { time: failure, reading: null }, point(resumed, 46)], start, now);
  assert.deepEqual(data.gaps, [
    { start: first, end: failure, kind: 'unrecorded' },
    { start: failure, end: failure, kind: 'invalid' },
    { start: failure, end: resumed, kind: 'unrecorded' },
  ]);
  assert.equal(sampleAt(data, first + 1, now), undefined);
  assert.equal(sampleAt(data, failure)?.reading, null);
  assert.equal(sampleAt(data, failure + 1, now), undefined);
  assert.equal(sampleAt(data, resumed)?.reading?.low, 46);
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
  const commands = [...curve.matchAll(/C([\d.,-]+)/g)].map(match => {
    const [x1, y1, x2, y2, x, y] = match[1].split(',').map(Number);
    return [[x1, y1], [x2, y2], [x, y]];
  });
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

test('interval edges change at the observation time and share the filled boundary', async () => {
  const { intervalPaths } = await import('../src/history-curve');
  const interval = intervalPaths([[0, 10, 30], [2, 10, 30], [3, 10, 30], [5, 20, 40], [9, 30, 50]]);
  const vertices = (path: string) => {
    const points = path.match(/\d+,\d+/g) ?? [];
    return points.filter((point, index) => point !== points[index - 1]);
  };
  assert.deepEqual(vertices(interval.upper), ['0,10', '3,10', '5,10', '5,20', '9,20', '9,30']);
  assert.deepEqual(vertices(interval.lower), ['0,30', '3,30', '5,30', '5,40', '9,40', '9,50']);
  assert.ok(interval.fill.startsWith(interval.upper));
  assert.ok(interval.fill.endsWith('L0,30Z'));
});

test('the rendered curve hits every observation even when it compacts long plateaus', async () => {
  const { exactCurve } = await import('../src/history-curve');
  const values = Array.from({ length: 201 }, (_, i) => [i, Math.round(10 + Math.abs(150 - i) * .35)] as const);
  const segments = [...exactCurve(values).matchAll(/C([\d.,-]+)/g)];
  assert.ok(segments.length < values.length - 1);
  let [startX, startY] = values[0];
  for (const [, segment] of segments) {
    const [, a, , b, endX, endY] = segment.split(',').map(Number);
    for (let i = startX; i <= endX; i++) {
      const t = (i - startX) / (endX - startX);
      const u = 1 - t;
      const fitted = u ** 3 * startY + 3 * u ** 2 * t * a + 3 * u * t ** 2 * b + t ** 3 * endY;
      assert.ok(Math.abs(fitted - values[i][1]) < .001);
    }
    [startX, startY] = [endX, endY];
  }
});

test('trend removes quantization stairs while preserving the measured peak and abrupt changes', async () => {
  const { exactCurve, trendCurve } = await import('../src/history-curve');
  const points = [[0, 36], [1, 36], [2, 35], [3, 35], [4, 35], [5, 34], [6, 34],
    [7, 31], [8, 31], [9, 32], [10, 33]] as const;
  const trend = trendCurve([...points], 1);
  assert.notEqual(trend, exactCurve([...points]));
  const endpoints = [...trend.matchAll(/C([\d.,-]+)/g)].map(([, controls]) => controls.split(',').slice(-2).join(','));
  assert.deepEqual(endpoints, ['1,36', '3,35', '5,34', '6,34', '7,31', '8,31', '9,32', '10,33']);
});

test('trend interval ribbons use the measured time and bounds of each plateau', async () => {
  const { intervalRibbon } = await import('../src/history-curve');
  const ribbon = intervalRibbon([[0, 10, 30], [4, 10, 30], [8, 20, 40], [16, 20, 40]]);
  assert.equal(ribbon.match(/M/g)?.length, 2);
  assert.ok(ribbon.includes('Q8,10 8,14'));
  assert.ok(ribbon.includes('M12,20'));
  assert.ok(ribbon.includes('Q16,40 12,40'));
});

test('comparison reuses a vacated color without renumbering the other devices', () => {
  const two = toggleHistorySlots(['mouse', 'dual', 'keyboard'], 'mouse');
  assert.deepEqual(two, [undefined, 'dual', 'keyboard']);
  const lone = toggleHistorySlots(two, 'keyboard');
  assert.deepEqual(lone, [undefined, 'dual', undefined]);
  assert.equal(toggleHistorySlots(lone, 'dual'), lone);
  assert.deepEqual(toggleHistorySlots(two, 'xbox'), ['xbox', 'dual', 'keyboard']);
  assert.equal(toggleHistorySlots(two, 'mouse').length, 3);
});

test('multi-day axis ticks advance by local date without repeating the first date', () => {
  const end = new Date(2026, 10, 25, 11, 34).getTime();
  for (const range of ['week', 'month', 'year'] as const) {
    const start = historyStart(end, range);
    const ticks = historyDateTicks(start, end, 8);
    assert(ticks.length > 0 && ticks.length <= 8);
    assert(ticks.every(time => time > start && time < end && new Date(time).getHours() === 0));
    assert.equal(new Set([start, ...ticks].map(time => new Date(time).toLocaleDateString())).size, ticks.length + 1);
  }
});
