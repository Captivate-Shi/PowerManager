import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Collector } from '../src/collector';
import { defaults, inventoryState, type Device } from '../src/model';
import { Monitor } from '../src/monitor';

const reading = { low: 9, high: 9, raw: 9, power: 'discharging', source: 'hid' } as const;
const existing: Device = { id: 'local-key', name: '已保存鼠标', connection: 'USB', art: 'mouse',
  watched: false, status: 'current', reason: '旧读数', reading, lastRead: 1000 };
const file = (devices: unknown[]) => ({ version: 1, devices, settings: { ...defaults },
  deviceSettings: { 'local-key': { alias: '工作鼠标' } }, alerts: {}, watched: [], history: {} });
const noProcess = (path: string) => join(path, 'missing-test-collector.exe');

test('冷启动无缓存不制造设备；首次成功但空是已确认，而非加载失败', async t => {
  const path = mkdtempSync(join(tmpdir(), 'power-start-cold-'));
  let monitor: Monitor | undefined;
  try {
    t.mock.method(Collector.prototype, 'request', async () => []);
    monitor = new Monitor(path, noProcess(path), () => {}, () => {});
    assert.equal(inventoryState(monitor.state), 'cold');
    assert.deepEqual(monitor.state.devices, []);
    await monitor.poll(true);
    assert.equal(inventoryState(monitor.state), 'ready');
    assert.deepEqual(monitor.state.devices, []);
  } finally {
    monitor?.close();
    rmSync(path, { recursive: true, force: true });
  }
});

test('暖启动初始与没有采样的首轮都只承认本地旧值；新采样后才可提醒', async t => {
  const path = mkdtempSync(join(tmpdir(), 'power-start-warm-'));
  let monitor: Monitor | undefined;
  try {
    writeFileSync(join(path, 'monitor.json'), JSON.stringify(file([existing, null, { id: 'broken' }])));
    let sampled: 'none' | 'invalid' | 'fresh' = 'none';
    let alerts = 0;
    t.mock.method(Collector.prototype, 'request', async function () {
      return [{ ...existing, aliases: [], automatic: true, sample: sampled !== 'none'
        ? { reading: sampled === 'fresh' ? reading : null, status: 'current', reason: '新读数' } : null, voltage: null }];
    });
    monitor = new Monitor(path, noProcess(path), () => {}, () => {
      alerts += monitor!.state.devices.filter(device => !!monitor!.eligible(device)).length;
    });
    assert.equal(inventoryState(monitor.state), 'cached');
    assert.equal(monitor.state.devices.length, 1);
    const stale = monitor.state.devices[0];
    assert.equal(stale.name, '工作鼠标');
    assert.equal(stale.status, 'stale');
    assert.deepEqual(stale.reading, reading);
    assert.equal(stale.lastRead, existing.lastRead);
    assert.equal(monitor.eligible(stale), undefined);
    await monitor.poll(true);
    assert.equal(monitor.state.devices[0].status, 'stale');
    assert.equal(alerts, 0);
    sampled = 'invalid';
    await monitor.poll(true);
    assert.equal(monitor.state.devices[0].status, 'unavailable');
    assert.equal(monitor.state.devices[0].reading?.low, 9);
    assert.equal(alerts, 0);
    sampled = 'fresh';
    await monitor.poll(true);
    assert.equal(monitor.state.devices[0].status, 'current');
    assert.equal(monitor.eligible(monitor.state.devices[0]), 'critical');
    assert.equal(alerts, 1);
    monitor.close();
    monitor = new Monitor(path, noProcess(path), () => {}, () => {});
    assert.equal(monitor.state.devices[0].status, 'stale');
    assert.equal(monitor.eligible(monitor.state.devices[0]), undefined);
  } finally {
    monitor?.close();
    rmSync(path, { recursive: true, force: true });
  }
});

test('坏存档与启动失败不产生示例数据或已扫描结论；暖启动失败保留旧值', async () => {
  const path = mkdtempSync(join(tmpdir(), 'power-start-fail-'));
  let monitor: Monitor | undefined;
  try {
    writeFileSync(join(path, 'monitor.json'), 'not-json');
    monitor = new Monitor(path, noProcess(path), () => {}, () => {});
    assert.equal(inventoryState(monitor.state), 'cold');
    assert.ok(readdirSync(path).some(name => name.startsWith('monitor-corrupt-')));
    await monitor.poll(true);
    assert.equal(inventoryState(monitor.state), 'unavailable');
    assert.equal(monitor.state.demo, false);
    assert.deepEqual(monitor.state.devices, []);
    monitor.close();
    writeFileSync(join(path, 'monitor.json'), JSON.stringify(file([existing])));
    monitor = new Monitor(path, noProcess(path), () => {}, () => {});
    await monitor.poll(true);
    assert.equal(monitor.state.collector, 'retrying');
    assert.equal(inventoryState(monitor.state), 'cached');
    assert.equal(monitor.state.devices[0].status, 'stale');
    assert.equal(monitor.eligible(monitor.state.devices[0]), undefined);
    const saved = JSON.parse(readFileSync(join(path, 'monitor.json'), 'utf8'));
    assert.deepEqual(saved.devices[0].reading, reading);
  } finally {
    monitor?.close();
    rmSync(path, { recursive: true, force: true });
  }
});
