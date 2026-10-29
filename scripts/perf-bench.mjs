// Time the worker pipeline on the perf fixtures: `npm run perf:bench [-- --runs 5 --only a,b]`.
// Each fixture runs in its own child process (fresh heap and JIT): one cold run, then
// `--runs` measured runs, reported as medians. Each run loads the pair, then times the
// worker requests behind the page's interactions: hiding a group, filtering, a sorted
// table page, a group summary and a full CSV export. Results also go to
// data/stress/results/ (gitignored) with the machine, Node version and commit, because
// timings only compare on one machine. Local only: timing is too noisy for CI.
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, platform, release, totalmem } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { csv, fixtures, measure } from './perf-fixtures.mjs';
import { startWorker } from './worker-harness.mjs';

const RESULTS = new URL('../data/stress/results/', import.meta.url);
const SCRIPT = fileURLToPath(import.meta.url);

/**
 * Worker requests timed after each load, in order. Payloads mirror what main.js sends
 * for the same interaction. `group` is the first group name in the first line chart.
 * @type {[string, string, (group: string) => object][]}
 */
const STAGES = [
  ['hideGroup', 'view', group => ({ hiddenBySource: [[group], [], []] })],
  ['filter', 'view', () => ({ query: 'person 1' })],
  ['sortedPage', 'page', () => ({ source: 2, mode: 'detail', sortBy: 'value',
    direction: 'desc', size: 100 })],
  ['groupSummary', 'page', () => ({ source: 0, mode: 'group' })],
  ['exportCsv', 'export', () => ({ source: 2, mode: 'detail' })],
];

/**
 * Middle value of a list, or the mean of the two middle values for an even count.
 * Returns NaN for an empty list. Does not mutate `values`.
 * @param {number[]} values
 * @returns {number}
 * @example
 * median([3, 1, 2])     // => 2
 * median([4, 1, 3, 2])  // => 2.5
 */
export function median(values) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Reduce per-run stage timings to the first (cold) run and the median of the rest.
 * Stages missing from a run (after a rejected load) are left out of that stage's median.
 * @param {Record<string, number>[]} samples  One object per run, stage name -> ms.
 * @returns {Record<string, {cold: number, median: number}>}
 * @example
 * summarize([{ load: 9 }, { load: 3 }, { load: 5 }])  // => {load: {cold: 9, median: 4}}
 */
export function summarize(samples) {
  const stages = [...new Set(samples.flatMap(Object.keys))];
  return Object.fromEntries(stages.map(stage => [stage, {
    cold: samples[0][stage],
    median: median(samples.slice(1).map(s => s[stage]).filter(ms => ms !== undefined)),
  }]));
}

/**
 * Load one fixture pair `runs + 1` times in this process and time every stage.
 * Never throws for a rejected pair: its error message is returned instead.
 * Side effects: starts the worker in this process (see worker-harness.mjs).
 * @param {import('./perf-fixtures.mjs').Fixture} fixture
 * @param {number} runs  Measured runs after the cold one; at least 1.
 * @returns {Promise<{samples: Record<string, number>[], error?: string, counts?: number[]}>}
 */
export async function timeFixture(fixture, runs) {
  const send = await startWorker();
  const files = ['a', 'b']
    .map(side => new File([csv(fixture[side])], `${fixture.name}-${side}.csv`));
  const samples = [];
  let error, counts;
  for (let run = 0; run <= runs; run++) {
    /** @type {Record<string, number>} */
    const sample = {};
    let start = performance.now();
    const loaded = await send('load', { files });
    sample.load = performance.now() - start;
    error = loaded.error;
    if (!error) {
      counts = loaded.result.counts;
      const group = loaded.result.charts[0].groupNames[0];
      for (const [stage, type, payload] of STAGES) {
        start = performance.now();
        const reply = await send(type, payload(group));
        sample[stage] = performance.now() - start;
        if (reply.error) throw new Error(`${fixture.name} ${stage}: ${reply.error}`);
      }
    }
    samples.push(sample);
  }
  return { samples, ...(error ? { error } : { counts }) };
}

/** Child mode: time one fixture and print one JSON line for the parent. */
async function child(name, runs) {
  const fixture = fixtures().find(f => f.name === name);
  globalThis.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  const timed = await timeFixture(fixture, runs);
  globalThis.gc?.();
  console.log(JSON.stringify({
    ...timed,
    // Heap still in use after the last run: roughly the retained model and its caches.
    retainedHeapMB: (process.memoryUsage().heapUsed - heapBefore) / 2 ** 20,
    maxRssMB: process.resourceUsage().maxRSS / 1024,
  }));
}

/** Milliseconds for the table: one decimal under 10 ms, '-' when not measured. */
const fmt = ms =>
  (ms === undefined || Number.isNaN(ms) ? '-' : ms.toFixed(ms < 10 ? 1 : 0));
const COLUMNS = ['load', ...STAGES.map(([stage]) => stage)];

/** Parent mode: run each fixture in a child process, print a table and save JSON. */
async function main({ runs, only }) {
  const selected = fixtures().filter(f => !only || only.split(',').includes(f.name));
  console.log(`${selected.length} fixtures, 1 cold + ${runs} measured runs each; times in ms ` +
    '(median; load also shows the cold run)\n');
  console.log(['fixture'.padEnd(31), 'cells'.padStart(7), 'cold'.padStart(6),
    ...COLUMNS.map(c => c.padStart(c.length > 6 ? c.length : 6)), 'µs/cell', 'heapMB', 'rssMB']
    .join(' '));
  const results = [];
  for (const fixture of selected) {
    const proc = spawnSync(process.execPath, ['--expose-gc',
      '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', SCRIPT, '--child', fixture.name,
      '--runs', String(runs)], { encoding: 'utf8', maxBuffer: 2 ** 26 });
    if (proc.status !== 0) throw new Error(`${fixture.name}: ${proc.stderr}`);
    const timed = JSON.parse(proc.stdout.trim().split('\n').pop());
    const cells = measure(csv(fixture.a)).cells + measure(csv(fixture.b)).cells;
    const stages = summarize(timed.samples);
    results.push({ name: fixture.name, expect: fixture.expect, cells, stages,
      ...(timed.error ? { error: timed.error } : { counts: timed.counts }),
      retainedHeapMB: timed.retainedHeapMB, maxRssMB: timed.maxRssMB });
    console.log([fixture.name.padEnd(31), String(cells).padStart(7),
      fmt(stages.load.cold).padStart(6),
      ...COLUMNS.map(c => fmt(stages[c]?.median).padStart(c.length > 6 ? c.length : 6)),
      (timed.error ? '-' : (stages.load.median * 1000 / cells).toFixed(2)).padStart(7),
      timed.retainedHeapMB.toFixed(1).padStart(6), timed.maxRssMB.toFixed(0).padStart(5),
      timed.error ? ` rejected: ${timed.error.slice(0, 40)}` : ''].join(' '));
  }
  const environment = {
    date: new Date().toISOString(), node: process.version, platform: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model, cores: cpus().length, memoryGB: Math.round(totalmem() / 2 ** 30),
    commit: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(),
    uncommittedChanges: execFileSync('git', ['status', '--porcelain', '--untracked-files=no'],
      { encoding: 'utf8' }).trim() !== '',
    runs,
  };
  await mkdir(RESULTS, { recursive: true });
  const file = new URL(`bench-${environment.date.replace(/[:.]/g, '-')}.json`, RESULTS);
  await writeFile(file, JSON.stringify({ environment, results }, null, 2));
  console.log(`\n${environment.cpu}, Node ${environment.node}, commit ${environment.commit}` +
    `${environment.uncommittedChanges ? ' (uncommitted changes)' : ''}`);
  console.log(`Saved ${fileURLToPath(file)}`);
}

if (process.argv[1] === SCRIPT) {
  const { values } = parseArgs({ options: {
    runs: { type: 'string', default: '5' }, only: { type: 'string' }, child: { type: 'string' },
  } });
  const runs = Number(values.runs);
  if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer');
  if (values.child) await child(values.child, runs);
  else await main({ runs, only: values.only });
}
