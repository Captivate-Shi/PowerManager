import * as Dialog from '@radix-ui/react-dialog';
import * as Select from '@radix-ui/react-select';
import * as Switch from '@radix-ui/react-switch';
import { Battery, BatteryCharging, BatteryLow, Bluetooth, Cable, Check, ChevronDown, ChevronUp, CircleHelp, Wifi, X } from 'lucide-react';
import { lazy, Suspense, useRef, type ComponentProps, type ReactNode } from 'react';
import { isConnected, midpoint, percent, severity, type DesktopApi, type Device, type Snapshot } from './model';
import s from './panel.module.css';

declare global { interface Window { powerManager: DesktopApi } }
export const api = window.powerManager;
const artUrl = (name: string) => './assets/' + name + '.png';
export function Brand() {
  return <div className={s.brand}><img src={artUrl('powermanager-brand')} width="36" height="36" alt="" /><div><b>外设电量管理器</b><small>设备监测 · 低电量提醒</small></div></div>;
}
export function Art({ device, className = '' }: { device: Device; className?: string }) {
  return <div className={s.art + ' ' + className} data-device-art>
    {device.art === 'unknown' ? <CircleHelp aria-hidden="true" /> : <img src={artUrl(device.art)} width="120" height="80" alt="" draggable={false} />}
  </div>;
}
export function Connection({ device }: { device: Device }) {
  const Icon = /蓝牙|bluetooth/i.test(device.connection) ? Bluetooth : /usb/i.test(device.connection) ? Cable : Wifi;
  return <span className={s.connection}><Icon size={15} aria-hidden="true" /><span title={device.connection}>{device.connection.replace(' 共享接收器', ' · 共享') || '连接方式未知'}</span></span>;
}
export function StatusTag({ device }: { device: Device }) {
  const connected = isConnected(device);
  const text = device.status === 'current' ? '已连接' : device.status === 'stale' ? '等待读数' : device.status === 'unreachable' ? '未回应' : connected ? '读取受限' : '未连接';
  return <span className={s.tag + ' ' + (device.status === 'current' ? s.live : connected ? s.pending : '')}>{text}</span>;
}
export function tone(device: Device, state: Snapshot) {
  if (device.status !== 'current' || !device.reading) return 'offline';
  if (severity(device, state.settings, state.deviceSettings[device.id])) return 'red';
  if (device.reading.power === 'charging' || device.reading.power === 'full') return 'green';
  if (device.reading.low < 70) return 'amber';
  return 'green';
}
export function BatteryMeter({ device, state }: { device: Device; state: Snapshot }) {
  const color = tone(device, state);
  const isCharging = device.reading?.power === 'charging' && device.status === 'current';
  const Icon = isCharging ? BatteryCharging : color === 'red' ? BatteryLow : Battery;
  return <div className={s.battery} data-tone={color}>
    <div><Icon size={23} strokeWidth={2} /><strong>{percent(device.reading)}</strong>{isCharging && <small>充电中</small>}</div>
    <div className={s.track} role="meter" aria-label="电量" aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={device.reading ? midpoint(device.reading) : undefined} aria-valuetext={device.reading ? percent(device.reading) : '暂无读数'}>
      <span style={{ width: (device.reading ? midpoint(device.reading) : 0) + '%' }} />
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
const GaugeView = lazy(() => loadCharts().then(charts => ({ default: charts.ConnectionGauge })));
const HistoryView = lazy(() => loadCharts().then(charts => ({ default: charts.Chart })));

export function ConnectionGauge(props: ComponentProps<typeof GaugeView>) {
  return <Suspense fallback={<div className={s.connectionGauge} aria-hidden="true" />}><GaugeView {...props} /></Suspense>;
}
export function Chart(props: ComponentProps<typeof HistoryView>) {
  return <Suspense fallback={<div className={s.chartEmpty} role="status">正在加载电量历史…</div>}><HistoryView {...props} /></Suspense>;
}
