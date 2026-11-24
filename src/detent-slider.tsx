import type { CSSProperties, InputHTMLAttributes } from 'react';
import styles from './detent-slider.module.css';

export type SliderDetent = { value: number; major?: boolean };
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'min' | 'max' | 'value' | 'step' | 'onChange'> & {
  min: number; max: number; value: number; detents: readonly SliderDetent[];
  detentLabel: string; selectedDetent?: number; inline?: boolean;
  onValue: (value: number) => void; onDetent: (value: number) => void;
};

export function DetentSlider({ min, max, value, detents, detentLabel, selectedDetent, inline, onValue, onDetent, ...inputProps }: Props) {
  const percent = (point: number) => (point - min) / (max - min) * 100 + '%';
  const gap = Math.min(max - min, ...detents.slice(1).map((point, i) => point.value - detents[i].value));
  return <div className={styles.control} data-detent-slider data-inline={inline || undefined}>
    <div className={styles.geometry} style={{ '--fill-stop': percent(value), '--detent-gap': percent(min + gap) } as CSSProperties}>
      <span className={styles.rail} aria-hidden="true" />
      <input {...inputProps} type="range" min={min} max={max} step={1} value={value} aria-valuetext={value + '%'}
        onChange={event => onValue(event.currentTarget.valueAsNumber)} />
      <div className={styles.detents} role="group" aria-label={detentLabel}>
        {detents.map(point => <button
          key={point.value} type="button" data-major={point.major || undefined} data-detent={point.value}
          aria-label={point.value + '%'} title={point.value + '%'} aria-pressed={point.value === selectedDetent}
          disabled={inputProps.disabled}
          style={{ '--at': percent(point.value) } as CSSProperties}
          onClick={() => onDetent(point.value)}
        />)}
      </div>
    </div>
  </div>;
}
