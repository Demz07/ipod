const test = require('node:test');
const assert = require('node:assert/strict');
const { nextIndex, previousIndex, randomOtherIndex } = require('../playback-queue.js');

const base = { length: 3, order: 'in-order', repeat: 'off', auto: true };

test('in order: advances, stops at the end, or wraps with Loop All / manual next', () => {
  assert.equal(nextIndex({ ...base, current: 0 }), 1);
  assert.equal(nextIndex({ ...base, current: 2 }), -1);
  assert.equal(nextIndex({ ...base, current: 2, repeat: 'all' }), 0);
  assert.equal(nextIndex({ ...base, current: 2, auto: false }), 0);
  assert.equal(nextIndex({ ...base, current: -1 }), 0);
  assert.equal(nextIndex({ ...base, length: 0, current: -1 }), -1);
});

test('Loop 1 repeats only when the song ends on its own', () => {
  assert.equal(nextIndex({ ...base, current: 1, repeat: 'one' }), 1);
  assert.equal(nextIndex({ ...base, current: 1, repeat: 'one', auto: false }), 2);
});

test('shuffle uses the prefetched pick and never repeats the current song', () => {
  const s = { ...base, order: 'shuffle', current: 1 };
  assert.equal(nextIndex({ ...s, upcoming: 2 }), 2);
  assert.notEqual(nextIndex({ ...s, upcoming: 1, random: () => 0.5 }), 1);
  assert.notEqual(nextIndex({ ...s, upcoming: 9, random: () => 0.99 }), 1);
  for (let i = 0; i < 50; i++) assert.notEqual(nextIndex({ ...s, random: Math.random }), 1);
  assert.equal(nextIndex({ ...s, length: 1, current: 0 }), -1);
  assert.equal(nextIndex({ ...s, length: 1, current: 0, repeat: 'all' }), 0);
});

test('randomOtherIndex is uniform over the other songs', () => {
  const seen = new Set();
  for (let k = 0; k < 4; k++) seen.add(randomOtherIndex(5, 2, () => k / 4));
  assert.deepEqual([...seen].sort(), [0, 1, 3, 4]);
});

test('previous wraps around', () => {
  assert.equal(previousIndex({ length: 3, current: 0 }), 2);
  assert.equal(previousIndex({ length: 3, current: 2 }), 1);
  assert.equal(previousIndex({ length: 0, current: -1 }), -1);
});
