import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import type { Collector } from '../src/collector';
import { Monitor } from '../src/monitor';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function sample(id: string, value?: number, sampleSequence?: number | null) {
  return { id, name: id, art: 'mouse', connection: 'USB', aliases: [], automatic: true, voltage: null, sampleSequence,
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
  const polls: { generation: number; force: boolean; answer: ReturnType<typeof deferred<ReturnType<typeof sample>[]>> }[] = [];
  t.mock.method(collector, 'request', (_action: string, { generation, force }: { generation: number; force: boolean }) => {
    const answer = deferred<ReturnType<typeof sample>[]>();
    polls.push({ generation, force, answer });
    return answer.promise;
  });
  return { monitor, polls };
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
