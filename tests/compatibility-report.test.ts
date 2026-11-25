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
    inputOrHeadset: true, knownBluetooth: true, bleServiceCount: 2,
    serial: 'mysn1', name: 'Alice in private Bluetooth', macAddress: '00:11:22:33:44:55' }],
  hidInterfaces: [{ target: 'W1', descriptorState: 'candidate', vid: 0x1532, pid: 0xb8, interfaceNumber: -1, inputBytes: 91, descriptorAvailable: true,
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
  t.mock.method(Collector.prototype, 'request', async (action: string) => action === 'compatibility' ? rawReport :
    action === 'diagnostic_devices' ? [{ id: 'sensitive-interface', target: 'W1', model: 'MX Keys', firmwareReadable: true,
      label: '蓝牙键盘', connection: '蓝牙', connected: true }] :
    action === 'diagnostic_firmware' ? { status: 'ready', firmware: '2.0' } : []);
  const monitor = new Monitor(dir, join(dir, 'not-running.exe'), () => {}, () => {});
  try {
    await monitor.poll(true);
    const [device] = await monitor.listDiagnosticDevices();
    assert.ok(device.key && device.key !== 'sensitive-interface');
    assert.deepEqual(await monitor.readDiagnosticFirmware(device.key), { status: 'ready', firmware: '2.0' });
    const first = await monitor.previewCompatibility({ kind: 'device', deviceKey: device.key, model: 'override', firmware: 'overridden' }, '0.0.5');
    const firstReport = JSON.parse(first.json);
    assert.deepEqual(firstReport.selectedDevice, { model: 'MX Keys', modelSource: 'device', firmware: '2.0', firmwareSource: 'device',
      connection: '蓝牙', connected: true, evidence: 'matched' });
    assert.ok(!first.json.includes('sensitive-interface') && !first.json.includes(device.key) && !first.json.includes('W1'));
    assert.equal(firstReport.gamepads.xinput.length, 0);
    assert.equal(firstReport.windowsDevices.length, 1);
    assert.equal(firstReport.windowsDevices[0].knownBluetooth, true);
    assert.equal(firstReport.windowsDevices[0].inputOrHeadset, true);
    assert.equal(firstReport.windowsDevices[0].bleServiceCount, 2);
    assert.equal(firstReport.hidInterfaces[0].descriptorState, 'candidate');
    assert.deepEqual(firstReport.selectedEvidence, {
      scope: 'selected_device_only', hidInterfaceCount: 1, batteryAttemptCount: 2,
    });
    const file = join(dir, 'compatibility-report.json');
    assert.equal(existsSync(file), false);
    assert.throws(() => monitor.exportCompatibility('bad token'), /预览已失效/);
    assert.equal(existsSync(file), false);
    monitor.exportCompatibility(first.token);
    assert.equal(readFileSync(file, 'utf8'), first.json);
    assert.ok(readdirSync(dir).every(name => !name.endsWith('.tmp')));
    await assert.rejects(monitor.previewCompatibility({ kind: 'device', deviceKey: 'unknown' }, '0.0.5'), /设备列表已失效/);
    const manual = JSON.parse((await monitor.previewCompatibility({ kind: 'manual', model: '未知设备 C:\\Users\\Alice', firmware: '0.7' }, '0.0.5')).json);
    assert.equal(manual.selectedDevice.model, '未知设备 [路径已遮盖]');
    assert.equal(manual.selectedDevice.evidence, 'not_correlated');
    assert.equal(manual.windowsDevices.length, 0);
    assert.equal(manual.recentSamples.length, 0);
    assert.equal(manual.hidInterfaces.length, 0);
    assert.equal(manual.selectedEvidence.scope, 'device_not_linked');
  } finally { monitor.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('通用名称选中后仍保留所选接口；无关联时不导出其他外设', () => {
  const selected = { model: '未识别键盘', modelSource: 'manual', target: 'W2' } as const;
  const mixed = { ...rawReport, hidInterfaces: [
    ...rawReport.hidInterfaces,
    { target: 'W2', vid: 0x1234, pid: 0x5678, inputBytes: 64, descriptorAvailable: true,
      descriptorState: 'no_provider', usagePage: 0xff01, rawInput: [1, 2, 3], instanceId: 'private-container' },
    { target: 'W3', vid: 0x9999, pid: 0x9999 },
  ] };
  const json = compatibilityJson(metadata, mixed, new Date(0), selected);
  const selectedOnly = JSON.parse(json);
  assert.deepEqual(selectedOnly.hidInterfaces, [{ vid: 0x1234, pid: 0x5678, usagePage: 0xff01, inputBytes: 64,
    descriptorAvailable: true, descriptorState: 'no_provider', candidateProvider: null }]);
  assert.equal(selectedOnly.recentSamples.length, 0);
  assert.deepEqual(selectedOnly.selectedEvidence, {
    scope: 'selected_device_only', hidInterfaceCount: 1, batteryAttemptCount: 0,
  });
  for (const secret of ['W2', 'private-container', 'rawInput', '39221', '39321']) assert.ok(!json.includes(secret));
  const inventoryOnly = JSON.parse(compatibilityJson({ ...metadata, capture: 'inventory' }, mixed, new Date(0), selected));
  assert.equal(inventoryOnly.hidInterfaces.length, 0);
  assert.equal(inventoryOnly.selectedEvidence.scope, 'inventory_not_linked');
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
