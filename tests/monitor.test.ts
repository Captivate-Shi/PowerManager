import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaults, percent, type Device, type Reading } from '../src/model';
import { day, delayFor, eligible, observeRecovery, recordHistory } from '../src/monitor-rules';
import { Collector } from '../src/collector';

const reading: Reading = { low: 10, high: 19, raw: 1, power: 'discharging', source: 'hid' };
const device: Device = { id: 'test', name: 'DualSense', connection: '蓝牙', art: 'dualsense',
  status: 'current', reason: '', lastRead: 1, watched: false, reading };
const candidate = (level: number): Device => ({ ...device, reading: { ...reading, low: level, high: level } });
test('原始档位的上限决定提醒，显示四舍五入后的估算值', () => {
  assert.equal(percent(reading), '约 15%');
  assert.equal(eligible(device, defaults, undefined, {}, 0, 100), 'low');
  assert.equal(eligible(device, { ...defaults, low: 18 }, undefined, {}, 0, 100), undefined);
  assert.equal(eligible(candidate(10), defaults, undefined, { lowAt: 50 }, 0, 100), 'critical');
  assert.equal(eligible(candidate(20), defaults, { low: 18 }, {}, 0, 100), undefined);
});
test('静音、充电和失效状态抑制提醒', () => {
  assert.equal(eligible(device, defaults, { muted: true }, {}, 0, 100), undefined);
  assert.equal(eligible(device, defaults, undefined, {}, 150, 100), undefined);
  assert.equal(eligible({ ...device, status: 'offline' }, defaults, undefined, {}, 0, 100), undefined);
  assert.equal(eligible({ ...device, reading: { ...reading, power: 'charging' } }, defaults, undefined, {}, 0, 100), undefined);
});
test('忽略、稍后提醒和重启去重保留紧急升级', () => {
  const saved = JSON.parse(JSON.stringify({ lowAt: 50 }));
  assert.equal(eligible(device, defaults, undefined, saved, 0, 100), undefined);
  assert.equal(eligible(device, defaults, undefined, { ...saved, snoozeUntil: 101 }, 0, 100), undefined);
  assert.equal(eligible(device, defaults, undefined, { ...saved, snoozeUntil: 101 }, 0, 101), 'low');
  assert.equal(eligible(candidate(9), defaults, undefined, { ignored: 'low' }, 0, 100), 'critical');
  assert.equal(eligible(device, defaults, undefined, { ignored: 'critical' }, 0, 100), undefined);
  assert.equal(eligible(device, { ...defaults, repeat: 15 }, undefined, saved, 0, 900050), 'low');
});
test('连续两次确认恢复后重新允许新一轮提醒', () => {
  const recovered = candidate(25);
  const first = observeRecovery(recovered, defaults, undefined, { lowAt: 10, criticalAt: 20 });
  assert.equal(first.lowAt, 10);
  const second = observeRecovery(recovered, defaults, undefined, first);
  assert.equal(second.lowAt, undefined);
  assert.equal(eligible(device, defaults, undefined, second, 0, 100), 'low');
});
test('断线与重连分段，历史仅保留 24 小时', () => {
  const samples = [{ time: 1, reading }, { time: day, reading: null }];
  const gaps = recordHistory(samples, { time: day + 1, reading: null });
  assert.equal(gaps.length, 2);
  const next = recordHistory(gaps, { time: day + 2, reading });
  assert.deepEqual(next, [{ time: day, reading: null }, { time: day + 2, reading }]);
  assert.equal(delayFor(device, defaults, undefined, 0), 12000);
  assert.equal(delayFor({ ...device, status: 'no_radio_reply' }, defaults, undefined, 9), 12000);
});
test('采集进程启动失败时拒绝请求并通知重连', async () => {
  let exits = 0;
  const client = new Collector('unavailable-powermanager-h5-collector.exe', () => { exits++; });
  await assert.rejects(client.start(), /已断开/);
  await assert.rejects(client.start(), /已断开/);
  assert.equal(exits, 2);
});
