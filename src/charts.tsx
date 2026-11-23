import { useEffect, useId, useState } from 'react';
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { midpoint, type Device, type HistoryPoint } from './model';
import { api, dateLabel } from './ui';
import s from './panel.module.css';

export function ConnectionGauge({ online, total }: { online: number; total: number }) {
  const data = [{ value: online }, { value: total ? total - online : 1 }];
  return <div className={s.connectionGauge} role="img" aria-label={online + ' 台在线，共 ' + total + ' 台'}>
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <PieChart accessibilityLayer={false}>
        <Pie data={data} dataKey="value" innerRadius="79%" outerRadius="98%" startAngle={90} endAngle={-270}
          stroke="none" cornerRadius={4} paddingAngle={online > 0 && online < total ? 4 : 0} isAnimationActive={false}>
          <Cell fill="#2784dc" /><Cell fill="#d5e4f5" />
        </Pie>
      </PieChart>
    </ResponsiveContainer>
    <span aria-hidden="true"><strong>{online}</strong><small> / {total}</small></span>
  </div>;
}
export function Chart({ device, revision, large = false }: { device: Device; revision: number | null; large?: boolean }) {
  const gradient = useId();
  const [result, setResult] = useState<{ id: string; points: HistoryPoint[]; error?: string }>();
  useEffect(() => {
    let active = true;
    void api.command({ type: 'history', id: device.id }).then(reply => {
      if (active) setResult(reply.ok ? { id: device.id, points: reply.history ?? [] } : { id: device.id, points: [], error: reply.error });
    });
    return () => { active = false; };
  }, [device.id, device.status, revision]);
  const points = result?.id === device.id ? result.points : [];
  if (!points.some(point => point.reading)) {
    return <div className={s.chartEmpty} role="status">{result?.id === device.id ? result.error ?? '等待设备上报电量后生成曲线' : '正在加载电量历史…'}</div>;
  }
  const now = Date.now();
  const start = now - 86400000;
  const data = points.filter(point => point.time >= start).map(point => ({
    time: point.time, level: point.reading ? midpoint(point.reading) : null,
    low: point.reading?.low, high: point.reading?.high,
  }));
  const labels = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const color = device.reading && device.reading.high <= 20 ? '#cf4b4b' : '#2476c8';
  const present = data.filter(point => point.level !== null).length;
  return <div className={s.chart} data-large={large} role="group" aria-label={device.name + '近 24 小时电量曲线'}>
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <AreaChart data={data} margin={{ top: 10, right: 14, bottom: 3, left: 0 }}>
        <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor={color} stopOpacity={.28} /><stop offset="100%" stopColor={color} stopOpacity={.025} />
        </linearGradient></defs>
        <CartesianGrid stroke="#d6e2f2" vertical={false} />
        <XAxis type="number" dataKey="time" domain={[start, now]} allowDataOverflow
          ticks={Array.from({ length: large ? 7 : 5 }, (_, i) => start + i * 86400000 / (large ? 6 : 4))}
          tickFormatter={time => time === now ? '现在' : labels.format(time)} minTickGap={6}
          tick={{ fontSize: 11, fill: '#425771' }} tickLine={false} axisLine={false} />
        <YAxis width={41} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={value => value + '%'}
          tick={{ fontSize: 11, fill: '#425771' }} tickLine={false} axisLine={false} />
        <Tooltip isAnimationActive={false} content={props => {
          const point = props.payload?.[0]?.payload as typeof data[number] | undefined;
          if (!props.active || !point || point.level === null) return null;
          return <div className={s.chartTip}><span>{dateLabel(point.time)}</span>
            <b>{point.low === point.high ? point.level + '%' : '约 ' + point.level + '%（' + point.low + '–' + point.high + '%）'}</b></div>;
        }} />
        <Area type="linear" dataKey="level" connectNulls={false} isAnimationActive={false}
          stroke={color} strokeWidth={2.2} fill={'url(#' + gradient + ')'} dot={present <= 14 ? { r: 2, strokeWidth: 0, fill: color } : false}
          activeDot={{ r: 4, fill: color, stroke: '#fff', strokeWidth: 2 }} />
      </AreaChart>
    </ResponsiveContainer>
  </div>;
}
