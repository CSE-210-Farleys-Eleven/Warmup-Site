// Node stress benchmark for the pure (no-DOM) pipeline: `npm run stress`.
// Run `npm run stress:gen` first to create the fixtures in data/stress/.
//
// For each fixture, a child process times every stage from CSV text to the
// numbers the charts need, and reports the median of RUNS runs. A stage that
// throws is recorded as FAIL (with the error), and stages that need its output
// are skipped; the run carries on with the next fixture.
//
// Not covered here: anything in chart.js / the renderers (scene building,
// hover, zoom, painting). Those need a DOM and are measured in the browser.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildPlotData } from '../src/data.js';
import { paddedExtent } from '../src/scales.js';
import { computeStats, groupStats, pointsFromSeries } from '../src/stats.js';
import { SHAPES, SIZES, fixtureName } from './gen-stress-data.mjs';

const RUNS = 3;
const CHILD_TIMEOUT_MS = 180_000;
const DIR = new URL('../data/stress/', import.meta.url);

/**
 * Mirror of toScatterInput in src/main.js (lines 45-63), which can't be
 * imported here because main.js touches the DOM on load. Keep in step.
 * @param {ReturnType<typeof buildPlotData>} a
 * @param {ReturnType<typeof buildPlotData>} b
 */
function pairLikeMain(a, b) {
  const key = (data, group, x) => JSON.stringify([group, data.xTickLabels?.[x] ?? x]);
  const bValues = new Map();
  for (const { group, points } of b.series) {
    for (const [x, y] of points) bValues.set(key(b, group, x), y);
  }
  return a.series.flatMap(({ group, points: pts }) => pts.flatMap(([x, y]) => {
    const other = bValues.get(key(a, group, x));
    return other === undefined ? [] : [{ x: other, y, group }];
  }));
}

/**
 * Mirror of homeX in src/chart.js (lines 221-226) for charts with tick
 * labels (every line chart in the app), which spreads all x values into
 * Math.min / Math.max. Keep in step.
 * @param {{x: number}[]} points @param {Record<number, string>} labels
 */
function homeXLikeChart(points, labels) {
  const keys = Object.keys(labels).map(Number).concat(points.map((p) => p.x));
  return [Math.min(...keys) - 0.5, Math.max(...keys) + 0.5];
}

/** Stages in order; each reads earlier results from `s` and returns its own. */
const STAGES = [
  ['parse A', (s) => buildPlotData(s.textA)],
  ['parse B', (s) => buildPlotData(s.textB)],
  ['flatten', (s) => pointsFromSeries(s['parse A'].series)],
  ['groupStats/group', (s) => groupStats(s.flatten, 'group')],
  ['groupStats/x', (s) => groupStats(s.flatten, 'x', s['parse A'].xTickLabels)],
  ['line homeX', (s) => homeXLikeChart(s.flatten, s['parse A'].xTickLabels)],
  ['line extent y', (s) => paddedExtent('linear', s.flatten.map((p) => p.y))],
  ['line stats', (s) => computeStats(s.flatten)],
  ['pair', (s) => pairLikeMain(s['parse A'], s['parse B'])],
  ['scatter extent', (s) => [paddedExtent('linear', s.pair.map((p) => p.x)),
    paddedExtent('linear', s.pair.map((p) => p.y))]],
  ['scatter stats', (s) => computeStats(s.pair)],
];
/** Which earlier stage each stage needs, so a failure skips its dependents. */
const NEEDS = {
  flatten: ['parse A'], 'groupStats/group': ['flatten'], 'groupStats/x': ['flatten'],
  'line homeX': ['flatten'], 'line extent y': ['flatten'], 'line stats': ['flatten'],
  pair: ['parse A', 'parse B'], 'scatter extent': ['pair'], 'scatter stats': ['pair'],
};

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** Child: time one fixture and print a JSON result line. */
async function runOne(name) {
  const textA = await readFile(new URL(`${name}-a.csv`, DIR), 'utf8');
  const textB = await readFile(new URL(`${name}-b.csv`, DIR), 'utf8');
  const out = { name, bytes: textA.length + textB.length, stages: {} };
  const times = Object.fromEntries(STAGES.map(([k]) => [k, []]));

  for (let run = 0; run < RUNS; run++) {
    const s = { textA, textB };
    for (const [stage, fn] of STAGES) {
      if (out.stages[stage]?.status === 'FAIL') continue;
      const missing = (NEEDS[stage] ?? []).filter((d) => !(d in s));
      if (missing.length) { out.stages[stage] = { status: 'SKIP', reason: `needs ${missing}` }; continue; }
      const t = performance.now();
      try {
        s[stage] = fn(s);
        times[stage].push(performance.now() - t);
      } catch (e) {
        out.stages[stage] = { status: 'FAIL', error: `${e.constructor.name}: ${e.message}` };
      }
    }
    if (run === 0) {
      out.points = s.flatten?.length ?? null;
      out.pairs = s.pair?.length ?? null;
      out.warnings = s['parse A']?.warnings.length ?? null;
    }
  }
  for (const [stage, ts] of Object.entries(times)) {
    if (ts.length === RUNS) out.stages[stage] = { status: 'ok', ms: median(ts) };
  }
  out.maxRssMB = Math.round(process.resourceUsage().maxRSS / 1024);
  console.log(JSON.stringify(out));
}

/** Parent: run every fixture in its own process and print a table. */
async function runAll() {
  const self = fileURLToPath(import.meta.url);
  const results = [];
  for (const shape of Object.keys(SHAPES)) {
    for (const cells of SIZES) {
      const name = fixtureName(shape, cells);
      process.stdout.write(`${name.padEnd(16)} `);
      try {
        const line = execFileSync(process.execPath,
          ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', self, name],
          { encoding: 'utf8', timeout: CHILD_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] });
        const r = JSON.parse(line.trim().split('\n').pop());
        results.push(r);
        const fails = Object.entries(r.stages).filter(([, v]) => v.status === 'FAIL');
        console.log(`${r.points} points, ${r.pairs} pairs, ${r.maxRssMB} MB RSS` +
          (fails.length ? `  FAIL: ${fails.map(([k]) => k).join(', ')}` : ''));
      } catch (e) {
        const reason = e.code === 'ETIMEDOUT' ? `timed out after ${CHILD_TIMEOUT_MS / 1000}s`
          : (e.stderr || e.message).trim().split('\n').pop();
        results.push({ name, crashed: reason });
        console.log(`CRASHED: ${reason}`);
      }
    }
  }

  const fmt = (v) => !v ? '' : v.status === 'ok' ? v.ms.toFixed(1) : v.status;
  const cols = STAGES.map(([k]) => k);
  console.log(`\nMedian ms over ${RUNS} runs (FAIL = threw, SKIP = needed a failed stage)\n`);
  console.log(['fixture', ...cols].join(' | '));
  for (const r of results) {
    console.log([r.name, ...(r.crashed ? ['CRASHED'] : cols.map((k) => fmt(r.stages[k])))].join(' | '));
  }
  const failures = results.flatMap((r) => r.crashed ? [`${r.name}: ${r.crashed}`]
    : Object.entries(r.stages).filter(([, v]) => v.status === 'FAIL').map(([k, v]) => `${r.name} ${k}: ${v.error}`));
  if (failures.length) console.log(`\nFailures:\n  ${failures.join('\n  ')}`);

  const out = new URL('results.json', DIR);
  await writeFile(out, JSON.stringify({ node: process.version, runs: RUNS, results }, null, 2) + '\n');
  console.log(`\nFull results written to ${fileURLToPath(out)}`);
}

if (import.meta.main) {
  if (process.argv[2]) await runOne(process.argv[2]);
  else await runAll();
}
