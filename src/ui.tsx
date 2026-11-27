import * as Dialog from '@radix-ui/react-dialog';
import * as Select from '@radix-ui/react-select';
import * as Switch from '@radix-ui/react-switch';
import { Battery, BatteryCharging, BatteryLow, Bluetooth, Cable, Check, ChevronDown, ChevronUp, CircleHelp, Wifi, X } from 'lucide-react';
import { lazy, Suspense, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { HelpTip } from './help-tip';
import { ChartLoadingFrame } from './chart-loading';
import { isConnected, type Reading, severity, type DesktopApi, type Device, type Snapshot } from './model';
import s from './panel.module.css';
import scene from './scene.module.css';

declare global { interface Window { powerManager: DesktopApi } }
export const api = window.powerManager;
const artUrl = (name: string) => './assets/' + name + '.png';
export function Brand() {
  return <div className={s.brand}><img src={artUrl("yudian-mark")} width="28" height="28" alt="" draggable={false} /><b>余电</b></div>;
}
const renderedArt = new Set<Device['art']>(['dualsense', 'mouse', 'keyboard']);
type ArtVariant = 'thumb' | 'card' | 'hero' | 'stage' | 'detail';
export const studioPath = (name: string) => new URL('./assets/studio-v2/' + name, document.baseURI).href;
const studioAsset = (art: Device['art'], variant: string) => studioPath(art + '-' + variant + '.webp');
const deviceArtUrl = (device: Device, variant: ArtVariant, loading: boolean) => studioAsset(device.art,
  loading ? 'loading' : variant === 'thumb' || variant === 'card' ? 'thumb' : 'hero');
const fallbackArtUrl = (device: Device, variant: ArtVariant) => renderedArt.has(device.art)
  ? './assets/' + device.art + '-' + (variant === 'stage' ? 'card' : variant === 'detail' ? 'hero' : variant) + '.webp' : artUrl(device.art);
const warmedArtwork = new Map<string, { ready: boolean; request: Promise<boolean> }>();
export function heroPrepared(device: Device) {
  return device.art === 'unknown' || warmedArtwork.get(deviceArtUrl(device, 'hero', false))?.ready === true;
}
export function prepareHero(device: Device): Promise<boolean> {
  if (device.art === 'unknown') return Promise.resolve(true);
  const url = deviceArtUrl(device, 'hero', false);
  const previous = warmedArtwork.get(url);
  if (previous) return previous.request;
  const image = new Image();
  image.src = url;
  const entry = { ready: false, request: image.decode().then(() => {
    entry.ready = true;
    return true;
  }, () => {
    warmedArtwork.delete(url); // allow a later attempt after a transient failure
    return false;
  }) };
  warmedArtwork.set(url, entry);
  return entry.request;
}

export function Art({ device, variant = 'thumb', loading = false, revealPhoto = false, onReady }: {
  device: Device; variant?: ArtVariant; loading?: boolean; revealPhoto?: boolean; onReady?: () => void;
}) {
  const [failed, setFailed] = useState<string>();
  const url = deviceArtUrl(device, variant, loading);
  return <div className={s.art + (loading ? ' ' + scene.loadingArt : '')} data-art={device.art}
    style={loading && device.art !== 'unknown' ? { '--device-mask': `url("${url}")` } as React.CSSProperties : undefined}>
    {device.art === 'unknown' || failed === url ? <CircleHelp data-device-art='' aria-hidden='true' /> :
      <img key={url} data-device-art='' src={url} width='120' height='90' alt='' draggable={false} data-cold-photo={revealPhoto || undefined}
        onLoad={event => {
          const image = event.currentTarget;
          if (revealPhoto) image.dataset.coldPhotoLoaded = '';
          if (!onReady) return;
          const ready = () => {
            if (!image.isConnected || !image.naturalWidth) return;
            image.dataset.artReady = '';
            onReady();
          };
          void image.decode().then(ready, ready);
        }}
        onError={event => {
          const image = event.currentTarget;
          if (image.dataset.fallback) { setFailed(url); onReady?.(); return; }
          image.dataset.fallback = 'true';
          if (loading) image.parentElement?.style.setProperty('--device-mask', `url("${new URL(fallbackArtUrl(device, variant), document.baseURI).href}")`);
          image.src = fallbackArtUrl(device, variant);
        }} />}
  </div>;
}
export function Connection({ device }: { device: Device }) {
  const Icon = /蓝牙|bluetooth/i.test(device.connection) ? Bluetooth : /usb/i.test(device.connection) ? Cable : Wifi;
  return <span className={s.connection}><Icon size={15} aria-hidden="true" /><span title={device.connection}>{device.connection.replace(' 共享接收器', ' · 共享') || '连接方式未知'}</span></span>;
}
export function StatusTag({ device, state }: { device: Device; state?: Snapshot }) {
  const connected = isConnected(device);
  const color = state ? tone(device, state) : 'normal';
  const text = color === 'red' ? '电量告急' : color === 'amber' ? '低电量' : color === 'green' ? device.reading?.power === 'charging' ? '充电中' : '已充满' : device.status === 'current' ? '已连接' : device.status === 'stale' ? '等待读数' : device.status === 'unreachable' ? '未回应' : connected ? '无数据' : '未连接';
  return <span className={s.tag} data-tone={color}>{text}</span>;
}
export function tone(device: Device, state: Snapshot) {
  if (device.status !== 'current' || !device.reading) return 'offline';
  const alert = severity(device, state.settings, state.deviceSettings[device.id]);
  if (alert) return alert === 'critical' ? 'red' : 'amber';
  if (device.reading.power === 'charging' || device.reading.power === 'full') return 'green';
  return 'normal';
}
export const readingLabel = (reading: Reading | null) => !reading ? "—" :
  (reading.source === "hid_voltage" ? "约 " : "") + (reading.low === reading.high ? reading.low : reading.low + "–" + reading.high) + "%";

export function BatteryTrack({ reading, className, label }: { reading?: Reading | null; className?: string; label?: string }) {
  const range = !!reading && reading.low !== reading.high;
  const named = !!label && !!reading;
  return <span className={className ? s.batteryTrack + ' ' + className : s.batteryTrack} data-battery-track=""
    data-scale={range ? 'interval' : 'exact'} role={named ? 'meter' : undefined} aria-hidden={!named || undefined}
    aria-label={named ? label : undefined} aria-valuemin={named ? 0 : undefined} aria-valuemax={named ? 100 : undefined}
    aria-valuenow={named ? reading.low : undefined} aria-valuetext={named ? readingLabel(reading) : undefined}
    aria-description={named && range ? (reading.source === 'hid_voltage' ? '根据设备电压估算的电量范围。' : '设备上报电量区间，实色为确认的下限，斜纹为上报范围。') : undefined}>
    {reading && <span className={s.batteryConfirmed} data-battery-confirmed="" style={{ width: reading.low + '%' }} />}
    {range && <span className={s.batteryInterval} data-battery-band=""
      style={{ left: reading.low + '%', width: (reading.high - reading.low) + '%' }} />}
  </span>;
}

export function BatteryMeter({ device, state }: { device: Device; state: Snapshot }) {
  const color = tone(device, state);
  const isCharging = device.reading?.power === 'charging' && device.status === 'current';
  const Icon = isCharging ? BatteryCharging : (color === 'red' || color === 'amber') ? BatteryLow : Battery;
  return <div className={s.battery} data-tone={color} data-range={!!device.reading && device.reading.low !== device.reading.high}>
    <div><Icon size={23} strokeWidth={2} /><strong>{readingLabel(device.reading)}</strong>{isCharging && <small>充电中</small>}</div>
    <BatteryTrack className={s.track} reading={device.reading} label="电量" />
  </div>;
}
export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return <div className={s.sectionTitle}><h2>{children}</h2>{aside && <div>{aside}</div>}</div>;
}
export function SwitchControl({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <Switch.Root className={s.switch} checked={checked} onCheckedChange={onChange} aria-label={label}><Switch.Thumb /></Switch.Root>;
}
export function SelectControl({ label, value, choices, onChange, disabled }: {
  label: string; value: string; disabled?: boolean; choices: { value: string; label: string; detail?: string; disabled?: boolean }[]; onChange: (value: string) => void;
}) {
  const details = useId();
  return <Select.Root value={value} disabled={disabled} onValueChange={onChange}>
    <Select.Trigger className={s.select} aria-label={label} title={choices.find(choice => choice.value === value)?.label}>
      <span className={s.selectValue}><Select.Value /></span><Select.Icon asChild><ChevronDown className={s.selectChevron} size={15} aria-hidden="true" /></Select.Icon>
    </Select.Trigger>
    <Select.Portal><Select.Content className={s.popover + ' ' + s.selectPopover} position="popper" align={choices.some(choice => choice.detail) ? "end" : "start"} sideOffset={5} collisionPadding={8}>
      <Select.ScrollUpButton className={s.selectScroll}><ChevronUp size={15} aria-hidden="true" /></Select.ScrollUpButton>
      <Select.Viewport className={s.selectViewport}>{choices.map(choice => <Select.Item key={choice.value} value={choice.value}
        disabled={choice.disabled} className={s.option} data-with-detail={!!choice.detail || undefined}
        aria-describedby={choice.detail ? details + '-' + choice.value : undefined}>
        <Select.ItemText>{choice.label}</Select.ItemText>
        {choice.detail && <span className={s.optionDetail} id={details + '-' + choice.value}>{choice.detail}</span>}
        <Select.ItemIndicator><Check size={15} aria-hidden="true" /></Select.ItemIndicator>
      </Select.Item>)}</Select.Viewport>
      <Select.ScrollDownButton className={s.selectScroll}><ChevronDown size={15} aria-hidden="true" /></Select.ScrollDownButton>
    </Select.Content></Select.Portal>
  </Select.Root>;
}
export function Modal({ title, description, hint, onClose, children }: {
  title: string; description?: string; hint?: string; onClose: () => void; children: ReactNode;
}) {
  const opener = useRef(document.activeElement);
  return <Dialog.Root open onOpenChange={value => { if (!value) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className={s.overlay} onPointerDown={event => {
      if (event.isPrimary && event.button === 0 && !event.ctrlKey && event.target === event.currentTarget) {
        // Radix registers the document outside-press listener after opening.
        event.preventDefault();
        onClose();
      }
    }} />
    <Dialog.Content className={s.modal} {...(!description ? { 'aria-describedby': undefined } : {})}
      onOpenAutoFocus={event => {
        if (!hint) return;
        const content = event.currentTarget;
        if (!(content instanceof HTMLElement)) return;
        const focus = content.querySelector<HTMLElement>('input:not([disabled]), button:not([disabled]):not([data-copy-tip]):not(.' + s.modalClose + ')') ??
          content.querySelector<HTMLElement>('.' + s.modalClose);
        if (focus) { event.preventDefault(); focus.focus(); }
      }}
      onCloseAutoFocus={event => {
      if (opener.current instanceof HTMLElement && opener.current.isConnected) {
        event.preventDefault();
        opener.current.focus({ preventScroll: true });
      }
    }}>
      <div className={s.modalHeading}><Dialog.Title>{title}</Dialog.Title>{hint && <HelpTip label={title} text={hint} />}</div>
      {description && <Dialog.Description>{description}</Dialog.Description>}
      <Dialog.Close asChild><button className={s.iconButton + ' ' + s.modalClose} aria-label="关闭对话框"><X size={20} /></button></Dialog.Close>
      {children}
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
export function SettingRow({ title, hint, status, children }: { title: string; hint?: string; status?: string; children: ReactNode }) {
  return <div className={s.settingRow} data-setting-row=""><div data-setting-description=""><div className={s.settingLabel} data-setting-label=""><b>{title}</b>
    {hint && <HelpTip label={title} text={hint} />}</div>{status && <small>{status}</small>}</div><div data-setting-control="">{children}</div></div>;
}
const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
});
export const dateLabel = (value: number | null) => value && Number.isFinite(value) && Math.abs(value) <= 8.64e15
  ? dateFormatter.format(value) : '暂无记录';
export const readingTimeLabel = '最近更新时间';
export const readingUpdated = (value: number | null) => `${readingTimeLabel}：${dateLabel(value)}`;

const loadCharts = () => import('./charts');
const HistoryView = lazy(() => loadCharts().then(charts => ({ default: charts.Chart })));
const ComparisonView = lazy(() => loadCharts().then(charts => ({ default: charts.HistoryComparison })));

const chartArt = (device: Device) => <Art device={device} />;
export function Chart(props: ComponentProps<typeof HistoryView>) {
  return <Suspense fallback={<ChartLoadingFrame devices={[props.device]} large={props.large ?? false}
    threshold={props.threshold} reserveRows={1} renderArt={chartArt} />}><HistoryView {...props} /></Suspense>;
}
export function CompareChart({ starting, ...props }: ComponentProps<typeof ComparisonView> & { starting: boolean }) {
  const fallback = <ChartLoadingFrame devices={props.devices} large={props.large} threshold={props.threshold}
    reserveRows={3} renderArt={chartArt} range={props.range} seriesSlots={props.seriesSlots} />;
  if (starting && !props.devices.length) return fallback;
  return <Suspense fallback={fallback}><ComparisonView {...props} /></Suspense>;
}
