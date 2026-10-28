// @ts-check
/**
 * Statistics for the chart: trend line and correlation for the plotted points, and summary
 * statistics grouped by row label or column.
 */

/**
 * One plotted point, in data units.
 * @typedef {{x: number, y: number}} XY
 */

/**
 * Ordinary least-squares fit y = slope * x + intercept.
 * Returns NaN for both when the fit is undefined (fewer than 2 points, or all x equal).
 * Never throws.
 * @param {XY[]} points
 * @returns {{slope: number, intercept: number}}
 * @example
 * linearFit([{x: 1, y: 2}, {x: 2, y: 4}, {x: 3, y: 5}, {x: 4, y: 8}])
 * // => {slope: 1.9, intercept: 0}
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
 * Pearson correlation coefficient r, in [-1, 1].
 * Returns NaN when undefined (fewer than 2 points, or zero variance in x or y). Never throws.
 * @param {XY[]} points
 * @returns {number}
 * @example
 * pearson([{x: 1, y: 2}, {x: 2, y: 4}, {x: 3, y: 5}, {x: 4, y: 8}])  // => 0.981 (rounded)
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
 * Trend-line statistics for the plotted points, as returned by the active stats provider.
 * Field names match correlation_stats() in the Warm_up_project stats.py, so a provider can
 * return that output as is. Fields beyond these are passed through for the UI to show.
 * @typedef {Object} StatsResult
 * @property {number} n             number of points the stats were computed from
 * @property {number} r             Pearson correlation in [-1, 1]; NaN when undefined
 * @property {number} slope         trend-line slope, in y units per x unit; NaN when undefined
 * @property {number} intercept     trend-line y at x = 0; NaN when undefined
 * @property {number} [r_squared]   r * r, in [0, 1]
 * @property {number} [p_value]     significance of r, in [0, 1]; shown in the corner label
 */

/** @type {(points: XY[]) => StatsResult} */
function builtinProvider(points) {
  const { slope, intercept } = linearFit(points);
  const r = pearson(points);
  return { n: points.length, r, slope, intercept, r_squared: r * r };
}

let provider = builtinProvider;

/**
 * Swaps in another statistics implementation (e.g. the shared stats library), or restores the
 * built-in one when called with no argument.
 * Side effects: changes module state, so every later `computeStats` call uses `fn`.
 * @param {((points: XY[]) => StatsResult) | undefined} [fn]   new provider; omit to restore
 * @returns {void}
 * @example
 * setStatsProvider((points) => ({n: points.length, r: 0.5, slope: 1, intercept: 0}));
 * setStatsProvider();  // back to the built-in provider
 */
export function setStatsProvider(fn) {
  provider = fn ?? builtinProvider;
}

/**
 * Stats for the points currently plotted, from whichever provider is active.
 * With the built-in provider, slope, intercept and r are NaN when the fit is undefined, and it
 * never throws; a swapped-in provider is expected to behave the same way.
 * @param {XY[]} points
 * @returns {StatsResult}
 * @example
 * computeStats([{x: 1, y: 2}, {x: 2, y: 4}])
 * // => {n: 2, r: 1, slope: 2, intercept: 0, r_squared: 1}
 */
export function computeStats(points) {
  return provider(points);
}

/**
 * A plotted point plus the row label it came from.
 * @typedef {{x: number, y: number, group?: string}} GroupedPoint
 */

/**
 * Summary statistics for one list of numbers, created by `describe`.
 * @typedef {Object} Summary
 * @property {number} n        count of finite values
 * @property {number} mean
 * @property {number} sd       sample standard deviation (n - 1); NaN when n < 2
 * @property {number} min
 * @property {number} max
 * @property {number} median
 */

/**
 * One row of the grouped statistics table, created by `groupStats`.
 * @typedef {Object} GroupSummary
 * @property {string | number} key   group name, or x value when grouping by x
 * @property {string} label          text to show for the key
 * @property {Summary} stats
 */

/**
 * Summary statistics for one list of numbers. Non-finite values are ignored.
 * Every field except n is NaN for an empty list (and sd is NaN for one value); never throws.
 * @param {number[]} values
 * @returns {Summary}
 * @example
 * describe([3, 1, NaN, 2])  // => {n: 3, mean: 2, sd: 1, min: 1, max: 3, median: 2}
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
 * Flattens buildPlotData's series into the points `groupStats` (and the chart) take.
 * Returns an empty list for an empty series list; never throws.
 * @param {{group: string, points: [number, number][]}[]} series   one entry per row label,
 *                                                                   points as [x, y] pairs
 * @returns {GroupedPoint[]}
 * @example
 * pointsFromSeries([{group: 'A', points: [[0, 5], [1, 7]]}])
 * // => [{x: 0, y: 5, group: 'A'}, {x: 1, y: 7, group: 'A'}]
 */
export function pointsFromSeries(series) {
  return series.flatMap(({ group, points }) => points.map(([x, y]) => ({ x, y, group })));
}

/**
 * Summary statistics of y per row label (by 'group') or per column (by 'x').
 * Groups are sorted by name and columns by x value. Points with no group fall into a
 * '(no group)' row. Points with a non-finite x or y are skipped, so empty input returns an
 * empty list; never throws.
 * @param {GroupedPoint[]} points
 * @param {'group' | 'x'} [by]                what to group by; defaults to 'group'
 * @param {Record<number, string>} [labels]   column header for each x value, used as the label
 *                                            when grouping by x; falls back to the x value
 * @returns {GroupSummary[]}
 * @example
 * groupStats([{x: 0, y: 1, group: 'B'}, {x: 0, y: 3, group: 'A'}, {x: 1, y: 5, group: 'A'}])
 * // => [{key: 'A', label: 'A', stats: {n: 2, mean: 4, ...}},
 * //     {key: 'B', label: 'B', stats: {n: 1, mean: 1, ...}}]
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
    label: by === 'x'
      ? labels?.[Number(key)] ?? String(key)
      : String(key) || '(no group)',
    stats: describe(/** @type {number[]} */ (buckets.get(key))),
  }));
}
