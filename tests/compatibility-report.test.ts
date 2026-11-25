import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Collector } from '../src/collector';
import { CompatibilityDraft, compatibilityJson } from '../src/compatibility-report';
import { Monitor } from '../src/monitor';
import type { Found, Reading } from '../src/model';

const denied = 'C:\\Users\\Alice\\secret.log';
const ble: Reading = { low: 8, high: 8, raw: 8, power: 'unknown', source: 'ble' };
const rawReport = {
  schemaVersion: 1, windowsQuerySucceeded: true, bleEnumerationError: 5, context: 'unsafe override', appVersion: 'unsafe override',
  windowsDevices: [{ target: 'W1', connection: '蓝牙', connected: true, battery: null, reasonCode: 'windows_no_battery', bleBasListed: false, bleReasonCode: 'multiple_battery_services',
    serial: 'mysn1', name: 'Alice in private Bluetooth', macAddress: '00:11:22:33:44:55' }],
  hidInterfaces: [{ vid: 0x1532, pid: 0xb8, interfaceNumber: -1, inputBytes: 91, descriptorAvailable: true,
    path: denied, candidateProvider: 'razer-1532-00b8' }],
  recentSamples: [{ target: 'W1', provider: 'ble-bas', status: 'current', elapsedMs: 5, reasonCode: 'gatt_read_failed', serial: 'hiddenSerial',
    outcome: { status: 'current', reading: ble, detail: 1, reason: denied, rawReport: [1, 2, 3] } }],
  attempts: [{ target: 'W1', provider: 'ble-bas', reasonCode: 'ble_no_service', stage: 'service', code: 'no_service', errorCode: -1 }],
  gamepads: { wgiStatus: 'sdk_headers_unavailable', xinputStatus: 'no_controller', windowsGamingInput: [{ slot: 0, vid: 1118, status: 'current',
    remainingMwh: 1200, fullMwh: 2000, percent: 60, power: 'discharging', identity: denied }],
    xinput: [{ slot: 0, status: 'current', level: 'medium', provider: 'xinput', reasonCode: 'xinput_battery' }] },
};
const metadata = { appVersion: '0.0.5', windowsRelease: '10.0.26100', capture: 'live', collectorStatus: 'ready',
  context: `复现时看到 ${denied} 00:11:22:33:44:55 SN=` } as const;

test('报告只导出已知字段，保留失败原因、报告内标识、区间及手柄读数', () => {
  const json = compatibilityJson(metadata, rawReport);
  const report = JSON.parse(json);
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.collectorSchemaVersion, 1);
  assert.equal(report.appVersion, '0.0.5');
  assert.equal(report.windowsDevices[0].target, 'W1');
  assert.equal(report.windowsDevices[0].reasonCode, 'windows_no_battery');
  assert.equal(report.hidInterfaces[0].candidateProvider, 'razer-1532-00b8');
  assert.equal(report.recentSamples[0].outcome.reading.source, 'ble');
  assert.equal(report.providerAttempts[0].reasonCode, 'ble_no_service');
  assert.equal(report.providerAttempts[0].errorCode, -1);
  assert.equal(report.gamepads.windowsGamingInput[0].remainingMwh, 1200);
  assert.equal(report.gamepads.xinput[0].level, 'medium');
  assert.equal(report.gamepads.wgiStatus, 'sdk_headers_unavailable');
  assert.equal(report.bleEnumerationError, 5);
  assert.equal(report.windowsDevices[0].bleReasonCode, 'multiple_battery_services');
  assert.equal(report.recentSamples[0].reasonCode, 'gatt_read_failed');
  for (const bad of ['Alice', 'secret.log', 'unsafe override', '00:11:22:33:44:55', 'mysn1', 'hiddenSerial', 'rawReport']) {
    assert.ok(!json.includes(bad), bad + ' should be absent');
  }
  assert.match(json, /路径已遮盖/);
  assert.match(json, /蓝牙地址已遮盖/);
});
test('报告保留上限，拒绝异常读数和冒充 provider 或 report ID 的设备身份', () => {
  const invented = { provider: 'not_a_provider', target: '00:11:22:33:44:55', attempt: [],
    outcome: { status: 'invented', reading: { ...ble, high: 101 } } };
  const parsed = JSON.parse(compatibilityJson(metadata, { recentSamples: Array.from({ length: 600 }, () => invented),
    hidInterfaces: Array.from({ length: 300 }, () => ({})) }));
  assert.equal(parsed.recentSamples.length, 160);
  assert.equal(parsed.hidInterfaces.length, 256);
  assert.deepEqual(parsed.recentSamples[0], { outcome: { reading: null } });
});
test('只可保存已预览的有效快照，不重放、不允许用错误令牌，写入失败可重试', () => {
  let time = 0;
  const cache = new CompatibilityDraft(() => time);
  const first = cache.create('first');
  const second = cache.create('second');
  assert.throws(() => cache.save(first.token, () => assert.fail()), /预览已失效/);
  assert.throws(() => cache.save(second.token, () => { throw new Error('disk full'); }), /disk full/);
  cache.save(second.token, data => assert.equal(data, 'second'));
  assert.throws(() => cache.save(second.token, () => assert.fail()), /预览已失效/);
  const third = cache.create('expired');
  time += 10 * 60_000;
  assert.throws(() => cache.save(third.token, () => assert.fail()), /预览已失效/);
});
test('实机采集模拟：预览不落盘，明确确认后文件与屏幕内容一致', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'power-compat-report-'));
  t.mock.method(Collector.prototype, 'request', async (action: string) => action === 'compatibility' ? rawReport : []);
  const monitor = new Monitor(dir, join(dir, 'not-running.exe'), () => {}, () => {});
  try {
    await monitor.poll(true);
    const first = await monitor.previewCompatibility(metadata.context, '0.0.5');
    const file = join(dir, 'compatibility-report.json');
    assert.equal(existsSync(file), false);
    assert.throws(() => monitor.exportCompatibility('bad token'), /预览已失效/);
    assert.equal(existsSync(file), false);
    monitor.exportCompatibility(first.token);
    assert.equal(readFileSync(file, 'utf8'), first.json);
    assert.ok(readdirSync(dir).every(name => !name.endsWith('.tmp')));
  } finally { monitor.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('只允许关联已连接的 BAS 候选；有效的新采样前不触发提醒', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'power-compat-bas-'));
  const candidate: Found = { id: 'ble-keyboard', name: '蓝牙键盘', connection: '蓝牙', connected: true,
    reading: null, batteryCandidate: 'ble_bas', automatic: false, offerBluetooth: false };
  let reading: Reading | null = { ...ble, low: -1 };
  let registered = false;
  t.mock.method(Collector.prototype, 'request', async (action: string) => {
    if (action === 'discover') return [candidate, { ...candidate, id: 'offline', connected: false },
      { ...candidate, id: 'no-service', batteryCandidate: undefined }];
    if (!registered) return [];
    return [{ ...candidate, art: 'keyboard', aliases: [], sample: { status: 'current', reason: '蓝牙电池', reading }, voltage: null }];
  });
  const monitor = new Monitor(dir, join(dir, 'not-running.exe'), () => {}, () => {});
  try {
    await monitor.discover();
    assert.throws(() => monitor.add('offline'));
    assert.throws(() => monitor.add('no-service'));
    registered = true;
    monitor.add(candidate.id);
    await monitor.poll(true);
    assert.equal(monitor.state.devices[0].status, 'unavailable');
    assert.equal(monitor.eligible(monitor.state.devices[0]), undefined);
    reading = ble;
    await monitor.poll(true);
    assert.equal(monitor.state.devices[0].reading?.source, 'ble');
    assert.equal(monitor.eligible(monitor.state.devices[0]), 'critical');
  } finally { monitor.close(); rmSync(dir, { recursive: true, force: true }); }
});
