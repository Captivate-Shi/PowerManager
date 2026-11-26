import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canReuseStageEntry, stageLanding, stageReleaseLead, stageTravel, stageVelocity } from '../src/stage-gesture';

test('stage drag is one-to-one before the soft limit and never hits a hard stop', () => {
  assert.equal(stageTravel(100, 700), 100);
  assert.equal(stageTravel(-100, 700), -100);
  const values = [210, 245, 300, 400].map(dx => stageTravel(dx, 700));
  assert.deepEqual(values, [...values].sort((a, b) => a - b));
  assert(new Set(values).size === values.length);
  assert(values.at(-1)! < 262);
});

test('release velocity distinguishes short flicks from slow pulls and honors direction', () => {
  assert.equal(stageLanding(-30, 700, 0), 0);
  assert.equal(stageLanding(-30, 700, -530), 1);
  assert.equal(stageLanding(30, 700, 530), -1);
  assert.equal(stageLanding(-65, 700, 350), 0);
  assert.equal(stageLanding(-30, 700, 1300), 0);
  assert.equal(stageLanding(30, 700, -1300), 0);
  assert.equal(stageLanding(-130, 700, 1300), 1);
  assert.equal(stageLanding(130, 700, -1300), -1);
  assert.equal(stageVelocity([{ x: 0, at: 1 }, { x: 4, at: 200 }, { x: 24, at: 240 }]), 500);
  assert.equal(stageVelocity([{ x: 0, at: 1 }, { x: 100, at: 200 }]), 0);
});

test('quick wrap restarts an entry from the correct side and never leads the exit backwards', () => {
  assert.equal(canReuseStageEntry(-95, 1), false);
  assert.equal(canReuseStageEntry(-95, -1), true);
  assert.equal(canReuseStageEntry(95, 1), true);
  assert.equal(canReuseStageEntry(95, -1), false);
  assert.equal(canReuseStageEntry(0, 1), false);
  assert.equal(Math.abs(stageReleaseLead(1300, 1)), 0);
  assert.equal(stageReleaseLead(-2500, 1), -34);
  assert.equal(stageReleaseLead(2500, -1), 34);
});
