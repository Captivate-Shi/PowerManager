import { exactCurve, intervalPaths, intervalRibbon, trendCurve } from './history-curve';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { RefreshCw, Zap } from 'lucide-react';
import type { Device, HistoryDay, HistoryPoint, HistoryRange } from './model';
import { historyRangeLabels, historyStart, plotHistory, sampleAt, type PlotSeries } from './history-plot';
import { api, Art, readingLabel } from './ui';
import { ChartFrame, ChartProgress, ChartSkeleton, HistorySummary, historyColors, type ChartView } from './chart-loading';
import s from './panel.module.css';

const dayTick = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' });
const tick = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const stamp = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
type ReadingResult = { points?: HistoryPoint[]; days?: HistoryDay[]; error?: string; query?: string; range: HistoryRange };
type Series = { device: Device; plot: PlotSeries; color: string; index: number; days?: HistoryDay[] };

export function Chart({ device, threshold, large = false }: { device: Device; revision: number | null; threshold?: number; large?: boolean }) {
  return <HistoryComparison devices={[device]} threshold={threshold} large={large} reserveRows={1} />;
}

export function HistoryComparison({ devices, threshold, anchor, range = 'day', large = true, reserveRows = 3 }: {
  devices: Device[]; threshold?: number; anchor?: number; range?: HistoryRange; large?: boolean; reserveRows?: 1 | 3;
}) {
  const [results, setResults] = useState<Record<string, ReadingResult>>({});
  const [retry, setRetry] = useState(0);
  const [view, setView] = useState<ChartView>('trend');
  const [internalEnd, setEnd] = useState(() => Date.now());
  const end = anchor ?? internalEnd;
  const requests = useRef(new Map<string, { query: string }>());
  // Each device has its own revision and request token: do not reload or
  // invalidate other series when devices report at different cadences.
  const signature = (device: Device) => JSON.stringify([device.status, device.historyUpdatedAt ?? device.lastRead, retry, range]);
  const request = JSON.stringify(devices.map(device => [device.id, signature(device)]));
  useEffect(() => () => requests.current.clear(), []);
  useEffect(() => {
    const keys = JSON.parse(request) as Array<[string, string]>;
    const activeIds = new Set(keys.map(([id]) => id));
    for (const id of requests.current.keys()) if (!activeIds.has(id)) requests.current.delete(id);
    setResults(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => activeIds.has(id))));
    setEnd(Date.now());
    for (const [id, query] of keys) {
      if (requests.current.get(id)?.query === query) continue;
      const token = { query };
      requests.current.set(id, token);
      void api.command({ type: 'history', id, range }).then(reply => {
        if (requests.current.get(id) !== token) return;
        setResults(previous => {
          const retained = previous[id]?.range === range ? previous[id] : undefined;
          const result = reply.ok ? { points: reply.history, days: reply.historyDays } : { ...retained, error: reply.error };
          return { ...previous, [id]: { ...result, query, range } };
        });
        setEnd(Date.now());
      }).catch(() => {
        if (requests.current.get(id) === token) setResults(previous => ({
          ...previous, [id]: { ...(previous[id]?.range === range ? previous[id] : undefined), error: '暂时无法读取电量记录', query, range },
        }));
      });
    }
  }, [request, range]);

  const controlled = anchor !== undefined;
  useEffect(() => {
    if (controlled) return;
    const timer = window.setInterval(() => { if (!document.hidden) setEnd(Date.now()); }, 60_000);
    return () => window.clearInterval(timer);
  }, [controlled]);

  const start = historyStart(end, range);
  const daysById = useMemo(() => new Map(Object.entries(results).filter(([, result]) => result.range === range && result.days)
    .map(([id, result]) => [id, result.days!.filter(bucket => bucket.day >= start && bucket.lowest.time <= end)])), [results, range, start, end]);
  const plotById = useMemo(() => new Map(Object.entries(results).filter(([, result]) => result.range === range)
    .map(([id, result]): [string, PlotSeries] => {
      if (range === 'day') return [id, plotHistory(result.points ?? [], start, end)];
      const points = (daysById.get(id) ?? []).map(bucket => bucket.lowest);
      return [id, { points, runs: points.map(point => ({ kind: point.reading.low === point.reading.high ? 'exact' : 'range', points: [point] })),
        gaps: [], charging: [] }];
    })), [results, range, start, end, daysById]);
  const activeSeries = useMemo(() => devices.flatMap((device, index): Series[] => {
    const plot = plotById.get(device.id);
    return plot?.points.length ? [{ device, plot, color: historyColors[index], index, days: daysById.get(device.id) }] : [];
  }), [devices, plotById, daysById]);
  const hasData = (id: string) => results[id]?.range === range && !!(results[id].points || results[id].days);
  const pending = devices.some(device => results[device.id]?.query !== signature(device));
  const errors = devices.filter(({ id }) => results[id]?.range === range && !!results[id]?.error);
  const settledEmpty = devices.filter(({ id }) => hasData(id) && !plotById.get(id)?.points.length);
  const onlyGaps = activeSeries.length > 0 && activeSeries.every(series => !series.plot.runs.length);
  const status = errors.length ? {
    text: errors.map(device => device.name + (hasData(device.id) ? '：保留上次记录' : '：读取失败')).join(' · '),
    retry: true,
  } : pending && activeSeries.length ? {
    text: '正在更新，暂显示已有记录',
    progress: true,
  } : settledEmpty.length && activeSeries.length ? {
    text: settledEmpty.map(device => device.name).join('、') + '暂无记录',
  } : onlyGaps ? { text: '该时段仅有无效记录，尚不能绘制电量曲线' } : undefined;
  const notice = <>
    {range === 'day' && activeSeries.length > 0 && <span className={s.chartSrOnly}>{activeSeries.map(({ device, plot }) =>
      device.name + '：' + plot.charging.length + ' 次采样显示充电，' + plot.gaps.filter(gap => gap.kind === 'invalid').length +
      ' 段无有效读数，' + plot.gaps.filter(gap => gap.kind === 'unrecorded').length + ' 段未采样').join('；')}</span>}
    {status && <div className={s.chartNotice} role="status">
      {status.progress ? <ChartProgress>{status.text}</ChartProgress> : <span title={status.text}>{status.text}</span>}
      {status.retry && <button className={s.textButton} onClick={() => setRetry(value => value + 1)} disabled={pending}><RefreshCw size={13} />重试</button>}
    </div>}
  </>;
  const summary = <HistorySummary range={range} rows={devices.map(device => {
    const result = results[device.id];
    const days = daysById.get(device.id);
    const valid = (plotById.get(device.id)?.points ?? []).filter(point => !!point.reading);
    const lowest = valid.reduce<HistoryPoint | undefined>((best, point) => !best || point.reading!.low < best.reading!.low ||
      (point.reading!.low === best.reading!.low && point.reading!.high < best.reading!.high) ? point : best, undefined);
    const latestCharge = days ? Math.max(0, ...days.map(bucket => bucket.lastCharge ?? 0)) :
      valid.findLast(point => point.reading?.power === 'charging')?.time;
    const count = days ? days.reduce((total, bucket) => total + bucket.count, 0) : valid.length;
    return { device, name: <Art device={device} />, pending: !hasData(device.id) && result?.query !== signature(device),
      lowest: lowest && <>{readingLabel(lowest.reading)} <small>{(range === 'day' ? tick : stamp).format(lowest.time)}</small></>,
      charge: latestCharge ? stamp.format(latestCharge) : undefined,
      count: hasData(device.id) ? count.toLocaleString('zh-CN') + ' 次' : undefined };
  })} />;
  return <ChartFrame large={large} pending={pending} threshold={threshold} notice={notice} summary={summary} reserveRows={reserveRows} range={range}
    view={view} onView={activeSeries.some(item => item.plot.runs.length) ? setView : undefined}>
    {activeSeries.length ? <Graph key={range} series={activeSeries} start={start} end={end} threshold={threshold} range={range} view={view} /> : pending ?
      <ChartSkeleton large={large} /> : <div className={s.chartEmpty} data-large={large} role="status">
        {errors.length ? '暂时无法读取电量记录' : '近 ' + historyRangeLabels[range] + '暂无设备读数'}
      </div>}
  </ChartFrame>;
}

type HoverEvent = { name: string; kind: 'invalid' | 'unrecorded' | 'charging'; at: number; end?: number; reading?: HistoryPoint['reading'] };
function Graph({ series, start, end, threshold, range, view }: {
  series: Series[]; start: number; end: number; threshold?: number; range: HistoryRange; view: ChartView;
}) {
  const gradientId = useId();
  const outer = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 900, height: 420 });
  const [pointer, setPointer] = useState<number | null>(null);
  const [over, setOver] = useState<HoverEvent | null>(null);
  const [keyboard, setKeyboard] = useState(false);
  useLayoutEffect(() => {
    if (!outer.current) return;
    const { width, height } = outer.current.getBoundingClientRect();
    if (width > 0 && height > 0) setSize({ width, height });
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    ro.observe(outer.current);
    return () => ro.disconnect();
  }, []);
  const { width, height } = size;
  const left = width < 560 ? 39 : 65;
  const right = width - (width < 560 ? 10 : 24);
  const compact = height < 145;
  const top = compact ? 11 : 14;
  const bottom = Math.max(33, height - (range === 'day' ? compact ? 34 : 59 : 30));
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
    for (let i = 1; i < intervals; i++) ticks.push(start + (end - start) * i / intervals);
  }
  ticks.push(end);
  const paths = useMemo(() => series.map(({ plot, index, color }) => {
    const line: string[] = [];
    const dots: string[] = [];
    const bands: string[] = [];
    const upperEdges: string[] = [];
    const lowerEdges: string[] = [];
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
      const first = run.points[0];
      if (run.points.length === 1) {
        const pos = x(first.time).toFixed(1);
        brackets.push('M' + pos + ',' + y(first.reading.low).toFixed(1) + 'V' + y(first.reading.high).toFixed(1));
        continue;
      }
      const points = run.points.map(({ time, reading }) => [x(time), y(reading.high), y(reading.low)] as const);
      if (view === 'trend') {
        bands.push(intervalRibbon(points));
        const last = points.at(-1)!;
        const previous = points[points.length - 2];
        if (previous[1] !== last[1] || previous[2] !== last[2]) brackets.push(`M${last[0]},${last[1]}V${last[2]}`);
      } else {
        const interval = intervalPaths(points);
        bands.push(interval.fill);
        upperEdges.push(interval.upper);
        lowerEdges.push(interval.lower);
      }
    }
    return { index, color, line: line.join(''), dots, bands: bands.join(''), brackets: brackets.join(''),
      upper: upperEdges.join(''), lower: lowerEdges.join('') };
  }), [series, start, end, width, height, view]);
  const eventPositions = useMemo(() => series.map(({ plot, index, color, device }) => {
    const valid = plot.runs.flatMap(run => run.points);
    const gaps = [...plot.gaps].sort((a, b) => Number(a.kind === 'invalid') - Number(b.kind === 'invalid')).map(gap => {
      const l = Math.max(left, x(gap.start));
      const r = Math.min(right, x(gap.end));
      return { ...gap, l, r, top: bottom + 6 + index * 6 };
    });
    return { device, plot, index, color, gaps, valid };
  }), [series, start, end, width, height]);

  function moveKey(event: KeyboardEvent) {
    const value = pointer ?? 1;
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
    return { device, color, sample, read, value: read ? readingLabel(read) : sample ? '无有效读数' : '未记录采样' };
  });
  const hoverSide = over ? ((over.end ?? over.at) + over.at) / 2 > start + (end - start) * .53 : (pointer ?? 0) > .53;
  const eventName = over?.kind === 'charging' ? '采样显示正在充电' : over?.kind === 'invalid' ? '无有效读数' : '无采样';
  return <div className={s.graph} ref={outer} tabIndex={0} data-chart-view={view} onKeyDown={moveKey}
    aria-label={`近 ${historyRangeLabels[range]}${range === 'day' ? '电量曲线' : '每日最低读数'}。用左右方向键查看时间点，Escape 退出。`}
    onPointerMove={event => {
      setKeyboard(false);
      const bounds = event.currentTarget.getBoundingClientRect();
      const localX = event.clientX - bounds.left;
      const localY = event.clientY - bounds.top;
      setPointer(localX < left || localX > right || localY < top || localY > bottom ? null : (localX - left) / (right - left));
    }} onPointerLeave={() => { setOver(null); if (!keyboard) setPointer(null); }}
    onBlur={() => { setKeyboard(false); setPointer(null); setOver(null); }}>
    <svg className={s.graphSvg} width="100%" height="100%" aria-hidden="true">
      <defs>{paths.filter(item => item.bands).map(item => <linearGradient key={item.index}
        id={gradientId + '-range-' + item.index} x2="0%" y2="100%">
        <stop offset="0%" stopColor={item.color} stopOpacity={view === 'trend' ? '.46' : '.25'} />
        <stop offset="100%" stopColor={item.color} stopOpacity={view === 'trend' ? '.17' : '.09'} />
      </linearGradient>)}</defs>
      {(compact ? [0, 50, 100] : [0, 25, 50, 75, 100]).map(value => <g key={value}>
        <line className={value === 0 ? s.graphAxis : s.graphGrid} x1={left - 6} x2={right} y1={y(value)} y2={y(value)} />
        <text className={s.graphLabel} x={left - 11} y={y(value) + 4.5} textAnchor="end">{value}%</text>
      </g>)}
      <line className={s.graphAxis} x1={left} x2={left} y1={top} y2={bottom} />
      {ticks.map((instant, i) => {
        const last = i === ticks.length - 1;
        const anchor = i === 0 ? 'start' : last ? 'end' : 'middle';
        const px = x(instant);
        return <g key={i}>
          <line className={s.graphAxis} x1={px} x2={px} y1={bottom} y2={bottom + 7}/>
          <text className={s.graphLabel} x={px} y={bottom + (range === 'day' ? compact ? 30 : 34 : 22)} textAnchor={anchor}>
            {last ? '现在' : (range === 'day' ? tick : dayTick).format(instant)}</text>
          {range === 'day' && !compact && <text className={s.graphDate} x={px} y={bottom + 49} textAnchor={anchor}>{dayTick.format(instant)}</text>}
        </g>;
      })}
      {threshold !== undefined && series.length === 1 && <line x1={left} x2={right} y1={y(threshold)} y2={y(threshold)}
        className={s.graphThreshold} strokeDasharray="4 5"><title>提醒阈值 {threshold}%</title></line>}
      {paths.map(item => <g key={item.index} stroke={item.color} fill={item.color} data-series={item.index}>
        <path data-trace="range" d={item.bands} fill={`url(#${gradientId}-range-${item.index})`} stroke="none" />
        <path className={s.graphBandUpper} d={item.upper} />
        <path className={s.graphBandLower} d={item.lower} />
        <path className={s.graphBandUpper} d={item.brackets} />
        <path data-trace="exact" className={s.graphTrace} d={item.line} />
        {item.dots.map((value, index) => { const [cx, cy] = value.split(','); return <circle key={index} cx={cx} cy={cy} r="2" />; })}
      </g>)}
      {eventPositions.map(({ device, color, index, gaps, valid, plot }) => <g key={device.id} data-event-series={index}>
        {range === 'day' && !compact && index === 0 && valid.length > 1 && [valid.at(-1)!].map(point => point.reading.low === point.reading.high &&
          <g key={point.time} fill={color} pointerEvents="none">
            <circle cx={x(point.time)} cy={y(point.reading.high)} r="2.7" />
            <text x={x(point.time) - 7} y={y(point.reading.high) + (point.reading.high > 92 ? 17 : -10)}
              textAnchor="end" className={s.endpointValue}>{readingLabel(point.reading)}</text>
          </g>)}
        {gaps.map(gap => {
          const label = gap.kind === 'invalid' ? '无有效读数' : '无采样';
          const event: HoverEvent = { name: device.name, kind: gap.kind, at: gap.start, end: gap.start < gap.end ? gap.end : undefined };
          return <g key={gap.start + ':' + gap.kind} data-event={gap.kind} data-event-label={label}
            className={s.chartEvent} onPointerEnter={() => setOver(event)} onPointerLeave={() => setOver(null)}>
            <rect fill="transparent" x={gap.l - 3} y={gap.top - 3} width={gap.r - gap.l + 6} height="6"/>
            {gap.start === gap.end
              ? <circle cx={gap.l} cy={gap.top} r="1.75" fill={color} pointerEvents="none" />
              : <path d={`M${gap.l},${gap.top}H${gap.r}`} stroke={color} strokeOpacity=".58" strokeWidth="2" fill="none"
                strokeDasharray={gap.kind === 'unrecorded' ? '2 3' : undefined} pointerEvents="none" />}
          </g>;
        })}
        {plot.charging.map(({ time: at, reading }) => {
          // For an interval, pin to its upper bound and explain the full
          // interval in the tooltip; do not synthesize an exact reading.
          const event: HoverEvent = { name: device.name, kind: 'charging', at, reading };
          return <g key={at} data-event="charging" className={s.chartEvent}
            transform={'translate(' + x(at) + ' ' + y(reading.high) + ')'}
            onPointerEnter={() => setOver(event)} onPointerLeave={() => setOver(null)}>
            <circle r="13" fill="transparent" />
            <circle r="7" fill={color} stroke="var(--window)" strokeWidth="1.5" pointerEvents="none" />
            <path d="M1.5 -5L-3 1H0L-1 5L3.8 -1.2H.5Z" fill="var(--window)" pointerEvents="none" />
          </g>;
        })}
      </g>)}
      {xCursor !== null && !over && <line className={s.graphCursor} x1={xCursor} x2={xCursor} y1={top} y2={bottom} />}
      {!over && cursorValues.map(({ device, color, sample, read }) => sample && read &&
        <g className={s.graphReadMarker} key={device.id} transform={`translate(${x(sample.time)},0)`}>
          {read.low === read.high ? <circle cy={y(read.low)} r="3.5" fill={color} /> :
            <path d={`M-3,${y(read.high)}h6M0,${y(read.high)}V${y(read.low)}M-3,${y(read.low)}h6`} stroke={color} />}
        </g>)}
    </svg>
    {over ? <div className={s.graphTooltip} data-side={hoverSide ? 'start' : 'end'} data-kind={over.kind}>
      <b>{over.name} · {eventName}</b>
      <span>{stamp.format(over.at)}{over.end !== undefined ? ' – ' + stamp.format(over.end) : ''}</span>
      {over.reading && <span>{readingLabel(over.reading)}</span>}
    </div> : time !== null && <div className={s.graphTooltip} data-side={hoverSide ? 'start' : 'end'}>
      <span>{stamp.format(time)}</span>
      {cursorValues.map(({ device, color, sample, read, value }) => <div key={device.id} style={{ '--series': color } as CSSProperties}>
        <i /><b>{device.name}</b><span>{value}</span>
        {read?.power === 'charging' && <Zap size={12} aria-label="充电记录" />}
        {read && sample && <small>{range === 'day' ? '读于' : '当日最低 ·'} {stamp.format(sample.time)}</small>}
      </div>)}
    </div>}
    <span className={s.chartSrOnly} role="status">{keyboard && time !== null ?
      stamp.format(time) + ' ' + cursorValues.map(({ device, value, sample, read }) => device.name + ' ' + value +
        (read && sample ? '，读于 ' + stamp.format(sample.time) : '') + (read?.power === 'charging' ? '，充电中' : '')).join('；') : ''}</span>
  </div>;
}
