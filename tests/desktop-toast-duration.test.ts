import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultDesktopToastSeconds, desktopToastDurations, defaults } from '../src/model';
import { loadSettings, patchSettings } from '../src/settings-validation';

test('desktop popup duration preserves legacy 12 s and reloads every supported choice including 0', () => {
  assert.equal(defaultDesktopToastSeconds, 12);
  assert.equal(loadSettings({}).desktopToastSeconds, 12);
  for (const value of desktopToastDurations) {
    const patched = patchSettings(defaults, { desktopToastSeconds: value });
    assert.equal(patched.desktopToastSeconds, value);
    assert.equal(loadSettings(JSON.parse(JSON.stringify(patched))).desktopToastSeconds, value);
    assert.equal(patched.desktopToasts, defaults.desktopToasts);
    assert.equal(patched.fullscreenSound, defaults.fullscreenSound);
    assert.equal(patched.desktopSound, defaults.desktopSound);
  }
});
test('desktop popup duration rejects invalid IPC values and repairs corrupt stored values', () => {
  for (const value of [null, -1, 1, 5.2, 600, '0', false]) {
    assert.throws(() => patchSettings(defaults, { desktopToastSeconds: value }), /弹窗显示时长无效/);
    assert.equal(loadSettings({ desktopToastSeconds: value }).desktopToastSeconds, 12);
  }
});
