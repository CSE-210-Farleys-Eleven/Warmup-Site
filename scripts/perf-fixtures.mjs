// Seeded CSV fixtures for performance and input-limit testing: `npm run perf:gen`.
// Writes file pairs (a = steps, b = sleep) to data/stress/limits/, which is
// gitignored because the largest files are 5 MiB each, plus a manifest.json that
// records each pair's measured size and whether the app should load or reject it.
//
// Sizes come from LIMITS in src/model.js, so every budget is tested at the limit
// and one unit over it, and the fixtures follow the limits if they change.
// Output is deterministic (seeded RNG), so timings are comparable run to run.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import Papa from '../src/vendor/papa.js';
import { LIMITS } from '../src/model.js';

const OUT = new URL('../data/stress/limits/', import.meta.url);

/**
 * How to write one CSV file in the app's wide shape: a header row of
 * `valueHeader, Day 1, Day 2, ...`, then one record per group.
 * @typedef {Object} CsvSpec
 * @property {string} valueHeader      Top-left header naming the measurement.
 * @property {'steps' | 'sleep' | 'constant' | 'extreme'} values  How cells are filled.
 * @property {number} rows             Data records, before any trailing blank lines.
 * @property {number} cols             Value columns after the group-name column.
 * @property {number} seed             RNG seed; the same spec always gives the same text.
 * @property {number} [blank]          Fraction of value cells left empty, [0, 1); default 0.
 * @property {number} [dirty]          Fraction of records given a non-numeric cell, a
 *   re-cased duplicate name or a quoted name with a comma and line break; default 0.
 * @property {number} [nameLength]     Minimum group-name length in characters; default none.
 * @property {number} [headerLength]   Minimum category-header length in characters.
 * @property {number} [bytes]          Exact file size in bytes, reached by padding the
 *   last group name. Throws if the unpadded file is already larger.
 * @property {boolean} [finalNewline]  End the last record with a newline; default true.
 * @property {number} [trailingBlankLines]  Empty lines after the last record; default 0.
 * @property {{row: number, col: number, value: string}} [plant]  One cell to overwrite
 *   (0-based data record and value column).
 */

/**
 * One fixture pair and what the app is expected to do with it.
 * @typedef {Object} Fixture
 * @property {string} name      File stem: files are `<name>-a.csv` and `<name>-b.csv`.
 * @property {string} purpose   What the pair checks, in one line.
 * @property {'load' | 'reject'} expect  Behavior the README's limits promise.
 * @property {string} [reason]  Regex source for the expected rejection message.
 * @property {CsvSpec} a        First file (steps).
 * @property {CsvSpec} b        Second file (sleep).
 */

const REJECT = {
  rows: `exceeds ${LIMITS.rows.toLocaleString('en-US')} CSV records`,
  columns: `more than ${LIMITS.columns} value columns`,
  cells: `combined ${LIMITS.cells.toLocaleString('en-US')}-cell limit`,
  bytes: '5 MiB per-file limit',
};

const EXTREME_VALUES = ['-1e300', '1e300', '-5', '0', '1e-300', '42'];

/** mulberry32: small seeded PRNG, so fixtures are identical on every run. */
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** @param {string} text @param {number} length Pad with 'x' up to this many characters. */
const padTo = (text, length = 0) =>
  text.length >= length ? text : `${text} ${'x'.repeat(length - text.length - 1)}`;

/**
 * Write one fixture CSV. Every character is ASCII, so the string's length is its
 * size in bytes. Throws when `bytes` is smaller than the unpadded file.
 * @param {CsvSpec} spec
 * @returns {string}
 * @example
 * csv({ valueHeader: 'Steps', values: 'constant', rows: 2, cols: 2, seed: 1 })
 * // => 'Steps,Day 1,Day 2\nPerson 00001,7,7\nPerson 00002,7,7\n'
 */
export function csv(spec) {
  const { valueHeader, values, rows, cols, seed, blank = 0, dirty = 0 } = spec;
  const r = rng(seed);
  const value = {
    steps: () => String(Math.round(2000 + r() * 12000)),
    sleep: () => (4 + r() * 6).toFixed(1),
    constant: () => '7',
    extreme: () => EXTREME_VALUES[Math.floor(r() * EXTREME_VALUES.length)],
  }[values];
  const headers = Array.from({ length: cols }, (_, i) => padTo(`Day ${i + 1}`, spec.headerLength));
  const names = Array.from({ length: rows }, (_, p) =>
    padTo(`Person ${String(p + 1).padStart(5, '0')}`, spec.nameLength));
  const lines = [[valueHeader, ...headers].join(',')];
  for (let p = 0; p < rows; p++) {
    let name = names[p];
    const cells = Array.from({ length: cols }, () => (r() < blank ? '' : value()));
    if (r() < dirty) {
      // Cycle through the three kinds of mess the parser is meant to warn about.
      if (p % 3 === 0) cells[0] = 'n/a';
      else if (p % 3 === 1 && p > 0) name = names[p - 1].toUpperCase();
      else name = `"Doe, Jo\nJr ${p}"`;
    }
    if (spec.plant?.row === p) cells[spec.plant.col] = spec.plant.value;
    lines.push([name, ...cells].join(','));
  }
  const ending = ((spec.finalNewline ?? true) ? '\n' : '') +
    '\n'.repeat(spec.trailingBlankLines ?? 0);
  let text = lines.join('\n') + ending;
  if (spec.bytes !== undefined) {
    const missing = spec.bytes - text.length;
    if (missing < 0) throw new Error(`${valueHeader}: ${text.length} bytes before padding`);
    // The last record starts with its group name, so padding it keeps the file's shape.
    const last = text.lastIndexOf('\nPerson ') + 1;
    const nameEnd = text.indexOf(',', last);
    text = text.slice(0, nameEnd) + 'x'.repeat(missing) + text.slice(nameEnd);
  }
  return text;
}

/**
 * Pick a shape holding exactly `cells` value cells within the row and column
 * limits, using the fewest columns from 7 (the class data's width) upwards.
 * Throws when no such shape exists.
 * @param {number} cells
 * @returns {{rows: number, cols: number}}
 * @example
 * shapeFor(125000)  // => {rows: 15625, cols: 8}
 */
export function shapeFor(cells) {
  for (let cols = 7; cols <= LIMITS.columns; cols++) {
    if (cells % cols === 0 && cells / cols <= LIMITS.rows) return { rows: cells / cols, cols };
  }
  throw new Error(`No shape within the limits holds exactly ${cells} cells`);
}

/**
 * A steps/sleep pair with the same shape, names and headers, so the scatter
 * plot has a match for every cell. `extra` applies to both files; `a` and `b`
 * apply to one file only. The seed comes from the shape, so pairs of one shape
 * hold the same values and differ only in the option they test.
 * @param {string} name @param {string} purpose
 * @param {{rows: number, cols: number}} shape
 * @param {{expect?: 'load' | 'reject', reason?: string, extra?: Partial<CsvSpec>,
 *   a?: Partial<CsvSpec>, b?: Partial<CsvSpec>}} [options]
 * @returns {Fixture}
 */
function pair(name, purpose, shape, options = {}) {
  const { expect = 'load', reason, extra = {} } = options;
  const seed = shape.rows * (LIMITS.columns + 1) + shape.cols;
  return {
    name, purpose, expect, ...(reason ? { reason } : {}),
    a: { valueHeader: 'Step Count', values: 'steps', ...shape, seed, ...extra, ...options.a },
    b: { valueHeader: 'Hours of Sleep', values: 'sleep', ...shape, seed: seed + 1, ...extra,
      ...options.b },
  };
}

/**
 * Every fixture pair, grouped by the budget or display rule it exercises.
 * Pure: builds specs only, writes nothing.
 * @returns {Fixture[]}
 */
export function fixtures() {
  // Widest shape whose limit + 1 rows still fit the cell budget in both files, so
  // the row limit, not the cell limit, is what rejects the over-limit pair.
  const rowCols = Math.floor(LIMITS.cells / (2 * (LIMITS.rows + 1)));
  const half = shapeFor(LIMITS.cells / 2);
  const bytesShape = { rows: 1000, cols: 2 };
  const bytesName = Math.floor(LIMITS.fileBytes / bytesShape.rows) - 32;
  return [
    ...[100, 1000, 5000, 10000].map(rows =>
      pair(`rows-${rows}`, `Scaling: ${rows} groups x ${rowCols} days`, { rows, cols: rowCols })),
    pair('rows-at-limit', 'Row limit: exactly the maximum records per file',
      { rows: LIMITS.rows, cols: rowCols }),
    pair('rows-at-limit-no-final-newline', 'Row limit, with no newline after the last record',
      { rows: LIMITS.rows, cols: rowCols }, { extra: { finalNewline: false } }),
    pair('rows-at-limit-trailing-blanks', 'Row limit, followed by three blank lines',
      { rows: LIMITS.rows, cols: rowCols }, { extra: { trailingBlankLines: 3 } }),
    pair('rows-over-limit', 'Row limit: one record too many',
      { rows: LIMITS.rows + 1, cols: rowCols }, { expect: 'reject', reason: REJECT.rows }),

    ...[7, 50, 200].map(cols =>
      pair(`cols-${cols}`, `Scaling: ${cols} categories on the x-axis`, { rows: 10, cols })),
    pair('cols-at-limit', 'Column limit: exactly the maximum value columns',
      { rows: 10, cols: LIMITS.columns }),
    pair('cols-over-limit', 'Column limit: one value column too many',
      { rows: 10, cols: LIMITS.columns + 1 }, { expect: 'reject', reason: REJECT.columns }),

    pair('cells-at-limit', 'Cell limit: both files together hold exactly the maximum', half),
    pair('cells-over-limit', 'Cell limit: each file under, both together one cell over', half,
      { expect: 'reject', reason: REJECT.cells, b: shapeFor(LIMITS.cells / 2 + 1) }),
    pair('cells-one-file-over', 'Cell limit: the first file alone uses the whole budget',
      shapeFor(LIMITS.cells), { expect: 'reject', reason: REJECT.cells, b: { rows: 1, cols: 1 } }),

    pair('bytes-at-limit', 'Byte limit: both files exactly 5 MiB (long group names)', bytesShape,
      { extra: { nameLength: bytesName, bytes: LIMITS.fileBytes } }),
    pair('bytes-over-limit', 'Byte limit: the first file one byte over', bytesShape,
      { expect: 'reject', reason: REJECT.bytes,
        extra: { nameLength: bytesName, bytes: LIMITS.fileBytes },
        a: { bytes: LIMITS.fileBytes + 1 } }),

    ...[1, LIMITS.individualGroups, LIMITS.individualGroups + 1].map(rows =>
      pair(`groups-${rows}`, `Line display: ${rows} groups (means above ` +
        `${LIMITS.individualGroups})`, { rows, cols: 7 })),

    ...[LIMITS.drawn - 1, LIMITS.drawn, LIMITS.drawn + 1].map(rows =>
      pair(`pairs-${rows}`, `Scatter: ${rows} matched pairs (sampling above ${LIMITS.drawn})`,
        { rows, cols: 1 })),
    pair('outlier-at-cells-limit', 'Scatter sampling: one extreme step count in the middle row',
      half, { a: { plant: { row: Math.floor(half.rows / 2), col: 0, value: '1000000' } } }),

    pair('sparse', 'Warnings: 30% of cells blank', { rows: 10000, cols: rowCols },
      { extra: { blank: 0.3 } }),
    pair('dirty', 'Warnings: non-numeric cells, duplicate names, quoted line breaks',
      { rows: 2000, cols: 7 }, { extra: { dirty: 0.15 } }),

    pair('long-names', 'Layout: 2,000-character group names', { rows: 200, cols: 7 },
      { extra: { nameLength: 2000 } }),
    pair('long-headers', 'Layout: 500-character category headers', { rows: 20, cols: 30 },
      { extra: { headerLength: 500 } }),
    pair('constant', 'Scales: every value identical', { rows: 1000, cols: 7 },
      { extra: { values: 'constant' } }),
    pair('extreme', 'Scales: values from -1e300 to 1e300, zeros and negatives on a log axis',
      { rows: 1000, cols: 7 }, { extra: { values: 'extreme' } }),
  ];
}

/**
 * Measure a CSV as the app's limits see it: data records (blank lines skipped),
 * value columns, value cells and bytes. Parses with the app's own Papa Parse.
 * @param {string} text
 * @returns {{records: number, columns: number, cells: number, bytes: number}}
 * @example
 * measure('Steps,Mon\nAna,1\n\n')  // => {records: 1, columns: 1, cells: 1, bytes: 17}
 */
export function measure(text) {
  const { data } = Papa.parse(text, { delimiter: ',', skipEmptyLines: true });
  const records = data.slice(1);
  return {
    records: records.length,
    columns: data[0].length - 1,
    cells: records.reduce((sum, fields) => sum + fields.length - 1, 0),
    bytes: Buffer.byteLength(text),
  };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const manifest = [];
  for (const fixture of fixtures()) {
    const [a, b] = [csv(fixture.a), csv(fixture.b)];
    await writeFile(new URL(`${fixture.name}-a.csv`, OUT), a);
    await writeFile(new URL(`${fixture.name}-b.csv`, OUT), b);
    const sizes = { a: measure(a), b: measure(b) };
    const { name, purpose, expect, reason } = fixture;
    manifest.push({ name, purpose, expect, reason, files: [`${name}-a.csv`, `${name}-b.csv`],
      ...sizes });
    const mb = ((sizes.a.bytes + sizes.b.bytes) / 1e6).toFixed(2);
    console.log(`${fixture.name.padEnd(32)} ${fixture.expect.padEnd(6)} ` +
      `${String(sizes.a.cells + sizes.b.cells).padStart(7)} cells  ${mb} MB`);
  }
  const json = JSON.stringify({ limits: LIMITS, manifest }, null, 2);
  await writeFile(new URL('manifest.json', OUT), json);
  console.log(`${manifest.length} pairs written to ${fileURLToPath(OUT)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
