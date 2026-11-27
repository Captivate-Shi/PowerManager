import { isAbsolute, join } from 'node:path';
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Monitor } from '../../src/monitor';
import { isHistoryRange, isHistoryRangeWithin, severity, type Command, type MainView, type Toast } from '../../src/model';
import { patchDeviceSettings, patchSettings } from '../../src/settings-validation';
import { previewDevice } from '../../src/demo';
import pkg from '../../package.json';

const [dir, collector, benchmark] = process.argv.slice(2);
if (!dir || !isAbsolute(dir) || !collector || !isAbsolute(collector)) throw Error('Missing lab paths.');
const send = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n');
let toast: Toast | null = null;
let view: MainView | undefined;
let stopped = false;
const monitor = new Monitor(dir, collector, () => send({ event: 'state', value: monitor.state }), evaluate);
function evidence(name: string) {
  if (benchmark === '--benchmark') appendFileSync(join(dir, 'bench.ndjson'), JSON.stringify({ name, time: Date.now() }) + '\n');
}
function evaluate() {
  evidence('poll');
  if (stopped || toast) return;
  for (const level of ['critical', 'low'] as const) {
    const device = monitor.state.devices.find(item => monitor.eligible(item) === level);
    if (!device) continue;
    evidence(level);
    const current = monitor.state.alerts[device.id] ?? {};
    const now = Date.now();
    try {
      monitor.saveAlertAction(device.id, { ...current, [level === 'critical' ? 'criticalAt' : 'lowAt']: now, lastNoticeAt: now });
    } catch { return; }
    // The lab does not claim fullscreen detection or system notification parity.
    if (monitor.state.settings.soundOnly) void monitor.tone().catch(() => {});
    else if (monitor.state.settings.desktopToasts) {
      toast = { device, severity: level, preview: false, detailId: device.id };
      send({ event: 'toast' });
    }
    break;
  }
}
async function call(method: string, data: any) {
  const state = monitor.state;
  if (method === 'snapshot') return state;
  if (method === 'view') return view ?? null;
  if (method === 'remember') {
    if (['overview','devices','alerts','history','settings'].includes(data?.page)) view = data;
    return null;
  }
  if (method === 'toast') return toast;
  if (method === 'dismiss') { toast = null; return null; }
  if (method === 'evidence') { evidence('renderer-ready'); return null; }
  if (method !== 'command' || !data || typeof data !== 'object') throw Error('操作不受支持');
  const command = data as Command;
  const device = 'id' in command ? state.devices.find(d => d.id === command.id) : undefined;
  switch (command.type) {
    case 'refresh': await monitor.refresh(); break;
    case 'discover': return { ok: true, found: await monitor.discover() };
    case 'add': monitor.add(command.id); break;
    case 'remove': monitor.remove(command.id); break;
    case 'history': {
      const range = command.range ?? 'day';
      if (!device || !isHistoryRange(range) || !isHistoryRangeWithin(range, state.settings.historyRetention)) throw Error('记录范围无效');
      return range === 'day' ? { ok: true, history: monitor.history(device.id) } : { ok: true, historyDays: monitor.historySummary(device.id, range) };
    }
    case 'deviceSettings':
      if (!device || !monitor.saveDeviceSettings(device.id, patchDeviceSettings(state.deviceSettings[device.id], command.patch)))
        throw Error('设备不存在或保存失败');
      monitor.publish(); break;
    case 'toggleAlertSetting': {
      const k = command.key;
      if (!['fullscreenSound','soundOnly','desktopToasts'].includes(k)) throw Error('开关无效');
      return call('command', { type: 'settings', patch: { [k]: !state.settings[k] } });
    }
    case 'settings': {
      const before = { ...state.settings };
      const after = patchSettings(before, command.patch, command.confirmHistoryShorten === true);
      if (after.startup !== before.startup) throw Error('实验版不修改登录启动项');
      Object.assign(state.settings, after);
      if (!monitor.persist()) { Object.assign(state.settings, before); throw Error('无法保存设置'); }
      monitor.publish(); break;
    }
    case 'diagnosticDevices': return { ok: true, diagnosticDevices: await monitor.listDiagnosticDevices() };
    case 'diagnosticFirmware': return { ok: true, diagnosticFirmware: await monitor.readDiagnosticFirmware(command.deviceKey) };
    case 'compatibility':
      if ('reportToken' in command) return { ok: true, reportName: monitor.exportCompatibility(command.reportToken) };
      return { ok: true, compatibility: await monitor.previewCompatibility(command.selection, pkg.version) };
    case 'mute':
      state.mutedUntil = state.mutedUntil > Date.now() ? 0 : Date.now() + state.settings.muteMinutes * 60_000;
      monitor.publish(); break;
    case 'preview':
      if (!['low','critical'].includes(command.severity)) throw Error('预览级别无效');
      toast = { device: device ?? previewDevice(command.severity), severity: command.severity, preview: true, detailId: device?.id };
      send({ event: 'toast' }); break;
    case 'snooze': case 'ignore': {
      const level = device && severity(device, state.settings, state.deviceSettings[device.id]);
      if (!device || !level) throw Error('设备未达到提醒阈值');
      const previous = state.alerts[device.id] ?? {};
      monitor.saveAlertAction(device.id, command.type === 'ignore' ? { ...previous, ignored: level, snoozeUntil: undefined } :
        { ...previous, ignored: undefined, snoozeUntil: Date.now() + state.settings.snooze * 60_000 });
      monitor.publish(); break;
    }
    default: throw Error('该操作未接入实验版');
  }
  return { ok: true };
}
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', line => {
  if (stopped || line.length > 200_000) return;
  let request: any;
  try { request = JSON.parse(line); } catch { return; }
  if (!Number.isSafeInteger(request.id) || typeof request.method !== 'string') return;
  void call(request.method, request.data).then(value => send({ id: request.id, value }),
    error => send({ id: request.id, error: error instanceof Error ? error.message : '操作失败' }));
});
input.on('close', async () => {
  stopped = true;
  await monitor.closeForMaintenance().catch(() => undefined);
  monitor.close();
  process.exitCode = 0;
});
process.stdout.on('error', () => { input.close(); });
monitor.start();
