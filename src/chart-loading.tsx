import { LoaderCircle, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Device, HistoryRange } from './model';
import { historyRangeLabels } from './history-plot';
import s from './panel.module.css';

export const historyColors = ['#c5e4f6', '#cbbbf1', '#a2c9ba'];
export type ChartView = 'trend' | 'samples';

export function ChartProgress({ children }: { children: ReactNode }) {
  return <span className={s.chartProgress}><LoaderCircle size={16} aria-hidden="true" /><span>{children}</span></span>;
}

export function ChartSkeleton({ large = true }: { large?: boolean }) {
  return <div className={s.chartSkeleton} data-large={large} role="status" aria-label="正在加载电量历史">
    <svg className={s.chartSkeletonGrid} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 18H100 M0 34H100 M0 66H100 M0 82H100" vectorEffect="non-scaling-stroke" />
    </svg>
    <ChartProgress>正在加载电量记录</ChartProgress>
  </div>;
}

export function ChartFrame({ large, pending, threshold, children, notice, summary, reserveRows, range = 'day', view = 'trend', onView, hasIntervals = false }: {
  large: boolean; pending: boolean; threshold?: number; children: ReactNode; notice?: ReactNode;
  summary: ReactNode; reserveRows: 1 | 3; range?: HistoryRange;
  view?: ChartView; hasIntervals?: boolean; onView?: (value: ChartView) => void;
}) {
  return <div className={s.chartFrame} data-large={large} data-scroll-pane="">
    <div className={s.chartPlot} data-large={large} aria-busy={pending}>{children}</div>
    <div className={s.chartMeta}>
      <div className={s.chartGuide} aria-label="图例">
        {range === 'day' ? <>
          <div className={s.chartView} role="group" aria-label="曲线显示方式">
            <button type="button" aria-pressed={view === 'trend'} disabled={!onView} onClick={() => onView?.('trend')}>趋势</button>
            <button type="button" aria-pressed={view === 'samples'} disabled={!onView} onClick={() => onView?.('samples')}>原始采样</button>
          </div>
          {hasIntervals && <span><i className={view === 'trend' ? s.rangeMidKey : s.rangeKey} />{view === 'trend' ? '区间中点（估算）' : '上报区间'}</span>}<span><Zap size={13} />充电采样</span>
          <span><i className={s.gapKey} />无数据</span>
        </> : <span>每日最低读数 · 空白日期无有效采样</span>}
        {threshold !== undefined && <span><i className={s.thresholdKey} />提醒阈值 {threshold}%</span>}
      </div>
      <div className={s.chartStatusSlot}>{notice}</div>
    </div>
    <div className={s.chartSummarySlot} data-rows={reserveRows}>{summary}</div>
  </div>;
}

type SummaryRow = { device: Device; slot?: number; name: ReactNode; lowest?: ReactNode; charge?: ReactNode; count?: ReactNode; pending?: boolean };
export function HistorySummary({ rows, range = 'day' }: { rows: SummaryRow[]; range?: HistoryRange }) {
  return <table className={s.historySummary} aria-label={'近 ' + historyRangeLabels[range] + '记录摘要'}>
    <thead><tr><th scope="col">设备</th><th scope="col">最低记录</th><th scope="col">最近充电采样</th><th scope="col">有效采样</th></tr></thead>
    <tbody>{rows.map(({ device, name, lowest, charge, count, pending, slot }, index) => (
      <tr key={device.id} data-summary-device={device.id} data-pending={pending}>
        <th scope="row"><div>{name}<i style={{ background: historyColors[slot ?? index] }} /><span>{device.name}</span></div></th>
        <td>{pending ? '读取中' : lowest ?? '—'}</td><td>{charge ?? '—'}</td><td>{count ?? '—'}</td>
      </tr>
    ))}</tbody>
  </table>;
}

export function ChartLoadingFrame({ devices, large = true, threshold, reserveRows, renderArt, range = 'day', seriesSlots }: {
  devices: Device[]; large?: boolean; threshold?: number; reserveRows: 1 | 3; renderArt: (device: Device) => ReactNode; range?: HistoryRange; seriesSlots?: ReadonlyMap<string, number>;
}) {
  return <ChartFrame large={large} pending threshold={threshold} reserveRows={reserveRows} range={range}
    summary={<HistorySummary range={range} rows={devices.map(device => ({ device, slot: seriesSlots?.get(device.id), name: renderArt(device), pending: true }))} />}>
    <ChartSkeleton large={large} />
  </ChartFrame>;
}
