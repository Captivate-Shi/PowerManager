import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DeviceRowMotion } from '../src/device-row-motion';

test('mock rows move only for actual reordered IDs, retarget from current pixels, and respect scope/reduced motion', () => {
  let reduced = false;
  const preference = {get matches() { return reduced; }, addEventListener() {}, removeEventListener() {}};
  const restore = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia');
  Object.defineProperty(globalThis, 'matchMedia', { configurable: true, value: () => preference });
  try {
    let reads = 0;
    const calls: { id: string; from: string; to: string; canceled: boolean }[] = [];
    function row(id: string, top: number) {
      return { dataset: { deviceRow: id }, top,
        getBoundingClientRect() { reads++; return { top: this.top }; },
        animate(frames: { transform: string }[]) {
          const rec = { id, from: frames[0].transform, to: frames[1].transform, canceled: false };
          calls.push(rec);
          return { cancel: () => { rec.canceled = true; } };
        } };
    }
    const a = row('a', 155), b = row('b', 215), c = row('c', 295);
    const body = { rows: [a,b,c] };
    let props = { ids: ['a','b','c'], scope: 'all', children: null };
    const motion = new DeviceRowMotion(props);
    Object.assign(motion, { body: { current: body } });
    motion.componentDidMount();
    function change(ids: string[], scope = 'all', commit = () => {}) {
      const previous = props;
      props = { ...props, ids, scope };
      Object.assign(motion, { props });
      const snap = motion.getSnapshotBeforeUpdate(previous);
      commit();
      motion.componentDidUpdate(previous, {}, snap);
    }
    change(['a','b','c']);
    assert.equal(reads,0);
    change(['b','a','c'], 'all', () => { a.top = 235; b.top = 155; body.rows = [b,a,c]; });
    assert.deepEqual(calls.map(x=>[x.id,x.from,x.to]), [['b','translateY(60px)','translateY(0)'],['a','translateY(-80px)','translateY(0)']]);
    a.top=181; b.top=199; // positions midway through the unfinished first animation
    change(['a','b','c'], 'all', () => { a.top = 155; b.top = 215; body.rows = [a,b,c]; });
    assert.equal(calls.slice(0,2).every(x=>x.canceled),true);
    assert.deepEqual(calls.slice(2).map(x=>[x.id,x.from]), [['a','translateY(26px)'],['b','translateY(-16px)']]);
    change(['a','c'], 'online', () => { body.rows=[a,c]; });
    assert.equal(calls.length,4);
    reduced=true;
    change(['c','a'], 'online', () => { body.rows=[c,a]; });
    assert.equal(calls.length,4);
    motion.componentWillUnmount();
  } finally {
    if (restore) Object.defineProperty(globalThis, 'matchMedia', restore);
    else Reflect.deleteProperty(globalThis, 'matchMedia');
  }
});
