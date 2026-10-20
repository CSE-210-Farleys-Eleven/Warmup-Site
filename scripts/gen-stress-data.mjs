// Stress-test fixtures: `npm run stress:gen`.
// Writes CSVs in the same wide shape the app reads (value header, then one
// row per person, one column per X), at several sizes and shapes, into
// data/stress/ (gitignored: the largest files are several MB each).
//
// Each fixture comes as a pair (a, b) with the same names and headers, so the
// scatter plot's pairing step has real matches to work on.
//
// Output is deterministic (seeded RNG), so timings are comparable run to run.
import { mkdir, writeFile } from 'node:fs/promises';

/** Total cells (people × columns) per fixture. 150k sits just past the
 * ~124k-argument limit on Math.min(...xs) seen in Chromium 152. */
export const SIZES = [1_000, 10_000, 100_000, 150_000, 500_000, 1_000_000];

/**
 * tall:   many people, 7 columns (the class data's shape, scaled up)
 * wide:   10 people, many columns (a long time series)
 * sparse: tall, with 30% of cells left blank (exercises the warning paths)
 */
export const SHAPES = {
  tall: (cells) => ({ rows: Math.ceil(cells / 7), cols: 7, blank: 0 }),
  wide: (cells) => ({ rows: 10, cols: Math.ceil(cells / 10), blank: 0 }),
  sparse: (cells) => ({ rows: Math.ceil(cells / 7), cols: 7, blank: 0.3 }),
};

const OUT = new URL('../data/stress/', import.meta.url);

/** mulberry32: small seeded PRNG so fixtures are identical on every run. */
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {string} valueHeader
 * @param {{rows: number, cols: number, blank: number}} shape
 * @param {(r: () => number) => string} value
 * @param {number} seed
 */
function csv(valueHeader, { rows, cols, blank }, value, seed) {
  const r = rng(seed);
  const headers = Array.from({ length: cols }, (_, i) => `Day ${i + 1}`);
  const lines = [[valueHeader, ...headers].join(',')];
  for (let p = 0; p < rows; p++) {
    const cells = [`Person ${p + 1}`];
    for (let c = 0; c < cols; c++) cells.push(r() < blank ? '' : value(r));
    lines.push(cells.join(','));
  }
  return lines.join('\n') + '\n';
}

/** @param {number} cells */
export const fixtureName = (shape, cells) => `${shape}-${cells}`;

async function main() {
  await mkdir(OUT, { recursive: true });
  for (const [shape, dims] of Object.entries(SHAPES)) {
    for (const cells of SIZES) {
      const d = dims(cells);
      const name = fixtureName(shape, cells);
      const a = csv('Step Count', d, (r) => String(Math.round(2000 + r() * 12000)), cells);
      const b = csv('Hours of Sleep', d, (r) => (4 + r() * 6).toFixed(1), cells + 1);
      await writeFile(new URL(`${name}-a.csv`, OUT), a);
      await writeFile(new URL(`${name}-b.csv`, OUT), b);
      console.log(`${name.padEnd(16)} ${d.rows} rows × ${d.cols} cols  ` +
        `${(a.length / 1e6).toFixed(2)} MB + ${(b.length / 1e6).toFixed(2)} MB`);
    }
  }
}

if (import.meta.main) await main();
