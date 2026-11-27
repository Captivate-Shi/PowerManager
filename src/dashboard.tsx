import * as Collapsible from '@radix-ui/react-collapsible';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Activity, ArrowLeft, Bell, BellOff, Bluetooth, Cable, ChevronDown, ChevronRight, CircleAlert, CircleCheck, Clock, Copy, Ellipsis, FolderOpen, LayoutGrid, List, MonitorSmartphone, Pencil, Plus, RefreshCw, Search, ShieldCheck, TriangleAlert, Unplug, X, Zap } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ColdStartMotion } from './cold-start-motion';
import { flushSync } from 'react-dom';
import { pendingChargeRoute, defaultPollIntervalSeconds, defaults, historyRanges, inventoryState, isConnected, isDesktopToastSeconds, isPollIntervalSeconds, isLiveDualSenseFull, isHistoryRange, isHistoryRangeWithin, isMuteDuration, limitHistoryRange, muteDurationLabel, muteDurations, severity, type Command, type CommandResult, type CompatibilitySelection, type Device, type DiagnosticDevice, type Found, type HistoryRange, type MainView, type Snapshot } from './model';
import { api, Art, BatteryMeter, Brand, Chart, CompareChart, Connection, dateLabel, heroPrepared, Modal, prepareHero, readingLabel, readingTimeLabel, readingUpdated, SectionTitle, SelectControl, SettingRow, StatusTag, studioPath, SwitchControl, tone } from './ui';
import s from './panel.module.css';
import look from './scene.module.css';
import listLook from './overview-list.module.css';
import { allowOverviewMotion, OverviewModeMotion } from './overview-mode-motion';
import { LiquidSelection } from './liquid-selection';
import { JellyNav } from './jelly-nav';
import { SceneBattery, SceneStage } from './device-scene';
import { compareDevices, rememberSortConnections } from './device-order';
import { DeviceRowMotion } from './device-row-motion';
import { DeviceThreshold } from './device-threshold';
import { HelpTip } from './help-tip';
import { ZoomControl } from './zoom';
import preferences from './preferences.module.css';
import { previewDevice as makePreviewDevice } from './demo';
import { compareLimit, historyAnchor, historyRangeLabels, historyStart } from './history-plot';
import { historyComparisonSlots, readHistorySlots, saveHistorySlots, updateHistoryComparison } from './history-preferences';
import { historyStorageEstimate } from './history-storage';
import { applyMainPalette, palettes, readPalette, savePalette, type Palette } from './theme';
import { DetentSlider } from './detent-slider';
import { canReuseStageEntry, paintStage, shifted, stageLanding, stagePose, stageReleaseLead, stageRest, stageTravel, stageVelocity, type StagePose, type StageSample } from './stage-gesture';
import { animateDetailPhoto, detailPhoto, fadeDetailPhoto, fadeReflection, freezeReflection, stageReflection } from './device-art-motion';

const pages = [
  ['overview', '总览'], ['devices', '设备'], ['alerts', '提醒'], ['history', '记录'], ['settings', '设置'],
] as const;
type Page = typeof pages[number][0];
type Filter = 'all' | 'online' | 'low' | 'offline' | 'recent';
type Run = (command: Command, options?: { inlineError?: boolean }) => Promise<CommandResult>;
type ReportFeedback = (feedback: { text: string; error?: boolean }) => void;


const level = (device: Device, state: Snapshot) => severity(device, state.settings, state.deviceSettings[device.id]);
const snoozeAction = (minutes: number) => minutes + ' 分钟后提醒';
const needCharge = (state: Snapshot) => state.devices.filter(device => level(device, state));
const minutes = (values: number[]) => values.map(value => ({ value: String(value), label: value ? value + ' 分钟' : '关闭' }));
const powerLabels = { charging: '充电中', full: '已充满', discharging: '电池供电', unknown: '设备未上报' };
const historyChoices = historyRanges.map(value => ({ value, label: historyRangeLabels[value] }));
const pollChoices = [
  { value: '30', label: '30 秒', detail: '读取更频繁，可能增加耗电' },
  { value: '60', label: '1 分钟（推荐）' },
  { value: '300', label: '5 分钟', detail: '低电量可能更晚发现' },
  { value: '600', label: '10 分钟', detail: '设备可能在提醒前耗尽电量' },
];
const toastDurationChoices = [
  { value: '5', label: '5 秒' }, { value: '10', label: '10 秒' },
  { value: '12', label: '12 秒（默认）' }, { value: '15', label: '15 秒' },
  { value: '0', label: '一直显示', detail: '手动关闭或查看详情' },
];
const retentionChoices = historyChoices.map(choice => ({ ...choice, detail: historyStorageEstimate(choice.value) }));
const thresholdDetents = Array.from({ length: 9 }, (_, index) => ({ value: (index + 1) * 10, major: index % 2 === 0 }));

export function Dashboard({ state, remembered }: { state: Snapshot; remembered?: MainView }) {
  const [page, setPage] = useState<Page>(remembered?.page ?? 'overview');
  const [palette, setPalette] = useState(readPalette);
  const choosePalette = (value: Palette) => {
    setPalette(value);
    savePalette(value);
  };
  useLayoutEffect(() => applyMainPalette(palette), [palette]);
  const [selected, select] = useState<string | undefined>(remembered?.selected);
  const [detailId, setDetailId] = useState<string | undefined>(remembered?.detailId);
  const [featured, chooseFeatured] = useState<string | undefined>(remembered?.featured);
  const [overviewMode, setOverviewMode] = useState<'stage' | 'list'>(remembered?.mode ?? 'stage');
  const main = useRef<HTMLElement>(null);
  const detailBack = useRef<HTMLButtonElement>(null);
  const returnScroll = useRef(0);
  const returnFocus = useRef<HTMLElement | null>(null);
  const sourcePhoto = useRef<HTMLImageElement>(undefined);
  type DetailMotion = ReturnType<typeof fadeReflection> & { read?: () => ReturnType<typeof detailPhoto> };
  const activeTransition = useRef<DetailMotion[]>(undefined);
  const livePhoto = () => activeTransition.current?.find(item => item.read)?.read?.();
  const detailed = state.devices.find(device => device.id === detailId);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, search] = useState('');
  const [deviceSort, setDeviceSort] = useState('state');
  const lastSortConnections = useRef<ReadonlyMap<string, boolean>>(new Map());
  const sortConnections = rememberSortConnections(state.devices, lastSortConnections.current);
  useLayoutEffect(() => { lastSortConnections.current = sortConnections; }, [sortConnections]);
  const settingsPosition = useRef({ category: 'appearance', top: 0 });
  const [finding, setFinding] = useState(false);
  const [currentHistoryRange, setCurrentHistoryRange] = useState<HistoryRange>();
  const [historySlots, setHistorySlots] = useState(readHistorySlots);
  const chooseHistorySlots = (slots: (string | undefined)[]) => {
    setHistorySlots(slots);
    saveHistorySlots(slots);
  };
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();
  const starting = state.collector === 'starting';
  const inventory = inventoryState(state);
  const low = needCharge(state);
  useEffect(() => {
    void api.rememberMainView?.({ page, selected, detailId, featured, mode: overviewMode }).catch(() => {});
  }, [page, selected, detailId, featured, overviewMode]);
  useEffect(() => api.onNavigate(id => {
    if (id) {
      cancelTransition();
      returnFocus.current = null;
      sourcePhoto.current = undefined;
      returnScroll.current = 0;
      setFinding(false);
      setFilter('all');
      search('');
      if (id === pendingChargeRoute) {
        setDetailId(undefined);
        setPage('alerts');
        window.scrollTo(0, 0);
        requestAnimationFrame(() => {
          const heading = document.querySelector<HTMLElement>('#charge-heading');
          heading?.scrollIntoView({ block: 'nearest' });
          heading?.focus({ preventScroll: true });
        });
        return;
      }
      select(id);
      setPage('devices');
      setDetailId(id);
      window.scrollTo(0, 0);
    }
  }), []);
  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(undefined), 4500);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const run: Run = async (command, options) => {
    const result = await api.command(command).catch((): CommandResult => ({ ok: false, error: '与应用主进程的连接已断开' }));
    if (!result.ok) {
      if (!options?.inlineError) setFeedback({ text: result.error, error: true });
    } else setFeedback(result.message ? { text: result.message } : undefined);
    return result;
  };
  useEffect(() => {
    if (!detailed) return;
    detailBack.current?.focus({ preventScroll: true });
    const onBack = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      closeDetail();
    };
    window.addEventListener('keydown', onBack);
    return () => window.removeEventListener('keydown', onBack);
  }, [detailed?.id]);

  function cancelTransition() {
    const active = activeTransition.current;
    activeTransition.current = undefined;
    active?.forEach(motion => motion.cleanup());
  }

  function transitionDetail(from: ReturnType<typeof detailPhoto>, to?: HTMLImageElement, duration = 335,
    reflection?: HTMLElement, returning = false, reflectionOpacity?: number) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const active: DetailMotion[] = [];
    // A device-table preview and the full-size art sit on opposite sides.
    // Animate the destination in place rather than crossing readable controls.
    const photo = page === 'devices'
      ? to && fadeDetailPhoto(to)
      : from && to && animateDetailPhoto(from, to, duration);
    if (photo) active.push(photo);
    if (reflection) active.push(returning ? fadeReflection(reflection, true, 190, reflectionOpacity === undefined ? 95 : 0, reflectionOpacity) : fadeReflection(reflection, false, 230));
    if (!active.length) return;
    activeTransition.current = active;
    void Promise.allSettled(active.map(motion => motion.finished)).then(() => {
      if (activeTransition.current === active) cancelTransition();
    });
  }
  function openDetail(id: string, source?: HTMLElement) {
    const live = livePhoto();
    const reflection = freezeReflection(stageReflection(source));
    cancelTransition();
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : source ?? null;
    returnScroll.current = window.scrollY;
    const photo = source?.querySelector<HTMLImageElement>('[data-list-art-layer]:not([data-exiting]) img[data-device-art]') ??
      source?.querySelector<HTMLImageElement>('[data-active-stage] img[data-device-art]') ??
      source?.querySelector<HTMLImageElement>('img[data-device-art]') ?? undefined;
    sourcePhoto.current = photo;
    const from = live && photo && live.image.src === photo.src ? live : detailPhoto(photo);
    const device = state.devices.find(item => item.id === id);
    if (device) prepareHero(device);
    flushSync(() => setDetailId(id));
    window.scrollTo(0, 0);
    transitionDetail(from, main.current?.querySelector<HTMLImageElement>('[data-full="true"] img[data-device-art]') ?? undefined, 335, reflection);
  }

  function closeDetail() {
    const from = livePhoto() ?? detailPhoto(main.current?.querySelector<HTMLImageElement>('[data-full="true"] img[data-device-art]') ?? undefined);
    const exitingReflection = document.querySelector('[data-reflection-exit]');
    const reflectionOpacity = exitingReflection ? Number(getComputedStyle(exitingReflection).opacity) : undefined;
    cancelTransition();
    flushSync(() => setDetailId(undefined));
    window.scrollTo(0, returnScroll.current);
    if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
    if (!main.current?.contains(document.activeElement)) main.current?.focus({ preventScroll: true });
    const returnPhoto = sourcePhoto.current?.isConnected ? sourcePhoto.current : page === 'devices' ?
      main.current?.querySelector<HTMLImageElement>('[data-full="false"] img[data-device-art]') ?? undefined : undefined;
    transitionDetail(from, returnPhoto, 285, stageReflection(main.current), true, reflectionOpacity);
  }
  useEffect(() => {
    const skip = () => cancelTransition();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    reduced.addEventListener('change', skip);
    document.addEventListener('visibilitychange', skip);
    window.addEventListener('resize', skip);
    return () => {
      reduced.removeEventListener('change', skip);
      document.removeEventListener('visibilitychange', skip);
      window.removeEventListener('resize', skip);
      cancelTransition();
    };
  }, []);
  useEffect(() => {
    const timers = new Map<Element, number>();
    const onScroll = (event: Event) => {
      const pane = event.target === document ? document.scrollingElement : event.target;
      if (!(pane instanceof HTMLElement) || (pane !== document.scrollingElement && !main.current?.contains(pane))) return;
      window.clearTimeout(timers.get(pane));
      pane.dataset.scrolling = '';
      timers.set(pane, window.setTimeout(() => {
        delete pane.dataset.scrolling;
        timers.delete(pane);
      }, 700));
    };
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('scroll', onScroll, true);
      for (const [pane, timer] of timers) {
        window.clearTimeout(timer);
        pane.removeAttribute('data-scrolling');
      }
    };
  }, []);

  function navigate(next: Page) {
    if (next === page) {
      if (detailed) closeDetail();
      return;
    }
    cancelTransition();
    setDetailId(undefined);
    setPage(next);
  }
  function showDevices(next: Filter) { search(''); select(undefined); setFilter(next); navigate('devices'); }
  const historyRetention = state.settings.historyRetention ?? defaults.historyRetention;
  const viewRange = limitHistoryRange(currentHistoryRange ?? 'day', historyRetention);
  useEffect(() => {
    setCurrentHistoryRange(previous => previous && limitHistoryRange(previous, historyRetention));
  }, [historyRetention]);
  const chooseHistoryRange = (value: string) => {
    if (isHistoryRange(value) && isHistoryRangeWithin(value, historyRetention)) setCurrentHistoryRange(value);
  };
  const headings: Record<Page, string> = { overview: '我的桌面', devices: '我的设备', alerts: '提醒', history: '电量对比', settings: '设置' };
  return <div className={s.shell + ' ' + look.shell + ' ' + preferences.mainPalette} data-theme={palette} data-view={detailed ? 'detail' : page}
    style={{ '--studio-stage': `url("${studioPath('stage.webp')}")`, '--alert-stage': `url("${studioPath('alerts-stage.webp')}")` } as CSSProperties}>
    <ColdStartMotion cold={inventory === 'cold'} visible={page === 'overview' && !detailed} />
    <a className={s.skipLink} draggable={false} href="#main-content">跳到主要内容</a>
    <header className={s.topbar + ' ' + look.topbar}
      onMouseDown={event => { if (event.button === 0 && event.detail === 1 && api.windowAction && !(event.target as HTMLElement).closest?.('button, nav, a')) void api.windowAction('drag').catch(() => {}); }}
      onDoubleClick={event => { if (api.windowAction && !(event.target as HTMLElement).closest?.('button, nav, a')) void api.windowAction('maximize').catch(() => {}); }}>
      <Brand />
      <JellyNav current={page}>{pages.map(([id, label]) => <button key={id} className={s.navItem + ' ' + look.navItem}
        aria-label={label} aria-current={page === id ? 'page' : undefined} onClick={() => navigate(id)}><span>{label}</span>
        {id === 'alerts' && low.length > 0 && <i aria-hidden="true" />}</button>)}</JellyNav>
      {api.windowAction && <div className={s.captionControls}>
        <button type="button" aria-label="最小化" onClick={() => void api.windowAction?.('minimize').catch(() => {})}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8h8" /></svg></button>
        <button type="button" aria-label="最大化或还原" onClick={() => void api.windowAction?.('maximize').catch(() => {})}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5h7v7h-7z" /></svg></button>
        <button type="button" aria-label="关闭窗口" onClick={() => void api.windowAction?.('close').catch(() => {})}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" /></svg></button>
      </div>}
    </header>
    <main className={s.content + ' ' + look.content} id="main-content" tabIndex={-1} ref={main}>
      <div className={s.pageBody} hidden={!!detailed}>
      <header className={s.heading + (page === 'overview' ? ' ' + look.deskToolbar : '')} data-history={page === 'history'} data-page-heading={page}><div><h1>{headings[page]}</h1></div>
        {((page === 'overview' && inventory !== 'cold') || page === 'devices') && <div className={s.headingActions}>
          {page === "devices" && !starting && <label className={s.searchBox}><Search size={17} aria-hidden="true" />
            <input type="search" autoComplete="off" name="device-search" aria-label="搜索设备" value={query}
              onChange={event => search(event.target.value)} placeholder="搜索设备" />
          </label>}
          <button className={s.iconButton} title="立即刷新" aria-label="立即刷新" disabled={starting || state.refreshing} onClick={() => { void run({ type: 'refresh' }); }}>
            <RefreshCw size={18} className={state.refreshing ? s.spin : ''} /></button>
          {(state.devices.length > 0 || inventory === 'cold') && <button className={page === "devices" ? s.primary : s.button} onClick={() => setFinding(true)}><Plus size={18} />查找设备</button>}
        </div>}
      </header>
      {(state.collector !== 'ready' && !(page === 'overview' && starting)) && <div className={s.notice} role="status"><Activity size={19} /><span>{
        { starting: inventory === 'cached' ? '正在确认连接。' : '正在读取设备…', occupied: '请退出旧版 PowerManager，由余电接管监测。',
          retrying: '正在重新连接采集程序…' }[state.collector]}</span></div>}
      {state.error && <div className={s.notice} role="alert"><TriangleAlert size={19} />{state.error}</div>}
      {page === 'overview' && <Overview state={state} openDetail={openDetail} showDevices={showDevices} find={() => setFinding(true)}
        chosen={featured} choose={chooseFeatured} mode={overviewMode} setMode={setOverviewMode} />}
      {page === 'devices' && (inventory === 'cold' ? <DeviceSkeleton /> :
        inventory === 'unavailable' ? <Empty button={() => setFinding(true)}>暂无法读取设备，等待采集恢复</Empty> :
        <Devices state={state} sortConnections={sortConnections} selected={selected} pick={select} filter={filter} setFilter={setFilter} query={query} sort={deviceSort} setSort={setDeviceSort} clearSearch={() => search('')} openDetail={openDetail} run={run} reportFeedback={setFeedback} find={() => setFinding(true)} />)}
      {page === 'alerts' && <Alerts state={state} run={run} open={openDetail} />}
      {page === 'history' && <History state={state} starting={inventory === 'cold'} find={() => setFinding(true)} range={viewRange} retention={historyRetention} chooseRange={chooseHistoryRange} slots={historySlots} setSlots={chooseHistorySlots} />}
      {page === 'settings' && <Settings state={state} run={run} palette={palette} choosePalette={choosePalette} retention={historyRetention} position={settingsPosition} />}
      </div>
      {detailed && <div className={s.pageBody}>
        <header className={s.fullHeader + ' ' + look.detailBack}>
          <button className={look.ghost} ref={detailBack} onClick={closeDetail}><ArrowLeft size={16} aria-hidden="true" />返回{pages.find(([id]) => id === page)?.[1]}</button>
        </header>
        <Details key={detailed.id} device={detailed} state={state} run={run} reportFeedback={setFeedback} full />
      </div>}
      <footer className={s.appFooter + ' ' + look.footer} data-cold={page === 'overview' && !detailed && inventory === 'cold'}>
        <span className={s.monitorState}><i data-state={state.collector} />{state.collector === "ready" ? "后台监测中" : "等待采集"}</span>
        {page === "overview" && !detailed && <button className={s.textButton} onClick={() => navigate("alerts")}>管理提醒 <ChevronRight size={16} /></button>}
        <small>{state.demo ? '示例数据' : '电量以设备或 Windows 上报为准'}</small>
      </footer>
    </main>
    {finding && <FindDevices state={state} run={run} close={() => setFinding(false)} />}
    {feedback && <div className={s.feedback} data-error={!!feedback.error} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</div>}
  </div>;
}
function Empty({ children, button, action = '查找设备' }: { children: ReactNode; button?: () => void; action?: string }) {
  return <div className={s.empty}><MonitorSmartphone size={32} /><p>{children}</p>
    {button && <button className={s.button} onClick={button}>{action}</button>}</div>;
}
function DeviceSkeleton() {
  return <div className={s.deviceSplit} aria-hidden="true">
    <div className={s.skeletonHero} />
    <div>{[0, 1, 2, 3].map(index => <div className={s.skeletonRow} key={index} />)}</div>
  </div>;
}

function batteryState(device: Device, state: Snapshot) {
  if (device.status !== 'current' || !device.reading) return device.reason;
  const alert = level(device, state);
  if (alert) return alert === 'critical' ? '电量告急' : '低电量';
  if (device.reading.power === 'charging') return '充电中';
  if (device.reading.power === 'full') return '已充满';
  return '电量正常';
}

function overviewOrder(state: Snapshot) {
  return [...state.devices].sort((a, b) =>
    Number(isConnected(b)) - Number(isConnected(a)) ||
    Number(!!level(b, state)) - Number(!!level(a, state))).map(device => device.id);
}

function deviceLowThreshold(device: Device, state: Snapshot) {
  return state.deviceSettings[device.id]?.low ?? state.settings.low;
}

function overviewListFacts(device: Device, state: Snapshot, live: boolean) {
  const threshold = deviceLowThreshold(device, state);
  const limit = `低电量阈值：${threshold}%（${state.deviceSettings[device.id]?.low === undefined ? '跟随全局' : '设备自定义'}）`;
  const readTime = device.lastRead != null && Number.isFinite(device.lastRead) && device.lastRead > 0 ? dateLabel(device.lastRead) : undefined;
  const time = readingUpdated(device.lastRead);
  const power = live && device.status === 'current' ? device.reading?.power : undefined;
  const powerLabel = ({ ...powerLabels, unknown: '未上报', discharging: '供电' })[power ?? 'unknown'];
  const powerDescription = '充电状态：' + (power ? powerLabels[power] : '未确认');
  const hasConnection = !!device.connection && isConnected(device);
  return {
    threshold, limit, readTime, time, power, powerLabel, powerDescription, hasConnection,
    description: [isLiveDualSenseFull(device) ? '已充满' : '电量：' + readingLabel(device.reading),
      limit, time, powerDescription, ...(hasConnection ? ['连接方式：' + device.connection] : [])].join('；'),
  };
}

function Overview({ state, openDetail, showDevices, find, chosen, choose, mode, setMode }: { state: Snapshot;
  openDetail: (id: string, source?: HTMLElement) => void;
  showDevices: (value: Filter) => void; find: () => void;
  chosen?: string; choose: (id?: string) => void;
  mode: 'stage' | 'list'; setMode: (value: 'stage' | 'list') => void;
}) {
  const [order, setOrder] = useState(() => overviewOrder(state));
  const [stageResumed, setStageResumed] = useState(false);
  const [modeInfo, setModeInfo] = useState<'entry' | 'exit'>();
  const [departing, setDeparting] = useState<Device>();
  const [listOutgoing, setListOutgoing] = useState<{ device: Device; opacity: number; y: number }>();
  const [listReady, setListReady] = useState(true);
  const [listIncoming, setListIncoming] = useState<{ opacity: number; y: number }>();
  const artRequest = useRef(0);
  const listArtwork = useRef<HTMLDivElement>(null);
  const overviewDesk = useRef<HTMLDivElement>(null);
  const overviewPlane = useRef<HTMLDivElement>(null);
  const modeMotion = useRef<OverviewModeMotion | undefined>(undefined);
  const carousel = useRef<HTMLDivElement>(null);
  const stageAnimations = useRef<Animation[]>([]);
  const pendingStage = useRef<(() => void) | undefined>(undefined);
  const drag = useRef<{ pointer: number; x: number; y: number; samples: StageSample[]; poses?: Map<string, StagePose> } | null>(null);
  const lastDragged = useRef(-Infinity);
  const hero = useRef<HTMLElement>(null);
  const deviceById = new Map(state.devices.map(device => [device.id, device]));
  const ordered = [...new Set([...order, ...overviewOrder(state)])].flatMap(id => {
    const device = deviceById.get(id);
    return device ? [device] : [];
  });
  const featured = (chosen ? deviceById.get(chosen) : undefined) ?? ordered[0];
  const index = ordered.findIndex(device => device.id === featured?.id);
  const inventory = inventoryState(state);
  const initial = inventory === 'cold';
  const [previousInitial, setPreviousInitial] = useState(initial);
  const [revealId, setRevealId] = useState<string>();
  const [reveal, setReveal] = useState(false);
  if (initial !== previousInitial) {
    setPreviousInitial(initial);
    const revealDevice = !initial && inventory === 'ready' && featured && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    setRevealId(revealDevice ? featured.id : undefined);
    setReveal(!!revealDevice);
  }
  useEffect(() => {
    if (!reveal) return;
    const timer = window.setTimeout(() => setReveal(false), 340);
    return () => clearTimeout(timer);
  }, [reveal]);
  const phase = initial ? 'initial' : inventory === 'ready' && state.refreshing ? 'refreshing' : 'ready';
  useEffect(() => {
    const ranked = overviewOrder(state);
    const available = new Set(ranked);
    setOrder(previous => {
      const retained = previous.filter(id => available.has(id));
      const additions = ranked.filter(id => !retained.includes(id));
      return additions.length || retained.length !== previous.length ? [...retained, ...additions] : previous;
    });
    if (chosen && !available.has(chosen)) choose(undefined);
  }, [state, chosen]);
  useEffect(() => {
    if (initial || index < 0) return;
    const at = (offset: number) => ordered[(index + offset + ordered.length) % ordered.length];
    [featured, at(-1), at(1), ordered[0]].filter((item): item is Device => !!item).forEach(prepareHero);
  }, [initial, featured?.art, index, ordered.length]);
  useEffect(() => {
    if (!listOutgoing || !listReady) return;
    const timer = window.setTimeout(() => setListOutgoing(undefined), 250);
    return () => clearTimeout(timer);
  }, [listOutgoing, listReady]);

  useEffect(() => {
    const cancel = () => modeMotion.current?.cancel();
    const policy = matchMedia('(min-width: 771px) and (prefers-reduced-motion: no-preference)');
    window.addEventListener('resize', cancel);
    document.addEventListener('visibilitychange', cancel);
    policy.addEventListener('change', cancel);
    return () => {
      window.removeEventListener('resize', cancel);
      document.removeEventListener('visibilitychange', cancel);
      policy.removeEventListener('change', cancel);
      cancel();
    };
  }, []);

  useEffect(() => { modeMotion.current?.cancel(); }, [featured?.id]);
  useEffect(() => {
    const policy = matchMedia('(prefers-reduced-motion: reduce)');
    const clear = () => { resetStage(); setDeparting(undefined); };
    policy.addEventListener('change', clear);
    document.addEventListener('visibilitychange', clear);
    window.addEventListener('resize', clear);
    return () => {
      policy.removeEventListener('change', clear);
      document.removeEventListener('visibilitychange', clear);
      window.removeEventListener('resize', clear);
      resetStage();
    };
  }, []);

  function switchMode(next: 'stage' | 'list') {
    if (next === mode) return;
    artRequest.current++;
    const desk = overviewDesk.current;
    const plane = overviewPlane.current;
    const enabled = featured && desk && plane && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    const motion = enabled ? modeMotion.current ??= new OverviewModeMotion(desk, plane) : modeMotion.current;
    const morph = enabled && allowOverviewMotion();
    const before = morph ? motion?.read(mode, featured.id) : undefined;
    const reflection = enabled && next === 'list' ? freezeReflection(stageReflection(desk)) : undefined;
    motion?.cancel();
    resetStage();
    const commit = () => {
      setListOutgoing(undefined);
      setListIncoming(undefined);
      setListReady(true);
      setDeparting(undefined);
      setRevealId(undefined);
      setStageResumed(next === 'stage' && !before?.photo);
      setModeInfo(before?.rail ? next === 'list' ? 'entry' : 'exit' : undefined);
      setMode(next);
    };
    if (!enabled || !motion) { commit(); return; }
    flushSync(commit);
    motion.play(before ?? {}, morph ? motion.read(next, featured.id, false) : {}, next, reflection);
  }

  function previewInList(device: Device) {
    const request = ++artRequest.current;
    if (device.id === featured?.id) return;
    const commit = () => {
      if (request !== artRequest.current || !listArtwork.current?.isConnected) return;
      modeMotion.current?.cancel();
      const live = [...listArtwork.current.querySelectorAll<HTMLElement>('[data-list-art-layer]')].map(node => {
        const style = getComputedStyle(node);
        return { id: node.dataset.deviceId, opacity: Number(style.opacity),
          y: style.transform === 'none' ? 0 : new DOMMatrixReadOnly(style.transform).m42,
          ready: Boolean(node.querySelector('[data-art-ready], svg[data-device-art]')) };
      });
      const previous = live.filter(item => item.id !== device.id).sort((a, b) => b.opacity - a.opacity)[0];
      const incoming = live.find(item => item.id === device.id);
      const visible = previous && (previous.id === featured?.id ? featured :
        previous.id === listOutgoing?.device.id ? listOutgoing?.device : undefined);
      setListOutgoing(visible && previous.opacity > .01 ? { device: visible, opacity: previous.opacity, y: previous.y } : undefined);
      setListIncoming(incoming);
      setListReady(incoming?.ready === true || device.art === 'unknown' || !visible);
      setDeparting(undefined);
      choose(device.id);
    };
    if (heroPrepared(device)) commit();
    else void prepareHero(device).then(commit);
  }
  const connectionStatus = !featured || featured.status === 'stale' || inventory !== 'ready'
    ? 'pending' : featured.status === 'offline' ? 'offline' : isConnected(featured) ? 'connected' : 'pending';
  const critical = !!featured && inventory === 'ready' && level(featured, state) === 'critical';

  const stageNodes = () => [...(carousel.current?.querySelectorAll<HTMLElement>('[data-stage-layer]') ?? [])];
  function stopStageAnimations() {
    pendingStage.current = undefined;
    const previous = stageAnimations.current;
    stageAnimations.current = [];
    previous.forEach(animation => animation.cancel());
  }
  function resetStage() {
    stopStageAnimations();
    drag.current = null;
    if (carousel.current) delete carousel.current.dataset.dragging;
    stageNodes().forEach(node => { node.style.removeProperty('transform'); node.style.removeProperty('opacity'); });
  }
  function playStage(frames: Map<string, Keyframe[]>, duration: number, waitForPhoto = true) {
    const photo = carousel.current?.querySelector<HTMLImageElement>('[data-active-stage] img[data-device-art]');
    if (waitForPhoto && photo && photo.dataset.artReady === undefined) {
      // JSX mounts its own image. Even if the preloader finished, the live
      // image may re-fetch. Keep the last painted frame until it is ready.
      stageNodes().forEach(node => {
        const first = frames.get(node.dataset.stageLayer!)?.[0];
        if (first && typeof first.transform === 'string' && typeof first.opacity === 'number')
          paintStage(node, { transform: first.transform, opacity: first.opacity });
      });
      pendingStage.current = () => playStage(frames, duration, false);
      return;
    }
    pendingStage.current = undefined;
    if (!duration) {
      stageNodes().forEach(node => { node.style.removeProperty('transform'); node.style.removeProperty('opacity'); });
      setDeparting(undefined);
      return;
    }
    const active: Animation[] = [];
    stageNodes().forEach(node => {
      const poses = frames.get(node.dataset.stageLayer!);
      if (!poses) return;
      // The settled style is already underneath the animation; WAAPI owns only the flight.
      node.style.removeProperty('transform');
      node.style.removeProperty('opacity');
      active.push(node.animate(poses, { duration, fill: 'both' }));
    });
    stageAnimations.current = active;
    void Promise.allSettled(active.map(animation => animation.finished)).then(() => {
      if (stageAnimations.current !== active) return;
      stopStageAnimations();
      setDeparting(undefined);
    });
  }
  function activate(device: Device, way?: 1 | -1, velocity = 0, gesture = false, tried = false) {
    const request = ++artRequest.current;
    if (initial || device.id === featured?.id) return;
    if (!tried && !heroPrepared(device)) {
      void prepareHero(device).then(() => {
        if (request === artRequest.current && carousel.current?.isConnected) activate(device, way, velocity, gesture, true);
      });
      return;
    }
    modeMotion.current?.cancel();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const live = new Map(stageNodes().map(node => [node.dataset.stageLayer!, stagePose(node)]));
    const outgoing = [featured, departing].filter((item): item is Device => !!item && item.id !== device.id)
      .sort((a, b) => (live.get(b.id)?.opacity ?? 0) - (live.get(a.id)?.opacity ?? 0))[0];
    const direction = way ?? (ordered.findIndex(item => item.id === device.id) < index ? -1 : 1);
    const out = outgoing && live.get(outgoing.id);
    resetStage();
    flushSync(() => {
      setDeparting(outgoing);
      setRevealId(undefined);
      choose(device.id);
    });
    const previousEntry = live.get(device.id);
    // A quick wrap can bring back the layer still leaving on the other side.
    // Only resume its pose if it is on this gesture's incoming side.
    const reuseEntry = previousEntry && (!gesture || canReuseStageEntry(
      new DOMMatrixReadOnly(previousEntry.transform === 'none' ? undefined : previousEntry.transform).m41, direction));
    const enter = (reuseEntry ? previousEntry : undefined) ?? {
      transform: gesture ? `perspective(1000px) translate3d(${38 * direction}%, 3%, -175px) rotateY(${-25 * direction}deg) scale(.83)`
        : `translateX(${8 * direction}px)`,
      opacity: 0,
    };
    const frames = new Map<string, Keyframe[]>([[device.id, [
      { ...enter, easing: 'cubic-bezier(.19,.74,.22,1)' }, stageRest,
    ]]]);
    if (outgoing && out) {
      const exit: StagePose = { opacity: 0, transform: gesture
        ? `perspective(1000px) translate3d(${-48 * direction}%, 4%, -205px) rotateY(${28 * direction}deg) scale(.8)`
        : `translateX(${-8 * direction}px)` };
      // First 24 ms inherit pointer speed without jumping away from the last visible pose.
      const lead = stageReleaseLead(velocity, direction);
      frames.set(outgoing.id, gesture && Math.abs(lead) > 1 ? [
        { ...out, offset: 0 }, { ...shifted(out, lead), offset: .052, easing: 'cubic-bezier(.26,.55,.29,1)' }, { ...exit, offset: 1 },
      ] : [{ ...out, easing: 'cubic-bezier(.24,.62,.3,1)' }, exit]);
    }
    playStage(frames, reduced ? 0 : gesture ? 460 : 205);
  }
  function step(delta: 1 | -1, velocity = 0, gesture = false) {
    if (ordered.length < 2) return;
    activate(ordered[(index + delta + ordered.length) % ordered.length], delta, velocity, gesture);
  }
  function openFeatured(device: Device, row?: HTMLElement) {
    const wasFeatured = device.id === featured?.id;
    artRequest.current++;
    modeMotion.current?.cancel();
    // Capture the active photo before clearing any in-progress carousel movement.
    if (device.id === featured?.id && mode === 'stage') {
      openDetail(device.id, hero.current ?? undefined);
      resetStage();
      setDeparting(undefined);
      return;
    }
    if (device.id !== featured?.id || departing || listOutgoing) flushSync(() => {
      setListOutgoing(undefined);
      setListIncoming(undefined);
      setListReady(true);
      setDeparting(undefined);
      setRevealId(undefined);
      if (device.id !== featured?.id) choose(device.id);
    });
    openDetail(device.id, (!wasFeatured && row ? row : mode === 'stage' ? hero.current : listArtwork.current) ?? undefined);
  }
  function trackDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const tracking = drag.current;
    if (!tracking || tracking.pointer !== event.pointerId) return;
    const dx = event.clientX - tracking.x;
    const dy = event.clientY - tracking.y;
    tracking.samples = [...tracking.samples, { x: event.clientX, at: event.timeStamp }].filter(point => event.timeStamp - point.at <= 100);
    if (!tracking.poses) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { drag.current = null; return; }
      if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy) * 1.1) return;
      tracking.poses = new Map(stageNodes().map(node => [node.dataset.stageLayer!, stagePose(node)]));
      stopStageAnimations();
      event.currentTarget.dataset.dragging = 'true';
    }
    const x = stageTravel(dx, event.currentTarget.clientWidth);
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
      stageNodes().forEach(node => paintStage(node, shifted(tracking.poses!.get(node.dataset.stageLayer!) ?? stageRest, x)));
  }
  function endDrag(event: ReactPointerEvent<HTMLDivElement>, commit: boolean) {
    const tracking = drag.current;
    if (!tracking || tracking.pointer !== event.pointerId) return;
    if (commit) trackDrag(event);
    drag.current = null;
    delete event.currentTarget.dataset.dragging;
    if (!tracking.poses) return;
    lastDragged.current = performance.now();
    const dx = event.clientX - tracking.x;
    const velocity = stageVelocity(tracking.samples);
    const next = commit && stageLanding(dx, event.currentTarget.clientWidth, velocity);
    if (next) { step(next, velocity, true); return; }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { resetStage(); setDeparting(undefined); return; }
    const frames = new Map(stageNodes().map(node => {
      const pose = stagePose(node);
      return [node.dataset.stageLayer!, [{ ...pose, easing: 'cubic-bezier(.22,.75,.23,1)' },
        node.hasAttribute('data-active-stage') ? stageRest : { ...pose, opacity: 0 }]];
    }));
    playStage(frames, 230);
  }
  return <div ref={overviewDesk} className={look.desk + ' ' + listLook.modeDesk + (mode === 'list' ? ' ' + listLook.listDesk : '')} data-load-state={inventory === 'cached' || inventory === 'unavailable' ? inventory : phase} data-mode={mode} data-cold-reveal={reveal || undefined} data-mode-featured={!!featured && !initial || undefined}
    data-mode-info-entry={modeInfo === 'entry' || undefined} data-mode-info-exit={modeInfo === 'exit' || undefined}>
    <div className={listLook.modeOverlay} ref={overviewPlane} aria-hidden="true" />
    <div className={listLook.bottomVeil} data-mode-bottom-veil="" aria-hidden="true" />
    {(initial || reveal) && <div className={look.coldCopy} data-cold-copy="" data-exiting={!initial || undefined} aria-hidden={!initial || undefined} role={initial ? 'status' : undefined}>
      <h2>正在识别设备</h2>
    </div>}
    {featured && !initial && mode === 'stage' && <section ref={hero} className={look.hero + (stageResumed ? ' ' + listLook.stageResume : '')} aria-label="主设备">
      <div className={look.heroData + ' ' + listLook.modeStageCopy} aria-live="polite">
        <h2 title={featured?.name}>{featured.name}</h2>
        <SceneBattery device={featured} state={state} phase={phase} />
        <div className={look.heroMeta}>
          <div className={look.heroState} data-tone={tone(featured, state)}>
            {phase === 'refreshing' && featured.status === 'current' ? <span role="status">正在更新</span> :
              !isLiveDualSenseFull(featured) && <><i aria-hidden="true" /><span>{batteryState(featured, state)}</span>
              </>}
            {featured.lastRead !== null && <small>{readingUpdated(featured.lastRead)}</small>}
          </div>
          <button className={look.ghost} onClick={() => openFeatured(featured)}>
            查看详情 <ChevronRight size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className={look.carousel} ref={carousel}
        role="group" aria-label="主设备视觉展示" tabIndex={initial || ordered.length <= 1 ? -1 : 0}
        onDoubleClick={event => {
          if (performance.now() - lastDragged.current > 320 && !(event.target as Element).closest('button')) openFeatured(featured);
        }}
        onKeyDown={event => {
          if (event.target !== event.currentTarget || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
          event.preventDefault(); step(event.key === 'ArrowRight' ? 1 : -1);
        }}
        onPointerDown={event => {
          if (initial || ordered.length < 2 || !event.isPrimary || event.button !== 0 || (event.target as Element).closest('button')) return;
          artRequest.current++;
          modeMotion.current?.cancel();
          drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, samples: [{ x: event.clientX, at: event.timeStamp }] };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={trackDrag}
        onPointerUp={event => endDrag(event, true)}
        onPointerCancel={event => endDrag(event, false)}
        onLostPointerCapture={event => endDrag(event, false)}>
        {(departing ? [departing, featured] : [featured]).map(device => {
          const active = device.id === featured.id;
          return <div key={device.id} className={active ? look.arriving : look.departing} data-stage-layer={device.id}
            data-active-stage={active ? '' : undefined} data-departing={active ? undefined : ''} aria-hidden={!active || undefined}>
            <SceneStage device={device} reflect revealPhoto={active && revealId === device.id}
              onArtReady={active ? () => {
                const current = carousel.current?.querySelector<HTMLElement>('[data-active-stage]');
                if (current?.dataset.stageLayer === device.id) pendingStage.current?.();
              } : undefined} />
          </div>;
        })}
        {ordered.length > 1 && ordered.length <= 8 && <div className={look.dots} role="group" aria-label="主设备切换">{ordered.map(device => <button
          key={device.id} aria-label={'展示 ' + device.name} aria-pressed={device.id === featured?.id} disabled={initial}
          onClick={() => activate(device)} />)}</div>}
      </div>
    </section>}
    {!featured && !initial && (inventory === 'unavailable'
      ? <Empty button={find}>暂无法读取设备，等待采集恢复</Empty> : <Empty button={find}>尚未监测到外设</Empty>)}
    {!initial && mode === 'list' && featured && <>
      <div className={listLook.artFrame} ref={listArtwork} data-list-artwork="" aria-hidden="true">
        {listOutgoing && <div className={listLook.artLayer} data-list-art-layer="" data-device-id={listOutgoing.device.id}
          data-exiting="" data-waiting={!listReady || undefined} key={listOutgoing.device.id}
          style={{ '--list-art-opacity': listOutgoing.opacity, '--list-art-y': listOutgoing.y + 'px' } as CSSProperties}><Art device={listOutgoing.device} variant="stage" /></div>}
        <div className={listLook.artLayer} data-list-art-layer="" data-device-id={featured.id}
          data-animated={!!listOutgoing && listReady || undefined} data-waiting={!listReady || undefined} key={featured.id}
          style={{ '--list-art-in-opacity': listIncoming?.opacity ?? 0, '--list-art-in-y': (listIncoming?.y ?? 8) + 'px' } as CSSProperties}>
          <Art device={featured} variant="stage" onReady={() => {
            const current = listArtwork.current?.querySelector<HTMLElement>('[data-list-art-layer]:not([data-exiting])');
            if (current?.dataset.deviceId === featured.id) setListReady(true);
          }} />
        </div>
      </div>
    </>}
    {!initial && featured && (mode === 'list' || modeInfo === 'exit') &&
      <div className={listLook.status} role={mode === 'list' ? 'status' : undefined} aria-hidden={mode !== 'list' || undefined}
        aria-label="所选设备状态" data-connection-state={connectionStatus}>
        <span className={listLook.connection}><i aria-hidden="true" />{{
          pending: '连接待确认', offline: '未连接', connected: '已连接',
        }[connectionStatus]}</span>
        {critical && <span className={listLook.critical} data-list-critical=""><CircleAlert size={15} aria-hidden="true" />电量告急</span>}
      </div>}
    {!initial && <section className={look.rail + ' ' + listLook.modeRail + (mode === 'list' ? ' ' + listLook.rail : '')} data-mode-rail="" aria-label="切换设备">
      <header className={look.railHeader}>
        <div className={look.modeControl} role="group" aria-label="总览显示方式">
          <button disabled={initial} aria-label="展台模式" aria-pressed={mode === 'stage'} onClick={() => switchMode('stage')}><LayoutGrid size={15} /></button>
          <button disabled={initial} aria-label="列表模式" aria-pressed={mode === 'list'} onClick={() => switchMode('list')}><List size={17} /></button>
        </div>
        <button className={look.ghost} onClick={() => showDevices('all')}>全部设备 <ChevronRight size={14} aria-hidden="true" /></button>
      </header>
      <div className={look.railRows + ' ' + listLook.sharedRows} data-mode-rail-scroll="" data-scroll-pane="" aria-busy={initial || undefined}>
        {ordered.map(device => {
          const facts = overviewListFacts(device, state, inventory === 'ready');
          return <div key={device.id} className={listLook.entry} data-mode-row=""
          data-list-selected={mode === 'list' && device.id === featured?.id ? '' : undefined}>
          {device.id === featured?.id && <LiquidSelection />}
          <button className={look.railRow + ' ' + listLook.selectRow} aria-label={device.name}
            aria-description={mode === 'list' ? facts.description : undefined}
            aria-pressed={device.id === featured?.id} disabled={initial}
            title={device.name} onClick={() => mode === 'stage' ? activate(device) : previewInList(device)}
            onDoubleClick={() => openFeatured(device)}>
            <Art device={device} variant="card" />
            <div className={look.railInfo + ' ' + listLook.sharedInfo}>
              <div className={look.railName}><b>{device.name}</b></div>
              <strong className={look.railValue} data-tone={tone(device, state)}>{isLiveDualSenseFull(device) ? '已充满' : readingLabel(device.reading)}</strong>
              <span className={listLook.modeExtra} data-mode-extra="" aria-hidden={mode !== 'list' || undefined}>
                <span data-list-field="threshold" title={facts.limit}><Bell aria-hidden="true" /><span>{facts.threshold}%</span></span>
                <span data-list-field="last-read" title={facts.time}><Clock aria-hidden="true" /><span>{facts.readTime ?? '—'}</span></span>
                <span data-list-field="power" data-power={facts.power ?? 'unconfirmed'} title={facts.powerDescription}>
                  <Zap aria-hidden="true" /><span>{facts.power ? facts.powerLabel : '—'}</span>
                </span>
                {facts.hasConnection && <span data-list-field="connection" title={'连接方式：' + device.connection}>
                  <Connection device={device} />
                </span>}
              </span>
            </div>
          </button>
          <button className={listLook.details} aria-label={'查看详情 · ' + device.name} title="查看详情"
            onClick={event => openFeatured(device, event.currentTarget.parentElement ?? undefined)}>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>})}
      </div>
    </section>}
  </div>;
}

function Devices({ state, sortConnections, selected, pick, filter, setFilter, query, sort, setSort, clearSearch, openDetail, run, reportFeedback, find }: {
  state: Snapshot; sortConnections: ReadonlyMap<string, boolean>; selected?: string; pick: (id?: string) => void; filter: Filter; setFilter: (value: Filter) => void; query: string; sort: string; setSort: (value: string) => void; clearSearch: () => void; openDetail: (id: string, source?: HTMLElement) => void; run: Run; reportFeedback: ReportFeedback; find: () => void;
}) {
  const split = useRef<HTMLDivElement>(null);
  const { devices, alerts } = state;
  const online = devices.filter(isConnected);
  const low = needCharge(state);
  const offline = devices.filter(device => device.status !== 'stale' && !isConnected(device));
  const recent = devices.filter(device => (alerts[device.id]?.lastNoticeAt ?? 0) >= Date.now() - 86400000);
  const groups = { all: devices, online, low, offline, recent };
  const menus: [Filter, string][] = [['all', '全部设备'], ['online', '已连接'],
    ['low', '低电量'], ['offline', '未连接'], ['recent', '最近提醒']];
  const needle = query.trim().toLocaleLowerCase();
  const visible = groups[filter].filter(device => [device.name, device.recognizedName, device.connection, device.art]
    .some(value => value?.toLocaleLowerCase().includes(needle)));
  visible.sort((a, b) => compareDevices(a, b, sort, sortConnections));
  const detail = visible.find(device => device.id === selected) ?? (state.demo && !selected && filter === 'all' && !needle
    ? visible.find(device => device.art === 'dualsense') : visible[0]);
  function openPreview(device: Device) {
    if (device.id !== detail?.id) flushSync(() => pick(device.id));
    openDetail(device.id, split.current?.querySelector<HTMLElement>('[data-full="false"]') ?? undefined);
  }
  return <>
    <div className={s.deviceToolbar}>
      <div className={s.filters} role="group" aria-label="设备筛选">{menus.map(([id, name]) => <button key={id} data-filter={id}
        aria-pressed={filter === id} onClick={() => { setFilter(id); pick(undefined); }}>{name}<b>{groups[id].length}</b></button>)}</div>
      <div className={s.compactFilters}><SelectControl label="设备筛选" value={filter}
        onChange={value => { setFilter(value as Filter); pick(undefined); }}
        choices={menus.map(([value, label]) => ({ value, label: label + ' ' + groups[value].length }))} /></div>
      <SelectControl label="设备排序" value={sort} onChange={setSort} choices={[
          { value: 'state', label: '已连接优先' }, { value: 'low', label: '按电量排序' }, { value: 'name', label: '按名称排序' },
        ]} />
    </div>
    <div ref={split} className={s.deviceSplit + ' ' + look.deviceSplit}>
      <section className={s.deviceListing + ' ' + look.deviceListing} data-scroll-pane="">
        {visible.length ? <table className={s.deviceTable + ' ' + look.deviceTable}><caption>设备（{visible.length}）</caption>
          <thead><tr><th scope="col">设备</th><th scope="col">连接</th><th scope="col">电量</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead>
          <DeviceRowMotion ids={visible.map(device => device.id)} scope={filter + '\0' + needle}>{visible.map(device => {
            const alert = level(device, state);
            return <tr key={device.id} data-device-row={device.id} data-selected={device.id === detail?.id}
            onClick={() => pick(device.id)} onDoubleClick={() => openPreview(device)}>
            <td>{device.id === detail?.id && <LiquidSelection />}<button className={s.deviceName} type="button" aria-pressed={device.id === detail?.id} title={device.name}
              aria-description="选择后在右侧预览，可用查看详情按钮打开完整页面"
              onClick={event => { event.stopPropagation(); pick(device.id); }}>
              <Art device={device} /><b>{device.name}</b>
            </button></td>
            <td>{device.status === 'stale' ? '待确认' : <Connection device={device} />}</td>
            <td className={s.rowReading} data-tone={tone(device, state)}><strong>{isLiveDualSenseFull(device) ? '已充满' : readingLabel(device.reading)}</strong>
              {alert && <small className={s.compactReadingStatus}>{alert === 'critical' ? '电量告急' : '低电量'}</small>}
              {device.lastRead !== null && <small title={readingUpdated(device.lastRead)}>{dateLabel(device.lastRead)}</small>}</td>
            <td><StatusTag device={device} state={state} /></td>
            <td onDoubleClick={event => event.stopPropagation()}><button className={s.iconButton} aria-label={'查看详情 · ' + device.name} title="查看详情"
              onClick={event => { event.stopPropagation(); openPreview(device); }}><ChevronRight size={17} /></button></td>
          </tr>; })}</DeviceRowMotion>
        </table> : <Empty button={devices.length ? () => { setFilter('all'); clearSearch(); } : find} action={devices.length ? '清除筛选' : '查找设备'}>{devices.length ? '未找到匹配设备' : '暂无受监测设备'}</Empty>}
      </section>
      {detail && <Details key={detail.id} device={detail} state={state} run={run} reportFeedback={reportFeedback} openFull={source => openDetail(detail.id, source)} />}
    </div>
  </>;
}
function Details({ device, state, run, reportFeedback, full, openFull }: { device: Device; state: Snapshot; run: Run; reportFeedback: ReportFeedback; full?: boolean; openFull?: (source: HTMLElement) => void }) {
  const detailRef = useRef<HTMLElement>(null);
  const moreActions = useRef<HTMLButtonElement>(null);
  const [editing, edit] = useState(false);
  const [alias, setAlias] = useState(state.deviceSettings[device.id]?.alias ?? '');
  const aliasTooLong = [...alias.trim()].length > 50;
  const [confirmRemove, setRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const rules = state.deviceSettings[device.id];
  const savedLimit = deviceLowThreshold(device, state);
  useEffect(() => { if (!full) prepareHero(device); }, [device.art, full]);
  const low = level(device, state);
  const send = (command: Command) => { void run(command); };
  async function copyDevice() {
    const reading = isLiveDualSenseFull(device) ? '已充满' : readingLabel(device.reading);
    try {
      await navigator.clipboard.writeText([
        device.name, `电量：${reading}`, `读取状态：${device.reason}`,
      ].join('\n'));
      reportFeedback({ text: '已复制设备信息' });
    } catch {
      reportFeedback({ text: '无法复制设备信息', error: true });
    }
  }
  return <section ref={detailRef} className={s.details + ' ' + (full ? look.fullDetail : look.devicePreview)} data-full={!!full} aria-label={full ? "设备详情" : "设备预览"}>
    {!full && <h2 className={s.previewTitle}>设备预览</h2>}
    <div className={s.detailTop + (full ? ' ' + look.detailTop : '')}>
      <div className={s.detailsHeader + (full ? ' ' + look.detailsHeader : '')}
        onDoubleClick={event => {
          if (detailRef.current && (event.target as Element).closest('[data-device-art]')) openFull?.(detailRef.current);
        }}><div className={s.detailName}>{full ? <h1>{device.name}</h1> : <h3>{device.name}</h3>}
          <div><StatusTag device={device} state={state} />{device.status !== 'stale' && <Connection device={device} />}</div></div>
        <SceneStage device={device} detail />
        <button className={s.iconButton} aria-label="编辑设备备注" onClick={() => { setAlias(rules?.alias ?? ''); edit(true); }}><Pencil size={17} /></button></div>
      <div className={s.detailReadout + (full ? ' ' + look.detailReadout : '')} data-scroll-pane=""><div className={s.batteryPanel} data-tone={tone(device, state)}>
        <div className={s.readoutLabel}><span>{!device.reading ? '无数据' : '电量'}</span>{full && !isLiveDualSenseFull(device) && <span className={s.readingState}>{batteryState(device, state)}</span>}</div>
        <SceneBattery state={state} device={device} phase={state.refreshing ? "refreshing" : "ready"} /></div>
        <dl className={s.detailsFacts}>
          {full && isLiveDualSenseFull(device) && <div><Activity size={21} /><div><dt>设备上报区间</dt><dd>{readingLabel(device.reading)}</dd></div></div>}
          <div><ShieldCheck size={21} /><div><dt>读取状态</dt><dd>{device.reason}</dd></div></div>
          <div><Cable size={21} /><div><dt>读数来源</dt><dd>{device.reading ? { hid: '设备 HID', windows: 'Windows 电量属性', ble: '蓝牙电池服务', hid_voltage: '设备电压估算', bluetooth_vendor: '厂商蓝牙协议' }[device.reading.source] : '—'}</dd></div></div>
          <div><Zap size={21} /><div><dt>充电状态</dt><dd>{device.status === 'current' && device.reading ? powerLabels[device.reading.power] : '—'}</dd></div></div>
          <div><Clock size={21} /><div><dt>{readingTimeLabel}</dt><dd>{dateLabel(device.lastRead)}</dd></div></div>
        </dl>

        <Collapsible.Root defaultOpen={!full}>
          {full ? <div className={s.reminderSummary}><span>低电量阈值 <b>{savedLimit}%</b></span>
            <Collapsible.Trigger className={s.primary}>调整提醒 <ChevronDown size={15} aria-hidden="true" /></Collapsible.Trigger>
          </div> : <h3 className={s.detailSection}>提醒设置</h3>}
          <Collapsible.Content className={s.reminderContent}>
          <DeviceThreshold deviceId={device.id} saved={rules?.low} global={state.settings.low} critical={state.settings.critical}
            save={value => run({ type: 'deviceSettings', id: device.id, patch: { low: value } })} />
          <SettingRow title="静音提醒"><SwitchControl label="静音此设备" checked={!!rules?.muted}
            onChange={value => send({ type: 'deviceSettings', id: device.id, patch: { muted: value } })} /></SettingRow>
          </Collapsible.Content>
        </Collapsible.Root>
        <footer className={s.detailActions}>{openFull && <button className={s.primary} onClick={() => { if (detailRef.current) openFull(detailRef.current); }}>查看详情 <ChevronRight size={16} aria-hidden="true" /></button>}<button className={s.button} onClick={() => send({ type: 'preview', severity: low ?? 'low', id: device.id })}><Bell size={19} />提醒测试</button>
          <Menu.Root><Menu.Trigger asChild><button ref={moreActions} className={s.button}><Ellipsis size={20} />更多操作</button></Menu.Trigger>
            <Menu.Portal><Menu.Content align="end" sideOffset={5} className={s.popover}
              onCloseAutoFocus={event => { if (confirmRemove) event.preventDefault(); }}>
              <Menu.Item className={s.menuOption} onSelect={() => void copyDevice()}><Copy size={15} aria-hidden="true" />复制设备信息</Menu.Item>
              <Menu.Item className={s.menuOption} onSelect={() => send({ type: 'refresh' })}><RefreshCw size={15} aria-hidden="true" />立即刷新</Menu.Item>
              <Menu.Item className={s.menuOption} disabled={!low} onSelect={() => send({ type: 'snooze', id: device.id })}><Clock size={15} aria-hidden="true" />{snoozeAction(state.settings.snooze)}</Menu.Item>
              <Menu.Item className={s.menuOption} disabled={!low} onSelect={() => send({ type: 'ignore', id: device.id })}><BellOff size={15} aria-hidden="true" />忽略本次</Menu.Item>
              {device.watched && <><Menu.Separator className={s.menuDivider} /><Menu.Item className={s.menuOption} data-destructive onSelect={() => {
                setRemoveError('');
                setRemove(true);
              }}>
                <MonitorSmartphone size={15} aria-hidden="true" />停止监测</Menu.Item></>}
            </Menu.Content></Menu.Portal></Menu.Root>
        </footer>
        {full && <section className={s.detailHistory + ' ' + look.detailHistory}>
          <SectionTitle>电量趋势 <span>近 24 小时</span></SectionTitle>
          <Chart device={device} revision={device.lastRead} threshold={savedLimit} large />
        </section>}
      </div>
    </div>
    {editing && <Modal title="编辑设备备注" description={'识别名称：' + (device.recognizedName ?? device.name)} hint="备注可填 1–50 个字符，清空后保存可恢复原名。" onClose={() => edit(false)}>
      <form className={s.modalForm} onSubmit={event => {
        event.preventDefault();
        void run({ type: 'deviceSettings', id: device.id, patch: { alias } }).then(reply => { if (reply.ok) edit(false); });
      }}><input autoComplete="off" name="device-name" aria-label="设备备注" aria-invalid={aliasTooLong || undefined}
        value={alias} onChange={event => setAlias(event.target.value)} />
        <button type="submit" className={s.primary} disabled={aliasTooLong}>保存备注</button></form>
      {aliasTooLong && <small role="alert">设备备注最多 50 个字符</small>}
    </Modal>}
    {confirmRemove && <Modal title="停止监测设备？" description={'将从监测列表移除' + device.name + '。'}
      onClose={() => { if (!removing) setRemove(false); }}
      restoreFocus={() => moreActions.current ?? document.querySelector<HTMLElement>('#main-content')}>
      {removeError && <p className={s.formError} role="alert">{removeError}</p>}
      <div className={s.confirmActions}>
        <button className={s.button} type="button" data-dialog-initial="" disabled={removing} onClick={() => setRemove(false)}>取消</button>
        <button className={s.deleteAction} type="button" disabled={removing} onClick={() => {
          setRemoving(true);
          setRemoveError('');
          void run({ type: 'remove', id: device.id }, { inlineError: true }).then(reply => {
            setRemoving(false);
            if (reply.ok) setRemove(false);
            else setRemoveError(reply.error);
          });
        }}>{removing ? '正在停止…' : '停止监测'}</button>
      </div>
    </Modal>}
  </section>;
}

function Alerts({ state, run, open }: { state: Snapshot; run: Run; open: (id: string, source?: HTMLElement) => void }) {
  const devices = needCharge(state).sort((a, b) => Number(level(b, state) === 'critical') - Number(level(a, state) === 'critical'));
  const [low, setLow] = useState(state.settings.low);
  const [critical, setCritical] = useState(state.settings.critical);
  const [preview, setPreview] = useState<'low' | 'critical'>('low');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setLow(state.settings.low); setCritical(state.settings.critical); }, [state.settings.low, state.settings.critical]);
  const muted = state.mutedUntil > Date.now();
  const previewTarget = devices.find(device => level(device, state) === preview) ?? devices[0] ?? state.devices.find(device => device.art === 'dualsense') ?? state.devices[0];
  const previewDevice = makePreviewDevice(preview, previewTarget);
  const dirty = low !== state.settings.low || critical !== state.settings.critical;
  const invalid = critical >= low;
  const patch = (value: Partial<Snapshot['settings']>) => { void run({ type: 'settings', patch: value }); };
  return <div className={preferences.reminders} data-page="reminders">
    <section className={preferences.queue} aria-labelledby="charge-heading" data-scroll-pane="">
      <h2 id="charge-heading" tabIndex={-1}>待充电 <span>{devices.length ? devices.length + ' 台设备' : ''}</span></h2>
      {!devices.length && <div className={preferences.empty}><ShieldCheck size={40} strokeWidth={1.25} /><h3>暂无待充电设备</h3></div>}
      {devices.map(device => {
        const severityValue = level(device, state);
        const status = state.alerts[device.id];
        return <article className={preferences.chargeDevice} key={device.id} data-level={severityValue}>
          <div className={preferences.deviceImage}><Art device={device} variant="hero" /></div>
          <div className={preferences.deviceInfo}><button className={s.linkTitle} aria-label={'查看详情 · ' + device.name}
            onClick={event => open(device.id, event.currentTarget.closest('article') ?? undefined)}>{device.name}<ChevronRight size={14} aria-hidden="true" /></button>
            <BatteryMeter device={device} state={state} />
            <small>{state.deviceSettings[device.id]?.muted ? '已静音' : status?.ignored === severityValue ? '已忽略本次' : (status?.snoozeUntil ?? 0) > Date.now() ? '提醒暂停至 ' + dateLabel(status?.snoozeUntil ?? null) : severityValue === 'critical' ? '电量告急' : ''}</small>
          </div>
          <div className={preferences.chargeActions}><button className={s.button} onClick={() => { void run({ type: 'snooze', id: device.id }); }}>{snoozeAction(state.settings.snooze)}</button>
            <Menu.Root><Menu.Trigger asChild><button className={s.iconButton} aria-label={device.name + '的提醒操作'}><Ellipsis size={19} /></button></Menu.Trigger>
              <Menu.Portal><Menu.Content className={s.popover} align="end" sideOffset={5}><Menu.Item className={s.menuOption} onSelect={() => { void run({ type: 'ignore', id: device.id }); }}>忽略本次</Menu.Item></Menu.Content></Menu.Portal>
            </Menu.Root>
          </div>
        </article>;
      })}
    </section>
    <section className={preferences.reminderSettings} aria-labelledby="reminder-heading" data-scroll-pane="">
      <h2 id="reminder-heading">提醒设置</h2>
      <form className={preferences.thresholds} onSubmit={event => {
        event.preventDefault();
        if (invalid || !dirty || saving) return;
        setSaving(true); setError('');
        void run({ type: 'settings', patch: { low, critical } }).then(reply => {
          if (!reply.ok) setError(reply.error);
        }).finally(() => setSaving(false));
      }}>
        <div className={preferences.thresholdLabel}><span>低电量</span><output>{low}%</output></div>
        <DetentSlider name="low-threshold" aria-label="全局低电量阈值" min={2} max={95}
          value={low} detents={thresholdDetents} detentLabel="快速选择全局低电量阈值" selectedDetent={low} disabled={saving}
          onValue={setLow} onDetent={setLow} />
        <div className={preferences.thresholdLabel}><span>电量告急</span><output>{critical}%</output></div>
        <DetentSlider name="critical-threshold" aria-label="全局告急阈值" min={1} max={94}
          value={critical} detents={thresholdDetents} detentLabel="快速选择全局告急阈值" selectedDetent={critical} disabled={saving}
          onValue={setCritical} onDetent={setCritical} />
        <div className={preferences.thresholdApply}>{(invalid || error) && <p role="alert">{invalid ? '告急阈值需低于低电量阈值。' : error}</p>}
          <button className={s.button} disabled={saving || !dirty || invalid}>{saving ? '应用中…' : '应用阈值'}</button></div>
      </form>
      <div className={preferences.repeat}><SettingRow title="重复提醒"><SelectControl label="重复提醒间隔" value={String(state.settings.repeat)} onChange={value => patch({ repeat: Number(value) })} choices={minutes([0, 15, 30, 60, 120])} /></SettingRow></div>
      <div className={preferences.notificationPreview}>
        <h3>桌面通知预览</h3>
        <button className={preferences.notificationCard} aria-label={preview === 'low' ? '发送低电量测试通知' : '发送电量告急测试通知'} onClick={() => { void run({ type: 'preview', severity: preview, ...(previewTarget ? { id: previewTarget.id } : {}) }); }}>
          <Art device={previewDevice} /><span><small>发送测试通知</small><span>{previewDevice.name} <strong data-level={preview}>{readingLabel(previewDevice.reading)}</strong></span></span><Bell size={16} aria-hidden="true" />
        </button>
        <div className={preferences.previewSwitch} role="group" aria-label="通知预览级别">{(['low', 'critical'] as const).map(value => <button key={value} aria-pressed={preview === value} onClick={() => setPreview(value)}>{value === 'low' ? '低电量' : '电量告急'}</button>)}</div>
      </div>
      <details className={preferences.morePreferences}><summary>通知与静音 <ChevronDown size={16} /></summary>
        <SettingRow title="桌面弹窗"><SwitchControl label="桌面弹窗" checked={state.settings.desktopToasts} onChange={() => { void run({ type: 'toggleAlertSetting', key: 'desktopToasts' }); }} /></SettingRow>
        <SettingRow title="告急弹窗停留" hint="只调整电量告急。普通低电量提醒停留 12 秒。设备开始充电后会从提醒里移除。">
          <SelectControl label="弹窗停留时间" value={String(state.settings.desktopToastSeconds ?? 12)} choices={toastDurationChoices}
            disabled={!state.settings.desktopToasts} onChange={value => { const seconds = Number(value); if (isDesktopToastSeconds(seconds)) patch({ desktopToastSeconds: seconds }); }} />
        </SettingRow>
        <SettingRow title="全屏提示音"><SwitchControl label="全屏提示音" checked={state.settings.fullscreenSound} onChange={() => { void run({ type: 'toggleAlertSetting', key: 'fullscreenSound' }); }} /></SettingRow>
        <SettingRow title="桌面提示音"><SwitchControl label="桌面提示音" checked={state.settings.desktopSound} onChange={() => { void run({ type: 'toggleAlertSetting', key: 'desktopSound' }); }} /></SettingRow>
        <SettingRow title="稍后提醒"><SelectControl label="稍后提醒时间" value={String(state.settings.snooze)} onChange={value => patch({ snooze: Number(value) })} choices={minutes([5, 15, 30, 60])} /></SettingRow>
        <SettingRow title="静音时长"><SelectControl label="全局静音时长" value={String(state.settings.muteMinutes)} onChange={value => { const duration = Number(value); if (isMuteDuration(duration)) patch({ muteMinutes: duration }); }} choices={muteDurations.map(value => ({ value: String(value), label: muteDurationLabel(value) }))} /></SettingRow>
        <SettingRow title={muted ? '提醒已静音' : '暂停提醒'} status={muted ? '静音至 ' + dateLabel(state.mutedUntil) : undefined}><button className={s.button} onClick={() => { void run({ type: 'mute' }); }}>{muted ? '恢复提醒' : '静音 ' + muteDurationLabel(state.settings.muteMinutes)}</button></SettingRow>
      </details>
    </section>
  </div>;
}

const historyClock = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function History({ state, starting, find, range, retention, chooseRange, slots, setSlots }: {
  state: Snapshot; starting: boolean; find: () => void; range: HistoryRange; retention: HistoryRange; chooseRange: (value: string) => void;
  slots?: (string | undefined)[]; setSlots: (slots: (string | undefined)[]) => void;
}) {
  const addDevice = useRef<HTMLButtonElement>(null);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const sync = () => { if (!document.hidden) setClock(Date.now()); };
    const timer = window.setInterval(sync, 30_000);
    document.addEventListener('visibilitychange', sync);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', sync); };
  }, []);
  const ordered = [...state.devices].sort((a, b) => compareDevices(a, b, 'name'));
  const first = ordered.find(item => item.art === 'mouse') ?? ordered[0];
  const second = ordered.find(item => item.id !== first?.id && item.art === 'dualsense');
  const available = new Set(ordered.map(item => item.id));
  const colorSlots = historyComparisonSlots(slots, [first?.id, second?.id], available);
  const seriesSlots = new Map(colorSlots.flatMap((id, index) => id && available.has(id) ? [[id, index] as const] : []));
  const selected = ordered.filter(item => seriesSlots.has(item.id));
  const activeIds = selected.map(item => item.id);
  const toggle = (id: string) => {
    const next = updateHistoryComparison(colorSlots, id, available);
    if (next !== colorSlots) setSlots(next);
  };
  const single = selected.length === 1 ? selected[0] : undefined;
  const now = historyAnchor(clock, selected.map(item => item.lastRead), Date.now());
  const dateSpan = `${historyClock.format(historyStart(now, range))} – ${historyClock.format(now)}`;
  return <section className={s.history} aria-label="电量对比记录">
    <div className={s.historyToolbar}>
      <div className={s.historySpan}><div className={s.historyRangeGroup}>
          <SelectControl label="记录范围" value={range} choices={historyChoices.map(choice =>
            ({ ...choice, disabled: !isHistoryRangeWithin(choice.value, retention) }))} onChange={chooseRange} />
          {retention !== 'year' && <HelpTip label="可查看范围" text={`目前最多保留 ${historyRangeLabels[retention]}。可在设置 → 记录调整；延长期限不会找回已清理的记录。`} />}
        </div>
        <span aria-label="实际查看时段" title={dateSpan}>{dateSpan}</span></div>
      <div className={s.historyChoices} role="group" aria-label="选择对比设备">
        {selected.map(item => <button type="button" key={item.id} className={s.historyChoice}
          data-series={seriesSlots.get(item.id)} data-device={item.id} disabled={activeIds.length === 1}
          aria-label={activeIds.length > 1 ? '移除对比：' + item.name : item.name} title={item.name}
          onClick={event => {
            if (event.currentTarget === document.activeElement) addDevice.current?.focus();
            toggle(item.id);
          }}>
          <Art device={item} /><i data-series-shape={seriesSlots.get(item.id)} aria-hidden="true" /><span>{item.name}</span>
          {item.status === 'offline' && <Unplug size={13} aria-label="当前断开" />}
          {activeIds.length > 1 && <X className={s.historyRemove} size={12} aria-hidden="true" />}
        </button>)}
        {state.devices.length > 1 && <Menu.Root>
          <Menu.Trigger asChild><button ref={addDevice} className={s.historyAdd}><Plus size={15} aria-hidden="true" />对比设备</button></Menu.Trigger>
          <Menu.Portal><Menu.Content align="end" sideOffset={6} className={s.historyMenu} aria-label="可对比设备">
            {ordered.map(item => {
              const checked = seriesSlots.has(item.id);
              return <Menu.CheckboxItem key={item.id} checked={checked} className={s.menuOption}
                disabled={checked ? activeIds.length === 1 : activeIds.length >= compareLimit}
                onCheckedChange={() => toggle(item.id)}>
                <span>{item.name}</span><Menu.ItemIndicator aria-hidden="true">✓</Menu.ItemIndicator>
              </Menu.CheckboxItem>;
            })}
          </Menu.Content></Menu.Portal>
        </Menu.Root>}
      </div>
    </div>
    {!first && !starting ? <Empty button={find}>暂无电量记录</Empty> :
      <CompareChart devices={selected} starting={starting} anchor={now} range={range} seriesSlots={seriesSlots}
        threshold={single ? state.deviceSettings[single.id]?.low ?? state.settings.low : undefined} />}
  </section>;
}
function Settings({ state, run, palette, choosePalette, retention, position }: {
  state: Snapshot; run: Run; palette: Palette; choosePalette: (palette: Palette) => void;
  retention: HistoryRange; position: RefObject<{ category: string; top: number }>;
}) {
  const [shorter, setShorter] = useState<HistoryRange>();
  const [savingRetention, setSavingRetention] = useState(false);
  const [retentionError, setRetentionError] = useState('');
  const retentionControl = useRef<HTMLElement>(null);
  async function saveRetention(value: HistoryRange, confirmed = false) {
    setSavingRetention(true);
    setRetentionError('');
    const result = await run({ type: 'settings', patch: { historyRetention: value }, confirmHistoryShorten: confirmed });
    setSavingRetention(false);
    if (result.ok) closeRetention();
    else if (confirmed) setRetentionError(result.error);
  }
  function closeRetention() {
    setShorter(undefined);
    setRetentionError('');
    requestAnimationFrame(() => retentionControl.current?.querySelector<HTMLElement>('[role="combobox"]')?.focus({ preventScroll: true }));
  }
  function selectRetention(value: string) {
    if (!isHistoryRange(value) || savingRetention || value === retention) return;
    if (!isHistoryRangeWithin(retention, value)) setShorter(value);
    else void saveRetention(value);
  }
  const [diagnosticOpen, setDiagnosticOpen] = useState(false);
  const [active, setActive] = useState(position.current.category);
  const sections = useRef<HTMLDivElement>(null);
  const requested = useRef<string | undefined>(position.current.category);
  const send = (command: Command) => { void run(command); };
  useLayoutEffect(() => {
    const pane = sections.current;
    const nodes = [...(pane?.querySelectorAll<HTMLElement>(':scope > section') ?? [])];
    if (!pane || !nodes.length) return;
    pane.scrollTop = position.current.top;
    let frame = 0;
    const sync = () => {
      frame = 0;
      position.current.top = pane.scrollTop;
      if (requested.current) return;
      const edge = pane.getBoundingClientRect().top + parseFloat(getComputedStyle(pane).scrollPaddingTop) + 2;
      const bottom = pane.scrollHeight - pane.clientHeight;
      const current = bottom > 2 && pane.scrollTop >= bottom - 2 ? nodes.at(-1) :
        nodes.findLast(node => (node.querySelector('h2')?.getBoundingClientRect().top ?? Infinity) <= edge) ?? nodes[0];
      if (current) {
        position.current.category = current.id.slice('settings-'.length);
        setActive(position.current.category);
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(sync); };
    // While navigating to an explicit target, crossing another section (or a
    // clamped position at the bottom) must not steal the selected category.
    const release = () => { requested.current = undefined; };
    const onKey = (event: KeyboardEvent) => {
      if (['Tab', 'PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' '].includes(event.key)) release();
    };
    pane.addEventListener('wheel', release, { passive: true });
    pane.addEventListener('pointerdown', release, { passive: true });
    window.addEventListener('keydown', onKey);
    pane.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      pane.removeEventListener('wheel', release);
      pane.removeEventListener('pointerdown', release);
      window.removeEventListener('keydown', onKey);
      pane.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(frame);
    };
  }, [position]);
  return <div className={preferences.settings} data-page="settings">
    <nav className={preferences.settingsNav} aria-label="设置分类">{[['appearance', '外观'], ['runtime', '运行与托盘'], ['history', '记录'], ['diagnostics', '诊断']].map(([id, title]) =>
      <button type="button" key={id} aria-controls={'settings-' + id} aria-current={active === id ? 'location' : undefined} onClick={() => {
        const pane = sections.current;
        const heading = pane?.querySelector<HTMLElement>('#settings-' + id + ' h2');
        if (!pane || !heading) return;
        requested.current = id;
        position.current.category = id;
        setActive(id);
        heading.focus({ preventScroll: true });
        const top = pane.scrollTop + heading.getBoundingClientRect().top -
          pane.getBoundingClientRect().top - pane.clientTop - (parseFloat(getComputedStyle(pane).scrollPaddingTop) || 0);
        pane.scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      }}>{title}</button>)}</nav>
    <div className={preferences.settingsSections} ref={sections} data-scroll-pane="" role="region" aria-label="设置内容" tabIndex={0}>
      <section id="settings-appearance" className={preferences.appearance} aria-labelledby="appearance-heading">
        <h2 id="appearance-heading" tabIndex={-1}>外观</h2>
        <div className={preferences.currentColor} role="group" aria-label="配色"><span>配色</span>
          <div>{palettes.map(([id, label]) => <label key={id} data-palette={id}>
            <input type="radio" name="appearance-palette" checked={palette === id} onChange={() => choosePalette(id)} />
            <i aria-hidden="true">{palette === id ? '✓' : ''}</i>{label}
          </label>)}</div>
        </div>
        <ZoomControl name="主界面" value={state.settings.zoom} apply={value => run({ type: 'settings', patch: { zoom: value } })} />
        <ZoomControl name="托盘浮窗" value={state.settings.trayZoom} apply={value => run({ type: 'settings', patch: { trayZoom: value } })} />
      </section>
      <section id="settings-runtime" className={preferences.settingsSection} aria-labelledby="runtime-heading">
        <h2 id="runtime-heading" tabIndex={-1}>运行与托盘</h2>
        <SettingRow title="开机启动" hint="登录 Windows 后在托盘开始监测，不打开主窗口。"><SwitchControl label="随 Windows 登录启动" checked={state.settings.startup} onChange={value => send({ type: 'settings', patch: { startup: value } })} /></SettingRow>
        <SettingRow title="电量轮询间隔"
          hint="间隔越短，设备读取越频繁，可能增加耗电。间隔越长，可能来不及提醒。接近低电量阈值或正在充电的设备仍会更频繁检查。"
          status={(state.settings.pollIntervalSeconds ?? defaultPollIntervalSeconds) >= 300 ? '设备可能在提醒前耗尽电量' : undefined}>
          <SelectControl label="电量轮询间隔" value={String(state.settings.pollIntervalSeconds ?? defaultPollIntervalSeconds)} choices={pollChoices}
            onChange={value => { const seconds = Number(value); if (isPollIntervalSeconds(seconds)) send({ type: 'settings', patch: { pollIntervalSeconds: seconds } }); }} />
        </SettingRow>
        <SettingRow title="电量采集"><button className={s.button} disabled={state.refreshing || state.collector === 'starting'} onClick={() => send({ type: 'refresh' })}>{state.refreshing ? '刷新中…' : '立即刷新'}</button></SettingRow>
      </section>
      <section ref={retentionControl} id="settings-history" className={preferences.settingsSection} aria-labelledby="settings-history-heading">
        <h2 id="settings-history-heading" tabIndex={-1}>记录</h2>
        <SettingRow title="保留上限" hint="按每台设备的高频采样估算，只算电量历史，不含诊断日志。最近 24 小时保留明细，更早只保留每日汇总。">
          <SelectControl label="记录保留上限" value={retention} choices={retentionChoices} onChange={selectRetention} disabled={savingRetention} />
        </SettingRow>
        {shorter && <Modal title="缩短记录保留期限？"
          description={`超过 ${historyRangeLabels[shorter]} 的电量记录将被删除。之后延长期限也无法恢复。`}
          onClose={() => { if (!savingRetention) closeRetention(); }}>
          {retentionError && <p className={s.formError} role="alert">{retentionError}</p>}
          <div className={s.confirmActions}>
            <button type="button" className={s.button} disabled={savingRetention} onClick={closeRetention}>取消</button>
            <button type="button" className={s.deleteAction} disabled={savingRetention}
              onClick={() => { void saveRetention(shorter, true); }}>{savingRetention ? '正在清理…' : '缩短并清理'}</button>
          </div>
        </Modal>}
      </section>
      <section id="settings-diagnostics" className={preferences.settingsSection} aria-labelledby="diagnostics-heading">
        <h2 id="diagnostics-heading" tabIndex={-1}>诊断</h2>
        <SettingRow title="记录 DualSense 电池电压" hint="电压记在本地诊断日志。"><SwitchControl label="记录 DualSense 电池电压" checked={state.settings.voltage} onChange={value => send({ type: 'settings', patch: { voltage: value } })} /></SettingRow>
        <SettingRow title="诊断日志"><button className={s.button} onClick={() => send({ type: 'diagnostics' })}>打开日志目录 <ChevronRight size={16} /></button></SettingRow>
        <SettingRow title="兼容性报告" hint="选择遇到问题的外设，导出报告后可复制内容或定位文件。">
          <button className={s.button} data-compat-report="" disabled={state.demo} onClick={() => setDiagnosticOpen(true)}>导出兼容性报告</button>
        </SettingRow>
        {diagnosticOpen && <CompatibilityPicker run={run} close={() => setDiagnosticOpen(false)} />}
      </section>
    </div>
  </div>;
}

function CompatibilityPicker({ run, close }: { run: Run; close: () => void }) {
  const [devices, setDevices] = useState<DiagnosticDevice[]>([]);
  const [choice, setChoice] = useState('choose');
  const [model, setModel] = useState('');
  const [firmware, setFirmware] = useState('');
  const [scanning, setScanning] = useState(true);
  const [working, setWorking] = useState(false);
  const [firmwareState, setFirmwareState] = useState('');
  const [firmwareAttempted, setFirmwareAttempted] = useState(false);
  const [saved, setSaved] = useState<{ file: string; json: string }>();
  const [copied, setCopied] = useState(false);
  const resultFocus = useRef<HTMLDivElement>(null);
  useEffect(() => { if (saved) resultFocus.current?.focus({ preventScroll: true }); }, [saved]);
  const [error, setError] = useState('');
  const [scanError, setScanError] = useState('');
  const mounted = useRef(true);
  const scanSequence = useRef(0);
  const runRef = useRef(run);
  runRef.current = run;
  const selected = devices.find(device => device.key === choice);
  const manual = choice === 'manual';
  const transport = selected?.connection;
  const TransportIcon = transport?.includes('蓝牙') ? Bluetooth : Cable;
  const options = [
    { value: 'choose', label: scanning ? '正在扫描…' : scanError ? '扫描未完成' : '请选择' },
    ...devices.map((device, index) => {
      const label = device.model || device.label || '未识别型号';
      const duplicate = devices.some((other, n) => n !== index &&
        (other.model || other.label || '未识别型号') === label && other.connection === device.connection);
      return { value: device.key, label: duplicate ? label + ' · ' + (index + 1) : label,
        detail: [device.connection, !device.connected ? '未连接' : undefined].filter(Boolean).join(' · ') };
    }),
    ...(!scanError ? [{ value: 'manual', label: '列表中没有我的设备' }] : []),
  ];
  async function scan() {
    const sequence = ++scanSequence.current;
    setScanning(true);
    setDevices([]);
    setScanError('');
    changeChoice('choose');
    try {
      const reply = await runRef.current({ type: 'diagnosticDevices' }, { inlineError: true });
      if (!mounted.current || sequence !== scanSequence.current) return;
      if (reply.ok && Array.isArray(reply.diagnosticDevices)) setDevices(reply.diagnosticDevices);
      else setScanError(reply.ok ? '未收到设备列表，请重新扫描。' : reply.error);
    } finally { if (mounted.current && sequence === scanSequence.current) setScanning(false); }
  }
  useEffect(() => {
    mounted.current = true;
    void scan();
    return () => { mounted.current = false; scanSequence.current++; };
  }, []);
  function changeChoice(value: string) {
    setChoice(value);
    setModel('');
    setFirmware('');
    setFirmwareState('');
    setFirmwareAttempted(false);
    setError('');
  }
  async function readFirmware(device: DiagnosticDevice) {
    setWorking(true);
    setFirmwareState('正在读取固件…');
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        if (attempt) await new Promise(resolve => setTimeout(resolve, 650));
        if (!mounted.current) return;
        const reply = await runRef.current({ type: 'diagnosticFirmware', deviceKey: device.key }, { inlineError: true });
        if (!mounted.current) return;
        const info = reply.ok ? reply.diagnosticFirmware : undefined;
        if (info?.status === 'ready' && info.firmware) {
          setDevices(items => items.map(item => item.key === device.key ? { ...item, firmware: info.firmware } : item));
          setFirmwareState(''); return;
        }
        if (info?.status !== 'pending') {
          setFirmwareState(info?.status === 'busy' ? '蓝牙忙，请稍后重试。' : '未读取到固件版本，可手动填写。');
          return;
        }
      }
      setFirmwareState('固件读取尚未完成，可稍后查看结果。');
    } finally { if (mounted.current) { setWorking(false); setFirmwareAttempted(true); } }
  }
  async function generate() {
    if (working || (!manual && !selected)) return;
    const selection: CompatibilitySelection = manual
      ? { kind: 'manual', model: model.trim(), firmware: firmware.trim() || undefined }
      : { kind: 'device', deviceKey: selected!.key, model: selected?.model ? undefined : model.trim(),
        firmware: selected?.firmware ? undefined : firmware.trim() || undefined };
    setWorking(true);
    setError('');
    try {
      const draft = await run({ type: 'compatibility', selection }, { inlineError: true });
      if (!mounted.current) return;
      if (!draft.ok || !draft.compatibility) {
        setError(draft.ok ? '无法生成报告，请重试。' : draft.error);
        return;
      }
      const reply = await run({ type: 'compatibility', reportToken: draft.compatibility.token }, { inlineError: true });
      if (!mounted.current) return;
      if (reply.ok && reply.reportName) setSaved({ file: reply.reportName, json: draft.compatibility.json });
      else setError(reply.ok ? '未收到保存结果，请重试。' : reply.error);
    } finally { if (mounted.current) setWorking(false); }
  }
  async function copyReport() {
    if (!saved) return;
    setCopied(false);
    setError('');
    try {
      await navigator.clipboard.writeText(saved.json);
      if (mounted.current) setCopied(true);
    } catch {
      if (mounted.current) setError('无法复制，请在资源管理器中定位报告。');
    }
  }
  async function revealReport() {
    if (!saved || working) return;
    setWorking(true);
    setCopied(false);
    setError('');
    try {
      const reply = await run({ type: 'revealCompatibility', reportName: saved.file }, { inlineError: true });
      if (mounted.current && !reply.ok) setError(reply.error);
    } finally { if (mounted.current) setWorking(false); }
  }
  const fieldStyle: CSSProperties = { display: 'grid', gap: 7 };
  const inputStyle: CSSProperties = { minWidth: 0, width: '100%', background: 'var(--panel)', border: '1px solid var(--line)',
    borderRadius: 8, padding: '8px 10px' };
  return <Modal title={saved ? '报告已保存' : '导出兼容性报告'}
    description={saved ? undefined : '报告保存在本机，不会自动发送。'}
    className={preferences.reportDialog} onClose={() => { if (!working) close(); }}>
    {saved ? <div className={preferences.reportReceipt}>
      <div ref={resultFocus} tabIndex={-1} className={preferences.reportFile}>
        <CircleCheck size={18} aria-hidden="true" /><span>{saved.file}</span>
      </div>
      <div className={preferences.reportActions}>
        <button type="button" className={s.button} onClick={() => { void copyReport(); }}>
          <Copy size={16} aria-hidden="true" />复制报告内容
        </button>
        <button type="button" className={s.button} disabled={working} onClick={() => { void revealReport(); }}>
          <FolderOpen size={16} aria-hidden="true" />在资源管理器中定位
        </button>
      </div>
      {copied && <div className={preferences.reportStatus} role="status">已复制到剪贴板</div>}
      {error && <p className={s.formError} role="alert">{error}</p>}
      <div className={preferences.reportFooter}>
        <button type="button" className={s.primary} disabled={working} onClick={close}>完成</button>
      </div>
    </div> : <form style={{ display: 'grid', gap: 14, marginTop: 14 }} onSubmit={event => { event.preventDefault(); void generate(); }}>
      <div style={fieldStyle}>
        <span>设备型号</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select aria-label="设备型号" className={s.select} style={{ minHeight: 34, minWidth: 145 }}
            value={choice} onChange={event => changeChoice(event.target.value)} disabled={scanning || working || !!scanError}>
            {options.map(option => <option key={option.value} value={option.value}>
              {option.label}{option.value !== choice && 'detail' in option && option.detail ? ' · ' + option.detail : ''}
            </option>)}
          </select>
          <button className={s.button} type="button" disabled={scanning || working} onClick={() => { void scan(); }}>重新扫描</button>
        </div>
      </div>
      {selected && (transport || selected.firmware) && <div className={preferences.reportMetadata}>
        {transport && <div><TransportIcon size={15} aria-hidden="true" /><span>{transport}</span></div>}
        {selected.firmware && <div><span className={preferences.reportMetaLabel}>固件</span>
          <output aria-label="已识别固件版本">{selected.firmware}</output></div>}
      </div>}
      {scanError && <p className={s.formError} role="alert">{scanError}</p>}
      {!scanning && !scanError && devices.length === 0 && !manual && <small role="status">未识别到可选设备，可选「列表中没有我的设备」补录。</small>}
      {manual && <small role="status">手动补录不关联接口。若列表中有对应的通用设备，请选中它。</small>}
      {(manual || (selected && !selected.model)) && <label style={fieldStyle}>填写设备型号
        <input maxLength={80} autoComplete="off" style={inputStyle} required value={model} disabled={working}
          onChange={event => setModel(event.target.value)} placeholder="例如 V98 Pro V3" />
      </label>}
      {!selected?.firmware && (selected || manual) && <div style={fieldStyle}>
          {(!selected?.firmwareReadable || firmwareAttempted) && <label style={fieldStyle}>固件版本 <small>未识别，可选填</small>
            <input maxLength={48} autoComplete="off" style={inputStyle} value={firmware} disabled={working}
              onChange={event => setFirmware(event.target.value)} placeholder="例如 1.2.3" />
          </label>}
          {selected?.firmwareReadable && <div><button className={s.button} type="button" disabled={working}
            onClick={() => { void readFirmware(selected); }}>读取固件版本</button></div>}
          {firmwareState && <small role="status">{firmwareState}</small>}
        </div>}
      {error && <p className={s.formError} role="alert">{error}</p>}
      <div className={s.confirmActions}>
        <button type="button" className={s.button} disabled={working} onClick={close}>取消</button>
        <button type="submit" className={s.primary} disabled={working || (!selected && !manual) || ((!selected?.model) && !model.trim())}>
          {working ? '正在导出…' : '导出报告'}
        </button>
      </div>
    </form>}
  </Modal>;
}

function FindDevices({ state, run, close }: { state: Snapshot; run: Run; close: () => void }) {
  const [found, setFound] = useState<Found[]>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [addError, setAddError] = useState<{ id: string; text: string }>();
  async function search() {
    setLoading(true);
    setError('');
    setAddError(undefined);
    const reply = await run({ type: 'discover' }, { inlineError: true });
    setLoading(false);
    if (reply.ok && Array.isArray(reply.found)) setFound(reply.found);
    else setError(reply.ok ? '未收到设备列表，请重新扫描。' : reply.error);
  }
  useEffect(() => { void search(); }, []);
  return <Modal title="查找设备" className={s.discoveryModal}
    hint="先在 Windows 连接或配对设备。当前连接状态请看「设备」。"
    onClose={close}>
      <button className={s.button + ' ' + s.discoveryScan} disabled={loading || !!pending} onClick={() => { void search(); }}><RefreshCw size={16} aria-hidden="true" />重新扫描</button>
      <div className={s.discovery}>
        {loading ? <p role="status">正在扫描 Windows 设备…</p> : error ? <small className={s.formError} role="alert">{error}</small> : !found?.length ? <p role="status">未发现设备。</p> : found.map(device => {
          const watched = state.devices.some(item => item.id === device.id);
          return <div key={device.id} className={s.discoveryRow}><div><b>{device.name}</b><small>{device.connection} · {
            device.automatic || watched ? '已加入监测' : !device.connected ? '已识别 · 未加入监测' : device.reading ? '可添加 · ' + readingLabel(device.reading) : device.batteryCandidate === 'ble_bas' ? '可尝试读取蓝牙电量' : 'Windows 暂无可用电量'}</small>
            {addError?.id === device.id && <span className={s.formError} role="alert">{addError.text}</span>}</div>
            {device.connected && (device.reading || device.batteryCandidate === 'ble_bas') && !device.automatic && !watched && <button className={s.button} disabled={!!pending} onClick={() => {
                setPending(device.id);
                setAddError(undefined);
                void run({ type: 'add', id: device.id }, { inlineError: true }).then(reply => {
                  setPending(null);
                  if (reply.ok) setFound(items => items?.map(item => item.id === device.id ? { ...item, automatic: true } : item));
                  else setAddError({ id: device.id, text: reply.error });
                });
              }}>{pending === device.id ? '正在添加…' : addError?.id === device.id ? '重试添加' : '添加到监测'}</button>}
          </div>;
        })}
      </div>
  </Modal>;
}
