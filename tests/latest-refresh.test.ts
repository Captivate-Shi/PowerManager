import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { Collector } from '../src/collector';
import { Monitor } from '../src/monitor';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function sample(id: string, value?: number, sampleSequence?: number | null, pending = false) {
  return { id, name: id, art: 'mouse', connection: 'USB', aliases: [], automatic: true, voltage: null, sampleSequence, pending,
    sample: value === undefined ? null : { status: 'current', reason: '', reading: {
      low: value, high: value, raw: value, power: 'discharging', source: 'hid',
    } },
  };
}
function harness(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'pm-refresh-test-'));
  const monitor = new Monitor(directory, 'unused-test-collector', () => {}, () => {});
  const collector = (monitor as unknown as { collector: Collector }).collector;
  t.after(() => { monitor.close(); rmSync(directory, { recursive: true, force: true }); });
  type Rows = ReturnType<typeof sample>[];
  type Reply = Rows | { rows: Rows; workPending: boolean; discoveryPending?: boolean } | { restartRequired: true };
  const polls: { generation: number; force: boolean; answer: ReturnType<typeof deferred<Reply>> }[] = [];
  t.mock.method(collector, 'request', (_action: string, { generation, force }: { generation: number; force: boolean }) => {
    const answer = deferred<Reply>();
    polls.push({ generation, force, answer });
    return answer.promise;
  });
  return { monitor, collector, polls };
}
const nextTurn = () => new Promise<void>(done => setImmediate(done));

test('new manual refresh replaces previous requests without applying stale data or queuing every click', async t => {
  const { monitor, polls } = harness(t);
  const first = monitor.poll();
  const second = monitor.poll(true);
  const latest = monitor.poll(true);
  assert.equal(polls.length, 1);
  assert.equal(monitor.state.refreshing, true);
  polls[0]!.answer.resolve([sample('obsolete', 5)]);
  await nextTurn();
  assert.equal(polls.length, 2);
  assert.equal(polls[1]!.generation, 2);
  assert.equal(polls[1]!.force, true);
  assert.equal(monitor.state.devices.length, 0);
  assert.equal(monitor.state.refreshing, true);
  polls[1]!.answer.resolve([sample('new', 65)]);
  await Promise.all([first, second, latest]);
  assert.deepEqual(monitor.state.devices.map(x => [x.id, x.reading?.low]), [['new', 65]]);
  assert.equal(monitor.state.refreshing, false);
});

test('ready sample applies independently while another device still has no result', async t => {
  const { monitor, polls } = harness(t);
  const first = monitor.poll(true);
  polls[0]!.answer.resolve([sample('fast', 90, null), sample('slow')]);
  await first;
  assert.equal(monitor.state.devices.find(x => x.id === 'fast')?.reading?.low, 90);
  assert.equal(monitor.state.devices.find(x => x.id === 'slow')?.status, 'stale');

  const second = monitor.poll();
  polls[1]!.answer.resolve([sample('fast'), sample('slow', 33, 2)]);
  await second;
  assert.equal(monitor.state.devices.find(x => x.id === 'fast')?.reading?.low, 90);
  assert.equal(monitor.state.devices.find(x => x.id === 'slow')?.reading?.low, 33);
});

test('active manual refresh interrupts old work; an idle manual scan does not restart', async t => {
  const { monitor, collector, polls } = harness(t);
  const restart = t.mock.method(collector, 'restart', async () => {});
  const idle = monitor.refresh();
  assert.equal(restart.mock.callCount(), 0);
  polls[0]!.answer.resolve([sample('slow', undefined, null, true)]);
  await idle;
  const active = monitor.refresh();
  assert.equal(restart.mock.callCount(), 1);
  assert.equal(polls[1]!.generation, 2);
  polls[1]!.answer.resolve([sample('slow', 42, null)]);
  await active;
});

test('a stale slow lane stops alerting while healthy lanes still update', async t => {
  const { monitor, polls } = harness(t);
  const start = Date.now();
  let now = start;
  t.mock.method(Date, 'now', () => now);
  const first = monitor.poll();
  polls[0]!.answer.resolve([sample('slow', 8), sample('fast', 90)]);
  await first;
  const slow = () => monitor.state.devices.find(x => x.id === 'slow')!;
  assert.equal(monitor.eligible(slow()), 'critical');
  now += 70_000;
  const second = monitor.poll();
  assert.equal(monitor.eligible(slow()), undefined, 'do not alert while waiting for the next native reply');
  polls[1]!.answer.resolve([sample('slow', undefined, null, true), sample('fast', 91)]);
  await second;
  assert.equal(slow().status, 'stale');
  assert.equal(slow().reading?.low, 8);
  assert.equal(monitor.eligible(slow()), undefined);
  assert.equal(monitor.state.devices.find(x => x.id === 'fast')?.reading?.low, 91);
});

test('a delayed old process close does not leave manual refresh spinning or queue each click', async t => {
  const { monitor, collector, polls } = harness(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(collector, 'restart', () => new Promise<void>(() => {}));
  const old = monitor.poll();
  const first = monitor.refresh();
  const latest = monitor.refresh();
  assert.equal(monitor.state.refreshing, true);
  t.mock.timers.tick(5000);
  await Promise.all([first, latest]);
  assert.equal(monitor.state.refreshing, false);
  assert.equal(polls.length, 1);
  polls[0]!.answer.resolve([sample('obsolete', 5)]);
  await nextTurn();
  assert.equal(polls.length, 2);
  assert.equal(polls[1]!.generation, 2);
  polls[1]!.answer.resolve([sample('fresh', 66)]);
  await old;
  assert.deepEqual(monitor.state.devices.map(value => value.reading?.low), [66]);
});

test('pending HID discovery does not mark missing devices offline or hide completed readings', async t => {
  const { monitor, polls } = harness(t);
  const first = monitor.poll(true);
  polls[0]!.answer.resolve({ rows: [], workPending: true, discoveryPending: true });
  await first;
  assert.equal(monitor.state.collector, 'starting');
  const second = monitor.poll();
  polls[1]!.answer.resolve({ rows: [sample('receiver', 70)], workPending: false });
  await second;
  const third = monitor.poll();
  polls[2]!.answer.resolve({ rows: [sample('ble', 80)], workPending: true, discoveryPending: true });
  await third;
  const receiver = () => monitor.state.devices.find(value => value.id === 'receiver')!;
  assert.equal(receiver().status, 'current');
  assert.equal(monitor.state.devices.find(value => value.id === 'ble')?.reading?.low, 80);
  const fourth = monitor.poll();
  polls[3]!.answer.resolve({ rows: [sample('ble', 80)], workPending: false, discoveryPending: false });
  await fourth;
  assert.equal(receiver().status, 'offline');
});

test('an invalid sample or an old BLE sequence does not unlock a changed threshold', async t => {
  const { monitor, polls } = harness(t);
  const first = monitor.poll();
  polls[0]!.answer.resolve([sample('ble', 65, 1)]);
  await first;
  const beforeEdit = monitor.poll();
  monitor.saveDeviceSettings('ble', { low: 30 });
  const device = () => monitor.state.devices[0]!;
  polls[1]!.answer.resolve([sample('ble', 9, 1)]);
  await beforeEdit;
  assert.equal(monitor.eligible(device()), undefined);
  const invalid = monitor.poll();
  polls[2]!.answer.resolve([sample('ble', 101, 3)]);
  await invalid;
  const manual = monitor.refresh();
  polls[3]!.answer.resolve([sample('ble', 9, null)]);
  await manual;
  assert.equal(monitor.eligible(device()), undefined);
  const valid = monitor.poll();
  polls[4]!.answer.resolve([sample('ble', 9, 5)]);
  await valid;
  assert.equal(monitor.eligible(device()), 'critical');
});

test('native five-minute watchdog replaces collector, then retries a full scan once', async t => {
  const { monitor, collector, polls } = harness(t);
  const restart = t.mock.method(collector, 'restart', async () => {});
  const first = monitor.poll();
  polls[0]!.answer.resolve({ restartRequired: true });
  await nextTurn();
  assert.equal(restart.mock.callCount(), 1);
  assert.equal(polls[1]!.force, true);
  assert.equal(polls[1]!.generation, 1);
  polls[1]!.answer.resolve([sample('mouse', 59)]);
  await first;
  assert.equal(monitor.state.devices[0]?.reading?.low, 59);
});

test('collector restart terminates a real unresponsive child and rejects its pending IPC', async () => {
  let unexpectedExits = 0;
  const collector = new Collector(process.execPath, () => { ++unexpectedExits; });
  try {
    // Node without a script waits on stdin and does not answer the handshake.
    const pending = assert.rejects(collector.request('poll'), /采集程序已断开/);
    const interruptedPid = collector.pid;
    assert.ok(interruptedPid);
    await Promise.all([collector.restart(), pending]);
    assert.equal(collector.pid, undefined);
    assert.equal(collector.pendingCount, 0);
    assert.equal(unexpectedExits, 0);
  } finally {
    collector.close();
  }
});

test('replacement start remains gated until the retired collector signals close', async () => {
  const collector = new Collector('must-not-spawn', () => {});
  const child = Object.assign(new EventEmitter(), { kill: () => true, pid: 1 });
  const privateState = collector as unknown as { child?: typeof child; closing: boolean };
  privateState.child = child;
  const stopped = collector.restart();
  assert.equal(collector.restart(), stopped, 'one termination wait for all refreshes');
  let settled = false;
  const start = collector.start().finally(() => { settled = true; });
  const result = assert.rejects(start, /正在关闭/);
  await nextTurn();
  assert.equal(settled, false);
  assert.equal(collector.pid, 1, 'keep exclusive ownership until exit');
  privateState.closing = true;
  child.emit('close', 0);
  await Promise.all([stopped, result]);
});
