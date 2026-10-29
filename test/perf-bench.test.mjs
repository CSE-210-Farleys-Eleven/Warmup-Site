import test from 'node:test';
import assert from 'node:assert/strict';
import { median, summarize, timeFixture } from '../scripts/perf-bench.mjs';
import { fixtures } from '../scripts/perf-fixtures.mjs';

const fixture = name => fixtures().find(f => f.name === name);

test('median handles odd, even and empty lists without mutating them', () => {
  const values = [3, 1, 2];
  assert.equal(median(values), 2);
  assert.deepEqual(values, [3, 1, 2]);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.ok(Number.isNaN(median([])));
});

test('summarize keeps the first run as cold and takes the median of the rest', () => {
  assert.deepEqual(summarize([{ load: 9, view: 1 }, { load: 3 }, { load: 5, view: 2 }]),
    { load: { cold: 9, median: 4 }, view: { cold: 1, median: 2 } });
});

test('a loaded pair is timed for every interaction stage on every run', async () => {
  const { samples, counts, error } = await timeFixture(fixture('groups-1'), 2);
  assert.equal(error, undefined);
  assert.deepEqual(counts, [7, 7, 7]);
  assert.equal(samples.length, 3);
  for (const sample of samples) {
    assert.deepEqual(Object.keys(sample),
      ['load', 'hideGroup', 'filter', 'sortedPage', 'groupSummary', 'exportCsv']);
    assert.ok(Object.values(sample).every(ms => ms >= 0));
  }
});

test('a rejected pair reports its error and times only the load', async () => {
  const { samples, error } = await timeFixture(fixture('cols-over-limit'), 1);
  assert.match(error, /512 value columns/);
  assert.deepEqual(samples.map(Object.keys), [['load'], ['load']]);
});
