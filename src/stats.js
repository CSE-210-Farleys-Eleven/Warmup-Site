// @ts-check
/**
 * Simple statistics helpers: trend line + correlation for the chart, and
 * summary statistics grouped by row label or column.
 * Placeholder version — the stats owner can swap in their own as long as the
 * signatures stay the same.
 */

/**
 * @typedef {{x: number, y: number}} XY
 */

/**
 * Ordinary least-squares fit y = slope * x + intercept.
 * Returns NaN for both when the fit is undefined (fewer than 2 points, or all x equal).
 * @param {XY[]} points
 * @returns {{slope: number, intercept: number}}
 */
export function linearFit(points) {
  const n = points.length;
  if (n < 2) return { slope: NaN, intercept: NaN };

  const meanX = points.reduce((s, p) => s + p.x, 0) / n;
  const meanY = points.reduce((s, p) => s + p.y, 0) / n;

  let sxy = 0;
  let sxx = 0;
  for (const p of points) {
    sxy += (p.x - meanX) * (p.y - meanY);
    sxx += (p.x - meanX) ** 2;
  }
  if (sxx === 0) return { slope: NaN, intercept: NaN };

  const slope = sxy / sxx;
  return { slope, intercept: meanY - slope * meanX };
}

/**
 * Pearson correlation coefficient r in [-1, 1].
 * Returns NaN when undefined (fewer than 2 points, or zero variance in x or y).
 * @param {XY[]} points
 * @returns {number}
 */
export function pearson(points) {
  const n = points.length;
  if (n < 2) return NaN;

  const meanX = points.reduce((s, p) => s + p.x, 0) / n;
  const meanY = points.reduce((s, p) => s + p.y, 0) / n;

  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const p of points) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return NaN;
  return sxy / Math.sqrt(sxx * syy);
}

/**
 * Summary fields the chart understands. `slope`/`intercept`/`r`/`n` drive the
 * trend line and corner label; anything else (r_squared, p_value, ...) is
 * passed through for the UI to show. Field names match correlation_stats()
 * in the Warm_up_project stats.py so a provider can return its output as is.
 * @typedef {{n: number, r: number, slope: number, intercept: number,
 *            r_squared?: number, p_value?: number, [extra: string]: number | null | undefined}} StatsResult
 */

/**
 * The default statistics provider: least-squares fit and Pearson r. Fields are NaN when
 * the fit is undefined (see `linearFit` and `pearson`). Never throws.
 * @type {(points: XY[]) => StatsResult}
 */
function builtinProvider(points) {
  const { slope, intercept } = linearFit(points);
  const r = pearson(points);
  return { n: points.length, r, slope, intercept, r_squared: r * r };
}

let provider = builtinProvider;

/**
 * Swap in another statistics implementation (e.g. the shared stats library).
 * It must be synchronous, return the fields above, and return NaN (not throw)
 * for slope/intercept/r when the fit is undefined. Call with no argument to
 * restore the built-in one.
 * @param {((points: XY[]) => StatsResult) | undefined} [fn]
 */
export function setStatsProvider(fn) {
  provider = fn ?? builtinProvider;
}

/**
 * Stats for the points currently plotted, from whichever provider is active.
 * @param {XY[]} points
 * @returns {StatsResult}
 */
export function computeStats(points) {
  return provider(points);
}

/**
 * @typedef {{x: number, y: number, group?: string}} GroupedPoint
 *
 * @typedef {Object} Summary
 * @property {number} n       count of finite values
 * @property {number} mean
 * @property {number} sd      sample standard deviation (n - 1); NaN when n < 2
 * @property {number} min
 * @property {number} max
 * @property {number} median
 *
 * @typedef {Object} GroupSummary
 * @property {string | number} key   group name, or x value when grouping by x
 * @property {string} label          text to show for the key
 * @property {Summary} stats
 */

/**
 * Summary statistics for one list of numbers. Non-finite values are ignored.
 * Every field except n is NaN for an empty list; never throws.
 * @param {number[]} values
 * @returns {Summary}
 */
export function describe(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  const n = v.length;
  if (n === 0) return { n: 0, mean: NaN, sd: NaN, min: NaN, max: NaN, median: NaN };

  const mean = v.reduce((s, y) => s + y, 0) / n;
  const sd = n < 2 ? NaN : Math.sqrt(v.reduce((s, y) => s + (y - mean) ** 2, 0) / (n - 1));
  const mid = Math.floor(n / 2);
  const median = n % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  return { n, mean, sd, min: v[0], max: v[n - 1], median };
}

/**
 * Flatten buildPlotData's series into the points groupStats (and the chart) take.
 * @param {{group: string, points: [number, number][]}[]} series
 * @returns {GroupedPoint[]}
 */
export function pointsFromSeries(series) {
  return series.flatMap(({ group, points }) => points.map(([x, y]) => ({ x, y, group })));
}

/**
 * Summary statistics of y per row label (by 'group', the default) or per
 * column (by 'x')
 * Order: groups by name, x by value, points with no group fall into '(no group)'.
 * @param {GroupedPoint[]} points
 * @param {'group' | 'x'} [by]
 * @param {Record<number, string>} [labels]
 * @returns {GroupSummary[]}
 */
export function groupStats(points, by = 'group', labels) {
  /** @type {Map<string | number, number[]>} */
  const buckets = new Map();
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const key = by === 'x' ? p.x : p.group ?? '';
    const bucket = buckets.get(key);
    if (bucket) bucket.push(p.y); else buckets.set(key, [p.y]);
  }

  const keys = [...buckets.keys()];
  if (by === 'x') keys.sort((a, b) => Number(a) - Number(b));
  else keys.sort((a, b) => String(a).localeCompare(String(b)));

  return keys.map((key) => ({
    key,
    label: by === 'x' ? labels?.[Number(key)] ?? String(key) : String(key) || '(no group)',
    stats: describe(/** @type {number[]} */ (buckets.get(key))),
  }));
}
