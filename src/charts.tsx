import { exactCurve, trendCurve } from './history-curve';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { RefreshCw, Zap } from 'lucide-react';
import type { Device, HistoryDay, HistoryPoint, HistoryRange } from './model';
import { compareLimit, historyDateTicks, historyRangeLabels, historyStart, plotHistory, sampleAt, type PlotSeries } from './history-plot';
import { api, Art, readingLabel } from './ui';
import { ChartFrame, ChartProgress, ChartSkeleton, HistorySummary, historyColors, type ChartView } from './chart-loading';
import s from './panel.module.css';

const dayTick = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' });
const tick = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const stamp = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
type HistoryRead = { points?: HistoryPoint[]; days?: HistoryDay[]; error?: string };
type ReadingResult = HistoryRead & { query: string; presented?: boolean };
type HistoryResults = ReadonlyMap<string, ReadingResult>;
const emptyResults: HistoryResults = new Map();
const cacheLimit = compareLimit * 2;
type Series = { device: Device; plot: PlotSeries; color: string; index: number; days?: HistoryDay[] };

export function Chart({ device, threshold, large = false }: { device: Device; revision: number | null; threshold?: number; large?: boolean }) {
  return <HistoryComparison devices={[device]} threshold={threshold} large={large} reserveRows={1} />;
}

export function HistoryComparison({ devices, threshold, anchor, range = 'day', seriesSlots, large = true, reserveRows = 3, layout }: {
  devices: Device[]; threshold?: number; anchor?: number; range?: HistoryRange; seriesSlots?: ReadonlyMap<string, number>; large?: boolean; reserveRows?: 1 | 3;
  layout?: (chart: ReactNode, loading: boolean) => ReactNode;
}) {
  const [cache, setCache] = useState<Partial<Record<HistoryRange, HistoryResults>>>({});
  const results = cache[range] ?? emptyResults;
  const [retry, setRetry] = useState(0);
  const [view, setView] = useState<ChartView>('trend');
  const [internalEnd, setEnd] = useState(() => Date.now());
  const end = anchor ?? internalEnd;
  const controlled = anchor !== undefined;
  const requests = useRef(new Map<string, { query: string }>());
  // Each device has its own revision and request token: do not reload or
  // invalidate other series when devices report at different cadences.
  const signature = (device: Device) => JSON.stringify([device.status, device.historyUpdatedAt ?? device.lastRead, retry, range]);
  const request = JSON.stringify(devices.map(device => [device.id, signature(device)]));
  const queries = useMemo(() => new Map<string, string>(JSON.parse(request)), [request]);
  const activeQueries = useRef(queries);
  useLayoutEffect(() => { activeQueries.current = queries; }, [queries]);
  const pending = devices.some(device => results.get(device.id)?.query !== queries.get(device.id));
  const hasPresentedResults = devices.some(device => results.get(device.id)?.presented);
  const visibleResults = pending && !hasPresentedResults ? emptyResults : results;
  useLayoutEffect(() => {
    // A response held during the first load is not yet a cache the user saw.
    const presented = [...queries.keys()].filter(id => {
      const result = visibleResults.get(id);
      return result && !result.presented && (result.points || result.days);
    });
    if (!presented.length) return;
    setCache(previous => {
      const updated = new Map(previous[range]);
      for (const id of presented) {
        const result = updated.get(id);
        if (result === visibleResults.get(id) && result) updated.set(id, { ...result, presented: true });
      }
      return { ...previous, [range]: updated };
    });
  }, [queries, range, visibleResults]);
  useEffect(() => () => requests.current.clear(), []);
  useEffect(() => {
    for (const [id, token] of requests.current) {
      if (queries.get(id) !== token.query) requests.current.delete(id);
    }
    for (const [id, query] of queries) {
      if (results.get(id)?.query === query || requests.current.get(id)?.query === query) continue;
      const token = { query };
      requests.current.set(id, token);
      const store = (reading: HistoryRead) => {
        if (requests.current.get(id) !== token || activeQueries.current.get(id) !== query) return;
        setCache(previous => {
          const updated = new Map(previous[range]);
          const retained = updated.get(id);
          updated.delete(id);
          updated.set(id, {
            ...(reading.error !== undefined ? retained : undefined), ...reading, query, presented: retained?.presented,
          });
          // Keep recently removed comparisons available for re-selection.
          for (const candidate of updated.keys()) {
            if (updated.size <= cacheLimit) break;
            if (!activeQueries.current.has(candidate)) updated.delete(candidate);
          }
          return { ...previous, [range]: updated };
        });
        if (!controlled) setEnd(Date.now());
      };
      void api.command({ type: 'history', id, range }).then(
        reply => store(reply.ok ? { points: reply.history, days: reply.historyDays } : { error: reply.error }),
        () => store({ error: '暂时无法读取电量记录' }));
    }
  }, [queries, range, results, controlled]);

  useEffect(() => {
    if (controlled) return;
    const timer = window.setInterval(() => { if (!document.hidden) setEnd(Date.now()); }, 60_000);
    return () => window.clearInterval(timer);
  }, [controlled]);

  const start = historyStart(end, range);
  const daysById = useMemo(() => new Map([...visibleResults].filter(([id, result]) => queries.has(id) && result.days)
    .map(([id, result]) => [id, result.days!.filter(bucket => bucket.day >= start && bucket.lowest.time <= end)])), [visibleResults, queries, start, end]);
  const plotById = useMemo(() => new Map([...visibleResults].filter(([id]) => queries.has(id))
    .map(([id, result]): [string, PlotSeries] => {
      if (range === 'day') return [id, plotHistory(result.points ?? [], start, end)];
      const points = (daysById.get(id) ?? []).map(bucket => bucket.lowest);
      return [id, { points, runs: points.map(point => ({ kind: point.reading.low === point.reading.high ? 'exact' : 'range', points: [point] })),
        gaps: [], charging: [] }];
    })), [visibleResults, queries, range, start, end, daysById]);
  const activeSeries = useMemo(() => devices.flatMap((device, index): Series[] => {
    const plot = plotById.get(device.id);
    const slot = seriesSlots?.get(device.id) ?? index;
    return plot?.points.length ? [{ device, plot, color: historyColors[slot], index: slot, days: daysById.get(device.id) }] : [];
  }), [devices, plotById, daysById, seriesSlots]);
  const showingRecords = hasPresentedResults || activeSeries.length > 0;
  const loading = pending && !showingRecords;
  const hasData = (id: string) => !!(visibleResults.get(id)?.points || visibleResults.get(id)?.days);
  const errors = devices.filter(({ id }) => !!visibleResults.get(id)?.error);
  const settledEmpty = devices.filter(({ id }) => hasData(id) && !plotById.get(id)?.points.length);
  const onlyGaps = activeSeries.length > 0 && activeSeries.every(series => !series.plot.runs.length);
  const allFailed = !pending && errors.length > 0 && errors.length === devices.length;
  const retryButton = <button className={s.textButton} onClick={() => setRetry(value => value + 1)} disabled={pending}><RefreshCw size={13} aria-hidden="true" />重试</button>;
  const status = pending && showingRecords ? {
    text: '正在更新，暂显示已有记录',
    progress: true,
  } : errors.length && !(allFailed && !activeSeries.length) ? {
    text: allFailed ? '更新失败，仍显示上次记录' :
      errors.map(device => device.name + (hasData(device.id) ? '：保留上次记录' : '：读取失败')).join(' · '),
    retry: true,
  } : settledEmpty.length && activeSeries.length ? {
    text: settledEmpty.map(device => device.name).join('、') + '暂无记录',
  } : onlyGaps ? { text: '该时段仅有无效记录，尚不能绘制电量曲线' } : undefined;
  const notice = <>
    {range === 'day' && activeSeries.length > 0 && <span className={s.chartSrOnly}>{activeSeries.map(({ device, plot }) =>
      device.name + '：' + plot.charging.length + ' 次采样显示充电，' + plot.gaps.filter(gap => gap.kind === 'invalid').length +
      ' 段无有效读数，' + plot.gaps.filter(gap => gap.kind === 'unrecorded').length + ' 段未采样').join('；')}</span>}
    {status && <div className={s.chartNotice} role="status">
      {status.progress ? <ChartProgress>{status.text}</ChartProgress> : <span title={status.text}>{status.text}</span>}
      {status.retry && retryButton}
    </div>}
  </>;
  const summary = <HistorySummary range={range} skeleton={reserveRows === 3} fullSkeleton={reserveRows === 3 && loading} rows={devices.map(device => {
    const result = visibleResults.get(device.id);
    const days = daysById.get(device.id);
    const valid = (plotById.get(device.id)?.points ?? []).filter(point => !!point.reading);
    const lowest = valid.reduce<HistoryPoint | undefined>((best, point) => !best || point.reading!.low < best.reading!.low ||
      (point.reading!.low === best.reading!.low && point.reading!.high < best.reading!.high) ? point : best, undefined);
    const latestCharge = days ? Math.max(0, ...days.map(bucket => bucket.lastCharge ?? 0)) :
      valid.findLast(point => point.reading?.power === 'charging')?.time;
    const count = days ? days.reduce((total, bucket) => total + bucket.count, 0) : valid.length;
    return { device, slot: seriesSlots?.get(device.id), name: <Art device={device} />, pending: !hasData(device.id) && result?.query !== queries.get(device.id),
      lowest: lowest && <>{readingLabel(lowest.reading)} <small>{(range === 'day' ? tick : stamp).format(lowest.time)}</small></>,
      charge: latestCharge ? stamp.format(latestCharge) : undefined,
      count: hasData(device.id) ? count.toLocaleString('zh-CN') + ' 次' : undefined };
  })} />;
  const chart = <ChartFrame large={large} pending={pending} threshold={threshold} notice={notice} summary={summary} reserveRows={reserveRows} range={range}
    view={view} hasIntervals={activeSeries.some(({ plot }) => plot.runs.some(run => run.kind === 'range'))} onView={activeSeries.some(item => item.plot.runs.length) ? setView : undefined}>
    {activeSeries.length ? <Graph key={range} series={activeSeries} start={start} end={end} threshold={threshold} range={range} view={view}
      lanes={devices.map((device, i) => ({ device, index: seriesSlots?.get(device.id) ?? i, color: historyColors[seriesSlots?.get(device.id) ?? i], plot: plotById.get(device.id) }))} /> : loading ?
      <ChartSkeleton large={large} comparisonDevices={reserveRows === 3 ? devices : undefined} range={range} /> : <div className={s.chartEmpty} data-large={large}>
        {allFailed ? <div><span role="status">电量记录读取失败</span>{retryButton}</div> :
          <span role="status">{errors.length ? '没有可显示的电量读数' : '近 ' + historyRangeLabels[range] + '暂无设备读数'}</span>}
      </div>}
  </ChartFrame>;
  return layout ? layout(chart, loading) : chart;
}

type HoverEvent = { device: string; name: string; kind: 'invalid' | 'unrecorded' | 'charging'; at: number; end?: number };
type Lane = Omit<Series, 'plot'> & { plot?: PlotSeries };
const eventLabel = (kind: HoverEvent['kind']) => kind === 'charging' ? '检测到充电' : kind === 'invalid' ? '无有效读数' : '无数据';
function Graph({ series, start, end, threshold, range, view, lanes }: {
  series: Series[]; start: number; end: number; threshold?: number; range: HistoryRange; view: ChartView; lanes: Lane[];
}) {
  const hint = useId();
  const outer = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 900, height: 420 });
  const [pointer, setPointer] = useState<number | null>(null);
  const [over, setOver] = useState<HoverEvent | null>(null);
  const [keyboard, setKeyboard] = useState(false);
  useLayoutEffect(() => {
    if (!canvas.current) return;
    const { width, height } = canvas.current.getBoundingClientRect();
    if (width > 0 && height > 0) setSize({ width, height });
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    ro.observe(canvas.current);
    return () => ro.disconnect();
  }, []);
  const { width, height } = size;
  const left = width < 560 ? 72 : width < 980 ? 91 : 108;
  const right = width - (width < 560 ? 10 : 24);
  const compact = height < 145;
  const bucketSlot = (right - left) * 86_400_000 / Math.max(1, end - start);
  const cap = Math.min(6, Math.max(0, bucketSlot * .6));
  const top = compact ? 11 : 14;
  const bottom = Math.max(33, height - (range === 'day' ? compact ? 25 : 42 : 30));
  const x = (time: number) => left + (time - start) / (end - start) * (right - left);
  const y = (value: number) => bottom - value / 100 * (bottom - top);
  const time = pointer === null ? null : start + pointer * (end - start);
  const xCursor = time === null ? null : x(time);
  const stepHours = width < 560 ? 8 : 4;
  const wallTick = new Date(start);
  wallTick.setHours(Math.floor(wallTick.getHours() / stepHours) * stepHours, 0, 0, 0);
  const ticks = [start];
  if (range === 'day') {
    for (let count = 0; count < 9; count++) {
      wallTick.setHours(wallTick.getHours() + stepHours);
      const instant = wallTick.getTime();
      if (instant >= end || x(end) - x(instant) < 67) break;
      if (x(instant) - x(ticks.at(-1)!) >= 67) ticks.push(instant);
    }
  } else {
    const intervals = Math.max(2, Math.min(8, Math.floor((right - left) / 95)));
    ticks.push(...historyDateTicks(start, end, intervals).filter(instant =>
      x(instant) - left >= 54 && right - x(instant) >= 54));
  }
  ticks.push(end);
  const paths = useMemo(() => series.map(({ plot, index, color }) => {
    const line: string[] = [];
    const dots: string[] = [];
    const midlines: string[] = [];
    const brackets: string[] = [];
    const xy = (t: number, v: number) => x(t).toFixed(1) + ',' + y(v).toFixed(1);
    for (const run of plot.runs) {
      if (run.kind === 'exact') {
        if (run.points.length > 1) {
          const points = run.points.map(({ time, reading }) => [x(time), y(reading.low)] as const);
          line.push(view === 'trend' ? trendCurve(points, Math.abs(y(1) - y(0))) : exactCurve(points));
        } else {
          const [{ time, reading }] = run.points;
          dots.push(xy(time, reading.low));
        }
        continue;
      }
      if (range === 'day' && view === 'trend' && run.points.length > 1) {
        const mid = run.points.map(({ time, reading }) => [x(time), y((reading.low + reading.high) / 2)] as const);
        midlines.push(exactCurve(mid));
      }
      const spacing = view === 'trend' ? Math.max(34, (right - left) / 16) : Math.max(9, (right - left) / 100);
      let previous = -Infinity;
      for (let i = 0; i < run.points.length; i++) {
        const { time, reading } = run.points[i];
        const pos = x(time), high = y(reading.high), low = y(reading.low);
        const last = i === run.points.length - 1;
        if (range === 'day' && pos - previous < spacing && !(last && pos - previous >= spacing / 2)) continue;
        const half = range === 'day' ? view === 'trend' ? 3 : 0 : cap / 2;
        brackets.push(half ? `M${pos - half},${high}h${2 * half}M${pos},${high}V${low}M${pos - half},${low}h${2 * half}` :
          `M${pos},${high}V${low}`);
        previous = pos;
      }
    }
    return { index, color, line: line.join(''), dots, midline: midlines.join(''), brackets: brackets.join(''),
      endpoint: plot.runs.at(-1)?.points.at(-1) };
  }), [series, start, end, width, height, view, range]);
  const seriesMarkers: { index: number; color: string; x: number; y: number }[] = [];
  if (series.length > 1) for (const { plot, index, color } of series) {
    // Anchor the symbol to a real sample. Search back just enough to avoid covering another symbol.
    const last = plot.runs.at(-1);
    if (!last) continue;
    const placed = (point: (typeof last.points)[number]) => ({
      index, color, x: x(point.time), y: y((point.reading.low + point.reading.high) / 2),
    });
    const endpoint = last.points.at(-1);
    if (!endpoint) continue;
    const endPos = placed(endpoint);
    let position = endPos;
    for (let offset = last.points.length - 1; offset >= 0; offset--) {
      position = placed(last.points[offset]);
      if (endPos.x - position.x > 44) { position = endPos; break; }
      if (seriesMarkers.every(other => Math.hypot(other.x - position.x, other.y - position.y) >= 11)) break;
    }
    seriesMarkers.push(position);
  }
  const plotLanes = useMemo(() => range === 'day' ? lanes.map(lane => {
    const events: HoverEvent[] = [];
    const base = { device: lane.device.id, name: lane.device.name };
    for (const gap of lane.plot?.gaps ?? []) {
      const at = Math.max(start, gap.start);
      const through = Math.min(end, gap.end);
      if (at <= through) events.push({ ...base, kind: gap.kind, at, end: through > at ? through : undefined });
    }
    for (const { time: at } of lane.plot?.charging ?? []) {
      if (at >= start && at <= end) events.push({ ...base, kind: 'charging', at });
    }
    events.sort((a, b) => a.at - b.at);
    const chargeTimes = events.filter(event => event.kind === 'charging');
    const collisionWindow = 14 * (end - start) / Math.max(1, right - left);
    const stagger = new Set<HoverEvent>();
    let nextCharge = 0;
    for (const gap of events) {
      if (gap.kind === 'charging') continue;
      const gapEnd = gap.end ?? gap.at;
      while (chargeTimes[nextCharge]?.at < gap.at - collisionWindow) nextCharge++;
      for (let i = nextCharge; chargeTimes[i]?.at <= gapEnd + collisionWindow; i++) {
        stagger.add(gap);
        stagger.add(chargeTimes[i]);
      }
    }
    return { ...lane, events, stagger };
  }) : [], [lanes, start, end, range, left, right]);
  const fraction = (at: number) => Math.max(0, Math.min(1, (at - start) / (end - start)));
  const focusEvent = (event: HoverEvent) => {
    setOver(event); setKeyboard(true); setPointer(fraction(event.at));
  };


  function moveKey(event: KeyboardEvent) {
    const value = pointer ?? 1;
    if (event.target !== event.currentTarget && event.key !== 'Escape') return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    setKeyboard(true);
    setOver(null);
    const stride = 1 / (event.shiftKey ? 24 : 96);
    setPointer(event.key === 'Escape' ? null : event.key === 'Home' ? 0 : event.key === 'End' ? 1 :
      Math.min(1, Math.max(0, value + (event.key === 'ArrowLeft' ? -stride : stride))));
  }
  const cursorValues = time === null ? [] : series.map(({ device, plot, color, days }) => {
    const target = new Date(time);
    target.setHours(0, 0, 0, 0);
    const sample = days ? days.find(bucket => bucket.day === target.getTime())?.lowest : sampleAt(plot, time, end);
    const read = sample?.reading;
    return { device, color, sample, read, value: read ? readingLabel(read) : sample ? '无有效读数' : '无数据' };
  });
  const formatCursor = range === 'day' ? tick : dayTick;
  const cursorLabel = time === null ? '' : formatCursor.format(time);
  const eventTime = over ? tick.format(over.at) + (over.end === undefined ? '' : '–' + tick.format(over.end)) : '';
  const style = { '--plot-left': left + 'px', '--plot-right': width - right + 'px',
    '--plot-top': top + 'px', '--plot-bottom': height - bottom + 'px', '--lane-count': plotLanes.length,
    '--cursor-x': (xCursor ?? left) + 'px',
    '--tip-x': ((xCursor ?? left) > width * .67 ? (xCursor ?? left) - 240 : (xCursor ?? left) + 14) + 'px',
  } as CSSProperties;
  return <div className={s.graph} ref={outer} style={style} tabIndex={0} data-chart-view={view} onKeyDown={moveKey}
    aria-label={`近 ${historyRangeLabels[range]}${range === 'day' ? '电量曲线' : '每日最低读数'}。用左右方向键查看时间点，Escape 退出。`}
    onPointerMove={event => {
      setKeyboard(false);
      const bounds = event.currentTarget.getBoundingClientRect();
      const localX = event.clientX - bounds.left;
      const localY = event.clientY - bounds.top;
      const inCanvas = localY >= top && localY <= bottom;
      const inLanes = !!(event.target as Element).closest('[data-event-lanes]');
      setPointer((inCanvas || inLanes) && (inLanes || localX >= left && localX <= right) ?
        Math.max(0, Math.min(1, (localX - left) / (right - left))) : null);
    }} onPointerLeave={() => { if (!keyboard) { setOver(null); setPointer(null); } }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { setKeyboard(false); setPointer(null); setOver(null); } }}>
    <div className={s.graphCanvas} ref={canvas} data-history-plot="">
    <svg className={s.graphSvg} width="100%" height="100%" aria-hidden="true" data-chart-range={range}>
      {(compact ? [0, 50, 100] : [0, 25, 50, 75, 100]).map(value => <g key={value}>
        <line className={value === 0 ? s.graphAxis : s.graphGrid} x1={left - 6} x2={right} y1={y(value)} y2={y(value)} />
        <text className={s.graphLabel} x={left - 11} y={y(value) + 4.5} textAnchor="end">{value}%</text>
      </g>)}
      <line className={s.graphAxis} x1={left} x2={left} y1={top} y2={bottom} />
      {ticks.map((instant, i) => {
        const last = i === ticks.length - 1;
        const anchor = i === 0 ? 'start' : last ? 'end' : 'middle';
        const px = x(instant);
        return <g key={instant} data-time-tick="">
          <line className={s.graphAxis} x1={px} x2={px} y1={bottom} y2={bottom + 7}/>
          <text className={s.graphLabel} x={px} y={bottom + (range === 'day' ? compact ? 19 : 24 : 22)} textAnchor={anchor}>
            {last ? '现在' : (range === 'day' ? tick : dayTick).format(instant)}</text>
          {range === 'day' && !compact && <text className={s.graphDate} x={px} y={bottom + 38} textAnchor={anchor}>{dayTick.format(instant)}</text>}
        </g>;
      })}
      {threshold !== undefined && series.length === 1 && <line x1={left} x2={right} y1={y(threshold)} y2={y(threshold)}
        className={s.graphThreshold} strokeDasharray="4 5"><title>提醒阈值 {threshold}%</title></line>}
      {paths.map(item => <g key={item.index} stroke={item.color} fill={item.color} data-series={item.index}>
        <path className={s.rangeMidline} data-range-mid="" d={item.midline} />
        <path className={range === 'day' ? view === 'trend' ? s.rangeWhisker : s.rangeSample : s.graphDailyRange}
          data-trace="range" data-daily-range={range !== 'day' || undefined}
          style={range === 'year' ? { strokeWidth: Math.min(1.65, bucketSlot * .76) } : undefined} d={item.brackets} />
        <path data-trace="exact" className={s.graphTrace} d={item.line} />
        {item.dots.map((value, index) => { const [cx, cy] = value.split(','); return <circle key={index} cx={cx} cy={cy} data-daily-point={range !== 'day' || undefined}
          r={range === 'day' ? 2 : range === 'year' && item.dots.length > (right - left) / 6 ?
            Math.min(2, bucketSlot * .46) : 3.2} />; })}
      </g>)}
      {seriesMarkers.map(marker => <g className={s.seriesMarker} key={marker.index} data-plot-series-shape={marker.index}
        transform={`translate(${marker.x},${marker.y})`} fill={marker.color}>
        {marker.index === 0 ? <circle r="4" /> : marker.index === 1
          ? <rect x="-3.8" y="-3.8" width="7.6" height="7.6" /> : <path d="M0 -4.7 L4.4 3.7 H-4.4 Z" />}
      </g>)}
      {range === 'day' && !compact && paths.map(item => {
        const p = item.endpoint;
        if (!p) return null;
        // Skip labels whose last observation ended well before the displayed edge.
        if (right - x(p.time) > 60) return null;
        const mid = y((p.reading.low + p.reading.high) / 2);
        const collides = paths.some(other => other.index < item.index && other.endpoint &&
          right - x(other.endpoint.time) <= 60 &&
          Math.abs(y((other.endpoint.reading.low + other.endpoint.reading.high) / 2) - mid) < 17);
        return !collides && <text key={item.index} fill={item.color} x={x(p.time) - 6}
          y={mid + (mid - top < 19 ? 15 : -8)} textAnchor="end" className={s.endpointValue}>{readingLabel(p.reading)}</text>;
      })}
      {cursorValues.map(({ device, color, sample, read }) => sample && read &&
        <g className={s.graphReadMarker} key={device.id} transform={`translate(${x(sample.time)},0)`}>
          {read.low === read.high ? <circle cy={y(read.low)} r="3.5" fill={color} /> :
            <path d={`M-3,${y(read.high)}h6M0,${y(read.high)}V${y(read.low)}M-3,${y(read.low)}h6`} stroke={color} />}
        </g>)}
    </svg>
    {xCursor !== null && <div className={s.sharedPlotCursor} data-plot-cursor="" aria-hidden="true">
      <small>{cursorLabel}</small>
    </div>}
    </div>
    {plotLanes.length > 0 && <div className={s.eventLanes} data-event-lanes="" role="group" aria-label="设备事件">
      {plotLanes.map(({ device, index, color, events, stagger }) => <div className={s.eventLane} key={device.id}
        data-event-series={index} style={{ '--series': color } as CSSProperties}>
        <span className={s.eventLaneLabel} title={device.name}><i data-series-shape={index} aria-hidden="true" />{device.name}</span>
        <div className={s.eventLaneTrack} data-event-track="">
          {events.map(event => {
            const label = eventLabel(event.kind);
            const change = `${label} · ${tick.format(event.at)}${event.end === undefined ? '' : '–' + tick.format(event.end)}`;
            const from = fraction(event.at), to = fraction(event.end ?? event.at);
            return <button type="button" key={event.kind + ':' + event.at}
              className={s.laneEvent} data-event={event.kind} data-event-label={label}
              data-event-wide={(to - from) * (right - left) > 64 || undefined}
              data-staggered={stagger.has(event) || undefined}
              style={{ left: from * 100 + '%', '--event-width': Math.max(0, to - from) * 100 + '%' } as CSSProperties}
              aria-label={device.name + ' · ' + change}
              aria-describedby={over === event ? hint : undefined}
              onPointerEnter={() => setOver(event)}
              onPointerLeave={ev => { if (!ev.currentTarget.matches(':focus-visible')) setOver(null); }}
              onFocus={() => focusEvent(event)}
              onBlur={() => setOver(null)}
              onClick={() => focusEvent(event)}>
              {event.kind === 'charging' ? <Zap size={12} aria-hidden="true" /> : <><i aria-hidden="true" /><span aria-hidden="true">{label}</span></>}
            </button>;
          })}
        </div>
      </div>)}
      <div className={s.eventGuides} aria-hidden="true">
        {ticks.map(t => <i key={t} style={{ left: fraction(t) * 100 + '%' }} />)}
      </div>
      {xCursor !== null && <div className={s.sharedLaneCursor} data-lane-cursor="" aria-hidden="true" />}
    </div>}
    {over && xCursor !== null ? <div id={hint} className={s.graphTooltip} data-kind={over.kind} role="tooltip">
      <span>{over.name}</span><div><b>{eventLabel(over.kind)}</b><span>{eventTime}</span></div>
    </div> : time !== null && <div className={s.graphTooltip} data-compare-tooltip="" role="tooltip">
      <span>{stamp.format(time)}</span>
      {cursorValues.map(({ device, color, read, value }) => <div key={device.id} style={{ '--series': color } as CSSProperties}>
        <i data-series-shape={series.find(item => item.device.id === device.id)?.index} aria-hidden="true" /><b>{device.name}</b><span data-no-reading={!read || undefined}>{value}</span>
        {read?.power === 'charging' && <Zap size={12} aria-label="充电中" />}
      </div>)}
    </div>}
    <span className={s.chartSrOnly} role="status">{keyboard && time !== null ?
      over ? over.name + ' ' + eventLabel(over.kind) + ' ' + eventTime :
        stamp.format(time) + ' ' + cursorValues.map(({ device, value, sample, read }) => device.name + ' ' + value +
        (read && sample ? '，读于 ' + stamp.format(sample.time) : '') + (read?.power === 'charging' ? '，充电中' : '')).join('；') : ''}</span>
  </div>;
}
