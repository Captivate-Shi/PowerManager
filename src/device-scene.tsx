import type { CSSProperties } from 'react';
import { Art, readingLabel, studioPath, tone } from './ui';
import { type Device, type Snapshot } from './model';
import view from './scene.module.css';

type Phase = 'initial' | 'refreshing' | 'ready';

export function SceneStage({ device, loading = false, shared = false, detail = false, revealPhoto = false }: {
  device?: Device; loading?: boolean; shared?: boolean; detail?: boolean; revealPhoto?: boolean;
}) {
  const reflected = device && device.art !== 'unknown' && !loading ? `url("${studioPath(device.art + '-hero.webp')}")` : undefined;
  return <div className={view.visual} data-art={device?.art} data-detail={detail} data-loading={loading}
    style={reflected ? { '--reflection': reflected } as CSSProperties : undefined}>
    {device ? <Art device={device} variant={detail ? 'detail' : 'stage'} shared={shared} loading={loading} revealPhoto={revealPhoto} /> :
      <i className={view.emptyStage} aria-hidden="true" />}
  </div>;
}

export function SceneBattery({ device, state, phase }: { device?: Device; state: Snapshot; phase: Phase }) {
  const reading = device?.reading;
  const color = device ? tone(device, state) : 'normal';
  const initial = phase === 'initial';
  const hasRange = !!reading && reading.low !== reading.high;
  return <div className={view.meter} data-phase={phase} data-tone={color}>
    {!initial && <strong>{readingLabel(reading ?? null)}</strong>}
    {initial ? <div role="progressbar" className={view.progress} aria-label="正在读取电量"><i aria-hidden="true" /></div> :
      <div role={reading ? "meter" : undefined} className={view.track} data-scale={hasRange ? 'interval' : 'exact'} aria-hidden={!reading || undefined} aria-label={reading ? device?.status === 'current' ? "电量" : "上次电量" : undefined}
        aria-valuemin={reading ? 0 : undefined} aria-valuemax={reading ? 100 : undefined}
        aria-valuenow={reading?.low}
        aria-description={hasRange ? '设备上报电量区间，数值下界是确认的最低电量。' : undefined} aria-valuetext={reading ? readingLabel(reading) : undefined}>
        {reading && (hasRange ? <span className={view.rangedFill} aria-hidden="true">
          <i className={view.confirmed} style={{ width: reading.low + '%' }} />
          <i className={view.interval} data-battery-band="" style={{ left: reading.low + '%', width: (reading.high - reading.low) + '%' }} />
        </span> : <i className={view.exact} aria-hidden="true" style={{ width: reading.low + '%' }} />)}
      </div>}
  </div>;
}
