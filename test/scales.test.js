import test from 'node:test';
import assert from 'node:assert/strict';
import { makeScale, logTicks, formatLogTick, paddedExtent, isPlottable, toT, fromT, niceTicks, categoryLabelStep } from '../src/scales.js';
import { computeStats, setStatsProvider } from '../src/stats.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('linear scale maps and inverts', () => {
  const s = makeScale('linear', [0, 10], [100, 200]);
  assert.equal(s.map(5), 150);
  assert.equal(s.invert(150), 5);
  assert.equal(s.invertT(150), 5);
});

test('log scale maps decades evenly and round-trips', () => {
  const s = makeScale('log', [0, 3], [0, 300]); // 1 .. 1000
  close(s.map(1), 0);
  close(s.map(10), 100);
  close(s.map(1000), 300);
  close(s.invert(200), 100);
  close(s.invertT(200), 2);
});

test('log transform rejects non-positive values', () => {
  assert.ok(Number.isNaN(toT('log', 0)));
  assert.ok(Number.isNaN(toT('log', -3)));
  assert.equal(isPlottable('log', 0), false);
  assert.equal(isPlottable('log', 0.5), true);
  assert.equal(isPlottable('linear', 0), true);
  assert.equal(isPlottable('linear', NaN), false);
  close(fromT('log', toT('log', 42)), 42);
});

test('paddedExtent ignores values a log axis cannot show', () => {
  const [lo, hi] = paddedExtent('log', [0, -5, 10, 1000]);
  assert.ok(lo < 1 && hi > 3 && hi < 3.5); // t-space: log10(10)=1 .. log10(1000)=3, padded
  assert.deepEqual(paddedExtent('log', [0, -1]), [0, 1]);
});

test('logTicks gives powers of ten over many decades', () => {
  assert.deepEqual(logTicks(0, 4), [1, 10, 100, 1000, 10000]);
});

test('logTicks adds 2 and 5 over a couple of decades', () => {
  assert.deepEqual(logTicks(0, 2), [1, 2, 5, 10, 20, 50, 100]);
});

test('logTicks stays within a fractional range and handles sub-1 values', () => {
  const t = logTicks(-2.2, -0.8);
  assert.ok(t.length > 0 && t.every((v) => Math.log10(v) >= -2.2 && Math.log10(v) <= -0.8));
  assert.ok(logTicks(-6, 6, 8).length <= 8);
});

test('logTicks thins out ticks when less than a decade is visible and 1-9 would crowd', () => {
  // About 1,600 to 15,000 (the steps-vs-sleep Y axis): 2k..9k plus 10k is 9 ticks, too many for 7.
  const ticks = logTicks(Math.log10(1600), Math.log10(15000), 7);
  assert.deepEqual(ticks, [2000, 5000, 10000]);
});

test('logTicks keeps every multiple 1-9 when they fit', () => {
  const ticks = logTicks(Math.log10(1.5), Math.log10(6.5), 8);
  assert.deepEqual(ticks, [2, 3, 4, 5, 6]);
});

test('logTicks never exceeds maxTicks and always returns something over a sub-decade range', () => {
  for (const max of [3, 4, 5, 7, 8]) {
    for (const lo of [-3.3, -0.4, 0.15, 2.7, 5.9]) {
      const ticks = logTicks(lo, lo + 0.9, max);
      assert.ok(ticks.length <= max, `${lo} max ${max}: ${ticks}`);
    }
  }
  assert.ok(logTicks(0.1, 0.9, 7).length >= 2);
});

test('formatLogTick', () => {
  assert.equal(formatLogTick(1), '1');
  assert.equal(formatLogTick(1e6), '1e6');
  assert.equal(formatLogTick(2e-5), '2e-5');
});

test('niceTicks still behaves', () => {
  assert.deepEqual(niceTicks(0, 10, 5).ticks, [0, 2, 4, 6, 8, 10]);
});

test('niceTicks returns no ticks for an empty or reversed range instead of hanging', () => {
  assert.deepEqual(niceTicks(3, 3, 5).ticks, []);
  assert.ok(Number.isNaN(niceTicks(3, 3, 5).step));
  assert.deepEqual(niceTicks(5, 0, 5).ticks, []);
  assert.deepEqual(niceTicks(NaN, 5, 5).ticks, []);
});

test('stats provider can be swapped and restored', () => {
  const pts = [{ x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 6 }];
  const builtin = computeStats(pts);
  close(builtin.slope, 2);
  close(builtin.r, 1);
  assert.equal(builtin.n, 3);

  setStatsProvider(() => ({ n: 9, r: 0.5, slope: 1, intercept: 0, p_value: 0.01 }));
  assert.equal(computeStats(pts).n, 9);
  setStatsProvider();
  assert.equal(computeStats(pts).n, 3);
});

test('categoryLabelStep keeps every label when they fit', () => {
  assert.equal(categoryLabelStep(100, 60), 1);
});

test('categoryLabelStep skips labels that would overlap', () => {
  // 7 weekdays on a phone: ~30px per day, "Wednesday" ~66px wide
  assert.equal(categoryLabelStep(30, 66), 3);
  assert.equal(categoryLabelStep(50, 42, 10), 2);
});

test('categoryLabelStep shows every label for a degenerate axis', () => {
  assert.equal(categoryLabelStep(0, 66), 1);
  assert.equal(categoryLabelStep(NaN, 66), 1);
});
