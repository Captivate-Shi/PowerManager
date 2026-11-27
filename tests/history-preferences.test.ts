import assert from 'node:assert/strict';
import { test } from 'node:test';
import { historyComparisonSlots, parseHistorySlots, updateHistoryComparison } from '../src/history-preferences';

test('restore valid comparison IDs without compacting their color slots', () => {
  assert.deepEqual(parseHistorySlots(['mouse', null, 'keyboard']), ['mouse', undefined, 'keyboard']);
  assert.deepEqual(parseHistorySlots(['mouse', 'mouse', 'dual', 'extra']), ['mouse', undefined, 'dual']);
  assert.equal(parseHistorySlots([null, 42, '  ']), undefined);
  assert.equal(parseHistorySlots({}), undefined);
});

test('temporary gaps in inventory do not erase selected IDs or renumber other colors', () => {
  const saved = ['mouse', 'dual', 'keyboard'];
  const defaults = ['mouse', 'dual'];
  const partial = new Set(['dual', 'keyboard', 'xbox']);
  const slots = historyComparisonSlots(saved, defaults, partial);
  assert.deepEqual(slots, saved);
  assert.deepEqual(updateHistoryComparison(slots, 'xbox', partial), ['xbox', 'dual', 'keyboard']);
  assert.deepEqual(updateHistoryComparison(slots, 'dual', partial), ['mouse', undefined, 'keyboard']);
  assert.deepEqual(historyComparisonSlots(saved, defaults, new Set()), saved);
  assert.deepEqual(historyComparisonSlots(saved, ['xbox'], new Set(['xbox'])), ['xbox', 'dual', 'keyboard']);
  assert.deepEqual(saved, ['mouse', 'dual', 'keyboard']);
});

test('an explicit comparison does not resume the defaults for free slots', () => {
  const available = new Set(['mouse', 'dual', 'keyboard']);
  const slots = historyComparisonSlots(['mouse'], ['mouse', 'dual'], available);
  assert.deepEqual(slots, ['mouse', undefined, undefined]);
  assert.equal(updateHistoryComparison(slots, 'mouse', available), slots);
  assert.deepEqual(updateHistoryComparison(slots, 'keyboard', available), ['mouse', 'keyboard', undefined]);
});
