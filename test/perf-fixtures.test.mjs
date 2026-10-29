import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS } from '../src/model.js';
import { csv, fixtures, measure } from '../scripts/perf-fixtures.mjs';

// The fixtures are only useful if each boundary pair trips exactly the budget it is
// named after, so these checks measure the generated text rather than the specs.
const all = fixtures().map(f => ({ ...f, a: measure(csv(f.a)), b: measure(csv(f.b)) }));
const byName = Object.fromEntries(all.map(f => [f.name, f]));

/** Budgets a measured pair exceeds, in LIMITS key order. */
function exceeded({ a, b }) {
  return [
    a.bytes > LIMITS.fileBytes || b.bytes > LIMITS.fileBytes ? 'bytes' : null,
    a.records > LIMITS.rows || b.records > LIMITS.rows ? 'rows' : null,
    a.columns > LIMITS.columns || b.columns > LIMITS.columns ? 'cols' : null,
    a.cells + b.cells > LIMITS.cells ? 'cells' : null,
  ].filter(Boolean);
}

test('pairs meant to load stay within every budget; rejected pairs exceed only their own', () => {
  for (const f of all) {
    const expected = f.expect === 'load' ? [] : [f.name.split('-')[0]];
    assert.deepEqual(exceeded(f), expected, f.name);
  }
});

test('boundary pairs sit exactly at each limit or one unit over it', () => {
  const at = (name, value) => assert.equal(value, 0, `${name} is ${value} away from its limit`);
  for (const suffix of ['', '-no-final-newline', '-trailing-blanks']) {
    at(`rows-at-limit${suffix}`, byName[`rows-at-limit${suffix}`].a.records - LIMITS.rows);
  }
  assert.equal(byName['rows-over-limit'].a.records, LIMITS.rows + 1);
  at('cols-at-limit', byName['cols-at-limit'].a.columns - LIMITS.columns);
  assert.equal(byName['cols-over-limit'].a.columns, LIMITS.columns + 1);
  const cells = name => byName[name].a.cells + byName[name].b.cells;
  at('cells-at-limit', cells('cells-at-limit') - LIMITS.cells);
  assert.equal(cells('cells-over-limit'), LIMITS.cells + 1);
  assert.equal(cells('cells-one-file-over'), LIMITS.cells + 1);
  assert.ok(byName['cells-over-limit'].a.cells <= LIMITS.cells / 2);
  assert.ok(byName['cells-over-limit'].b.cells <= LIMITS.cells / 2 + 1);
  const { a, b } = byName['bytes-at-limit'];
  assert.deepEqual([a.bytes, b.bytes], [LIMITS.fileBytes, LIMITS.fileBytes]);
  assert.equal(byName['bytes-over-limit'].a.bytes, LIMITS.fileBytes + 1);
});

test('the row-limit variants differ only in how the file ends', () => {
  const [plain, noNewline, blanks] = ['', '-no-final-newline', '-trailing-blanks']
    .map(suffix => csv(fixtures().find(f => f.name === `rows-at-limit${suffix}`).a));
  // assert.ok, not assert.equal: a failing equal would print megabytes of CSV.
  assert.ok(plain.endsWith('\n') && !plain.endsWith('\n\n'));
  assert.ok(noNewline === plain.slice(0, -1), 'no-final-newline differs beyond the newline');
  assert.ok(blanks === plain + '\n\n\n', 'trailing-blanks differs beyond the blank lines');
});

test('the outlier pair is the cell-limit pair with one planted value', () => {
  const spec = name => fixtures().find(f => f.name === name).a;
  const [base, outlier] = ['cells-at-limit', 'outlier-at-cells-limit']
    .map(name => csv(spec(name)).split('\n'));
  const changed = base.filter((line, i) => line !== outlier[i]);
  assert.equal(changed.length, 1);
});

test('display-rule pairs straddle the drawing cap and the individual-group limit', () => {
  const pairs = n => byName[`pairs-${n}`].a.cells;
  assert.deepEqual([LIMITS.drawn - 1, LIMITS.drawn, LIMITS.drawn + 1].map(pairs),
    [LIMITS.drawn - 1, LIMITS.drawn, LIMITS.drawn + 1]);
  const groups = n => byName[`groups-${n}`].a.records;
  assert.equal(groups(LIMITS.individualGroups + 1), LIMITS.individualGroups + 1);
});

test('fixtures are deterministic, so timings compare run to run', () => {
  const spec = fixtures().find(f => f.name === 'dirty').a;
  assert.equal(csv(spec), csv(spec));
  assert.throws(() => csv({ ...spec, bytes: 10 }), /bytes before padding/);
});
