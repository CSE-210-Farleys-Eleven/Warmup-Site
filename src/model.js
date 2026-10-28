// @ts-check
/**
 * Keep complete cleaned data and derive bounded chart and table views in the worker.
 * Matching uses normalized group names and exact category labels. Statistics and CSV
 * rows use all selected observations; drawing samples and log axes do not change them.
 * This module has no DOM, file access or network side effects.
 */

/**
 * A cleaned parser result accepted by the model.
 * @typedef {Object} ParsedData
 * @property {string | null} valueHeader Measurement label from the top-left cell.
 * @property {{group: string, points: [number, number][]}[]} series Cleaned finite values.
 * @property {Record<number, string>} [xTickLabels] Category labels by column position.
 * @property {string[]} warnings Parser diagnostics to include in the view.
 */

/**
 * One original or paired observation. Paired x is file B's value, not column order.
 * @typedef {Object} Observation
 * @property {string} group Canonical display spelling of the group.
 * @property {string} category Trimmed category label used for cross-file pairing.
 * @property {number} order Original category position for stable table sorting.
 * @property {number} x Category position for lines, or file B value for pairs.
 * @property {number} y Value from the selected file, or file A value for pairs.
 */

/**
 * Optional filters and representation for one complete-data analysis view.
 * @typedef {Object} ViewOptions
 * @property {string} [query] Normalized substring match on group names; default empty.
 * @property {string} [overview] 'auto', 'overview' or 'individual'; default 'auto'.
 * @property {string[][]} [hiddenBySource] Independent exclusions for A, B and pairs.
 */

/**
 * Select, order and optionally page a table. Numeric values stay unrounded.
 * @typedef {Object} TableOptions
 * @property {number} [source] 0 = file A, 1 = file B, 2 = matched pairs; default 0.
 * @property {string} [mode] 'detail', 'group' or 'category'; default 'detail'.
 * @property {string} [sortBy] Group/category, value/second, or a summary field.
 * @property {string} [direction] 'desc' reverses the primary key; otherwise ascending.
 * @property {string} [query] Shared group-name filter; default empty.
 * @property {string[]} [excludedGroups] Groups hidden in the selected chart.
 * @property {number} [page] Zero-based page index, clamped to the available pages.
 * @property {number} [size] 25, 50 or 100; other values fall back to 50.
 */

/**
 * Complete filtered rows, cached inside a model. Treat returned arrays as read-only.
 * @typedef {Object} TableResult
 * @property {string[]} columns Display/export column names.
 * @property {(string | number)[][]} rows All selected rows before pagination.
 * @property {(number | null)[]} decimals Display precision, not export rounding.
 * @property {string} note Scope note for paired summaries; otherwise empty.
 */
import { nameKey } from './data.js';
import { describe, linearFit, pearson } from './stats.js';

/**
 * Import and drawing budgets: bytes per file, cells across both files, data records
 * per file, value columns per file, points per chart and individual line groups.
 * The worker enforces import limits; the model applies drawing limits only.
 */
export const LIMITS = { fileBytes: 5 * 1024 * 1024, cells: 250000, rows: 20000, columns: 512, drawn: 3000, individualGroups: 20 };
/**
 * Select deterministic, evenly spaced references including the first and last point.
 * Return the original array when it fits; return an empty array for empty input.
 * Does not mutate points. Callers supply a finite integer cap of at least 2.
 * @template T
 * @param {T[]} points Ordered drawing candidates.
 * @param {number} [cap] Maximum selected points; default LIMITS.drawn.
 * @returns {T[]} References to the selected points.
 * @example
 * sample([0, 1, 2, 3, 4], 3) // => [0, 2, 4]
 */
export function sample(points, cap = LIMITS.drawn) {
  if (points.length <= cap) return points;
  return Array.from({ length: cap }, (_, i) => points[Math.floor(i * (points.length - 1) / (cap - 1))]);
}
/**
 * Find raw and strictly positive extents without expanding arrays into arguments.
 * Empty input has empty ranges. Callers supply finite coordinates; this helper
 * does not clean invalid values or transform the positive range to log units.
 * @param {{x: number, y: number}[]} points Finite cleaned coordinates.
 * @param {'x' | 'y'} axis Coordinate to inspect.
 * @returns {{linear: number[], log: number[]}} Raw-unit bounds, or empty arrays.
 * @example
 * extent([{x: -1, y: 2}, {x: 3, y: 4}], 'x') // => {linear: [-1, 3], log: [3, 3]}
 */
export function extent(points, axis) {
  let min = Infinity, max = -Infinity, positiveMin = Infinity, positiveMax = -Infinity;
  for (const p of points) {
    const v = p[axis]; min = Math.min(min, v); max = Math.max(max, v);
    if (v > 0) { positiveMin = Math.min(positiveMin, v); positiveMax = Math.max(positiveMax, v); }
  }
  return { linear: min === Infinity ? [] : [min, max], log: positiveMin === Infinity ? [] : [positiveMin, positiveMax] };
}
/**
 * Attach bounded drawing points, complete-data extents and log exclusion counts.
 * @template {object} T
 * @param {import('./chart.js').Point[]} points Finite points before sampling.
 * @param {T} extra Chart-specific labels, means and analysis metadata.
 */
function chartPayload(points, extra) {
  let xNonPositive = 0, yNonPositive = 0, eitherNonPositive = 0;
  for (const p of points) { if (p.x <= 0) xNonPositive++; if (p.y <= 0) yNonPositive++; if (p.x <= 0 || p.y <= 0) eitherNonPositive++; }
  return { ...extra, points: sample(points), total: points.length, xRanges: extent(points, 'x'), yRanges: extent(points, 'y'), xNonPositive, yNonPositive, eitherNonPositive };
}
/**
 * Summarize Y by group/category and retain the earliest original category order.
 * @param {Observation[]} records Selected complete-data observations.
 * @param {string} by 'group' groups by person; other values use category labels.
 */
function summaries(records, by) {
  const buckets = new Map();
  for (const r of records) {
    const key = by === 'group' ? r.group : r.category;
    if (!buckets.has(key)) buckets.set(key, { order: r.order, values: [] });
    const bucket = buckets.get(key);
    bucket.order = Math.min(bucket.order, r.order);
    bucket.values.push(r.y);
  }
  return [...buckets].map(([label, { order, values }]) => ({ label, order, ...describe(values) }));
}

// Summary sort keys map to describe() fields; NaN (e.g. SD with one value) sorts last.
/** @type {Record<string, 'mean' | 'median' | 'sd' | 'min' | 'max'>} */
const SUMMARY_FIELDS = { value: 'mean', median: 'median', sd: 'sd', min: 'min', max: 'max' };
/** @param {number} a @param {number} b @returns {number} */
const byNumber = (a, b) => (Number(Number.isNaN(a)) - Number(Number.isNaN(b))) || a - b;

// Decimal places a file's values are written with, capped at 3, so a table column can show
// every value with the same number of decimals (e.g. integer steps, 3-decimal sleep hours).
/** Maximum display precision; CSV rows retain their original numeric precision. */
const MAX_DECIMALS = 3;
/**
 * Infer a common display precision from finite cleaned values, capped at 3.
 * Empty input uses zero places; exponential notation uses the cap.
 * @param {number[]} values Cleaned values, not the original CSV strings.
 * @returns {number} Decimal places in [0, 3].
 */
function precisionOf(values) {
  let best = 0;
  for (const v of values) {
    const text = String(v);
    const decimals = text.includes('e') ? MAX_DECIMALS : text.includes('.') ? text.length - text.indexOf('.') - 1 : 0;
    if (decimals > best && (best = Math.min(MAX_DECIMALS, decimals)) === MAX_DECIMALS) break;
  }
  return best;
}
/**
 * Hash ordered cleaned rows and file boundaries with FNV-1a for a six-hex suffix.
 * This is a short identifier, not a cryptographic hash or a uniqueness guarantee.
 * @param {Observation[][]} recordLists Original rows for file A and file B.
 * @returns {string} Six lowercase hexadecimal characters, including for empty input.
 */
function fingerprintOf(recordLists) {
  let hash = 0x811c9dc5;
  for (const records of recordLists) {
    for (const r of records) {
      const text = `${r.group}\u0001${r.category}\u0001${r.y}\n`;
      for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
    }
    hash = Math.imul(hash ^ 0x1e, 0x01000193); // file separator
  }
  return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 6);
}

/**
 * Pair two cleaned files and expose full-data view/table and bounded page queries.
 * A is Y and B is X in matched pairs. Groups match through nameKey(); categories
 * match exactly. Empty series produce empty views/tables, not an import error.
 * Callers validate/clean input first; malformed structures are not accepted.
 * Queries update private filter/table caches and return structured-cloneable data.
 * @param {ParsedData} a Cleaned first file.
 * @param {ParsedData} b Cleaned second file.
 * @param {string[]} [names] File-name fallbacks when a measurement label is empty.
 * @returns A private model exposing view(), table() and page() query methods.
 */
export function createModel(a, b, names = ['First CSV', 'Second CSV']) {
  const canonical = new Map();
  for (const d of [a, b]) for (const s of d.series) if (!canonical.has(nameKey(s.group))) canonical.set(nameKey(s.group), s.group);
  const groups = [...canonical.values()].sort((x, y) => x.localeCompare(y));
  const groupSlots = Object.fromEntries(groups.map((g, i) => [g, i]));
  /** @param {ParsedData} d @returns {Observation[]} */
  const flatten = d => d.series.flatMap(s => s.points.map(([x, y]) => ({ group: canonical.get(nameKey(s.group)), category: d.xTickLabels?.[x] ?? String(x), order: x, x, y })));
  const original = [flatten(a), flatten(b)];
  const bIndex = new Map(original[1].map(r => [JSON.stringify([nameKey(r.group), r.category]), r.y]));
  const paired = original[0].flatMap(r => {
    const x = bIndex.get(JSON.stringify([nameKey(r.group), r.category]));
    // `x` holds the second file's value here, so the category position travels separately as `order`.
    return x === undefined ? [] : [{ group: r.group, category: r.category, order: r.order, x, y: r.y }];
  });
  const labels = [a.valueHeader || names[0], b.valueHeader || names[1]];
  const fingerprint = fingerprintOf(original);
  const precision = original.map(rs => precisionOf(rs.map(r => r.y)));
  // Means, medians and SDs get one digit more than the raw values, within the cap.
  const statDecimals = precision.map(p => Math.min(MAX_DECIMALS, p + 1));
  /** @type {string | null} */
  let filterKey = null;
  /** @type {Observation[][]} */
  let filtered;
  /** @type {Map<string, TableResult>} */
  let tables = new Map();
  /** Cache the normalized group query and invalidate derived tables when it changes.
   * @param {string} [query]
   */
  function filter(query = '') {
    const key = nameKey(query);
    if (filterKey === key) return;
    filterKey = key; tables = new Map();
    const keep = r => nameKey(r.group).includes(key);
    filtered = [...original.map(rs => rs.filter(keep)), paired.filter(keep)];
  }
  /**
   * Return analysis for all selected rows and at most LIMITS.drawn drawing points.
   * More than 20 visible line groups force category means even in individual mode.
   * Hidden names remain in legend metadata so an all-hidden chart is recoverable.
   * Empty selections have zero counts and NaN summary/fit fields where undefined.
   * @param {ViewOptions} [options]
   */
  function view({ query = '', overview = 'auto', hiddenBySource = [] } = {}) {
    filter(query);
    const visible = filtered.map((rows, i) => {
      const excluded = new Set(hiddenBySource[i] ?? []);
      return rows.filter(r => !excluded.has(r.group));
    });
    const [ra, rb, rp] = visible;
    const selectedGroups = new Set([...ra, ...rb].map(r => r.group)).size;
    const aggregate = overview === 'overview' || selectedGroups > LIMITS.individualGroups;
    const fit = { n: rp.length, r: pearson(rp), ...linearFit(rp) };
    const line = (records, i, ticks) => {
      const useMeans = overview === 'overview' || new Set(records.map(r => r.group)).size > LIMITS.individualGroups;
      const buckets = new Map();
      for (const r of records) { if (!buckets.has(r.x)) buckets.set(r.x, { sum: 0, n: 0, category: r.category }); const v = buckets.get(r.x); v.sum += r.y; v.n++; }
      const meanPoints = [...buckets].map(([x, v]) => ({ x, y: v.sum / v.n, n: v.n, group: 'Category mean', category: v.category }));
      const points = useMeans ? meanPoints : records;
      return chartPayload(points, { title: labels[i], xLabel: '', yLabel: labels[i], xTickLabels: ticks, connectGroups: true, aggregate: useMeans, meanPoints, sourceTotal: records.length, groupSlots });
    };
    const chartInputs = [line(ra, 0, a.xTickLabels), line(rb, 1, b.xTickLabels), chartPayload(rp, { title: `${labels[0]} vs. ${labels[1]}`, xLabel: labels[1], yLabel: labels[0], showTrend: true, statsOverride: rp.length > LIMITS.drawn ? fit : undefined, groupSlots })];
    chartInputs.forEach((chart, i) => {
      chart.groupNames = [...new Set(filtered[i].map(r => r.group))].sort((x, y) => x.localeCompare(y));
      chart.hiddenGroups = [...(hiddenBySource[i] ?? [])];
      chart.hiddenObservations = filtered[i].length - visible[i].length;
    });
    return {
      names, labels, groups: selectedGroups, aggregate, counts: visible.map(r => r.length), unfilteredCounts: [...original.map(r => r.length), paired.length],
      stats: [describe(ra.map(r => r.y)), describe(rb.map(r => r.y))], fit, precision, statDecimals, fingerprint,
      charts: chartInputs,
      warnings: [...a.warnings.map(w => `${names[0]}: ${w}`), ...b.warnings.map(w => `${names[1]}: ${w}`)].slice(0, 60),
    };
  }
  /**
   * Return every selected raw row or Y summary, sorted before any page is sliced.
   * Paired detail rows contain B then A; paired summaries describe A's Y values.
   * Empty selections return headers and no rows. Cache at most eight combinations.
   * @param {TableOptions} [options]
   * @returns {TableResult}
   */
  function table({ source = 0, mode = 'detail', sortBy = 'group', direction = 'asc', query = '', excludedGroups = [] } = {}) {
    filter(query);
    const excluded = new Set(excludedGroups);
    const dir = direction === 'desc' ? -1 : 1;
    const cacheKey = JSON.stringify([source, mode, sortBy, dir, [...excluded].sort()]);
    if (!tables.has(cacheKey)) {
      const pairedSource = source === 2;
      const records = (filtered[source] ?? []).filter(r => !excluded.has(r.group));
      const columns = mode === 'detail' ? ['Group', 'Category', ...(pairedSource ? [labels[1], labels[0]] : [labels[source]])] : [mode === 'group' ? 'Group' : 'Category', 'n', 'Mean', 'Median', 'Sample SD', 'Min', 'Max'];
      let rows;
      if (mode === 'detail') {
        // 'value' is the first file's value (y); 'second' is the second file's value (x), which only
        // matched pairs have. Summary-only keys (median, sd, ...) have no per-row meaning, so they sort by value.
        const key = sortBy === 'group' ? (a, b) => a.group.localeCompare(b.group)
          : sortBy === 'category' ? (a, b) => a.category.localeCompare(b.category)
            : sortBy === 'second' && pairedSource ? (a, b) => a.x - b.x
              : (a, b) => a.y - b.y;
        const sorted = [...records].sort((a, b) => dir * key(a, b) || a.group.localeCompare(b.group) || a.order - b.order);
        rows = sorted.map(r => [r.group, r.category, ...(pairedSource ? [r.x, r.y] : [r.y])]);
      } else {
        const field = SUMMARY_FIELDS[sortBy];
        // "Group / original category order" keeps categories in file order; "Category name" is alphabetical.
        const key = field ? (a, b) => byNumber(a[field], b[field])
          : mode === 'category' && sortBy !== 'category' ? (a, b) => a.order - b.order
            : (a, b) => a.label.localeCompare(b.label);
        const values = summaries(records, mode).sort((a, b) => dir * key(a, b) || a.label.localeCompare(b.label));
        rows = values.map(s => [s.label, s.n, s.mean, s.median, s.sd, s.min, s.max]);
      }
      // Paired summaries describe the first file (Y), so they use its precision.
      const valueFile = pairedSource ? 0 : source;
      const decimals = mode === 'detail'
        ? [null, null, ...(pairedSource ? [precision[1], precision[0]] : [precision[source]])]
        : [null, 0, statDecimals[valueFile], statDecimals[valueFile], statDecimals[valueFile], precision[valueFile], precision[valueFile]];
      tables.set(cacheKey, { columns, rows, decimals, note: pairedSource && mode !== 'detail' ? `Summaries describe ${labels[0]} (Y) within matched pairs.` : '' });
      if (tables.size > 8) tables.delete(tables.keys().next().value);
    }
    return tables.get(cacheKey);
  }
  return { view, table,
    /**
     * Slice a sorted table with a 25/50/100-row cap. Empty data has page 0 of 1.
     * The input page is expected to be finite and integer; it is clamped to bounds.
     * @param {TableOptions} [options]
     */
    page(options = {}) {
      const t = table(options);
      const size = [25, 50, 100].includes(Number(options.size)) ? Number(options.size) : 50;
      const pages = Math.max(1, Math.ceil(t.rows.length / size));
      const page = Math.max(0, Math.min(Number(options.page) || 0, pages - 1));
      return {
        ...t, rows: t.rows.slice(page * size, (page + 1) * size),
        total: t.rows.length, page, pages, size,
      };
    } };
}

/**
 * Create deterministic seven-category CSV text pairs for tests, without file I/O.
 * edge=true puts zero in A's first category and -1 in B's second category.
 * Zero groups produces headers only. Callers supply a nonnegative integer count;
 * generated files still pass through the worker's normal import budgets.
 * @param {number} count Number of synthetic groups.
 * @param {boolean} [edge] Include log-axis edge cases; default false.
 * @returns {[string, string]} First-file and second-file CSV text.
 * @example
 * generatedPair(0) // => ['Daily steps,Mon,Tue,Wed,Thu,Fri,Sat,Sun',
 *                  //     'Sleep (hours),Mon,Tue,Wed,Thu,Fri,Sat,Sun']
 */
export function generatedPair(count, edge = false) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const a = [`Daily steps,${days.join(',')}`], b = [`Sleep (hours),${days.join(',')}`];
  for (let i = 0; i < count; i++) {
    const person = `Person ${String(i + 1).padStart(5, '0')}`;
    const steps = days.map((_, d) => edge && d === 0 ? 0 : Math.round(5200 + 2500 * Math.sin(i * 1.37 + d) + (i % 17) * 130));
    const sleep = steps.map((s, d) => edge && d === 1 ? -1 : Number((8.6 - s / 5200 + Math.sin(i * 0.71 + d) * 0.8).toFixed(3)));
    a.push([person, ...steps].join(',')); b.push([person.toLowerCase(), ...sleep].join(','));
  }
  return [a.join('\n'), b.join('\n')];
}
