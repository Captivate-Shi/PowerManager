import s from './panel.module.css';

export function ChartSkeleton({ large = true }: { large?: boolean }) {
  return <div className={s.chartSkeleton} data-large={large} role="status" aria-label="正在加载电量历史">
    <svg viewBox="0 0 360 140" preserveAspectRatio="none" aria-hidden="true">
      <path d="M20 18V120H345 M20 44H345 M20 69H345 M20 94H345" />
    </svg>
    <span>正在加载记录</span>
  </div>;
}
