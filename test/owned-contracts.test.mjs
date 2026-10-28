import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlotData } from '../src/data.js';
import { createModel, extent, generatedPair, sample } from '../src/model.js';
import { exportFileName } from '../src/export-name.js';

test('documented sampling and extent examples preserve identity and empty bounds', () => {
  const small = [0, 1];
  assert.equal(sample(small, 3), small);
  assert.deepEqual(sample([], 3), []);
  assert.deepEqual(sample([0, 1, 2, 3, 4], 3), [0, 2, 4]);
  assert.deepEqual(extent([], 'x'), { linear: [], log: [] });
  assert.deepEqual(extent([{ x: -1, y: 2 }, { x: 3, y: 4 }], 'x'), {
    linear: [-1, 3], log: [3, 3],
  });
});

test('a cleaned empty model has zero counts and one recoverable empty page', () => {
  const empty = { valueHeader: 'A', series: [], warnings: [] };
  const model = createModel(empty, empty);
  const view = model.view();
  assert.deepEqual(view.counts, [0, 0, 0]);
  assert.equal(view.fit.n, 0);
  assert.ok(Number.isNaN(view.fit.r));
  assert.ok(view.stats.every(stats => stats.n === 0 && Number.isNaN(stats.mean)));
  const page = model.page({ source: 2, page: 100, size: 7 });
  assert.deepEqual(page.rows, []);
  assert.equal(page.page, 0);
  assert.equal(page.pages, 1);
  assert.equal(page.size, 50);
});

test('documented pairing handles reordered columns and independent chart exclusions', () => {
  const a = buildPlotData('A,Mon,Tue\nAna,1,3\nJay,5,7');
  const b = buildPlotData('B,Tue,Mon\nana,30,10\njay,70,50');
  const model = createModel(a, b);
  assert.deepEqual(model.view().counts, [4, 4, 4]);
  assert.deepEqual(model.table({ source: 2 }).rows, [
    ['Ana', 'Mon', 10, 1], ['Ana', 'Tue', 30, 3],
    ['Jay', 'Mon', 50, 5], ['Jay', 'Tue', 70, 7],
  ]);
  assert.deepEqual(model.view({ hiddenBySource: [['Ana'], [], []] }).counts, [2, 4, 4]);
  assert.equal(model.page({ source: 0, excludedGroups: ['Ana'] }).total, 2);
});

test('documented export filenames and header-only generated pairs match actual output', () => {
  assert.equal(exportFileName(
    { labels: ['Steps', 'Sleep'], fingerprint: 'abc123' },
    { source: 2, mode: 'detail' }, 35,
  ), 'steps_vs_sleep__pairs-obs__35r__abc123.csv');
  assert.deepEqual(generatedPair(0), [
    'Daily steps,Mon,Tue,Wed,Thu,Fri,Sat,Sun',
    'Sleep (hours),Mon,Tue,Wed,Thu,Fri,Sat,Sun',
  ]);
});
