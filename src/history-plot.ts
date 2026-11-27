import { historyPointEnd, type HistoryDay, type HistoryPoint, type HistoryRange, type Reading } from './model';

export const historyWindow = 86_400_000;
export const historyRangeLabels = { day: '24 小时', week: '7 天', month: '30 天', year: '365 天' } satisfies Record<HistoryRange, string>;
export const historyPointLimit = 7200;
// A rolling day crosses midnight; budget a third bucket around a short DST day.
export const historyBucketLimit = { day: 3, week: 7, month: 30, year: 365 } satisfies Record<HistoryRange, number>;
// A newly received sample may be newer than the renderer's periodic clock,
// but corrupted cache dates (including far-future values) must not move the chart.
export function historyAnchor(clock: number, readings: readonly (number | null)[], wallClock: number): number {
  return readings.reduce<number>((anchor, time) =>
    typeof time === 'number' && time > anchor && time <= wallClock ? time : anchor, clock);
}

export function historyStart(end: number, range: HistoryRange) {
  if (range === 'day') return end - historyWindow;
  const date = new Date(end);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - historyBucketLimit[range] + 1);
  return date.getTime();
}

/** Calendar ticks, not fractional subdivisions that can display the same date twice. */
export function historyDateTicks(start: number, end: number, intervals: number): number[] {
  const wallDay = (at: number) => {
    const date = new Date(at);
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  };
  const days = Math.round((wallDay(end) - wallDay(start)) / historyWindow);
  const step = Math.max(1, Math.ceil(days / Math.max(1, intervals)));
  const date = new Date(start);
  return Array.from({ length: Math.max(0, Math.floor(days / step)) }, (_, index) => {
    const tick = new Date(date);
    tick.setDate(date.getDate() + (index + 1) * step);
    tick.setHours(0, 0, 0, 0);
    return tick.getTime();
  }).filter(tick => tick > start && tick < end);
}

export function accumulateHistoryDay(days: HistoryDay[], { time, reading }: HistoryPoint) {
  if (!reading) return;
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  const day = date.getTime();
  let bucket = days.at(-1);
  if (bucket?.day !== day) bucket = days.find(item => item.day === day);
  if (!bucket) {
    bucket = { day, lowest: { time, reading }, count: 0 };
    days.push(bucket);
  }
  bucket.count++;
  const current = bucket.lowest.reading;
  if (reading.low < current.low || (reading.low === current.low && reading.high < current.high)) bucket.lowest = { time, reading };
  if (reading.power === 'charging') bucket.lastCharge = Math.max(time, bucket.lastCharge ?? 0);
}
// Missing legacy cadence keeps the old limit. A newer reading can explicitly
// allow a longer interval; it does not change historical evidence elsewhere.
export const unsampledAfter = 120_000;
function expectedGap(point: HistoryPoint) {
  return point.reading && (point.sampleIntervalMs === 300_000 || point.sampleIntervalMs === 600_000)
    ? point.sampleIntervalMs + 30_000 : unsampledAfter;
}
export const compareLimit = 3;
type Observation = { time: number; reading: Reading };
export type PlotRun = { kind: 'exact' | 'range'; points: Observation[] };
export type PlotGap = { start: number; end: number; kind: 'invalid' | 'unrecorded' };
export type PlotSeries = { points: HistoryPoint[]; runs: PlotRun[]; gaps: PlotGap[]; charging: Observation[] };

export function plotHistory(input: HistoryPoint[], start: number, end: number): PlotSeries {
  const points = [...new Map(input.filter(point => historyPointEnd(point) >= start && point.time <= end)
    .map(point => [point.time, point])).values()].sort((a, b) => a.time - b.time);
  const runs: PlotRun[] = [];
  const gaps: PlotGap[] = [];
  const charging: Observation[] = [];
  let previous: HistoryPoint | undefined;
  let run: PlotRun | undefined;
  for (const [index, point] of points.entries()) {
    const { time, reading } = point;
    if (previous && time - historyPointEnd(previous) > expectedGap(previous)) {
      gaps.push({ start: historyPointEnd(previous), end: time, kind: 'unrecorded' });
      run = undefined;
    }
    if (!reading) {
      const confirmedUntil = Math.min(end, historyPointEnd(point), points[index + 1]?.time ?? end);
      const tail = gaps.at(-1);
      if (previous && !previous.reading && tail?.kind === 'invalid' && time - tail.end <= unsampledAfter) tail.end = confirmedUntil;
      else gaps.push({ start: Math.max(start, time), end: confirmedUntil, kind: 'invalid' });
      run = undefined;
    } else {
      if (reading.power === 'charging' && (!run || previous?.reading?.power !== 'charging')) charging.push({ time, reading });
      const kind = reading.low === reading.high ? 'exact' : 'range';
      if (!run || run.kind !== kind) runs.push(run = { kind, points: [] });
      run.points.push({ time, reading });
    }
    previous = point;
  }
  if (previous && end - historyPointEnd(previous) > expectedGap(previous)) {
    gaps.push({ start: historyPointEnd(previous), end, kind: 'unrecorded' });
  }
  return { points, runs, gaps, charging };
}

export function sampleAt(series: PlotSeries, time: number, end = time): HistoryPoint | undefined {
  let low = 0;
  let high = series.points.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (series.points[mid].time <= time) low = mid + 1;
    else high = mid;
  }
  const floor = series.points[low - 1];
  if (!floor || time === floor.time) return floor;
  const next = series.points[low];
  if (!floor.reading) {
    const confirmedUntil = historyPointEnd(floor);
    return time <= confirmedUntil || (next && !next.reading && next.time - confirmedUntil <= unsampledAfter) ? floor : undefined;
  }
  return (next?.time ?? end) - floor.time <= expectedGap(floor) ? floor : undefined;
}

export function toggleHistorySelection(ids: string[], id: string): string[] {
  if (ids.includes(id)) return ids.length > 1 ? ids.filter(value => value !== id) : ids;
  return ids.length < compareLimit ? [...ids, id] : ids;
}

/** Keep colors attached to the remaining devices when a comparison changes. */
export function toggleHistorySlots(slots: (string | undefined)[], id: string): (string | undefined)[] {
  const index = slots.indexOf(id);
  if (index !== -1) {
    return slots.filter(Boolean).length > 1 ? slots.map(value => value === id ? undefined : value) : slots;
  }
  const free = slots.indexOf(undefined);
  if (free !== -1) return slots.map((value, position) => position === free ? id : value);
  return slots.length < compareLimit ? [...slots, id] : slots;
}
