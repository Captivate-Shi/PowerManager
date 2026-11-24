import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { RefreshCw, Zap } from 'lucide-react';
import type { Device, HistoryPoint } from './model';
import { historyWindow, plotHistory, sampleAt, type PlotSeries } from './history-plot';
import { api } from './ui';
import { ChartSkeleton } from './chart-loading';
import s from './panel.module.css';

const colors = ['#a8c8ed', '#c3adf7', '#82d9be'];
const dash = [undefined, '7 3', '2 3'];
const hour = 3_600_000;
const tick = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const stamp = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
type ReadingResult = { points?: HistoryPoint[]; error?: string; query?: string };
type Series = { device: Device; plot: PlotSeries; color: string; index: number };

export function Chart({ device, threshold, large = false }: { device: Device; revision: number | null; threshold?: number; large?: boolean }) {
  return <HistoryComparison devices={[device]} threshold={threshold} large={large} />;
}

export function HistoryComparison({ devices, threshold, large = true }: { devices: Device[]; threshold?: number; large?: boolean }) {
  const [results, setResults] = useState<Record<string, ReadingResult>>({});
  const [retry, setRetry] = useState(0);
  const [end, setEnd] = useState(() => Date.now());
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

  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) setEnd(Date.now()); }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

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
  </div>;
}

function Graph({ series, start, end, threshold }: { series: Series[]; start: number; end: number; threshold?: number }) {
  const outer = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 600, height: 260 });
  const [pointer, setPointer] = useState<number | null>(null);
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
  const left = 42;
  const right = width - 13;
  const top = 18;
  const bottom = Math.max(54, height - 32 - series.length * 15);
  const x = (time: number) => left + (time - start) / (end - start) * (right - left);
  const y = (value: number) => bottom - value / 100 * (bottom - top);
  const time = pointer === null ? null : start + pointer * (end - start);
  const xCursor = time === null ? null : x(time);
  const laneY = (lane: number) => bottom + 12 + lane * 15;
  const divisions = width < 420 ? 3 : 6;
  // Actual paths change only when data or chart geometry changes, not while
  // inspecting a timestamp with the pointer.
  const paths = useMemo(() => series.map(({ plot, index, color }) => {
    const line: string[] = [];
    const dots: string[] = [];
    const bands: string[] = [];
    const brackets: string[] = [];
    const xy = (t: number, v: number) => x(t).toFixed(1) + ',' + y(v).toFixed(1);
    const step = (from: number, to: number, height: number) => 'H' + x(from).toFixed(1) + 'V' + y(height).toFixed(1) + 'H' + x(to).toFixed(1);
    for (const run of plot.runs) {
      if (run.kind === 'exact') {
        const segments = run.points.map(point => xy(point.time, point.reading.low));
        if (segments.length > 1) line.push('M' + segments.join('L'));
        else dots.push(segments[0]);
      } else {
        const first = run.points[0];
        if (run.points.length === 1) {
          const pos = x(first.time).toFixed(1);
          brackets.push('M' + pos + ',' + y(first.reading.low).toFixed(1) + 'V' + y(first.reading.high).toFixed(1));
          continue;
        }
        const last = run.points.at(-1)!;
        const upper = run.points.slice(1).map(point => 'H' + x(point.time).toFixed(1) + 'V' + y(point.reading.high).toFixed(1));
        const reverse = run.points.slice(0, -1).reverse();
        const lower = reverse.map((point, i) => step(run.points[run.points.length - 1 - i].time, point.time, point.reading.low));
        bands.push('M' + xy(first.time, first.reading.high) + upper.join('') + 'L' + xy(last.time, last.reading.low) + lower.join('') + 'Z');
      }
    }
    return { index, color, line: line.join(''), dots, bands: bands.join(''), brackets: brackets.join('') };
  }), [series, start, end, width, height]);

  function moveKey(event: KeyboardEvent) {
    const value = pointer ?? 1;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    setKeyboard(true);
    const stride = 1 / (event.shiftKey ? 24 : 96);
    setPointer(event.key === 'Escape' ? null : event.key === 'Home' ? 0 : event.key === 'End' ? 1 :
      Math.min(1, Math.max(0, value + (event.key === 'ArrowLeft' ? -stride : stride))));
  }
  const cursorValues = time === null ? [] : series.map(({ device, plot, color }) => {
    const sample = sampleAt(plot, time);
    const read = sample?.reading;
    const value = read ? (read.low === read.high ? read.low : read.low + '–' + read.high) + '%' :
      sample ? '无有效读数' : '未记录采样';
    return { device, color, sample, read, value };
  });
  return <div className={s.graph} ref={outer} tabIndex={0} onKeyDown={moveKey}
    aria-label="近 24 小时电量曲线。用左右方向键查看时间点，Escape 退出。"
    onPointerMove={event => {
      setKeyboard(false);
      const bounds = event.currentTarget.getBoundingClientRect();
      setPointer(Math.max(0, Math.min(1, (event.clientX - bounds.left - left) / (right - left))));
    }} onPointerLeave={() => { if (!keyboard) setPointer(null); }} onBlur={() => { setKeyboard(false); setPointer(null); }}>
    <svg className={s.graphSvg} width="100%" height="100%" aria-hidden="true">
      {[0, 25, 50, 75, 100].map(value => <g key={value}>
        <line className={s.graphGrid} x1={left} x2={right} y1={y(value)} y2={y(value)} />
        <text className={s.graphLabel} x={left - 8} y={y(value) + 4} textAnchor="end">{value}%</text>
      </g>)}
      {Array.from({ length: divisions + 1 }, (_, i) => {
        const instant = start + i * (end - start) / divisions;
        return <text key={i} className={s.graphLabel} x={x(instant)} y={height - 7}
          textAnchor={i === 0 ? 'start' : i === divisions ? 'end' : 'middle'}>{i === divisions ? '现在' : tick.format(instant)}</text>;
      })}
      {threshold !== undefined && series.length === 1 && <line x1={left} x2={right} y1={y(threshold)} y2={y(threshold)}
        className={s.graphThreshold} strokeDasharray="4 5"><title>提醒阈值 {threshold}%</title></line>}
      {paths.map(item => <g key={item.index} stroke={item.color} fill={item.color} data-series={item.index}>
        <path d={item.bands} fillOpacity=".19" strokeOpacity=".65" strokeWidth="1" />
        <path d={item.brackets} fill="none" strokeWidth="3" strokeOpacity=".7" />
        <path d={item.line} fill="none" strokeWidth="2" strokeDasharray={dash[item.index]} strokeLinejoin="round" />
        {item.dots.map((value, index) => { const [cx, cy] = value.split(','); return <circle key={index} cx={cx} cy={cy} r="2" />; })}
      </g>)}
      {series.map(({ plot, color, index, device }, lane) => <g key={device.id} stroke={color}
        aria-hidden="true" data-event-series={index}>
        <text x={left - 8} y={laneY(lane) + 3} textAnchor="end" className={s.eventLaneLabel} stroke="none" fill={color}>{index + 1}</text>
        <line x1={left} x2={right} y1={laneY(lane)} y2={laneY(lane)} className={s.graphGrid} />
        {plot.gaps.map(gap => <line key={gap.start + ':' + gap.kind} x1={x(gap.start)} x2={Math.max(x(gap.start) + 3, x(gap.end))}
          y1={laneY(lane)} y2={laneY(lane)} strokeDasharray={gap.kind === 'invalid' ? '3 2' : '1 3'}
          data-event={gap.kind} strokeWidth="3" strokeOpacity={gap.kind === 'invalid' ? '.90' : '.55'}>
          <title>{device.name}：{gap.kind === 'invalid' ? '无有效读数' : '未记录采样'} · {stamp.format(gap.start)}–{stamp.format(gap.end)}</title>
        </line>)}
        {plot.charging.map(({ time: at }) => <g key={at} transform={'translate(' + x(at) + ' ' + laneY(lane) + ')'} data-event="charging">
          <circle r="6" fill="var(--panel)" strokeWidth="1.5" />
          <path d="M1 -4L-2 1H0L-1 4L3 -1H0Z" fill={color} stroke="none" />
          <title>{device.name}：采样显示正在充电 · {stamp.format(at)}</title>
        </g>)}
      </g>)}
      {xCursor !== null && <line className={s.graphCursor} x1={xCursor} x2={xCursor} y1={top} y2={bottom} />}
    </svg>
    {time !== null && <div className={s.graphTooltip} data-side={(pointer ?? 0) > .52 ? 'start' : 'end'}>
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
