import { useEffect, useId, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { type Device, type HistoryPoint } from './model';
import { api, dateLabel } from './ui';
import s from './panel.module.css';

export function Chart({ device, revision, threshold, large = false }: { device: Device; revision: number | null; threshold?: number; large?: boolean }) {
  const gradient = useId();
  const [result, setResult] = useState<{ id: string; points: HistoryPoint[]; error?: string }>();
  useEffect(() => {
    let active = true;
    void api.command({ type: 'history', id: device.id }).then(reply => {
      if (active) setResult(reply.ok ? { id: device.id, points: reply.history ?? [] } : { id: device.id, points: [], error: reply.error });
    }).catch(() => {
      if (active) setResult({ id: device.id, points: [], error: '暂时无法读取电量记录' });
    });
    return () => { active = false; };
  }, [device.id, device.status, revision]);
  const now = Date.now();
  const start = now - 86400000;
  const points = result?.id === device.id ? result.points.filter(point => point.time >= start) : [];
  if (!points.some(point => point.reading)) {
    return <div className={s.chartEmpty} data-large={large} role="status">{result?.id === device.id ? result.error ?? '等待设备上报电量后生成曲线' : '正在加载电量历史…'}</div>;
  }
  const hasRanges = points.some(point => point.reading && point.reading.low !== point.reading.high);
  const data = points.map(point => ({
    time: point.time,
    level: point.reading ? point.reading.high : null,
    range: point.reading ? [point.reading.low, point.reading.high] : null,
  }));
  const labels = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const color = hasRanges ? '#f5c16f' : '#9abde7';
  const present = data.filter(point => point.level !== null).length;
  return <>{hasRanges && <p className={s.chartLegend}>阶梯区间表示设备上报的电量范围</p>}<div className={s.chart} data-large={large} role="group" aria-label={device.name + '近 24 小时电量曲线'}>
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <AreaChart data={data} margin={{ top: 10, right: 14, bottom: 3, left: 0 }}>
        <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor={color} stopOpacity={.28} /><stop offset="100%" stopColor={color} stopOpacity={.025} />
        </linearGradient></defs>
        <CartesianGrid stroke="#303744" vertical={false} />
        <XAxis type="number" dataKey="time" domain={[start, now]} allowDataOverflow
          ticks={Array.from({ length: large ? 7 : 5 }, (_, i) => start + i * 86400000 / (large ? 6 : 4))}
          tickFormatter={time => time === now ? '现在' : labels.format(time)} minTickGap={6}
          tick={{ fontSize: 11, fill: '#a6afbf' }} tickLine={false} axisLine={false} />
        <YAxis width={41} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={value => value + '%'}
          tick={{ fontSize: 11, fill: '#a6afbf' }} tickLine={false} axisLine={false} />
        {threshold !== undefined && <ReferenceLine y={threshold} stroke="#f5c16f" strokeDasharray="4 5"
          label={{ value: '提醒阈值 ' + threshold + '%', position: 'insideTopRight', fill: '#f5c16f', fontSize: 11 }} />}
        <Tooltip isAnimationActive={false} content={props => {
          const point = props.payload?.[0]?.payload as typeof data[number] | undefined;
          if (!props.active || !point?.range) return null;
          return <div className={s.chartTip}><span>{dateLabel(point.time)}</span>
            <b>{point.range[0] === point.range[1] ? point.range[0] + '%' : point.range.join('–') + '%'}</b></div>;
        }} />
        <Area type={hasRanges ? "stepAfter" : "linear"} dataKey={hasRanges ? "range" : "level"} connectNulls={false} isAnimationActive={false}
          stroke={color} strokeWidth={2.2} fill={'url(#' + gradient + ')'} dot={present <= 14 ? { r: 2, strokeWidth: 0, fill: color } : false}
          activeDot={{ r: 4, fill: color, stroke: '#fff', strokeWidth: 2 }} />
      </AreaChart>
    </ResponsiveContainer>
  </div></>;
}
