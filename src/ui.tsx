import * as Dialog from '@radix-ui/react-dialog';
import * as Select from '@radix-ui/react-select';
import * as Switch from '@radix-ui/react-switch';
import { Battery, BatteryCharging, BatteryLow, Bluetooth, Cable, Check, ChevronDown, ChevronUp, CircleHelp, Wifi, X } from 'lucide-react';
import { lazy, Suspense, useRef, type ComponentProps, type ReactNode } from 'react';
import { ChartSkeleton } from './chart-loading';
import { isConnected, midpoint, type Reading, severity, type DesktopApi, type Device, type Snapshot } from './model';
import s from './panel.module.css';
import scene from './scene.module.css';

declare global { interface Window { powerManager: DesktopApi } }
export const api = window.powerManager;
const artUrl = (name: string) => './assets/' + name + '.png';
export function Brand() {
  return <div className={s.brand}><img src={artUrl("yudian-mark")} width="28" height="28" alt="" /><b>余电</b></div>;
}
const renderedArt = new Set<Device['art']>(['dualsense', 'mouse', 'keyboard']);
type ArtVariant = 'thumb' | 'card' | 'hero' | 'stage' | 'detail';
export const studioPath = (name: string) => new URL('./assets/studio-v2/' + name, document.baseURI).href;
const studioAsset = (art: Device['art'], variant: string) => studioPath(art + '-' + variant + '.webp');
const deviceArtUrl = (device: Device, variant: ArtVariant, loading: boolean) => studioAsset(device.art,
  loading ? 'loading' : variant === 'thumb' || variant === 'card' ? 'thumb' : 'hero');
const fallbackArtUrl = (device: Device, variant: ArtVariant) => renderedArt.has(device.art)
  ? './assets/' + device.art + '-' + (variant === 'stage' ? 'card' : variant === 'detail' ? 'hero' : variant) + '.webp' : artUrl(device.art);
const warmedArtwork = new Set<string>();

export function prepareHero(device: Device) {
  if (device.art === 'unknown') return;
  const url = deviceArtUrl(device, 'hero', false);
  if (warmedArtwork.has(url)) return;
  warmedArtwork.add(url);
  const image = new Image();
  image.src = url;
  void image.decode().catch(() => { warmedArtwork.delete(url); });
}

export function Art({ device, variant = 'thumb', shared = false, loading = false }: {
  device: Device; variant?: ArtVariant; shared?: boolean; loading?: boolean;
}) {
  const className = shared ? s.transitionArt : undefined;
  const url = deviceArtUrl(device, variant, loading);
  return <div className={s.art + (loading ? ' ' + scene.loadingArt : '')} data-art={device.art}
    style={loading && device.art !== 'unknown' ? { '--device-mask': `url("${url}")` } as React.CSSProperties : undefined}>
    {device.art === 'unknown' ? <CircleHelp data-device-art='' className={className} aria-hidden='true' /> :
      <img key={url} data-device-art='' className={className} src={url} width='120' height='90' alt='' draggable={false}
        onError={event => {
          const image = event.currentTarget;
          if (image.dataset.fallback) return;
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
  const text = color === 'red' ? '电量告急' : color === 'amber' ? '低电量' : color === 'green' && device.reading?.power === 'charging' ? '充电中' : device.status === 'current' ? '已连接' : device.status === 'stale' ? '等待读数' : device.status === 'unreachable' ? '未回应' : connected ? '读取受限' : '未连接';
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
  reading.low === reading.high ? reading.low + "%" : reading.low + "–" + reading.high + "%";

export function BatteryMeter({ device, state }: { device: Device; state: Snapshot }) {
  const color = tone(device, state);
  const isCharging = device.reading?.power === 'charging' && device.status === 'current';
  const Icon = isCharging ? BatteryCharging : (color === 'red' || color === 'amber') ? BatteryLow : Battery;
  return <div className={s.battery} data-tone={color} data-range={!!device.reading && device.reading.low !== device.reading.high}>
    <div><Icon size={23} strokeWidth={2} /><strong>{readingLabel(device.reading)}</strong>{isCharging && <small>充电中</small>}</div>
    <div className={s.track} role="meter" aria-label="电量" aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={device.reading ? midpoint(device.reading) : undefined} aria-valuetext={device.reading ? readingLabel(device.reading) : '暂无读数'}>
      {device.reading && <><span style={{ width: device.reading.low + '%' }} />
        {device.reading.low !== device.reading.high && <span className={s.rangeFill}
          style={{ left: device.reading.low + '%', width: (device.reading.high - device.reading.low) + '%' }} />}</>}
    </div>
  </div>;
}
export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return <div className={s.sectionTitle}><h2>{children}</h2>{aside && <div>{aside}</div>}</div>;
}
export function SwitchControl({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <Switch.Root className={s.switch} checked={checked} onCheckedChange={onChange} aria-label={label}><Switch.Thumb /></Switch.Root>;
}
export function SelectControl({ label, value, choices, onChange }: {
  label: string; value: string; choices: { value: string; label: string }[]; onChange: (value: string) => void;
}) {
  return <Select.Root value={value} onValueChange={onChange}>
    <Select.Trigger className={s.select} aria-label={label} title={choices.find(choice => choice.value === value)?.label}>
      <span className={s.selectValue}><Select.Value /></span><Select.Icon asChild><ChevronDown className={s.selectChevron} size={15} aria-hidden="true" /></Select.Icon>
    </Select.Trigger>
    <Select.Portal><Select.Content className={s.popover + ' ' + s.selectPopover} position="popper" sideOffset={5} collisionPadding={8}>
      <Select.ScrollUpButton className={s.selectScroll}><ChevronUp size={15} aria-hidden="true" /></Select.ScrollUpButton>
      <Select.Viewport className={s.selectViewport}>{choices.map(choice => <Select.Item key={choice.value} value={choice.value} className={s.option}>
        <Select.ItemText>{choice.label}</Select.ItemText><Select.ItemIndicator><Check size={15} aria-hidden="true" /></Select.ItemIndicator>
      </Select.Item>)}</Select.Viewport>
      <Select.ScrollDownButton className={s.selectScroll}><ChevronDown size={15} aria-hidden="true" /></Select.ScrollDownButton>
    </Select.Content></Select.Portal>
  </Select.Root>;
}
export function Modal({ title, description, onClose, children }: {
  title: string; description: string; onClose: () => void; children: ReactNode;
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
    <Dialog.Content className={s.modal} onCloseAutoFocus={event => {
      if (opener.current instanceof HTMLElement && opener.current.isConnected) {
        event.preventDefault();
        opener.current.focus({ preventScroll: true });
      }
    }}>
      <Dialog.Title>{title}</Dialog.Title><Dialog.Description>{description}</Dialog.Description>
      <Dialog.Close asChild><button className={s.iconButton + ' ' + s.modalClose} aria-label="关闭对话框"><X size={20} /></button></Dialog.Close>
      {children}
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
export function SettingRow({ title, copy, children }: { title: string; copy?: string; children: ReactNode }) {
  return <div className={s.settingRow}><div><b>{title}</b>{copy && <small>{copy}</small>}</div><div>{children}</div></div>;
}
export const dateLabel = (value: number | null) => value ? new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(value) : '暂无记录';

const loadCharts = () => import('./charts');
const HistoryView = lazy(() => loadCharts().then(charts => ({ default: charts.Chart })));
const ComparisonView = lazy(() => loadCharts().then(charts => ({ default: charts.HistoryComparison })));

export function Chart(props: ComponentProps<typeof HistoryView>) {
  return <Suspense fallback={<ChartSkeleton large={props.large} />}><HistoryView {...props} /></Suspense>;
}
export function CompareChart({ starting, ...props }: ComponentProps<typeof ComparisonView> & { starting: boolean }) {
  if (starting && !props.devices.length) return <ChartSkeleton />;
  return <Suspense fallback={<ChartSkeleton large={props.large} />}><ComparisonView {...props} /></Suspense>;
}
