import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareDevices, rememberSortConnections } from '../src/device-order';
import type { Device } from '../src/model';

const device = (id: string, name: string, low: number | null, status: Device['status'] = 'current',
  power: NonNullable<Device['reading']>['power'] = 'discharging'): Device => ({
  id, name, status, reading: low === null ? null : { low, high: low, raw: low, source: 'hid', power },
  reason: '', connection: 'USB', art: 'unknown', watched: true, lastRead: 1,
});
const rows = [
  device('z', 'Zulu', 42, 'current', 'charging'),
  device('b', 'Alpha', 42),
  device('a', 'Alpha', 42),
  device('n', 'Beta', null),
  device('x', 'Aardvark', 17, 'offline'),
];
const ordered = (items: Device[], sort: string) => items.toSorted((a, b) => compareDevices(a, b, sort)).map(x => x.id);

test('all three sorts are deterministic across collector order, including ties and missing readings', () => {
  for (const [mode, expected] of Object.entries({
    state: ['a','b','n','z','x'], low: ['x','a','b','z','n'], name: ['x','a','b','n','z'],
  })) {
    assert.deepEqual(ordered(rows, mode), expected);
    assert.deepEqual(ordered([...rows].reverse(), mode), expected);
  }
});

test('charging does not change connection order; natural names use numeric and pinyin collation', () => {
  const items = [
    device('10', 'Mouse 10', 20), device('2', 'Mouse 2', 90, 'current', 'charging'),
    device('du', '杜', 10), device('bai', '白', 30),
  ];
  assert.deepEqual(ordered(items.filter(x => x.id.length === 1 || x.id === '10'), 'state'), ['2','10']);
  assert.deepEqual(ordered(items.slice(2), 'name'), ['bai','du']);
});

test('uncertain samples retain both prior groups until a confirmed transition', () => {
  const a = device('a', 'Alpha', 42);
  const b = device('b', 'Beta', 42, 'offline');
  let groups = rememberSortConnections([a,b], new Map());
  const after = [device('a','Alpha',42,'stale'), device('b','Beta',42,'no_radio_reply')];
  assert.equal(rememberSortConnections(after, groups), groups);
  assert.equal(compareDevices(after[0], after[1], 'state', groups), -1);
  const swapped = [{...a,status:'offline' as const}, {...b,status:'current' as const}];
  groups = rememberSortConnections(swapped, groups);
  assert.equal(compareDevices(swapped[0], swapped[1], 'state', groups), 1);
  assert.deepEqual([...rememberSortConnections([swapped[1]], groups)], [['b',true]]);
});
