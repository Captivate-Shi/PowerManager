import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaults, isConnected, severity, type Device, type Reading } from '../src/model';
import { day, delayFor, eligible, historyLimit, observeRecovery, recordHistory } from '../src/monitor-rules';

// The reporting CLI is pure for in-memory samples.
const { summary } = require('../scripts/summarize-metrics.cjs');

const reading = (low: number, high = low): Reading => ({ low, high, raw: low, source: 'hid', power: 'discharging' });
const device = (level: Reading, status: Device['status'] = 'current'): Device => ({
  id: 'test', name: 'DualSense', connection: '蓝牙', art: 'dualsense',
  status, reason: '', reading: level, lastRead: 1, watched: false,
});

test('提醒边界包含 0%、临界值、跨档区间和 100%', () => {
  assert.equal(severity(device(reading(0)), defaults), 'critical');
  assert.equal(severity(device(reading(10)), defaults), 'critical');
  assert.equal(severity(device(reading(10, 11)), defaults), 'low');
  assert.equal(severity(device(reading(20)), defaults), 'low');
  assert.equal(severity(device(reading(20, 21)), defaults), undefined);
  assert.equal(severity(device(reading(100)), defaults), undefined);
  assert.equal(severity(device(reading(11)), defaults, { low: 11 }), 'low');
});

test('全局紧急优先，普通设备按各自阈值判断', () => {
  const value = device(reading(18));
  assert.equal(severity(value, defaults, { low: 15 }), undefined);
  assert.equal(severity(value, defaults, { low: 21 }), 'low');
  assert.equal(severity(value, { ...defaults, critical: 19 }, { low: 15 }), 'critical');
  assert.equal(severity(value, { ...defaults, low: 24 }), 'low');
  assert.equal(eligible(value, { ...defaults, critical: 19 }, { low: 15, muted: true }, {}, 0, 1), undefined);
  const critical = device(reading(9));
  assert.equal(eligible(critical, defaults, { low: 1 }, { criticalAt: 20 }, 0, 30), undefined);
  const remembered = { criticalAt: 20, recovery: 1 };
  assert.equal(observeRecovery(critical, defaults, { low: 1 }, remembered).criticalAt, 20);
  assert.equal(observeRecovery(device(reading(15)), defaults, { low: 1 }, remembered).criticalAt, undefined);
});

test('离线、未回应和过期读数不能用作提醒', () => {
  for (const status of ['offline', 'no_radio_reply', 'stale', 'unreachable'] as const) {
    assert.equal(isConnected(device(reading(7), status)), false);
    assert.equal(eligible(device(reading(7), status), defaults, undefined, {}, 0, 10), undefined);
  }
  assert.equal(delayFor(device(reading(0), 'unreachable'), defaults, undefined, 10000), 24_000);
  assert.equal(delayFor(device(reading(100)), defaults, undefined, 0), 22_000);
});

test('同一时刻更新、系统时间回拨和窗口容量保持历史有序', () => {
  const points = Array.from({ length: historyLimit }, (_, i) => ({ time: i + 100, reading: reading(60) }));
  const replaced = recordHistory(points, { time: points.at(-1)!.time, reading: null });
  assert.equal(replaced.length, historyLimit);
  assert.equal(replaced.at(-1)?.reading, null);
  const inserted = recordHistory(replaced, { time: 250, reading: reading(40) });
  assert.equal(inserted.length, historyLimit);
  assert.equal(inserted.find(item => item.time === 250)?.reading?.low, 40);
  assert.equal(recordHistory(inserted, { time: 42, reading: null })[0].time, 100);
  assert.equal(recordHistory(inserted, { time: day + 8000, reading: null }).length, 1);
});

test('设备解除静音和稍后提醒到期在对应边界生效', () => {
  const low = device(reading(19));
  assert.equal(eligible(low, defaults, undefined, { lowAt: 1, snoozeUntil: 40 }, 0, 39), undefined);
  assert.equal(eligible(low, defaults, undefined, { lowAt: 1, snoozeUntil: 40 }, 0, 40), 'low');
  assert.equal(eligible(low, defaults, { muted: true }, { snoozeUntil: 40 }, 0, 40), undefined);
  assert.equal(eligible(low, defaults, undefined, {}, 40, 39), undefined);
  assert.equal(eligible(low, defaults, undefined, {}, 40, 40), 'low');
});

test('性能汇总区分冷启动、后台、进程重启与缺失采样', () => {
  const create = (i: number, window = false, pid = 5, session = 'current') => ({
    version: 1, session, time: new Date(i * 10000).toISOString(), monotonicMs: i * 10000, cores: 4,
    surfaces: { main: window, tray: false, toast: false },
    electron: [{ pid: 1, created: 1, cpuSeconds: i * .02, privateBytes: 1024 * 1024 }],
    native: { pid, cpuSeconds: i * .01, privateBytes: 1024, handles: 12 },
    counters: { polls: i, failedPolls: 0, childExits: 0, pollMs: i * 10, maxPollMs: 10 },
    pending: 0, heapUsedBytes: 500, historyPoints: i, eventLoopActivePercent: .2, localCollectMs: .1, previousLogWriteMs: .1,
  });
  const samples = [create(99, false, 5, 'old'), create(0, true), create(1), create(2),
    create(3, false, 12), create(4, false, 12)];
  const result = summary(samples);
  assert.equal(result.sampleCount, 5);
  assert.equal(result.backgroundCpu.intervals, 3);
  assert.equal(result.backgroundCpu.nativePairs, 2);
  assert.equal(result.meanPollMs, 10);
  assert.equal(result.nativeHandles.drift, 0);
  const missing = summary([{ ...create(0), native: null }]);
  assert.equal(missing.nativeHandles.count, 0);
  assert.equal(missing.backgroundCpu.averagePercent, null);
});
