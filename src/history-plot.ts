import type { HistoryPoint, Reading } from './model';

export const historyWindow = 86_400_000;
// Sampling normally takes 12–22s. A long hole (e.g. app asleep) is not
// evidence of disconnection and must not be interpolated as a reading.
export const unsampledAfter = 120_000;
export const compareLimit = 3;
type Observation = { time: number; reading: Reading };
export type PlotRun = { kind: 'exact' | 'range'; points: Observation[] };
export type PlotGap = { start: number; end: number; kind: 'invalid' | 'unrecorded' };
export type PlotSeries = { points: HistoryPoint[]; runs: PlotRun[]; gaps: PlotGap[]; charging: Observation[] };

export function plotHistory(input: HistoryPoint[], start: number, end: number): PlotSeries {
  const points = [...new Map(input.filter(point => point.time >= start && point.time <= end)
    .map(point => [point.time, point])).values()].sort((a, b) => a.time - b.time);
  const runs: PlotRun[] = [];
  const gaps: PlotGap[] = [];
  const charging: Observation[] = [];
  let previous: HistoryPoint | undefined;
  let gap: PlotGap | undefined;
  let run: PlotRun | undefined;
  for (const { time, reading } of points) {
    if (!reading) {
      if (!gap) gaps.push(gap = { start: time, end, kind: 'invalid' });
      run = undefined;
    } else {
      if (gap) {
        gap.end = time;
        gap = undefined;
      } else if (previous?.reading && time - previous.time > unsampledAfter) {
        gaps.push({ start: previous.time + unsampledAfter, end: time, kind: 'unrecorded' });
        run = undefined;
      }
      if (reading.power === 'charging' && (!run || previous?.reading?.power !== 'charging')) charging.push({ time, reading });
      const kind = reading.low === reading.high ? 'exact' : 'range';
      if (!run || run.kind !== kind) runs.push(run = { kind, points: [] });
      run.points.push({ time, reading });
    }
    previous = { time, reading };
  }
  if (previous?.reading && end - previous.time > unsampledAfter) {
    gaps.push({ start: previous.time + unsampledAfter, end, kind: 'unrecorded' });
  }
  return { points, runs, gaps, charging };
}

export function sampleAt(series: PlotSeries, time: number): HistoryPoint | undefined {
  let low = 0;
  let high = series.points.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (series.points[mid].time <= time) low = mid + 1;
    else high = mid;
  }
  const floor = series.points[low - 1];
  if (!floor || !floor.reading) return floor;
  return time - floor.time <= unsampledAfter ? floor : undefined;
}

export function toggleHistorySelection(ids: string[], id: string): string[] {
  if (ids.includes(id)) return ids.length > 1 ? ids.filter(value => value !== id) : ids;
  return ids.length < compareLimit ? [...ids, id] : ids;
}
