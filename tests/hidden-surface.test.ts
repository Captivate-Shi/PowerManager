import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HiddenSurface } from '../src/hidden-surface';

test('only explicit hide schedules destruction, and a reopen before deadline cancels it', t => {
  const { timers } = t.mock;
  timers.enable({ apis: ['setTimeout'] });
  let destroyed = 0;
  const idle = new HiddenSurface(25_000, () => true, () => { destroyed++; });
  timers.tick(30_000);
  assert.equal(destroyed, 0);
  idle.hide();
  timers.tick(24_999);
  idle.shown();
  timers.tick(30_000);
  assert.equal(destroyed, 0);
  idle.hide();
  timers.tick(24_999);
  assert.equal(destroyed, 0);
  timers.tick(1);
  assert.equal(destroyed, 1);
  timers.tick(30_000);
  assert.equal(destroyed, 1);
});

test('retirement waits for every in-flight IPC and keeps a fresh grace period to send the last reply', t => {
  const { timers } = t.mock;
  timers.enable({ apis: ['setTimeout'] });
  let destroyed = 0;
  const idle = new HiddenSurface(25_000, () => true, () => { destroyed++; });
  const reply1 = idle.hold();
  idle.hide();
  timers.tick(24_000);
  const reply2 = idle.hold();
  timers.tick(26_000);
  reply1();
  reply1();
  timers.tick(27_000);
  assert.equal(destroyed, 0);
  reply2();
  timers.tick(24_999);
  assert.equal(destroyed, 0);
  timers.tick(1);
  assert.equal(destroyed, 1);
});

test('late pin, visibility, or window replacement is rechecked when the timer expires', t => {
  const { timers } = t.mock;
  timers.enable({ apis: ['setTimeout'] });
  let canRetire = true;
  let destroyed = 0;
  const idle = new HiddenSurface(15_000, () => canRetire, () => { destroyed++; });
  idle.hide();
  timers.tick(14_000);
  canRetire = false;
  timers.tick(1000);
  assert.equal(destroyed, 0);
  idle.shown();
  canRetire = true;
  idle.hide();
  timers.tick(15_000);
  assert.equal(destroyed, 1);
});

test('explicit surface switch releases hidden renderer as soon as IPC settles', t => {
  const { timers } = t.mock;
  timers.enable({ apis: ['setTimeout'] });
  const modes: boolean[] = [];
  let destroyed = 0;
  const idle = new HiddenSurface(25_000, switching => { modes.push(switching); return true; }, () => { destroyed++; });
  const reply = idle.hold();
  idle.hide();
  idle.switchAway();
  timers.tick(1000);
  assert.equal(destroyed, 0);
  reply();
  assert.equal(destroyed, 0, 'the handler must return before destruction');
  timers.tick(1);
  assert.deepEqual(modes, [true]);
  assert.equal(destroyed, 1);
});

test('a rapid reversal to an outgoing window cancels switch retirement', t => {
  const { timers } = t.mock;
  timers.enable({ apis: ['setTimeout'] });
  let destroyed = 0;
  const idle = new HiddenSurface(15_000, () => true, () => { destroyed++; });
  const reply = idle.hold();
  idle.switchAway();
  idle.shown();
  reply();
  timers.tick(20_000);
  assert.equal(destroyed, 0);
});
