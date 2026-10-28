// @ts-check
/**
 * Scatter / line plot library: scales, ticks, axes, points, legend, tooltip, zoom/pan.
 * No chart libraries. Knows nothing about the data's meaning — everything
 * comes from the PlotInput.
 *
 * The chart builds a renderer-neutral Scene (pixel positions of ticks, marks,
 * lines...) and hands it to a renderer: Canvas (default) or SVG. Hit-testing,
 * zoom and pan work on the Scene and the container, so they behave the same
 * with either. Each axis can independently be linear or log.
 *
 * Interaction: hover for a tooltip (nearest point), drag to pan,
 * Ctrl/⌘ + scroll (or trackpad pinch) to zoom, double-click or "Reset" to restore.
 */
import { computeStats } from './stats.js';
import { addImageActions } from './chart-image.js';
import { addLayoutControls } from './chart-layout.js';
import {
  categoryLabelStep, formatLogTick, formatTick, fromT, isPlottable, logTicks, makeScale, niceTicks, paddedExtent,
} from './scales.js';
import { MEAN_HALF_WIDTH, POINT_R, colorFor, shapePath } from './render-common.js';
import { createCanvasRenderer } from './render-canvas.js';
import { createSvgRenderer, svgEl } from './render-svg.js';

export { linearScale, niceStep, niceTicks, logTicks } from './scales.js';

/**
 * @typedef {Object} Point
 * @property {number} x
 * @property {number} y
 * @property {string} [group]   // person name, used for color
 * @property {string} [category]
 *
 * @typedef {Object} PlotInput
 * @property {string} title
 * @property {string} xLabel
 * @property {string} yLabel
 * @property {Point[]} points
 * @property {Object<number,string>} [xTickLabels]  // e.g. {0:"Mon",...,6:"Sun"}
 * @property {boolean} [showTrend]   // linear fit line + r in the legend
 * @property {boolean} [showMeans]   // mean marker per distinct x (weekday plots)
 * @property {number}  [jitter]      // horizontal jitter in x units (weekday plots)
 * @property {boolean} [connectGroups] // join each group's points in x order (line chart)
 * @property {string[]} [groupNames] // includes hidden groups so they can be restored
 * @property {string[]} [hiddenGroups]
 * @property {Record<string,number>} [groupSlots]
 * @property {boolean} [aggregate]
 * @property {Mean[]} [meanPoints] // full-visible-data means supplied by the worker
 * @property {ReturnType<typeof computeStats>} [statsOverride]
 * @property {Record<ScaleKind,number[]>} [xRanges]
 * @property {Record<ScaleKind,number[]>} [yRanges]
 *
 * @typedef {'canvas' | 'svg'} RendererKind
 * @typedef {import('./scales.js').ScaleKind} ScaleKind
 *
 * @typedef {Object} PlotOptions
 * @property {RendererKind} [renderer]   default 'canvas'
 * @property {ScaleKind} [xScale]        default 'linear'
 * @property {ScaleKind} [yScale]        default 'linear'
 * @property {(hidden: number, kinds: {x: ScaleKind, y: ScaleKind}) => void} [onHidden] called whenever the number of points that
 *                                       can't be drawn on a log axis (value <= 0) changes
 * @property {boolean} [controls]        show the scale selects in the chart toolbar (default true)
 * @property {(groups: string[]) => void} [onVisibilityChange] request a full-data worker recomputation
 * @property {{x: [number,number], y: [number,number]}} [view]
 * @property {string} [maxWidth] * @property {number} [legendPage]
 * @property {string} [legendQuery]
 *
 * @typedef {Object} ChartHandle
 * @property {(kind: RendererKind) => void} setRenderer
 * @property {(axis: 'x' | 'y', kind: ScaleKind) => void} setScale
 * @property {() => {renderer: RendererKind, xScale: ScaleKind, yScale: ScaleKind, hidden: number, view?: {x: number[], y: number[]}, maxWidth?: string, legendPage?: number, legendQuery?: string}} getState
 * @property {(preserveFullscreen?: boolean) => void} [destroy]
 *
 * @typedef {Object} Mark   one drawn point
 * @property {Point} point  original input point
 * @property {string} group
 * @property {number} slot  index into the color/shape tables
 * @property {number} noise jitter factor in [-1, 1]
 * @property {number} x     drawn x (after jitter)
 * @property {number} y
 *
 * @typedef {Object} Mean   one mean marker (per distinct x)
 * @property {number} x
 * @property {number} y
 * @property {number} n
 *
 * @typedef {{kind: 'point', mark: Mark} | {kind: 'mean', mean: Mean}} Hit
 */

const MARGIN = { top: 20, right: 24, bottom: 52, left: 72 };
const HEIGHT = 360;
const HIT_RADIUS = 24;        // px; hover target is much bigger than the mark
const LOG_MEAN_HALF_PX = 12;  // mean bars have no fixed width in x units on a log axis
const TICK_FONT_PX = 12;      // tick label size; keep in step with .tick-label (styles.css) and render-canvas.js
const TREND_SAMPLES = 64;     // a straight line is a curve on a log axis

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** @param {number} v */
function formatValue(v) {
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Deterministic pseudo-random number in [-1, 1] for index i, so jitter
 * stays put across re-renders instead of shimmering while panning.
 * @param {number} i
 */
function stableNoise(i) {
  const s = Math.sin((i + 1) * 12.9898) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {string} [className]
 * @param {string} [text]
 * @returns {HTMLElementTagNameMap[K]}
 */
function htmlEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** @type {CanvasRenderingContext2D | null} offscreen context for measuring tick labels */
let measureCtx = null;

/**
 * Width in px of the widest label at the tick-label font. Labels come from
 * uploaded CSVs, so they're measured rather than estimated per character.
 * @param {string[]} labels
 * @param {string} fontFamily
 */
function widestLabelPx(labels, fontFamily) {
  const ctx = measureCtx ??= document.createElement('canvas').getContext('2d');
  // No 2D context: assume every character is as wide as the font size, which
  // is wider than any glyph measured (uppercase W is ~11.6px at 12px).
  if (!ctx) return Math.max(0, ...labels.map((l) => l.length)) * TICK_FONT_PX;
  ctx.font = `${TICK_FONT_PX}px ${fontFamily}`;
  return Math.max(0, ...labels.map((l) => ctx.measureText(l).width));
}

/**
 * Mean y for each distinct (un-jittered) x.
 * @param {Mark[]} marks
 * @returns {Mean[]}
 */
function computeMeans(marks) {
  /** @type {Map<number, {sum: number, n: number}>} */
  const acc = new Map();
  for (const m of marks) {
    const a = acc.get(m.point.x) ?? { sum: 0, n: 0 };
    a.sum += m.point.y;
    a.n += 1;
    acc.set(m.point.x, a);
  }
  return [...acc].map(([x, { sum, n }]) => ({ x, y: sum / n, n }));
}

// ---------------------------------------------------------------------------
// The chart
// ---------------------------------------------------------------------------

/**
 * Render an interactive plot into `container`, replacing its contents.
 * @param {HTMLElement} container
 * @param {PlotInput} input
 * @param {PlotOptions} [options]
 * @returns {ChartHandle}
 */
export function drawScatter(container, input, options = {}) {
  const { title, xLabel, yLabel, xTickLabels, showTrend = false, showMeans = false, connectGroups = false } = input;
  // Jitter would make lines zig-zag sideways, so lines always plot at the exact x.
  const jitter = connectGroups ? 0 : input.jitter ?? 0;
  const points = input.points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

  /** @type {RendererKind} */ let rendererKind = options.renderer ?? 'canvas';
  const kinds = { x: options.xScale ?? 'linear', y: options.yScale ?? 'linear' };
  // Categorical x (weekday names) has no meaningful log scale.
  const xScalable = !xTickLabels;
  if (!xScalable) kinds.x = 'linear';
  const widestCategoryPx = xTickLabels ? widestLabelPx(Object.values(xTickLabels), getComputedStyle(container).fontFamily) : 0;

  container.replaceChildren();
  container.classList.add('scatter');
  container.append(htmlEl('h2', 'scatter-title', title));

  /** @type {ChartHandle} */
  const handle = {
    setRenderer: () => {},
    setScale: () => {},
    getState: () => ({ renderer: rendererKind, xScale: kinds.x, yScale: kinds.y, hidden: 0 }),
  };

  if (points.length === 0 && !input.groupNames?.length) {
    container.append(htmlEl('p', 'scatter-empty', 'No data to plot.'));
    return handle;
  }

  // Groups are sorted by name so the same person gets the same color and
  // shape on every chart, regardless of input order.
  const groups = input.groupNames ?? [...new Set(points.map((p) => p.group ?? ''))].sort();
  const slots = new Map(groups.map((g, i) => [g, input.groupSlots?.[g] ?? i]));
  const hasGroups = groups.length > 1 || groups[0] !== '';

  /** @type {Mark[]} */
  const marks = points.map((p, i) => ({
    point: p,
    group: p.group ?? '',
    slot: slots.get(p.group ?? '') ?? 0,
    noise: stableNoise(i),
    x: p.x,
    y: p.y,
  }));

  /** @param {Mark} m */
  const plottable = (m) => isPlottable(kinds.x, m.point.x) && isPlottable(kinds.y, m.point.y);

  /** Drawn x/y depend on the scale kind (jitter is additive on linear, multiplicative on log). */
  function placeMarks() {
    for (const m of marks) {
      m.x = kinds.x === 'log' ? m.point.x * 10 ** (jitter * m.noise) : m.point.x + jitter * m.noise;
      m.y = m.point.y;
    }
  }

  // Initial ("home") view per axis, in t-space (see scales.js). With tick
  // labels (categorical-ish x), give each labeled position half a unit of
  // room on either side.
  /** @returns {[number, number]} */
  function homeX() {
    const xs = points.map((p) => p.x);
    if (xTickLabels) {
      const keys = Object.keys(xTickLabels).map(Number).concat(xs);
      return [keys.reduce((a, b) => Math.min(a, b), Infinity) - 0.5, keys.reduce((a, b) => Math.max(a, b), -Infinity) + 0.5];
    }
    return paddedExtent(kinds.x, input.xRanges?.[kinds.x] ?? xs);
  }
  /** @returns {[number, number]} */
  function homeY() {
    return paddedExtent(kinds.y, input.yRanges?.[kinds.y] ?? points.map((p) => p.y));
  }
  let home = { x: homeX(), y: homeY() };
  let view = options.view ?? { x: home.x, y: home.y };

  /** @type {Set<string>} groups switched off in the legend */
  const hidden = new Set(input.hiddenGroups ?? []);
  /** @type {string | null} group being hovered in the legend */
  let highlighted = null;

  // ---- DOM skeleton -------------------------------------------------------
  const legend = htmlEl('div', 'scatter-legend');
  legend.setAttribute('role', 'group');
  legend.setAttribute('aria-label', `${title} legend`);

  const toolbar = htmlEl('div', 'scatter-toolbar');
  const hint = htmlEl('span', 'scatter-hint', 'Drag to pan · Ctrl/⌘ + scroll to zoom · double-click to reset');
  const resetBtn = htmlEl('button', 'scatter-reset', 'Reset view');
  resetBtn.type = 'button';
  toolbar.append(hint);

  /** @type {Record<'x' | 'y', HTMLSelectElement>} */
  const selects = /** @type {any} */ ({});
  if (options.controls ?? true) {
    for (const axis of /** @type {const} */ (['y', 'x'])) {
      if (axis === 'x' && !xScalable) continue;
      const label = htmlEl('label', 'scatter-scale');
      const select = htmlEl('select');
      select.append(new Option('Linear', 'linear'), new Option('Log', 'log'));
      select.value = kinds[axis];
      select.setAttribute('aria-label', `${axis.toUpperCase()} axis scale`);
      select.addEventListener('change', () => setScale(axis, /** @type {ScaleKind} */ (select.value)));
      selects[axis] = select;
      label.append(`${axis.toUpperCase()} scale `, select);
      toolbar.append(label);
    }
  }
  toolbar.append(resetBtn);

  const plot = htmlEl('div', 'scatter-plot');
  const tooltip = htmlEl('div', 'scatter-tooltip');
  tooltip.hidden = true;

  container.append(legend, toolbar, plot);

  // ---- Render state read by the event handlers ----------------------------
  let plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  let plotW = 0;
  /** @type {import('./scales.js').Scale} */ let sx = makeScale(kinds.x, view.x, [0, 1]);
  /** @type {import('./scales.js').Scale} */ let sy = makeScale(kinds.y, view.y, [0, 1]);
  /** @type {import('./render-common.js').Scene | null} */ let scene = null;
  /** @type {import('./render-common.js').Renderer} */
  let renderer = rendererKind === 'svg' ? createSvgRenderer() : createCanvasRenderer();
  // r/n for the trend line. Shown as HTML in the legend rather than drawn over
  // the plot, so it can't hide data and is the same text in both renderers.
  let statText = '';
  /** @type {HTMLSpanElement | null} */ let trendStatEl = null;

  placeMarks();

  /** Number of (legend-visible) points that the current scales can't draw. */
  function countUnplottable() {
    return marks.filter((m) => !hidden.has(m.group) && !plottable(m)).length;
  }

  /** Tells the page, through `options.onHidden`, how many points the current scales can't draw. */
  function reportHidden() {
    const n = countUnplottable();
    options.onHidden?.(n, { ...kinds });
  }

  /**
   * Gridline positions and labels for one axis over the current view. A category x axis
   * labels every step-th category (blank text for the rest), a log axis uses `logTicks`,
   * and a linear axis uses `niceTicks`. Reads `view`, `sx`/`sy` and the plot size, so call
   * it after the scales are rebuilt.
   * @param {'x' | 'y'} axis
   * @returns {{px: number, text: string}[]}  pixel position and label text, in tick order
   */
  function tickList(axis) {
    const isX = axis === 'x';
    const kind = kinds[axis];
    const [t0, t1] = view[axis];
    const scale = isX ? sx : sy;
    const px = isX ? plotW : plotH;
    if (isX && xTickLabels) {
      // When the labels would overlap, label every step-th category (by index,
      // so labels don't jump while panning). Gridlines still mark every category.
      const step = categoryLabelStep(Math.abs(scale.map(1) - scale.map(0)), widestCategoryPx);
      return Object.entries(xTickLabels)
        .map(([k, text]) => ({ v: Number(k), text }))
        .filter((t) => t.v >= t0 && t.v <= t1)
        .map(({ v, text }) => ({ px: scale.map(v), text: v % step === 0 ? text : '' }));
    }
    if (kind === 'log') {
      return logTicks(t0, t1, Math.max(3, Math.round(px / (isX ? 70 : 40))))
        .map((v) => ({ px: scale.map(v), text: formatLogTick(v) }));
    }
    const nt = niceTicks(t0, t1, Math.max(2, Math.round(px / (isX ? 90 : 56))));
    return nt.ticks.map((v) => ({ px: scale.map(v), text: formatTick(v, nt.step) }));
  }

  const fitCache = new Map();
  let meanCache = null;
  let dataVersion = 0;

  /**
   * Turns the current data, scales, view and legend state into a pixel-space Scene that either
   * renderer can draw. Points the scales can't draw (zero or negative on a log axis) and
   * groups hidden in the legend are left out. The trend line is only built when there are two
   * or more visible points and the fit is finite.
   * Side effects: rebuilds `sx`/`sy`, updates the plot size and `statText`, and fills the
   * fit and mean caches.
   * @returns {import('./render-common.js').Scene}
   */
  function buildScene() {
    // Floor keeps a usable data area (240 - 96px of margins = 144px) without
    // overflowing the card on 360px-wide phones, where the plot gets 294px.
    const width = Math.max(240, plot.clientWidth || 640);
    const expanded = document.fullscreenElement === container || container.classList.contains('chart-expanded');
    const height = expanded ? Math.max(HEIGHT, window.innerHeight - 210 - legend.clientHeight) : HEIGHT;
    plotH = height - MARGIN.top - MARGIN.bottom;
    plotW = width - MARGIN.left - MARGIN.right;
    const left = MARGIN.left;
    const right = MARGIN.left + plotW;
    const top = MARGIN.top;
    const bottom = MARGIN.top + plotH;

    sx = makeScale(kinds.x, view.x, [left, right]);
    sy = makeScale(kinds.y, view.y, [bottom, top]); // screen y grows downward

    const visible = marks.filter((m) => !hidden.has(m.group) && plottable(m));

    /** @type {[number, number][] | null} */
    let trend = null;
    let stat = '';
    if (showTrend && visible.length >= 2) {
      const xy = visible.map((m) => ({ x: m.point.x, y: m.point.y }));
      const cacheKey = `${dataVersion}:${kinds.x}:${kinds.y}`;
      if (!fitCache.has(cacheKey)) fitCache.set(cacheKey, input.statsOverride ?? computeStats(xy));
      const stats = fitCache.get(cacheKey);
      if (Number.isFinite(stats.slope) && Number.isFinite(stats.intercept)) {
        const straight = kinds.x === 'linear' && kinds.y === 'linear';
        const samples = straight ? 2 : TREND_SAMPLES;
        trend = [];
        for (let i = 0; i < samples; i++) {
          const xv = fromT(kinds.x, view.x[0] + ((view.x[1] - view.x[0]) * i) / (samples - 1));
          const yv = stats.slope * xv + stats.intercept;
          if (isPlottable(kinds.y, yv)) trend.push([sx.map(xv), sy.map(yv)]);
        }
        if (trend.length < 2) trend = null;
      }
      stat = `r = ${Number.isFinite(stats.r) ? stats.r.toFixed(2) : '—'}  (n = ${stats.n})`;
      if (typeof stats.p_value === 'number' && Number.isFinite(stats.p_value)) {
        stat += `  p = ${stats.p_value < 0.001 ? '<0.001' : stats.p_value.toFixed(3)}`;
      }
    }

    statText = stat;
    const lines = [];
    if (connectGroups) {
      const buckets = new Map();
      for (const m of visible) { if (!buckets.has(m.group)) buckets.set(m.group, []); buckets.get(m.group).push(m); }
      for (const [group, unsorted] of buckets) {
        const pts = unsorted.sort((a, b) => a.x - b.x);
        if (pts.length < 2) continue;
        lines.push({
          group, slot: pts[0].slot, pts: /** @type {[number, number][]} */ (pts.map((m) => [sx.map(m.x), sy.map(m.y)])),
        });
      }
    }

    meanCache ??= showMeans ? (input.meanPoints ?? computeMeans(visible)).filter(m => isPlottable(kinds.x, m.x) && isPlottable(kinds.y, m.y)) : [];
    const means = meanCache.map((mean) => {
      const c = sx.map(mean.x);
      const half = kinds.x === 'log' ? LOG_MEAN_HALF_PX : Math.abs(sx.map(mean.x + MEAN_HALF_WIDTH) - c);
      return { x0: c - half, x1: c + half, y: sy.map(mean.y), mean };
    });

    return {
      width,
      height,
      plot: { left, right, top, bottom },
      xTicks: tickList('x'),
      yTicks: tickList('y'),
      xLabel,
      yLabel,
      trend,
      lines,
      marks: visible.map((m) => ({ px: sx.map(m.x), py: sy.map(m.y), slot: m.slot, group: m.group, mark: m })),
      means,
      ariaLabel: `${title}: ${yLabel} against ${xLabel}`,
    };
  }

  /** Rebuild the scene and hand it to the renderer. Cheap: data is small. */
  function render() {
    scene = buildScene();
    renderer.draw(scene);
    renderer.setHighlight(highlighted);
    // render() runs on every pan frame, but r only changes with the legend or scales.
    if (trendStatEl && trendStatEl.textContent !== statText) trendStatEl.textContent = statText;
  }

  // ---- Hover / tooltip ----------------------------------------------------

  /**
   * Nearest point or mean bar within HIT_RADIUS pixels, or null.
   * Brute force is fine for a few hundred points.
   * @param {number} px
   * @param {number} py
   * @returns {Hit | null}
   */
  function nearest(px, py) {
    if (!scene) return null;
    /** @type {Hit | null} */
    let best = null;
    let bestD = HIT_RADIUS ** 2;
    for (const m of scene.marks) {
      const d = (m.px - px) ** 2 + (m.py - py) ** 2;
      if (d < bestD) { bestD = d; best = { kind: 'point', mark: m.mark }; }
    }
    for (const bar of scene.means) {
      // Distance to the horizontal bar segment, not just its center.
      const cx = Math.min(Math.max(px, bar.x0), bar.x1);
      const d = (cx - px) ** 2 + (bar.y - py) ** 2;
      if (d < bestD) { bestD = d; best = { kind: 'mean', mean: bar.mean }; }
    }
    return best;
  }

  /** @param {number} x */
  function xText(x) {
    return xTickLabels?.[x] ?? formatValue(x);
  }

  /**
   * What the tooltip says for a point or mean bar. Shared with the SVG export,
   * which turns it into native <title> tooltips.
   * @param {Hit} hit
   * @returns {{heading: string, rows: [string, string][]}}
   */
  function tooltipContent(hit) {
    if (hit.kind === 'point') {
      const { point, group } = hit.mark;
      /** @type {[string, string][]} */
      const rows = [[xLabel, xText(point.x)], [yLabel, formatValue(point.y)]];
      if (point.category) rows.unshift(['Category', point.category]);
      return { heading: hasGroups ? group || '(no group)' : '', rows };
    }
    const { mean } = hit;
    return { heading: 'Mean', rows: [[xLabel, xText(mean.x)], [yLabel, formatValue(mean.y)], ['n', String(mean.n)]] };
  }

  /** @param {Hit} hit */
  function tooltipText(hit) {
    const { heading, rows } = tooltipContent(hit);
    return [heading, ...rows.map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join('\n');
  }

  // Tooltip text for every drawn point and mean bar, in drawing order, for the SVG export.
  function exportTooltips() {
    if (!scene) return null;
    return {
      points: scene.marks.map((m) => tooltipText({ kind: 'point', mark: m.mark })),
      means: scene.means.map((bar) => tooltipText({ kind: 'mean', mean: bar.mean })),
    };
  }

  /**
   * @param {Hit | null} hit
   * @param {number} px
   * @param {number} py
   */
  function showTooltip(hit, px, py) {
    if (!hit) { hideTooltip(); return; }

    const { heading, rows } = tooltipContent(hit);
    if (hit.kind === 'point') renderer.setHover({ px: sx.map(hit.mark.x), py: sy.map(hit.mark.y) });
    else renderer.setHover(null);

    // textContent only: group names come from user-uploaded CSVs.
    tooltip.replaceChildren();
    if (heading) tooltip.append(htmlEl('div', 'tt-heading', heading));
    for (const [k, v] of rows) {
      const row = htmlEl('div', 'tt-row');
      row.append(htmlEl('span', 'tt-key', k), htmlEl('span', 'tt-value', v));
      tooltip.append(row);
    }
    tooltip.hidden = false;

    // Place to the upper-right of the cursor; flip left near the right edge.
    const tw = tooltip.offsetWidth;
    const flip = px + 16 + tw > plot.clientWidth;
    tooltip.style.left = `${flip ? px - 16 - tw : px + 16}px`;
    tooltip.style.top = `${Math.max(0, py - tooltip.offsetHeight - 8)}px`;
  }

  function hideTooltip() {
    tooltip.hidden = true;
    renderer.setHover(null);
  }

  // ---- Zoom / pan ---------------------------------------------------------
  // The view is in t-space, so these are plain linear operations on either scale.

  /** @param {MouseEvent} e */
  function localXY(e) {
    const rect = plot.getBoundingClientRect();
    return { px: e.clientX - rect.left, py: e.clientY - rect.top };
  }

  function resetView() {
    view = { x: home.x, y: home.y };
    hideTooltip();
    render();
  }

  /** @type {{px: number, py: number, x: [number, number], y: [number, number]} | null} */
  let drag = null;

  plot.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { px: e.clientX, py: e.clientY, x: view.x, y: view.y };
    plot.setPointerCapture(e.pointerId);
    plot.classList.add('dragging');
    hideTooltip();
  });

  plot.addEventListener('pointermove', (e) => {
    if (drag) {
      // Convert the pixel delta to t-space units using the view at drag start.
      const dx = ((e.clientX - drag.px) * (drag.x[1] - drag.x[0])) / plotW;
      const dy = ((e.clientY - drag.py) * (drag.y[1] - drag.y[0])) / plotH;
      view = {
        x: [drag.x[0] - dx, drag.x[1] - dx],
        y: [drag.y[0] + dy, drag.y[1] + dy], // screen y is inverted
      };
      render();
      return;
    }
    const { px, py } = localXY(e);
    showTooltip(nearest(px, py), px, py);
  });

  const endDrag = () => {
    drag = null;
    plot.classList.remove('dragging');
  };
  plot.addEventListener('pointerup', endDrag);
  plot.addEventListener('pointercancel', endDrag);
  plot.addEventListener('pointerleave', hideTooltip);

  // Zoom only with Ctrl/⌘ (trackpad pinch also sets ctrlKey), so plain
  // scrolling still scrolls the page past the chart.
  plot.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const { px, py } = localXY(e);
    // Small steps: a mouse-wheel notch (deltaY ~100) is about 20%.
    const f = Math.exp(Math.max(-100, Math.min(100, e.deltaY)) * 0.002); // >1 zooms out, <1 zooms in

    // Keep zoom within 1/50x .. 10x of the home view.
    const span = (view.x[1] - view.x[0]) * f;
    const homeSpan = home.x[1] - home.x[0];
    if (span < homeSpan / 50 || span > homeSpan * 10) return;

    // Zoom about the cursor: the data point under it stays fixed.
    const cx = sx.invertT(px);
    const cy = sy.invertT(py);
    view = {
      x: [cx + (view.x[0] - cx) * f, cx + (view.x[1] - cx) * f],
      y: [cy + (view.y[0] - cy) * f, cy + (view.y[1] - cy) * f],
    };
    hideTooltip();
    render();
  }, { passive: false });

  plot.addEventListener('dblclick', resetView);
  resetBtn.addEventListener('click', resetView);

  // ---- Public controls ----------------------------------------------------

  /**
   * Switches between the Canvas and SVG renderers and redraws. Does nothing when the kind
   * is unchanged. Side effects: hides the tooltip, destroys the old renderer's element and
   * listeners, and swaps in a new one.
   * @param {RendererKind} kind
   */
  function setRenderer(kind) {
    if (kind === rendererKind) return;
    rendererKind = kind;
    hideTooltip();
    renderer.destroy();
    renderer = kind === 'svg' ? createSvgRenderer() : createCanvasRenderer();
    plot.replaceChildren(renderer.el, tooltip);
    render();
  }

  /**
   * Switches one axis between linear and log scale and returns both axes to their home view.
   * Does nothing when the kind is unchanged, or for x on a category axis (it stays linear).
   * Side effects: updates that axis's scale select, clears cached means, hides the tooltip,
   * redraws, and reports points the log axes cannot show through `onHidden`.
   * @param {'x' | 'y'} axis
   * @param {ScaleKind} kind
   */
  function setScale(axis, kind) {
    if (axis === 'x' && !xScalable) return;
    if (kind === kinds[axis]) return;
    kinds[axis] = kind;
    meanCache = null;
    if (selects[axis]) selects[axis].value = kind;
    placeMarks();
    // The old view is in the other scale's units, and zoom always scales both
    // axes together, so resetting only this axis would leave the other zoomed.
    home = { x: homeX(), y: homeY() };
    view = { x: home.x, y: home.y };
    hideTooltip();
    render();
    reportHidden();
  }

  handle.setRenderer = setRenderer;
  handle.setScale = setScale;
  handle.getState = () => ({ renderer: rendererKind, xScale: kinds.x, yScale: kinds.y, hidden: countUnplottable(), view: { x: [...view.x], y: [...view.y] }, maxWidth: layout.getWidth(), legendPage, legendQuery });

  // ---- Legend: retain per-chart hide/show, with bounded controls for large data.
  let legendPage = options.legendPage ?? 0;
  let legendQuery = options.legendQuery ?? '';
  function legendButton(group) {
    const slot = slots.get(group) ?? 0;
    const btn = htmlEl('button', 'legend-item');
    btn.type = 'button'; btn.title = 'Click to show/hide';
    btn.setAttribute('aria-pressed', String(!hidden.has(group)));
    btn.append(markerSwatch(slot), htmlEl('span', '', group || '(no group)'));
    btn.addEventListener('click', () => {
      if (hidden.has(group)) hidden.delete(group); else hidden.add(group);
      btn.setAttribute('aria-pressed', String(!hidden.has(group)));
      if (highlighted === group && hidden.has(group)) highlighted = null;
      hideTooltip(); fitCache.clear(); meanCache = null; dataVersion++;
      if (options.onVisibilityChange) options.onVisibilityChange([...hidden]);
      else { render(); reportHidden(); }
    });
    // A hidden group has nothing to highlight; highlighting it would dim every visible group.
    const on = () => { if (hidden.has(group)) return; highlighted = group; renderer.setHighlight(group); };
    const off = () => { highlighted = null; renderer.setHighlight(null); };
    btn.addEventListener('mouseenter', on); btn.addEventListener('focus', on);
    btn.addEventListener('mouseleave', off); btn.addEventListener('blur', off);
    return btn;
  }
  const legendItems = htmlEl('div', 'legend-items');
  if (hasGroups && groups.length > 20) {
    const find = htmlEl('input'); find.type = 'search'; find.placeholder = 'Find a group'; find.value = legendQuery;
    find.setAttribute('aria-label', 'Find a group in this legend');
    const previous = htmlEl('button', '', 'Previous groups'); previous.type = 'button';
    const next = htmlEl('button', '', 'Next groups'); next.type = 'button';
    const count = htmlEl('span', 'legend-count');
    const controls = htmlEl('div', 'legend-paging'); controls.append(find, previous, count, next);
    const redrawLegend = () => {
      const matching = groups.filter(g => g.toLowerCase().includes(legendQuery.trim().toLowerCase()));
      const pages = Math.max(1, Math.ceil(matching.length / 20));
      legendPage = Math.min(Math.max(0, legendPage), pages - 1);
      legendItems.replaceChildren(...matching.slice(legendPage * 20, (legendPage + 1) * 20).map(legendButton));
      count.textContent = `${legendPage + 1} / ${pages} · ${matching.length} groups`;
      previous.disabled = legendPage === 0; next.disabled = legendPage + 1 === pages;
    };
    find.addEventListener('input', () => { legendQuery = find.value; legendPage = 0; redrawLegend(); });
    previous.onclick = () => { legendPage--; redrawLegend(); };
    next.onclick = () => { legendPage++; redrawLegend(); };
    legend.append(controls, legendItems); redrawLegend();
  } else if (hasGroups) { legendItems.append(...groups.map(legendButton)); legend.append(legendItems); }
  if (input.aggregate) legend.append(lineKey('mean', 'Category mean (visible groups)'));
  if (showMeans) legend.append(lineKey('mean', 'Mean'));
  if (showTrend) {
    const key = lineKey('trend', 'Linear fit');
    trendStatEl = htmlEl('span', 'trend-stat');
    key.append(trendStatEl);
    legend.append(key);
  }

  /** @param {number} slot */
  function markerSwatch(slot) {
    const s = svgEl('svg', { width: 14, height: 14, viewBox: '-7 -7 14 14', 'aria-hidden': 'true' });
    svgEl('path', { d: shapePath(slot, POINT_R), fill: colorFor(slot), class: 'point' }, s);
    return s;
  }

  /**
   * Static legend key for a line mark (mean bar / trend line).
   * @param {string} cls
   * @param {string} text
   */
  function lineKey(cls, text) {
    const item = htmlEl('span', 'legend-key');
    const s = svgEl('svg', { width: 18, height: 14, 'aria-hidden': 'true' });
    svgEl('line', { x1: 1, x2: 17, y1: 7, y2: 7, class: cls }, s);
    item.append(s, htmlEl('span', '', text));
    return item;
  }

  // ---- Initial render + re-render on width change -------------------------
  plot.append(renderer.el, tooltip);
  render();
  reportHidden();
  let lastWidth = plot.clientWidth;
  const observer = new ResizeObserver(() => {
    if (plot.clientWidth === lastWidth) return;
    lastWidth = plot.clientWidth;
    hideTooltip();
    render();
  });
  observer.observe(plot);
  const layout = addLayoutControls(container, () => { hideTooltip(); render(); }, options.maxWidth ?? '960');
  const removeImages = addImageActions(container, { tooltips: exportTooltips });
  const resize = () => { hideTooltip(); render(); };
  window.addEventListener('resize', resize);
  handle.destroy = (preserveFullscreen = false) => { observer.disconnect(); window.removeEventListener('resize', resize); removeImages(); layout.destroy(preserveFullscreen); renderer.destroy(); container.replaceChildren(); };

  return handle;
}
