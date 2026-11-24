import s from './panel.module.css';

export function ChartSkeleton({ large = true }: { large?: boolean }) {
  return <div className={s.chartSkeleton} data-large={large} role="status" aria-label="正在加载电量历史">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 0V100H100 M0 0H100 M0 25H100 M0 50H100 M0 75H100" vectorEffect="non-scaling-stroke" />
    </svg>
    <span>正在加载记录</span>
  </div>;
}
