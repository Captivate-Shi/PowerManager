import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import type { Collector } from '../src/collector';
import { defaults, type Device, type Found } from '../src/model';
import { Monitor } from '../src/monitor';

const battery = { low: 12, high: 12, raw: 12, power: 'discharging', source: 'hid' } as const;
const found: Found = {
  id: 'test-mouse', name: 'Test Mouse', connection: 'USB',
  connected: true, automatic: false, reading: battery, offerBluetooth: false,
};
const watched = { id: found.id, name: found.name, connection: found.connection };
const device: Device = {
  ...watched, art: 'mouse', status: 'current', reading: battery, lastRead: Date.now(),
  reason: '', watched: true,
};

function fixture(t: TestContext, existing = false) {
  const directory = mkdtempSync(join(tmpdir(), 'pm-state-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'monitor.json');
  const temporary = file + '.tmp';
  if (existing) writeFileSync(file, JSON.stringify({
    version: 1, settings: defaults, deviceSettings: {}, alerts: { [device.id]: { lowAt: 100 } },
    watched: [watched], devices: [device], history: {},
  }));
  const monitor = new Monitor(directory, 'unused-collector-test', () => {}, () => {});
  const collector = (monitor as unknown as { collector: Collector }).collector;
  return { monitor, collector, file, temporary };
}

test('添加失败回滚，可以重试且只在成功后刷新', async t => {
  const { monitor, collector, file, temporary } = fixture(t);
  t.mock.method(collector, 'request', async () => [found]);
  const poll = t.mock.method(monitor, 'poll', async () => {});
  await monitor.discover();

  mkdirSync(temporary);
  assert.throws(() => monitor.add(found.id), /无法保存设备列表/);
  assert.equal(poll.mock.callCount(), 0);
  rmSync(temporary, { recursive: true });
  monitor.add(found.id);
  assert.equal(poll.mock.callCount(), 1);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).watched, [watched]);
});

test('移除或提醒动作保存失败，设备、提醒及旧存档不变', t => {
  const { monitor, file, temporary } = fixture(t, true);
  const before = readFileSync(file, 'utf8');
  const previousAlert = monitor.state.alerts[device.id];
  mkdirSync(temporary);

  assert.throws(() => monitor.remove(device.id), /无法保存设备列表/);
  assert.throws(() => monitor.saveAlertAction(device.id, { ignored: 'low' }), /无法保存提醒设置/);
  assert.throws(() => monitor.saveAlertAction(device.id, { snoozeUntil: 200 }), /无法保存提醒设置/);
  assert.equal(monitor.state.devices[0]?.id, device.id);
  assert.deepEqual(monitor.state.alerts[device.id], previousAlert);
  assert.equal(readFileSync(file, 'utf8'), before);

  rmSync(temporary, { recursive: true });
  monitor.saveAlertAction(device.id, { ...previousAlert, snoozeUntil: 200 });
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).alerts[device.id].snoozeUntil, 200);
  monitor.remove(device.id);
  assert.deepEqual(monitor.state.devices, []);
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(saved.watched, []);
  assert.equal(saved.alerts[device.id], undefined);
});

test('采集正常关闭但维护回执失败，可恢复并实际接受新电量', async t => {
  const { monitor, collector } = fixture(t, true);
  const request = t.mock.method(collector, 'request', async () => [{
    ...watched, art: 'mouse', aliases: [], automatic: false,
    sample: { status: 'current', reason: '', reading: battery },
  }]);
  assert.equal(await monitor.closeForMaintenance(), undefined);
  const before = request.mock.callCount();

  try {
    monitor.resumeAfterMaintenance();
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(request.mock.callCount() > before);
    assert.equal(monitor.state.collector, 'ready');
    assert.equal(monitor.state.devices[0]?.status, 'current');
  } finally { monitor.close(); }
});

test('维护前保存失败，不关闭或重启正在运行的采集器', async t => {
  const { monitor, collector, temporary } = fixture(t);
  const close = t.mock.method(collector, 'closeGracefully', async () => true);
  const start = t.mock.method(monitor, 'start', () => {});
  mkdirSync(temporary);
  assert.match((await monitor.closeForMaintenance()) ?? '', /无法保存/);
  monitor.resumeAfterMaintenance();
  assert.equal(close.mock.callCount(), 0);
  assert.equal(start.mock.callCount(), 0);
});

test('维护退出超时，终止已收 EOF 的旧子进程，不立即并发打开设备', async t => {
  const { monitor, collector } = fixture(t);
  t.mock.getter(collector, 'pid', () => 123);
  t.mock.method(collector, 'closeGracefully', async () => false);
  const order: string[] = [];
  t.mock.method(collector, 'allowRestartAfterClose', () => { order.push('reopen'); });
  t.mock.method(collector, 'close', () => { order.push('close'); });
  const start = t.mock.method(monitor, 'start', () => {});
  const scheduler = monitor as unknown as { schedule(delay: number, force: boolean): void };
  const schedule = t.mock.method(scheduler, 'schedule', () => {});

  assert.match((await monitor.closeForMaintenance()) ?? '', /退出超时/);
  monitor.resumeAfterMaintenance();
  assert.deepEqual(order, ['reopen', 'close']);
  assert.equal(start.mock.callCount(), 0);
  assert.deepEqual(schedule.mock.calls[0]?.arguments, [5000, true]);
  assert.equal(monitor.state.collector, 'retrying');
});
