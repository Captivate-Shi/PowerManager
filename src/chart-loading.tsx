import { LoaderCircle, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Device } from './model';
import s from './panel.module.css';

export const historyColors = ['#c5e4f6', '#cbbbf1', '#a2c9ba'];

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

export function ChartFrame({ large, pending, threshold, children, notice, summary, reserveRows }: {
  large: boolean; pending: boolean; threshold?: number; children: ReactNode; notice?: ReactNode;
  summary: ReactNode; reserveRows: 1 | 3;
}) {
  return <div className={s.chartFrame} data-large={large}>
    <div className={s.chartPlot} data-large={large} aria-busy={pending}>{children}</div>
    <div className={s.chartMeta}>
      <div className={s.chartGuide} aria-label="图例">
        <span><i className={s.exactKey} />精确读数</span><span><i className={s.rangeKey} />上报区间</span>
        <span><Zap size={13} />采样显示充电</span><span><i className={s.gapKey} />无有效读数 / 无采样</span>
        {threshold !== undefined && <span><i className={s.thresholdKey} />提醒阈值 {threshold}%</span>}
      </div>
      <div className={s.chartStatusSlot}>{notice}</div>
    </div>
    <div className={s.chartSummarySlot} data-rows={reserveRows}>{summary}</div>
  </div>;
}

type SummaryRow = { device: Device; name: ReactNode; lowest?: ReactNode; charge?: ReactNode; count?: ReactNode; pending?: boolean };
export function HistorySummary({ rows }: { rows: SummaryRow[] }) {
  return <table className={s.historySummary} aria-label="近 24 小时记录摘要">
    <thead><tr><th scope="col">设备</th><th scope="col">最低记录</th><th scope="col">最近充电采样</th><th scope="col">有效采样</th></tr></thead>
    <tbody>{rows.map(({ device, name, lowest, charge, count, pending }, index) => (
      <tr key={device.id} data-summary-device={device.id} data-pending={pending}>
        <th scope="row"><div>{name}<i style={{ background: historyColors[index] }} /><span>{device.name}</span></div></th>
        <td>{pending ? '读取中' : lowest ?? '—'}</td><td>{charge ?? '—'}</td><td>{count ?? '—'}</td>
      </tr>
    ))}</tbody>
  </table>;
}

export function ChartLoadingFrame({ devices, large = true, threshold, reserveRows, renderArt }: {
  devices: Device[]; large?: boolean; threshold?: number; reserveRows: 1 | 3; renderArt: (device: Device) => ReactNode;
}) {
  return <ChartFrame large={large} pending threshold={threshold} reserveRows={reserveRows}
    summary={<HistorySummary rows={devices.map(device => ({ device, name: renderArt(device), pending: true }))} />}>
    <ChartSkeleton large={large} />
  </ChartFrame>;
}
