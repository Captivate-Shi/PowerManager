import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Collector } from '../src/collector';
import { Monitor } from '../src/monitor';

test('auto BLE path needs no Add and a missing sample cannot be mistaken for zero', async t => {
  const statePath = mkdtempSync(join(tmpdir(), 'pm-auto-'));
  let monitor: Monitor | undefined;
  const dev = { id: 'default-bas', name: '键盘', connection: '蓝牙', art: 'unknown', automatic: true, aliases: [] };
  let sample: unknown = { status: 'busy', reason: '读取中', reading: null };
  t.mock.method(Collector.prototype, 'request', async (action: string, req?: {watched?: unknown[]}) => {
    assert.equal(action, 'poll');
    assert.deepEqual(req?.watched, []);
    return [{ ...dev, sample }];
  });
  const clock = 1780000000000;
  let now = clock;
  t.mock.method(Date, 'now', () => ++now);
  try {
    monitor = new Monitor(statePath, join(statePath, 'unused.exe'), () => {}, () => {});
    await monitor.poll(true);
    assert.equal(monitor.state.devices.length, 1);
    const find = () => monitor!.state.devices[0];
    assert.equal(find().watched, false);
    assert.equal(find().reading, null);
    assert.equal(monitor.eligible(find()), undefined);
    sample = { status: 'current', reason: '可用', reading: {low:0, high:0, raw:0, power:'unknown', source:'ble'} };
    await monitor.poll(true);
    assert.equal(find().reading?.source, 'ble');
    assert.equal(find().reading?.low, 0);
    assert.equal(monitor.eligible(find()), 'critical');
    sample = { status:'offline', reason:'设备未连接', reading:null };
    await monitor.poll(true);
    assert.equal(monitor.eligible(find()), undefined);
  } finally {
    monitor?.close();
    rmSync(statePath, { recursive: true, force: true });
  }
});
