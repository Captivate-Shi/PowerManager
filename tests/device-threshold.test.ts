import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Monitor } from '../src/monitor';
import type { Reading, Sample } from '../src/model';

const id = 'test-threshold';
const reading = (level: number): Reading => ({ low: level, high: level, raw: level, power: 'discharging', source: 'hid' });
const row = (level: number | null, name = id) => ({ id: name, name, connection: '蓝牙', aliases: [],
  art: 'headset', automatic: true, sample: (level === null ? null : { status: 'current', reading: reading(level), reason: '' }) as Sample | null });

test('设备阈值在缓存、编辑前已启动的巡检、手动刷新和未采样的巡检中不触发提醒', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'threshold-poll-'));
  const monitor = new Monitor(dir, 'unused', () => {}, () => {});
  type Reply = ReturnType<typeof row>[];
  let resolve!: (value: Reply) => void;
  const requests = monitor as unknown as { collector: { request: () => Promise<Reply>; close: () => void } };
  requests.collector = { request: () => new Promise(done => { resolve = done; }), close() {} };
  const device = () => monitor.state.devices.find(device => device.id === id)!;
  const second = () => monitor.state.devices.find(device => device.id === 'untouched')!;
  try {
    let poll = monitor.poll();
    resolve([row(35), row(12, 'untouched')]); await poll;
    assert.equal(monitor.eligible(device()), undefined);
    assert.equal(monitor.eligible(second()), 'low');
    poll = monitor.poll();
    const offeredRevision = monitor.thresholdAlertRevision(id);
    assert.equal(monitor.saveDeviceSettings(id, { low: 45 }), true);
    assert.notEqual(monitor.thresholdAlertRevision(id), offeredRevision);
    assert.equal(monitor.eligible(device()), undefined, 'cached battery must not notify');
    assert.equal(monitor.eligible(second()), 'low', 'other device unaffected');
    assert.equal(JSON.parse(readFileSync(join(dir, 'monitor.json'), 'utf8')).deviceSettings[id].low, 45);
    resolve([row(34), row(12, 'untouched')]); await poll;
    assert.equal(monitor.eligible(device()), undefined, 'a poll begun before the edit cannot qualify');
    poll = monitor.poll(true);
    resolve([row(33), row(12, 'untouched')]); await poll;
    assert.equal(monitor.eligible(device()), undefined, 'forced read does not clear regular poll deferral');
    poll = monitor.poll();
    resolve([row(null), row(12, 'untouched')]); await poll;
    assert.equal(monitor.eligible(device()), undefined, 'poll inventory alone is not an observation');
    poll = monitor.poll();
    resolve([{ ...row(null), sample: { status: 'timeout', reading: null, reason: '' } }, row(12, 'untouched')]); await poll;
    assert.equal(monitor.eligible(device()), undefined, 'timeout must not clear the gate');
    poll = monitor.poll();
    resolve([row(33), row(12, 'untouched')]); await poll;
    assert.equal(monitor.eligible(device()), 'low');
    assert.notEqual(monitor.thresholdAlertRevision(id), offeredRevision, 'a fresh poll cannot resurrect an older pending alert');

    assert.equal(monitor.saveDeviceSettings(id, { low: 1 }), true);
    poll = monitor.poll();
    resolve([row(8), row(12, 'untouched')]); await poll;
    assert.equal(monitor.eligible(device()), 'critical', 'global critical threshold retains precedence');
  } finally { monitor.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('写入失败还原设备阈值和提醒历史，不产生待采样状态', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'threshold-rollback-'));
  const monitor = new Monitor(dir, 'unused', () => {}, () => {});
  try {
    assert.equal(monitor.saveDeviceSettings(id, { low: 20 }), true);
    monitor.state.alerts[id] = { recovery: 1, lowAt: 123 };
    mkdirSync(join(dir, 'monitor.json.tmp'));
    assert.equal(monitor.saveDeviceSettings(id, { low: 45 }), false);
    assert.deepEqual(monitor.state.deviceSettings[id], { low: 20 });
    assert.deepEqual(monitor.state.alerts[id], { recovery: 1, lowAt: 123 });
    assert.equal(JSON.parse(readFileSync(join(dir, 'monitor.json'), 'utf8')).deviceSettings[id].low, 20);
    rmSync(join(dir, 'monitor.json.tmp'), { recursive: true });
  } finally { monitor.close(); rmSync(dir, { recursive: true, force: true }); }
});
