// @ts-check
/**
 * Axis scales and ticks. Pure functions, no DOM, so they can be unit-tested.
 *
 * A scale works in "t-space": the data value itself for a linear axis, log10 of
 * the value for a log axis. Views, panning and zooming are all expressed in
 * t-space, so they are plain linear arithmetic whichever scale is active.
 */

/**
 * Axis type: `'linear'` plots values as they are; `'log'` plots log10 of positive values.
 * @typedef {'linear' | 'log'} ScaleKind
 */

/**
 * A mapping between data values and pixels along one axis, built by `makeScale`.
 * @typedef {Object} Scale
 * @property {ScaleKind} kind
 * @property {(v: number) => number} map        data value -> pixel (NaN if not representable)
 * @property {(px: number) => number} invert    pixel -> data value
 * @property {(px: number) => number} invertT   pixel -> t-space value
 */

/**
 * Converts a data value to t-space (the value itself, or log10 of it on a log axis).
 * Returns NaN for a log axis when `v` is zero, negative or NaN. Never throws.
 * @param {ScaleKind} kind
 * @param {number} v  data value
 * @returns {number}  t-space value
 * @example
 * toT('log', 1000)  // => 3
 * toT('log', 0)     // => NaN
 */
export function toT(kind, v) {
  return kind === 'log' ? (v > 0 ? Math.log10(v) : NaN) : v;
}

/**
 * Converts a t-space value back to a data value; the inverse of `toT`. Never throws.
 * @param {ScaleKind} kind
 * @param {number} t  t-space value
 * @returns {number}  data value (`10 ** t` on a log axis, `t` itself on a linear one)
 * @example
 * fromT('log', 3)  // => 1000
 */
export function fromT(kind, t) {
  return kind === 'log' ? 10 ** t : t;
}

/**
 * Whether a data value can be drawn on an axis of this kind: finite, and also above zero on
 * a log axis. NaN and +/-Infinity are never plottable. Never throws.
 * @param {ScaleKind} kind
 * @param {number} v  data value
 * @returns {boolean}
 * @example
 * isPlottable('log', 0)     // => false
 * isPlottable('linear', 0)  // => true
 */
export function isPlottable(kind, v) {
  return Number.isFinite(v) && (kind !== 'log' || v > 0);
}

/**
 * Builds a scale from a t-space domain to a pixel range, for the given axis kind.
 * The range may run backwards (e.g. `[height, 0]` for a y axis). A zero-width domain gives
 * infinite or NaN pixels rather than an error. `map` returns NaN for values the axis can't
 * show (zero or negative on a log axis). Never throws.
 * @param {ScaleKind} kind
 * @param {[number, number]} tDomain  visible extent in t-space (log10 units on a log axis)
 * @param {[number, number]} range    pixel positions of the two domain ends
 * @returns {Scale}
 * @example
 * const y = makeScale('log', [0, 3], [0, 300]);
 * y.map(10)      // => 100
 * y.invert(200)  // => 100
 * y.map(-1)      // => NaN
 */
export function makeScale(kind, tDomain, range) {
  const [d0, d1] = tDomain;
  const [r0, r1] = range;
  const k = (r1 - r0) / (d1 - d0);
  const invertT = (/** @type {number} */ px) => d0 + (px - r0) / k;
  return {
    kind,
    map: (v) => r0 + (toT(kind, v) - d0) * k,
    invert: (px) => fromT(kind, invertT(px)),
    invertT,
  };
}

/**
 * Linear scale from a data domain to a pixel range; shorthand for `makeScale('linear', ...)`.
 * @param {[number, number]} domain  data values at the two ends
 * @param {[number, number]} range   pixel positions of the two ends
 * @returns {Scale}
 * @example
 * linearScale([0, 10], [100, 0]).map(2.5)  // => 75
 */
export function linearScale(domain, range) {
  return makeScale('linear', domain, range);
}

/**
 * A "nice" step (1, 2 or 5 times a power of ten) giving roughly `count` intervals.
 * A `count` below 1 is treated as 1. A span of 0 gives 0, and a negative or NaN span gives
 * NaN, so callers must check the step before looping on it. Never throws.
 * @param {number} span   length of the range to divide, in data units
 * @param {number} count  desired number of intervals
 * @returns {number}      step size in data units
 * @example
 * niceStep(100, 5)  // => 20
 * niceStep(7, 5)    // => 1
 */
export function niceStep(span, count) {
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const nice = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return nice * mag;
}

/**
 * Tick values at multiples of a nice step inside [min, max].
 * Returns no ticks (and a NaN step) when `max < min` or either end is NaN. Ticks are
 * products `i * step`, so decimals can carry float noise; format them with `formatTick`.
 * Throws a RangeError when `min === max` (the step is 0 and the loop never ends), so give
 * it a padded extent such as the one from `paddedExtent`.
 * @param {number} min    lowest value on the axis
 * @param {number} max    highest value on the axis
 * @param {number} count  desired number of intervals
 * @returns {{ticks: number[], step: number}}  ascending tick values and the step between them
 * @example
 * niceTicks(0, 10, 5)  // => {ticks: [0, 2, 4, 6, 8, 10], step: 2}
 */
export function niceTicks(min, max, count) {
  const step = niceStep(max - min, count);
  const ticks = [];
  // Integer loop avoids floating-point drift from repeated addition.
  for (let i = Math.ceil(min / step); i <= Math.floor(max / step); i++) {
    ticks.push(i * step);
  }
  return { ticks, step };
}

/**
 * How many categories to step between labels so the widest one doesn't
 * overlap its neighbour: 1 shows every label, 3 shows every third.
 * A degenerate axis (no width, negative or NaN spacing) shows every label rather than
 * hiding them. Never throws.
 * @param {number} pxPerUnit      pixels between neighbouring categories
 * @param {number} widestLabelPx  width of the longest label, in pixels
 * @param {number} [gapPx]        minimum space between labels, in pixels (default 8)
 * @returns {number}              step between shown labels, at least 1
 * @example
 * categoryLabelStep(50, 90)   // => 2
 * categoryLabelStep(200, 40)  // => 1
 */
export function categoryLabelStep(pxPerUnit, widestLabelPx, gapPx = 8) {
  if (!(pxPerUnit > 0)) return 1;
  return Math.max(1, Math.ceil((widestLabelPx + gapPx) / pxPerUnit));
}

/**
 * Tick values for a log axis whose visible t-space range is [tMin, tMax].
 * Always powers of ten; intermediate 2 and 5 (or 1-9) are added when few
 * decades are visible so the axis never looks empty, but only as many as fit
 * within `maxTicks` (1-9 crowds up quickly: 2,000 ... 9,000 are close together).
 * A range that is empty or reversed (`tMax < tMin`) gives no ticks, and a zero-width range
 * gives the one power of ten it sits on, if any. Never throws.
 * @param {number} tMin  lowest visible value in t-space (log10 units)
 * @param {number} tMax  highest visible value in t-space
 * @param {number} [maxTicks]  most ticks to return (default 8)
 * @returns {number[]}  data values, ascending
 * @example
 * logTicks(0, 3)  // => [1, 10, 100, 1000]
 * logTicks(0, 1)  // => [1, 2, 5, 10]
 */
export function logTicks(tMin, tMax, maxTicks = 8) {
  const span = tMax - tMin;
  // Finest to coarsest; start at the one suited to the span, coarsen until it fits.
  const levels = [[1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 5], [1]];
  let level = span < 1.5 ? 0 : span < 3.5 ? 1 : 2;
  const decadeStep = Math.max(1, Math.ceil(span / maxTicks));

  /** @param {number[]} mults */
  const build = (mults) => {
    /** @type {number[]} */
    const out = [];
    const first = Math.floor(tMin);
    for (let k = Math.floor(first / decadeStep) * decadeStep; k <= Math.ceil(tMax); k += decadeStep) {
      for (const m of mults) {
        const v = m * 10 ** k;
        const t = Math.log10(v);
        if (t >= tMin - 1e-9 && t <= tMax + 1e-9) out.push(v);
      }
    }
    return out;
  };

  let ticks = build(levels[level]);
  while (ticks.length > maxTicks && level < levels.length - 1) ticks = build(levels[++level]);
  return ticks;
}

/**
 * Label for a log-axis tick: plain numbers (with thousands separators) for moderate sizes,
 * `1e6`-style from 1,000,000 up and below 0.0001. `v` must be above zero: zero gives
 * "NaNe-Infinity", and a log axis never has such ticks. Never throws.
 * @param {number} v  tick value in data units, greater than 0
 * @returns {string}  text for the axis; thousands separators follow the browser locale
 * @example
 * formatLogTick(1000)  // => '1,000'
 * formatLogTick(2e6)   // => '2e6'
 * formatLogTick(5e-5)  // => '5e-5'
 */
export function formatLogTick(v) {
  const exp = Math.floor(Math.log10(v) + 1e-9);
  if (exp >= 6 || exp <= -4) {
    const mant = v / 10 ** exp;
    return `${Number(mant.toPrecision(3))}e${exp}`;
  }
  return v.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

/**
 * Format a linear tick value with just enough decimals for the tick step (none for a step
 * of 1 or more). Throws a RangeError when `step` is 0, negative or NaN, so pass the step
 * from `niceTicks`.
 * @param {number} v     tick value
 * @param {number} step  distance between ticks, greater than 0
 * @returns {string}     text for the axis; separators follow the browser locale
 * @example
 * formatTick(2.5, 0.5)    // => '2.5'
 * formatTick(1200, 100)   // => '1,200'
 */
export function formatTick(v, step) {
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/**
 * t-space extent of data values, padded so points don't sit on the frame.
 * Values that can't be drawn on this axis kind are ignored. With nothing plottable it returns
 * `[0, 1]`; a single distinct value is widened by 1 on each side before padding, so the
 * result always has a positive width. Never throws.
 * @param {ScaleKind} kind
 * @param {number[]} values  data values, in data units
 * @param {number} [pad]     fraction of the extent added on each side (default 0.06)
 * @returns {[number, number]}  lowest and highest value in t-space
 * @example
 * paddedExtent('linear', [0, 10])         // => [-0.6, 10.6]
 * paddedExtent('log', [10, 1000, -1, 0])  // => [0.88, 3.12]
 * paddedExtent('log', [0, -3])            // => [0, 1]
 */
export function paddedExtent(kind, values, pad = 0.06) {
  const ts = values.filter((v) => isPlottable(kind, v)).map((v) => toT(kind, v));
  if (ts.length === 0) return [0, 1];
  let min = ts.reduce((a, b) => Math.min(a, b), Infinity);
  let max = ts.reduce((a, b) => Math.max(a, b), -Infinity);
  if (min === max) { min -= 1; max += 1; }
  const p = (max - min) * pad;
  return [min - p, max + p];
}
