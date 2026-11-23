import * as Menu from '@radix-ui/react-dropdown-menu';
import { Activity, ArrowDownRight, ArrowLeft, BatteryCharging, Bell, Bluetooth, CircleCheck, BellOff, Cable, ChartNoAxesColumnIncreasing, ChevronRight, Clock, Ellipsis, Gamepad2,
  House, LayoutGrid, List, MonitorSmartphone, Pencil, Plus, RefreshCw, Search, Settings2, ShieldCheck, TriangleAlert, Zap } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { canProbeBluetooth, isConnected, isMuteDuration, muteDurationLabel, muteDurations, percent, severity, type Command, type CommandResult, type Device, type Found, type Snapshot } from './model';
import { api, Art, BatteryMeter, Brand, Chart, Connection, ConnectionGauge, dateLabel, Modal, SectionTitle, SelectControl, SettingRow, StatusTag, SwitchControl, tone } from './ui';
import s from './panel.module.css';
import { ZoomControl } from './zoom';

const pages = [
  ['overview', '总览', House], ['devices', '设备', Gamepad2], ['alerts', '提醒', Bell],
  ['history', '历史', ChartNoAxesColumnIncreasing], ['settings', '设置', Settings2],
] as const;
type Page = typeof pages[number][0];
type Filter = 'all' | 'online' | 'low' | 'offline' | 'recent';
type Run = (command: Command) => Promise<CommandResult>;

const level = (device: Device, state: Snapshot) => severity(device, state.settings, state.deviceSettings[device.id]);
const needCharge = (state: Snapshot) => state.devices.filter(device => level(device, state));
const minutes = (values: number[]) => values.map(value => ({ value: String(value), label: value ? value + ' 分钟' : '关闭' }));
const powerLabels = { charging: '充电中', full: '已充满', discharging: '电池供电', unknown: '设备未上报' };

export function Dashboard({ state }: { state: Snapshot }) {
  const [page, setPage] = useState<Page>('overview');
  const [selected, select] = useState<string>();
  const [detailId, setDetailId] = useState<string>();
  const main = useRef<HTMLElement>(null);
  const detailBack = useRef<HTMLButtonElement>(null);
  const returnScroll = useRef(0);
  const returnFocus = useRef<HTMLElement | null>(null);
  const detailed = state.devices.find(device => device.id === detailId);
  const [filter, setFilter] = useState<Filter>('all');
  const [finding, setFinding] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();
  const starting = state.collector === 'starting';
  const low = needCharge(state);
  useEffect(() => api.onNavigate(id => {
    if (id) { setFinding(false); setFilter('all'); select(id); setPage('devices'); setDetailId(id); window.scrollTo(0, 0); }
  }), []);
  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(undefined), 4500);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const run: Run = async command => {
    const result = await api.command(command).catch((): CommandResult => ({ ok: false, error: '与应用主进程的连接已断开' }));
    if (!result.ok) setFeedback({ text: result.error, error: true });
    else setFeedback(result.message ? { text: result.message } : undefined);
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

  function openDetail(id: string, source?: HTMLElement) {
    returnFocus.current = source ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    returnScroll.current = window.scrollY;
    select(id);
    const photo = source?.querySelector<HTMLElement>('[data-device-art]');
    const update = () => {
      flushSync(() => setDetailId(id));
      window.scrollTo(0, 0);
    };
    if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches || !photo) {
      update();
      return;
    }
    photo.classList.add(s.transitionArt);
    const transition = document.startViewTransition(update);
    void transition.ready.catch(() => {});
    void transition.finished.finally(() => photo.classList.remove(s.transitionArt)).catch(() => {});
  }
  function closeDetail() {
    flushSync(() => setDetailId(undefined));
    window.scrollTo(0, returnScroll.current);
    if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
    else main.current?.focus({ preventScroll: true });
  }
  function open(id: string) { setFilter('all'); select(id); setPage('devices'); setDetailId(undefined); }
  function showDevices(next: Filter) { select(undefined); setFilter(next); setPage('devices'); setDetailId(undefined); }
  const descriptions: Record<Page, [string, string]> = {
    overview: ['外设电量总览', '实时查看外设电量与连接状态，及时充电。'],
    devices: ['设备管理', '查看已监测设备、当前电量和近期变化。'],
    alerts: ['低电量提醒', '管理提醒阈值、提醒方式与待充电设备。'],
    history: ['电量历史', '查看设备过去 24 小时的电量变化。'],
    settings: ['设置', '调整显示大小、Windows 启动和诊断。'],
  };
  return <div className={s.shell}>
    <a className={s.skipLink} href="#main-content">跳到主要内容</a>
    <aside className={s.sidebar}>
      <Brand />
      <nav aria-label="主导航">{pages.map(([id, label, Icon]) => <button key={id} className={s.navItem}
        aria-label={label} aria-current={page === id ? 'page' : undefined} onClick={() => { setDetailId(undefined); setPage(id); window.scrollTo(0, 0); }}><Icon size={21} aria-hidden="true" /><span>{label}</span>
        {id === 'alerts' && low.length > 0 && <i aria-hidden="true" />}</button>)}</nav>
      <div className={s.sidebarFoot}><i data-state={state.collector} />{state.demo ? '示例模式' : state.collector === 'ready' ? '监测运行中' : '等待采集'}</div>
    </aside>
    <main className={s.content} id="main-content" tabIndex={-1} ref={main}>
      <div className={s.dragZone} aria-hidden="true" />
      <div hidden={!!detailed}>
      <header className={s.heading}><div><h1>{descriptions[page][0]}</h1><p>{descriptions[page][1]}</p></div>
        {(page === 'overview' || page === 'devices') && <div className={s.headingActions}>
          <button className={s.iconButton} title="立即刷新" aria-label="立即刷新" disabled={starting || state.refreshing} onClick={() => { void run({ type: 'refresh' }); }}>
            <RefreshCw size={18} className={state.refreshing ? s.spin : ''} /></button>
          <button className={s.button} onClick={() => setFinding(true)}><Plus size={18} />查找设备</button>
        </div>}
      </header>
      {state.collector !== 'ready' && <div className={s.notice} role="status"><Activity size={19} /><span>{
        { starting: '正在读取设备和电量…', occupied: '旧版 PowerManager 正在监测。请从旧版托盘退出，新版会自动接管。',
          retrying: '采集暂时中断，正在尝试重新连接。' }[state.collector]}</span></div>}
      {state.error && <div className={s.notice} role="alert"><TriangleAlert size={19} />{state.error}</div>}
      {page === 'overview' && (starting ? <DeviceSkeleton overview /> :
        <Overview state={state} open={open} openDetail={openDetail} showDevices={showDevices} showAlerts={() => setPage('alerts')} find={() => setFinding(true)} />)}
      {page === 'devices' && (starting ? <DeviceSkeleton /> :
        <Devices state={state} selected={selected} pick={select} filter={filter} setFilter={setFilter} openDetail={openDetail} run={run} find={() => setFinding(true)} />)}
      {page === 'alerts' && <Alerts state={state} run={run} open={open} />}
      {page === 'history' && <History state={state} />}
      {page === 'settings' && <Settings state={state} run={run} />}
      </div>
      {detailed && <div className={s.fullDetail}>
        <header className={s.fullHeader}>
          <button className={s.button} ref={detailBack} onClick={closeDetail}><ArrowLeft size={16} aria-hidden="true" />返回{page === 'overview' ? '总览' : '设备'}</button>
          <h1>设备详情</h1>
        </header>
        <Details key={detailed.id} device={detailed} state={state} run={run} full />
      </div>}
    </main>
    {finding && <FindDevices state={state} run={run} close={() => setFinding(false)} />}
    {feedback && <div className={s.feedback} data-error={!!feedback.error} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</div>}
  </div>;
}
function Empty({ children, button }: { children: ReactNode; button?: () => void }) {
  return <div className={s.empty}><MonitorSmartphone size={32} /><p>{children}</p>
    {button && <button className={s.button} onClick={button}><Plus size={17} />查找设备</button>}</div>;
}
function DeviceSkeleton({ overview = false }: { overview?: boolean }) {
  return <div className={s.deviceSkeleton} aria-hidden="true">
    {overview && <div className={s.overviewTop}>
      <div className={s.skeletonSummary}><i /><div><i /><i /></div></div>
      <div className={s.skeletonSummary}><i /><div><i /><i /></div></div>
    </div>}
    <div className={s.skeletonHeading}><i /></div>
    <div className={s.overviewGrid}>{[0, 1, 2].map(index =>
      <div className={s.skeletonCard} key={index}><i /><i /><i /></div>)}</div>
  </div>;
}
function Overview({ state, open, openDetail, showDevices, showAlerts, find }: { state: Snapshot; open: (id: string) => void;
  openDetail: (id: string, source?: HTMLElement) => void;
  showDevices: (value: Filter) => void; showAlerts: () => void; find: () => void }) {
  const [picked, pick] = useState<string>();
  const online = state.devices.filter(isConnected);
  const offline = state.devices.filter(device => !isConnected(device));
  const low = needCharge(state);
  const readable = online.some(device => device.status === 'current' && device.reading);
  const chargeTitle = readable ? '当前没有待充电设备' : state.collector !== 'ready' ? '等待电量更新' :
    state.devices.length ? '暂无可用电量读数' : '尚未监测到设备';
  const chargeDescription = readable ? '有设备达到提醒阈值时会在这里显示。' : state.collector !== 'ready' ?
    '采集恢复后会重新检查电量。' : '连接或唤醒支持电量读取的外设后再试。';
  return <>
    <div className={s.overviewTop}>
      <section className={s.summary} aria-label="设备连接概况">
        <ConnectionGauge online={online.length} total={state.devices.length} />
        <div className={s.stat}><span>在线设备</span><strong>{online.length}<small> 个</small></strong><p>已连接 {online.length} 个 · 未连接 {offline.length} 个</p></div>
        <div className={s.stat + ' ' + s.riskStat} data-active={low.length > 0} data-readable={readable}><div>{low.length > 0 ? <TriangleAlert size={20} aria-hidden="true" /> :
          readable ? <CircleCheck className={s.healthyIcon} size={20} aria-hidden="true" /> : <Activity size={20} aria-hidden="true" />}<span>低电量设备</span></div>
          <strong>{readable ? <>{low.length}<small> 个</small></> : '—'}</strong>
          {low.length > 0 ? <button className={s.textButton} onClick={showAlerts}>查看提醒 <ChevronRight size={16} aria-hidden="true" /></button>
            : <p>{readable ? '已读设备暂无提醒' : '暂无可用读数'}</p>}</div>
      </section>
      <section className={s.chargePanel} data-active={low.length > 0} data-readable={readable}>
        <div className={s.chargeTitle}><span className={s.medallion}>{low.length ? <Zap size={23} aria-hidden="true" /> :
          readable ? <CircleCheck size={23} aria-hidden="true" /> : <Activity size={23} aria-hidden="true" />}</span>
          <div><h2>{low.length > 0 ? <><em>{low.length}</em> 个设备需要充电</> : chargeTitle}</h2>
          <p>{low.length > 0 ? '建议尽快充电，避免使用中断。' : chargeDescription}</p></div></div>
        {low.slice(0, 2).map(device => <button key={device.id} className={s.chargeRow} onClick={() => open(device.id)}>
          {device.art === 'dualsense' ? <Gamepad2 size={22} /> : <BatteryCharging size={22} />}
          <b title={device.name}>{device.name}</b><strong>{percent(device.reading)}</strong><span className={s.redTag}>需充电</span>
        </button>)}
        {low.length > 2 && <button className={s.textButton} onClick={showAlerts}>查看全部 {low.length} 个 <ChevronRight size={16} /></button>}
      </section>
    </div>
    <SectionTitle aside={picked && state.devices.some(device => device.id === picked) ?
      <button className={s.textButton} onClick={() => openDetail(picked)}>打开设备详情 <ChevronRight size={16} aria-hidden="true" /></button> :
      <span className={s.sectionMeta}>双击卡片打开设备详情</span>}>已连接设备（{online.length}）</SectionTitle>
    {online.length ? <div className={s.overviewGrid}>{online.map(device => <DeviceCard key={device.id} device={device} state={state} active={picked === device.id} onClick={() => pick(device.id)} onOpen={source => openDetail(device.id, source)} />)}</div>
      : <Empty button={find}>{state.collector === 'ready' ? '暂无已连接的受监测设备' : '设备会在读到连接状态后出现'}</Empty>}
    {offline.length > 0 && <>
      <SectionTitle aside={<button className={s.textButton} onClick={() => showDevices('offline')}>查看离线设备 <ChevronRight size={16} /></button>}>未连接设备（{offline.length}）</SectionTitle>
      <div className={s.offlineGrid}>{offline.map(device => <DeviceCard key={device.id} device={device} state={state} active={picked === device.id} onClick={() => pick(device.id)} onOpen={source => openDetail(device.id, source)} row />)}</div>
    </>}
  </>;
}
export function DeviceCard({ device, state, onClick, onOpen, active, row = false, list = false }: { device: Device; state: Snapshot;
  onClick: () => void; onOpen: (source: HTMLElement) => void; active?: boolean; row?: boolean; list?: boolean }) {
  const color = tone(device, state);
  const offline = !isConnected(device);
  const batteryHint = device.status !== 'current' ? device.reason : device.reading?.power === 'charging' ? '正在充电' :
    device.reading?.power === 'full' ? '电量已充满' : color === 'red' ? '电量较低 · 请尽快充电' :
    color === 'amber' ? '电量中等 · 可提前充电' : '电量充足';
  return <button className={s.deviceCard} data-layout={row ? 'tile' : list ? 'list' : 'grid'} data-tone={color}
    data-selected={!!active} title={device.name} aria-description="单击选择，双击或按 Enter 打开设备详情"
    onClick={event => {
      // Mouse clicks support both preview and a double-click detail transition.
      if (event.detail === 0) onOpen(event.currentTarget);
      else if (event.detail === 1) onClick();
    }}
    onDoubleClick={event => onOpen(event.currentTarget)} aria-label={device.name + '，' + percent(device.reading) + '，' + batteryHint}
    aria-pressed={active}>
    <Art device={device} />
    <div className={s.deviceIdentity}><b>{device.name}</b><div className={s.deviceMeta}><Connection device={device} /><StatusTag device={device} /></div></div>
    {row && offline ? <small className={s.batteryHint}>上次电量 <b>{percent(device.reading)}</b> · {dateLabel(device.lastRead)}</small>
      : <><BatteryMeter device={device} state={state} /><small className={s.batteryHint}>{offline ? '上次读数 · ' + dateLabel(device.lastRead) : batteryHint}</small></>}
  </button>;
}

function Devices({ state, selected, pick, filter, setFilter, openDetail, run, find }: {
  state: Snapshot; selected?: string; pick: (id?: string) => void; filter: Filter; setFilter: (value: Filter) => void; openDetail: (id: string, source?: HTMLElement) => void; run: Run; find: () => void;
}) {
  const [query, search] = useState('');
  const [sort, setSort] = useState('state');
  const [list, setList] = useState(false);
  const { devices, alerts } = state;
  const online = devices.filter(isConnected);
  const low = needCharge(state);
  const offline = devices.filter(device => !isConnected(device));
  const recent = devices.filter(device => (alerts[device.id]?.lastNoticeAt ?? 0) >= Date.now() - 86400000);
  const groups = { all: devices, online, low, offline, recent };
  const menus: [Filter, string][] = [['all', '全部设备'], ['online', '已连接'],
    ['low', '低电量'], ['offline', '未连接'], ['recent', '最近提醒']];
  const needle = query.trim().toLocaleLowerCase();
  const visible = groups[filter].filter(device => [device.name, device.connection, device.art].some(value => value.toLocaleLowerCase().includes(needle)));
  const readingOrder = (device: Device) => device.reading?.low ?? 101;
  visible.sort((a, b) => sort === 'low' ? readingOrder(a) - readingOrder(b) :
    sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : Number(isConnected(b)) - Number(isConnected(a)));
  const detail = visible.find(device => device.id === selected) ?? (state.demo && !selected && filter === 'all' && !needle
    ? visible.find(device => device.art === 'dualsense') : visible[0]);
  return <>
    <div className={s.deviceToolbar}>
      <label className={s.searchBox}><Search size={20} /><input type="search" autoComplete="off" name="device-search" aria-label="搜索设备" value={query}
        onChange={event => search(event.target.value)} placeholder="搜索设备名称、类型或连接方式…" /></label>
      <div className={s.filters} role="group" aria-label="设备筛选">{menus.map(([id, name]) => <button key={id} data-filter={id}
        aria-pressed={filter === id} onClick={() => { setFilter(id); pick(undefined); }}>{name}<b>{groups[id].length}</b></button>)}</div>
    </div>
    <div className={s.deviceSplit}>
      <section>
        <SectionTitle aside={<div className={s.tools}>
          <SelectControl label="设备排序" value={sort} onChange={setSort} choices={[
            { value: 'state', label: '按状态排序' }, { value: 'low', label: '按电量排序' }, { value: 'name', label: '按名称排序' },
          ]} />
          <div className={s.segment} role="group" aria-label="设备视图"><button aria-label="网格视图" title="网格视图" aria-pressed={!list} onClick={() => setList(false)}><LayoutGrid size={18} /></button>
            <button aria-label="列表视图" title="列表视图" aria-pressed={list} onClick={() => setList(true)}><List size={18} /></button></div>
        </div>}>我的设备（{visible.length}）</SectionTitle>
        {visible.length ? <div className={list ? s.deviceList : s.deviceGrid}>{visible.map(device =>
          <DeviceCard key={device.id} device={device} state={state} active={device.id === detail?.id} onClick={() => pick(device.id)} onOpen={source => openDetail(device.id, source)} list={list} />)}
        </div> : <Empty button={!devices.length ? find : undefined}>{devices.length ? '没有符合筛选条件的设备' : '暂无受监测设备'}</Empty>}
      </section>
      {detail && <Details key={detail.id} device={detail} state={state} run={run} openFull={() => openDetail(detail.id)} />}
    </div>
  </>;
}
function Details({ device, state, run, full, openFull }: { device: Device; state: Snapshot; run: Run; full?: boolean; openFull?: () => void }) {
  const [editing, edit] = useState(false);
  const [alias, setAlias] = useState(device.name);
  const [confirmRemove, setRemove] = useState(false);
  const [confirmBluetooth, setConfirmBluetooth] = useState(false);
  const [probing, setProbing] = useState(false);
  const rules = state.deviceSettings[device.id];
  const savedLimit = rules?.low ?? state.settings.low;
  const [limit, setLimit] = useState(String(savedLimit));
  const [savingLimit, setSavingLimit] = useState(false);
  useEffect(() => { setLimit(String(savedLimit)); }, [savedLimit, rules?.low]);
  async function saveLimit(value: number | undefined) {
    setSavingLimit(true);
    try {
      const result = await run({ type: 'deviceSettings', id: device.id, patch: { low: value } });
      if (result.ok) setLimit(String(value ?? state.settings.low));
    } finally { setSavingLimit(false); }
  }
  const low = level(device, state);
  const send = (command: Command) => { void run(command); };
  return <section className={s.details} data-full={!!full} aria-label="设备详情">
    <div className={s.detailsHeader}><Art device={device} className={full ? s.transitionArt : ''} /><div><h2>{device.name}</h2><div><StatusTag device={device} /><Connection device={device} /></div></div>
      <button className={s.iconButton} aria-label="编辑设备名称" onClick={() => { setAlias(device.name); edit(true); }}><Pencil size={17} /></button></div>
    <div className={s.batteryPanel} data-tone={tone(device, state)}><BatteryMeter state={state} device={device} /><div>
      {low && <span className={s.redTag}><TriangleAlert size={15} />{low === 'critical' ? '电量告急' : '电量较低'}</span>}
      <small>{device.status === 'current' ? (device.reading && device.reading.low !== device.reading.high ?
        '设备上报 ' + device.reading.low + '–' + device.reading.high + '%' : '当前电量') : '上次有效电量'}</small></div></div>
    <dl className={s.detailsFacts}>
      <div><ShieldCheck size={21} /><div><dt>读取状态</dt><dd>{device.reason}</dd></div></div>
      <div><Cable size={21} /><div><dt>读数来源</dt><dd>{device.reading ? device.reading.source === 'hid' ? '设备 HID' : 'Windows 电量属性' : '—'}</dd></div></div>
      <div><Zap size={21} /><div><dt>充电状态</dt><dd>{device.reading ? powerLabels[device.reading.power] : '—'}</dd></div></div>
      <div><Clock size={21} /><div><dt>上次读数</dt><dd>{dateLabel(device.lastRead)}</dd></div></div>
    </dl>
    <h3 className={s.detailSection}>电量历史 <span>（近 24 小时）</span></h3>
    <Chart device={device} revision={device.lastRead} large={full} />
    <h3 className={s.detailSection}><Bell size={18} />提醒设置</h3>
    <div className={s.settingsInset}>
      <SettingRow title="设备低电量阈值" copy={rules?.low === undefined
        ? '跟随全局 ' + state.settings.low + '% · 紧急线 ' + state.settings.critical + '%'
        : rules.low <= state.settings.critical
          ? '自定义 ' + rules.low + '% · 达到 ' + state.settings.critical + '% 时直接进入紧急提醒'
          : '自定义 ' + rules.low + '% · 紧急线 ' + state.settings.critical + '%'}>
        <form className={s.thresholdForm} onSubmit={event => {
          event.preventDefault();
          void saveLimit(Number(limit));
        }}>
          <input className={s.number} type="number" autoComplete="off" name="device-threshold"
            aria-label="设备低电量阈值" value={limit} min={1} max={95} step={1} required
            onChange={event => setLimit(event.target.value)} />
          <button className={s.button} type="submit" disabled={savingLimit || (rules?.low !== undefined && Number(limit) === savedLimit)}>应用</button>
          {rules?.low !== undefined && <button className={s.textButton} type="button" disabled={savingLimit}
            onClick={() => { void saveLimit(undefined); }}>恢复全局阈值</button>}
        </form>
      </SettingRow>
      <SettingRow title="静音提醒" copy="暂停此设备的提醒"><SwitchControl label="静音此设备" checked={!!rules?.muted}
        onChange={value => send({ type: 'deviceSettings', id: device.id, patch: { muted: value } })} /></SettingRow>
    </div>
    {canProbeBluetooth(device) && <div className={s.bluetoothOption}>
      <SettingRow title="DualSense 蓝牙电量" copy={isConnected(device) ? '读取本次连接的完整电量报告' : '唤醒手柄并连接蓝牙后可读取'}>
        <button className={s.button} disabled={probing || device.status === 'offline' || device.status === 'stale'}
          onClick={() => setConfirmBluetooth(true)}><Bluetooth size={16} aria-hidden="true" />{probing ? '正在读取…' : '读取蓝牙电量'}</button>
      </SettingRow>
    </div>}
    <footer className={s.detailActions}>{openFull && <button className={s.primary} onClick={openFull}>打开设备详情 <ArrowDownRight size={16} aria-hidden="true" /></button>}<button className={s.primary} onClick={() => send({ type: 'preview', severity: low ?? 'low', id: device.id })}><Bell size={19} />提醒测试</button>
      <Menu.Root><Menu.Trigger asChild><button className={s.button}><Ellipsis size={20} />更多操作</button></Menu.Trigger>
        <Menu.Portal><Menu.Content align="end" sideOffset={5} className={s.popover}>
          <Menu.Item className={s.menuOption} onSelect={() => send({ type: 'refresh' })}><RefreshCw size={15} aria-hidden="true" />立即刷新</Menu.Item>
          <Menu.Item className={s.menuOption} disabled={!low} onSelect={() => send({ type: 'snooze', id: device.id })}><Clock size={15} aria-hidden="true" />稍后提醒</Menu.Item>
          <Menu.Item className={s.menuOption} disabled={!low} onSelect={() => send({ type: 'ignore', id: device.id })}><BellOff size={15} aria-hidden="true" />忽略本次</Menu.Item>
          {device.watched && <><Menu.Separator className={s.menuDivider} /><Menu.Item className={s.menuOption} data-destructive onSelect={() => setRemove(true)}>
            <MonitorSmartphone size={15} aria-hidden="true" />停止监测</Menu.Item></>}
        </Menu.Content></Menu.Portal></Menu.Root>
    </footer>
    {confirmBluetooth && <Modal title="启用 DualSense 蓝牙增强读取？"
      description="手柄会在本次连接发送完整报告，部分 DirectInput 游戏可能受影响。关机重连可恢复。"
      onClose={() => { if (!probing) setConfirmBluetooth(false); }}>
      <button className={s.primary} disabled={probing} onClick={() => {
        setProbing(true);
        void run({ type: 'bluetooth', id: device.id }).then(reply => {
          setProbing(false);
          if (reply.ok) setConfirmBluetooth(false);
        });
      }}>{probing ? '正在读取…' : '确认读取蓝牙电量'}</button>
    </Modal>}
    {editing && <Modal title="编辑设备名称" description="清空名称可恢复设备原名。" onClose={() => edit(false)}>
      <form className={s.modalForm} onSubmit={event => {
        event.preventDefault();
        void run({ type: 'deviceSettings', id: device.id, patch: { alias } }).then(reply => { if (reply.ok) edit(false); });
      }}><input autoComplete="off" name="device-name" aria-label="设备名称" value={alias} maxLength={80} onChange={event => setAlias(event.target.value)} />
        <button type="submit" className={s.primary}>保存名称</button></form>
    </Modal>}
    {confirmRemove && <Modal title="停止监测设备？" description={device.name + '将从设备列表移除，可通过查找设备重新添加。'} onClose={() => setRemove(false)}>
      <button className={s.button} onClick={() => {
        void run({ type: 'remove', id: device.id }).then(reply => { if (reply.ok) setRemove(false); });
      }}>停止监测</button>
    </Modal>}
  </section>;
}

function Alerts({ state, run, open }: { state: Snapshot; run: Run; open: (id: string) => void }) {
  const devices = needCharge(state);
  const [low, setLow] = useState(String(state.settings.low));
  const [critical, setCritical] = useState(String(state.settings.critical));
  const muted = state.mutedUntil > Date.now();
  const patch = (value: Partial<Snapshot['settings']>) => { void run({ type: 'settings', patch: value }); };
  return <div className={s.alertsLayout}>
    <div>
      <div className={s.alertIntro}><div className={s.ring}><Bell /></div><div><h2>提醒状态</h2><p>{muted ? '已静音，设备电量仍会更新。' : '电量达到阈值时发送通知。'}</p></div>
        <button className={s.button} onClick={() => { void run({ type: 'mute' }); }}><BellOff size={17} />{muted ? '恢复提醒' : '静音 ' + muteDurationLabel(state.settings.muteMinutes)}</button></div>
      <section className={s.settingsPanel}>
        <SectionTitle>提醒设置</SectionTitle>
        <form onSubmit={event => { event.preventDefault(); patch({ low: Number(low), critical: Number(critical) }); }}>
          <SettingRow title="提醒阈值" copy="低电量阈值 / 紧急阈值。设备可单独设置低电量线，紧急线对所有设备优先。">
            <div className={s.inlineForm}><input type="number" className={s.number} autoComplete="off" name="low-threshold" min="2" max="95" aria-label="全局低电量阈值"
              value={low} onChange={event => setLow(event.target.value)} required />
            <input type="number" className={s.number} autoComplete="off" name="critical-threshold" min="1" max="94" aria-label="全局紧急阈值" value={critical}
              onChange={event => setCritical(event.target.value)} required /><button className={s.button}>应用</button></div>
          </SettingRow>
        </form>
        <SettingRow title="重复提醒间隔" copy="对仍处于低电量的设备再次提醒"><SelectControl label="重复提醒间隔"
          value={String(state.settings.repeat)} onChange={value => patch({ repeat: Number(value) })} choices={minutes([0, 15, 30, 60, 120])} /></SettingRow>
        <SettingRow title="全局静音时长" copy="下次静音时生效，期间仍会读取设备电量。"><SelectControl label="全局静音时长"
          value={String(state.settings.muteMinutes)} onChange={value => {
            const duration = Number(value);
            if (isMuteDuration(duration)) patch({ muteMinutes: duration });
          }} choices={muteDurations.map(value => ({ value: String(value), label: muteDurationLabel(value) }))} /></SettingRow>
        <SettingRow title="全屏提示音" copy="全屏时用短音提示"><SwitchControl label="全屏提示音" checked={state.settings.fullscreenSound}
          onChange={() => { void run({ type: 'toggleAlertSetting', key: 'fullscreenSound' }); }} /></SettingRow>
        <SettingRow title="仅提示音" copy="桌面场景仅播放短音"><SwitchControl label="仅提示音" checked={state.settings.soundOnly}
          onChange={() => { void run({ type: 'toggleAlertSetting', key: 'soundOnly' }); }} /></SettingRow>
        <SettingRow title="稍后提醒" copy="暂缓单个设备的低电量提醒"><SelectControl label="稍后提醒时间" value={String(state.settings.snooze)}
          onChange={value => patch({ snooze: Number(value) })} choices={minutes([5, 15, 30, 60])} /></SettingRow>
      </section>
    </div>
    <div>
      {(['critical', 'low'] as const).map(severityValue => {
        const group = devices.filter(device => level(device, state) === severityValue);
        return <section className={s.alertGroup} data-level={severityValue} key={severityValue}>
          <div className={s.chargeTitle}><span className={s.medallion}>{severityValue === 'critical' ? <Zap /> : <TriangleAlert />}</span>
            <div><h2>{severityValue === 'critical' ? '电量告急' : '低电量提醒'}（{group.length}）</h2>
              <p>{group.length ? '连接电源或更换电池可恢复提醒状态。' : '当前没有此级别的待充电设备。'}</p></div></div>
          {group.map(device => {
            const status = state.alerts[device.id];
            return <div className={s.alertDevice} key={device.id}>
              <Art device={device} /><div><button className={s.linkTitle} onClick={() => open(device.id)}>{device.name}</button>
                <strong>{percent(device.reading)}</strong><small>{state.deviceSettings[device.id]?.muted ? '已静音' :
                  status?.ignored === severityValue ? '已忽略本次' : (status?.snoozeUntil ?? 0) > Date.now() ? '已设为稍后提醒' : ''}</small></div>
              <div className={s.alertButtons}><button className={s.button} onClick={() => { void run({ type: 'snooze', id: device.id }); }}><Clock size={16} />稍后提醒</button>
                <button className={s.button} onClick={() => { void run({ type: 'ignore', id: device.id }); }}><BellOff size={16} />忽略本次</button></div>
            </div>;
          })}
        </section>;
      })}
      <section className={s.settingsPanel}>
        <SectionTitle>桌面通知</SectionTitle>
        <SettingRow title="右下角弹窗" copy="关闭后由 Windows 投递通知"><SwitchControl label="右下角弹窗"
          checked={state.settings.desktopToasts} onChange={() => { void run({ type: 'toggleAlertSetting', key: 'desktopToasts' }); }} /></SettingRow>
        <div className={s.previewActions}><button className={s.button} onClick={() => { void run({ type: 'preview', severity: 'low' }); }}><Bell size={17} />预览低电量</button>
          <button className={s.button} onClick={() => { void run({ type: 'preview', severity: 'critical' }); }}><Zap size={17} />预览紧急提醒</button></div>
      </section>
    </div>
  </div>;
}

function History({ state }: { state: Snapshot }) {
  const [id, select] = useState('');
  const device = state.devices.find(item => item.id === id) ?? state.devices.find(item => item.art === 'dualsense') ?? state.devices[0];
  if (!device) return <Empty>设备产生读数后，可在这里查看电量变化</Empty>;
  return <section className={s.history}>
    <SectionTitle aside={<SelectControl label="历史设备" value={device.id} onChange={select} choices={state.devices.map(item => ({ value: item.id, label: item.name }))} />}>近 24 小时</SectionTitle>
    <div className={s.historyDevice}><Art device={device} /><div><h3>{device.name}</h3><Connection device={device} /><p>上次读数 {dateLabel(device.lastRead)}</p></div>
      <BatteryMeter device={device} state={state} /></div>
    <Chart device={device} revision={device.lastRead} large />
  </section>;
}
function Settings({ state, run }: { state: Snapshot; run: Run }) {
  const [context, setContext] = useState('');
  const [exporting, setExporting] = useState(false);
  const send = (command: Command) => { void run(command); };
  return <div className={s.settingsPage}>
    <section className={s.settingsPanel}>
      <SectionTitle>显示大小</SectionTitle>
      <ZoomControl name="主界面" value={state.settings.zoom} apply={value => run({ type: 'settings', patch: { zoom: value } })} />
      <ZoomControl name="托盘浮窗" value={state.settings.trayZoom} apply={value => run({ type: 'settings', patch: { trayZoom: value } })} />
    </section>
    <section className={s.settingsPanel}>
      <SectionTitle>运行设置</SectionTitle>
      <SettingRow title="随 Windows 登录启动" copy="登录后在托盘开始监测"><SwitchControl label="随 Windows 登录启动" checked={state.settings.startup}
        onChange={value => send({ type: 'settings', patch: { startup: value } })} /></SettingRow>
      <SettingRow title="记录 DualSense 电池电压" copy="实验数据保存在本地诊断目录"><SwitchControl label="记录 DualSense 电池电压" checked={state.settings.voltage}
        onChange={value => send({ type: 'settings', patch: { voltage: value } })} /></SettingRow>
      <SettingRow title="诊断日志" copy="查看采集、错误和性能采样记录"><button className={s.button} onClick={() => send({ type: 'diagnostics' })}>打开诊断目录 <ChevronRight size={16} /></button></SettingRow>
      <form className={s.compatibilityForm} onSubmit={event => {
        event.preventDefault();
        setExporting(true);
        void run({ type: 'compatibility', context }).finally(() => setExporting(false));
      }}>
        <label htmlFor="compat-context">兼容性反馈说明（选填）</label>
        <input id="compat-context" name="compatibility-context" maxLength={240} autoComplete="off"
          placeholder="例如 V98 Pro V3，2.4 GHz，唤醒后仍无电量…" value={context} onChange={event => setContext(event.target.value)} />
        <button className={s.button} type="submit" disabled={exporting || state.demo}>
          {exporting ? '正在生成…' : '生成兼容性报告'}
        </button>
      </form>
    </section>
  </div>;
}
function FindDevices({ state, run, close }: { state: Snapshot; run: Run; close: () => void }) {
  const [found, setFound] = useState<Found[]>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<string | null>(null);
   async function search() {
    setLoading(true);
    const reply = await run({ type: 'discover' });
    setLoading(false);
    if (reply.ok) { setFound(reply.found); setError(''); }
    else setError(reply.error);
  }
  useEffect(() => { void search(); }, []);
  return <Modal title="查找设备"
    description="先在 Windows 中连接或配对外设，再选择支持电量读取的设备。"
    onClose={close}>
      <button className={s.button} disabled={loading} onClick={() => { void search(); }}><RefreshCw size={16} />重新扫描</button>
      <div className={s.discovery} aria-live="polite">
        {loading ? <p>正在扫描 Windows 设备…</p> : error ? <p>{error}</p> : !found?.length ? <p>暂未发现外设。</p> : found.map(device => {
          const watched = state.devices.some(item => item.id === device.id);
          return <div key={device.id} className={s.discoveryRow}><div><b>{device.name}</b><small>{device.connection} · {
            device.automatic || watched ? '已监测' : !device.connected ? '未连接' : device.reading ? '可添加 · ' + percent(device.reading) : 'Windows 暂无可用电量'}</small></div>
            {device.connected && device.reading && !device.automatic && !watched && <button className={s.button} disabled={!!pending} onClick={() => {
                setPending(device.id);
                void run({ type: 'add', id: device.id }).then(reply => {
                  setPending(null);
                  if (reply.ok) setFound(items => items?.map(item => item.id === device.id ? { ...item, automatic: true } : item));
                });
              }}>添加到监测</button>}
          </div>;
        })}
      </div>
  </Modal>;
}
