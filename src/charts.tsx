import { exactCurve, reduceCurve } from './history-curve';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { RefreshCw, Zap } from 'lucide-react';
import type { Device, HistoryPoint } from './model';
import { historyWindow, plotHistory, sampleAt, type PlotSeries } from './history-plot';
import { api, Art, readingLabel } from './ui';
import { ChartSkeleton } from './chart-loading';
import s from './panel.module.css';

const colors = ['#c5e4f6', '#cbbbf1', '#a2c9ba'];
const dash = [undefined, '6 3', '2 3'];
const dayTick = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' });
const tick = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const stamp = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
type ReadingResult = { points?: HistoryPoint[]; error?: string; query?: string };
type Series = { device: Device; plot: PlotSeries; color: string; index: number };

export function Chart({ device, threshold, large = false }: { device: Device; revision: number | null; threshold?: number; large?: boolean }) {
  return <HistoryComparison devices={[device]} threshold={threshold} large={large} />;
}

export function HistoryComparison({ devices, threshold, anchor, large = true }: { devices: Device[]; threshold?: number; anchor?: number; large?: boolean }) {
  const [results, setResults] = useState<Record<string, ReadingResult>>({});
  const [retry, setRetry] = useState(0);
  const [internalEnd, setEnd] = useState(() => Date.now());
  const end = anchor ?? internalEnd;
  const requests = useRef(new Map<string, { query: string }>());
  // Each device has its own revision and request token: do not reload or
  // invalidate other series when devices report at different cadences.
  const signature = (device: Device) => JSON.stringify([device.status, device.lastRead, retry]);
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
      void api.command({ type: 'history', id }).then(reply => {
        if (requests.current.get(id) !== token) return;
        setResults(previous => {
          const result = reply.ok ? { points: reply.history ?? [] } : { ...previous[id], error: reply.error };
          return { ...previous, [id]: { ...result, query } };
        });
        setEnd(Date.now());
      }).catch(() => {
        if (requests.current.get(id) === token) setResults(previous => ({
          ...previous, [id]: { ...previous[id], error: '暂时无法读取电量记录', query },
        }));
      });
    }
  }, [request]);

  const controlled = anchor !== undefined;
  useEffect(() => {
    if (controlled) return;
    const timer = window.setInterval(() => { if (!document.hidden) setEnd(Date.now()); }, 60_000);
    return () => window.clearInterval(timer);
  }, [controlled]);

  const start = end - historyWindow;
  const plotById = useMemo(() => new Map(Object.entries(results).map(([id, result]) =>
    [id, plotHistory(result.points ?? [], start, end)])), [results, start, end]);
  const activeSeries = useMemo(() => devices.flatMap((device, index): Series[] => {
    const plot = plotById.get(device.id);
    return plot?.points.length ? [{ device, plot, color: colors[index], index }] : [];
  }), [devices, plotById]);
  const pending = devices.some(device => results[device.id]?.query !== signature(device));
  const errors = devices.filter(({ id }) => !!results[id]?.error);
  const settledEmpty = devices.filter(({ id }) => results[id]?.points && !plotById.get(id)?.points.length);
  const onlyGaps = activeSeries.length > 0 && activeSeries.every(series => !series.plot.runs.length);
  return <div className={s.chartFrame} data-large={large}>
    <div className={s.chartPlot} data-large={large} aria-busy={pending}>
      {activeSeries.length ? <Graph series={activeSeries} start={start} end={end} threshold={threshold} /> : pending ?
        <ChartSkeleton /> : <div className={s.chartEmpty} data-large={large} role="status">
          {errors.length ? '暂时无法读取电量记录' : '近 24 小时暂无设备读数'}
        </div>}
    </div>
    <div className={s.chartMeta}>
      <div className={s.chartGuide} aria-label="图例">
        <span><i className={s.exactKey} />精确读数</span><span><i className={s.rangeKey} />上报区间</span>
        <span><Zap size={13} />采样显示充电</span><span><i className={s.gapKey} />无有效读数 / 无采样</span>
        {threshold !== undefined && activeSeries.length === 1 && <span><i className={s.thresholdKey} />提醒阈值 {threshold}%</span>}
      </div>
      {activeSeries.length > 0 && <span className={s.chartSrOnly}>{activeSeries.map(({ device, plot }) =>
        device.name + '：' + plot.charging.length + ' 次采样显示充电，' + plot.gaps.filter(gap => gap.kind === 'invalid').length +
        ' 段无有效读数，' + plot.gaps.filter(gap => gap.kind === 'unrecorded').length + ' 段未采样').join('；')}</span>}
      {!!activeSeries.length && pending && <span role="status" className={s.chartNotice}>正在更新，暂显示已有记录</span>}
      {!!settledEmpty.length && !!activeSeries.length && <span className={s.chartNotice}>{settledEmpty.map(device => device.name).join('、')}暂无记录</span>}
      {onlyGaps && <span className={s.chartNotice}>该时段仅有无效记录，尚不能绘制电量曲线</span>}
      {!!errors.length && <div className={s.chartNotice} role="status">
        {errors.map(device => device.name + (results[device.id]?.points ? '：保留上次记录' : '：读取失败')).join(' · ')}
        <button className={s.textButton} onClick={() => setRetry(value => value + 1)} disabled={pending}><RefreshCw size={13} />重试</button>
      </div>}
    </div>
    {activeSeries.length > 0 && <HistorySummary series={activeSeries} />}
  </div>;
}

function HistorySummary({ series }: { series: Series[] }) {
  return <table className={s.historySummary} aria-label="近 24 小时记录摘要">
    <thead><tr><th scope="col">设备</th><th scope="col">最低记录</th><th scope="col">最近充电采样</th><th scope="col">有效采样</th></tr></thead>
    <tbody>{series.map(({ device, plot, color }) => {
      const valid = plot.points.filter(point => !!point.reading);
      const lowest = valid.reduce<HistoryPoint | undefined>((best, point) => !best || point.reading!.low < best.reading!.low ||
        (point.reading!.low === best.reading!.low && point.reading!.high < best.reading!.high) ? point : best, undefined);
      const latestCharge = valid.findLast(point => point.reading?.power === 'charging');
      return <tr key={device.id}>
        <th scope="row"><div><Art device={device} /><i style={{ background: color }} /><span>{device.name}</span></div></th>
        <td>{lowest ? <>{readingLabel(lowest.reading)} <small>{tick.format(lowest.time)}</small></> : '—'}</td>
        <td>{latestCharge ? stamp.format(latestCharge.time) : '—'}</td><td>{valid.length.toLocaleString('zh-CN')} 次</td>
      </tr>;
    })}</tbody>
  </table>;
}

type HoverEvent = { name: string; kind: 'invalid' | 'unrecorded' | 'charging'; at: number; end?: number; reading?: HistoryPoint['reading'] };
function Graph({ series, start, end, threshold }: { series: Series[]; start: number; end: number; threshold?: number }) {
  const outer = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 900, height: 420 });
  const [pointer, setPointer] = useState<number | null>(null);
  const [over, setOver] = useState<HoverEvent | null>(null);
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    if (!outer.current) return;
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
  const top = 24;
  const bottom = Math.max(54, height - 49);
  const x = (time: number) => left + (time - start) / (end - start) * (right - left);
  const y = (value: number) => bottom - value / 100 * (bottom - top);
  const time = pointer === null ? null : start + pointer * (end - start);
  const xCursor = time === null ? null : x(time);
  const stepHours = width < 560 ? 8 : 4;
  const wallTick = new Date(start);
  wallTick.setHours(Math.floor(wallTick.getHours() / stepHours) * stepHours, 0, 0, 0);
  const ticks = [start];
  for (let count = 0; count < 9; count++) {
    wallTick.setHours(wallTick.getHours() + stepHours);
    const instant = wallTick.getTime();
    if (instant >= end || x(end) - x(instant) < 67) break;
    if (x(instant) - x(ticks.at(-1)!) >= 67) ticks.push(instant);
  }
  ticks.push(end);
  const paths = useMemo(() => series.map(({ plot, index, color }) => {
    const line: string[] = [];
    const dots: string[] = [];
    const bands: string[] = [];
    const brackets: string[] = [];
    const xy = (t: number, v: number) => x(t).toFixed(1) + ',' + y(v).toFixed(1);
    const step = (from: number, to: number, value: number) => 'H' + x(from).toFixed(1) + 'V' + y(value).toFixed(1) + 'H' + x(to).toFixed(1);
    const chargingAnchors = new Set(plot.charging.map(({ time }) => x(time)));
    for (const run of plot.runs) {
      if (run.kind === 'exact') {
        if (run.points.length > 1) {
          const samples = run.points.map(({ time, reading }) => [x(time), y(reading.low)] as const);
          const projected = reduceCurve(samples, Math.abs(y(0) - y(1)) * 1.05, chargingAnchors);
          line.push(exactCurve(projected));
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
      const last = run.points.at(-1)!;
      const upper = run.points.slice(1).map(point => 'H' + x(point.time).toFixed(1) + 'V' + y(point.reading.high).toFixed(1));
      const lower = run.points.slice(0, -1).reverse().map((point, i) =>
        step(run.points[run.points.length - 1 - i].time, point.time, point.reading.low));
      bands.push('M' + xy(first.time, first.reading.high) + upper.join('') + 'L' + xy(last.time, last.reading.low) + lower.join('') + 'Z');
    }
    return { index, color, line: line.join(''), dots, bands: bands.join(''), brackets: brackets.join('') };
  }), [series, start, end, width, height]);
  const eventPositions = useMemo(() => series.map(({ plot, index, color, device }) => {
    const valid = plot.runs.flatMap(run => run.points);
    let next = 0;
    const gaps = plot.gaps.map(gap => {
      while (next < valid.length && valid[next].time < gap.start) next++;
      const before = valid[next - 1];
      const after = valid[next];
      const matching = before ?? after;
      // The bracket is annotation, never an imputed value or line. Place it in
      // the vicinity of the adjacent trace, safely inset from plot edges.
      const labelAt = matching ? Math.min(88, Math.max(12, matching.reading.high)) : 58 - index * 14;
      const l = Math.min(right - 7, Math.max(left + 2, x(gap.start)));
      const r = Math.min(right, Math.max(l + 6, x(gap.end)));
      return { ...gap, l, r, top: y(labelAt) + (index === 0 ? 0 : index % 2 ? 14 : -14) };
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
  const cursorValues = time === null ? [] : series.map(({ device, plot, color }) => {
    const sample = sampleAt(plot, time);
    const read = sample?.reading;
    return { device, color, sample, read, value: read ? readingLabel(read) : sample ? '无有效读数' : '未记录采样' };
  });
  const hoverSide = over ? ((over.end ?? over.at) + over.at) / 2 > start + (end - start) * .53 : (pointer ?? 0) > .53;
  const eventName = over?.kind === 'charging' ? '采样显示正在充电' : over?.kind === 'invalid' ? '无有效读数' : '无采样';
  return <div className={s.graph} ref={outer} tabIndex={0} onKeyDown={moveKey}
    aria-label="近 24 小时电量曲线。用左右方向键查看时间点，Escape 退出。"
    onPointerMove={event => {
      setKeyboard(false);
      const bounds = event.currentTarget.getBoundingClientRect();
      setPointer(Math.max(0, Math.min(1, (event.clientX - bounds.left - left) / (right - left))));
    }} onPointerLeave={() => { setOver(null); if (!keyboard) setPointer(null); }}
    onBlur={() => { setKeyboard(false); setPointer(null); setOver(null); }}>
    <svg className={s.graphSvg} width="100%" height="100%" aria-hidden="true">
      {[0, 25, 50, 75, 100].map(value => <g key={value}>
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
          <text className={s.graphLabel} x={px} y={bottom + 23} textAnchor={anchor}>{last ? '现在' : tick.format(instant)}</text>
          <text className={s.graphDate} x={px} y={bottom + 41} textAnchor={anchor}>{dayTick.format(instant)}</text>
        </g>;
      })}
      {threshold !== undefined && series.length === 1 && <line x1={left} x2={right} y1={y(threshold)} y2={y(threshold)}
        className={s.graphThreshold} strokeDasharray="4 5"><title>提醒阈值 {threshold}%</title></line>}
      {paths.map(item => <g key={item.index} stroke={item.color} fill={item.color} data-series={item.index}>
        <path data-trace="range" d={item.bands} fillOpacity=".19" strokeOpacity=".78" strokeWidth="1.4" />
        <path d={item.brackets} fill="none" strokeWidth="2.6" strokeOpacity=".75" />
        <path data-trace="exact" d={item.line} fill="none" strokeWidth="2.45" strokeDasharray={dash[item.index]} strokeLinejoin="round" strokeLinecap="round" />
        {item.dots.map((value, index) => { const [cx, cy] = value.split(','); return <circle key={index} cx={cx} cy={cy} r="2" />; })}
      </g>)}
      {eventPositions.map(({ device, color, index, gaps, valid, plot }) => <g key={device.id} data-event-series={index}>
        {index === 0 && valid.length > 1 && [valid[0], valid.at(-1)!].map((point, i) => point.reading.low === point.reading.high &&
          <g key={point.time} fill={color} pointerEvents="none">
            <circle cx={x(point.time)} cy={y(point.reading.high)} r="3.5" />
            <text x={x(point.time) + (i === 0 ? 7 : -7)} y={y(point.reading.high) + (point.reading.high > 92 ? 17 : -10)}
              textAnchor={i === 0 ? 'start' : 'end'} className={s.endpointValue}>{readingLabel(point.reading)}</text>
          </g>)}
        {gaps.map(gap => {
          const span = gap.r - gap.l;
          const mid = (gap.l + gap.r) / 2;
          const label = gap.kind === 'invalid' ? '无有效读数' : '无采样';
          const inset = gap.kind === 'invalid' ? 41 : 29;
          const showLabel = span > inset * 2 + 16;
          const mark = (a: number, b: number) => 'M' + a + ',' + gap.top + 'H' + b;
          const event: HoverEvent = { name: device.name, kind: gap.kind, at: gap.start, end: gap.end };
          return <g key={gap.start + ':' + gap.kind} data-event={gap.kind} data-event-label={label}
            className={s.chartEvent} onPointerEnter={() => setOver(event)} onPointerLeave={() => setOver(null)}>
            <rect fill="transparent" x={gap.l - 5} y={gap.top - 13} width={span + 10} height="26"/>
            <path d={(showLabel ? mark(gap.l, mid - inset) + mark(mid + inset, gap.r) : mark(gap.l, gap.r)) +
              'M' + gap.l + ',' + (gap.top - 7) + 'v14M' + gap.r + ',' + (gap.top - 7) + 'v14'}
              stroke={color} strokeOpacity={index === 0 ? '.87' : '.75'} strokeWidth="1.15" fill="none"
              strokeDasharray={gap.kind === 'unrecorded' ? '3 3' : undefined} pointerEvents="none" />
            {showLabel && <text x={mid} y={gap.top + 4} textAnchor="middle" className={s.gapLabel} fill={color} pointerEvents="none">{label}</text>}
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
            <circle r="8" fill={color} stroke="var(--window)" strokeWidth="1.5" pointerEvents="none" />
            <path d="M1.5 -5L-3 1H0L-1 5L3.8 -1.2H.5Z" fill="var(--window)" pointerEvents="none" />
          </g>;
        })}
      </g>)}
      {xCursor !== null && !over && <line className={s.graphCursor} x1={xCursor} x2={xCursor} y1={top} y2={bottom} />}
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
        {read && sample && <small>读于 {stamp.format(sample.time)}</small>}
      </div>)}
    </div>}
    <span className={s.chartSrOnly} role="status">{keyboard && time !== null ?
      stamp.format(time) + ' ' + cursorValues.map(({ device, value, sample, read }) => device.name + ' ' + value +
        (read && sample ? '，读于 ' + stamp.format(sample.time) : '') + (read?.power === 'charging' ? '，充电中' : '')).join('；') : ''}</span>
  </div>;
}
