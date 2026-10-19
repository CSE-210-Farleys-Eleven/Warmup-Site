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
import {
  formatLogTick, formatTick, fromT, isPlottable, logTicks, makeScale, niceTicks, paddedExtent,
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
 *
 * @typedef {Object} PlotInput
 * @property {string} title
 * @property {string} xLabel
 * @property {string} yLabel
 * @property {Point[]} points
 * @property {Object<number,string>} [xTickLabels]  // e.g. {0:"Mon",...,6:"Sun"}
 * @property {boolean} [showTrend]   // linear fit line + r in the corner
 * @property {boolean} [showMeans]   // mean marker per distinct x (weekday plots)
 * @property {number}  [jitter]      // horizontal jitter in x units (weekday plots)
 * @property {boolean} [connectGroups] // join each group's points in x order (line chart)
 *
 * @typedef {'canvas' | 'svg'} RendererKind
 * @typedef {import('./scales.js').ScaleKind} ScaleKind
 *
 * @typedef {Object} PlotOptions
 * @property {RendererKind} [renderer]   default 'canvas'
 * @property {ScaleKind} [xScale]        default 'linear'
 * @property {ScaleKind} [yScale]        default 'linear'
 * @property {(hidden: number) => void} [onHidden]  called whenever the number of points that
 *                                       can't be drawn on a log axis (value <= 0) changes
 * @property {boolean} [controls]        show the scale selects in the chart toolbar (default true)
 *
 * @typedef {Object} ChartHandle
 * @property {(kind: RendererKind) => void} setRenderer
 * @property {(axis: 'x' | 'y', kind: ScaleKind) => void} setScale
 * @property {() => {renderer: RendererKind, xScale: ScaleKind, yScale: ScaleKind, hidden: number}} getState
 * @property {() => Promise<void>} downloadImage
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

/** @param {string} text */
function safeFileName(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'chart';
}

/**
 * @param {Blob} blob
 * @param {string} filename
 */
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = htmlEl('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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

  container.replaceChildren();
  container.classList.add('scatter');
  container.append(htmlEl('h2', 'scatter-title', title));

  /** @type {ChartHandle} */
  const handle = {
    setRenderer: () => {},
    setScale: () => {},
    getState: () => ({ renderer: rendererKind, xScale: kinds.x, yScale: kinds.y, hidden: 0 }),
    downloadImage: async () => {},
  };

  if (points.length === 0) {
    container.append(htmlEl('p', 'scatter-empty', 'No data to plot.'));
    return handle;
  }

  // Groups are sorted by name so the same person gets the same color and
  // shape on every chart, regardless of input order.
  const groups = [...new Set(points.map((p) => p.group ?? ''))].sort();
  const hasGroups = groups.length > 1 || groups[0] !== '';

  /** @type {Mark[]} */
  const marks = points.map((p, i) => ({
    point: p,
    group: p.group ?? '',
    slot: groups.indexOf(p.group ?? ''),
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
      return [Math.min(...keys) - 0.5, Math.max(...keys) + 0.5];
    }
    return paddedExtent(kinds.x, xs);
  }
  /** @returns {[number, number]} */
  function homeY() {
    return paddedExtent(kinds.y, points.map((p) => p.y));
  }
  let home = { x: homeX(), y: homeY() };
  let view = { x: home.x, y: home.y };

  /** @type {Set<string>} groups switched off in the legend */
  const hidden = new Set();
  /** @type {string | null} group being hovered in the legend */
  let highlighted = null;

  // ---- DOM skeleton -------------------------------------------------------
  const legend = htmlEl('div', 'scatter-legend');
  legend.setAttribute('role', 'group');
  legend.setAttribute('aria-label', `${title} legend`);

  const toolbar = htmlEl('div', 'scatter-toolbar');
  const hint = htmlEl('span', 'scatter-hint', 'Drag to pan · Ctrl/⌘ + scroll to zoom · double-click to reset');
  const resetBtn = htmlEl('button', 'scatter-reset', 'Reset view');
  const downloadBtn = htmlEl('button', 'scatter-download', 'Download');
  resetBtn.type = 'button';
  downloadBtn.type = 'button';
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
  toolbar.append(downloadBtn, resetBtn);

  const plot = htmlEl('div', 'scatter-plot');
  const tooltip = htmlEl('div', 'scatter-tooltip');
  tooltip.hidden = true;

  container.append(legend, toolbar, plot, buildTable());

  // ---- Render state read by the event handlers ----------------------------
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  let plotW = 0;
  /** @type {import('./scales.js').Scale} */ let sx = makeScale(kinds.x, view.x, [0, 1]);
  /** @type {import('./scales.js').Scale} */ let sy = makeScale(kinds.y, view.y, [0, 1]);
  /** @type {import('./render-common.js').Scene | null} */ let scene = null;
  /** @type {import('./render-common.js').Renderer} */
  let renderer = rendererKind === 'svg' ? createSvgRenderer() : createCanvasRenderer();
  let lastHidden = -1;

  placeMarks();

  /** Number of (legend-visible) points that the current scales can't draw. */
  function countUnplottable() {
    return marks.filter((m) => !hidden.has(m.group) && !plottable(m)).length;
  }

  function reportHidden() {
    const n = countUnplottable();
    if (n !== lastHidden) { lastHidden = n; options.onHidden?.(n); }
  }

  /** @param {'x' | 'y'} axis */
  function tickList(axis) {
    const isX = axis === 'x';
    const kind = kinds[axis];
    const [t0, t1] = view[axis];
    const scale = isX ? sx : sy;
    const px = isX ? plotW : plotH;
    if (isX && xTickLabels) {
      return Object.entries(xTickLabels)
        .map(([k, text]) => ({ v: Number(k), text }))
        .filter((t) => t.v >= t0 && t.v <= t1)
        .map(({ v, text }) => ({ px: scale.map(v), text }));
    }
    if (kind === 'log') {
      return logTicks(t0, t1, Math.max(3, Math.round(px / (isX ? 70 : 40))))
        .map((v) => ({ px: scale.map(v), text: formatLogTick(v) }));
    }
    const nt = niceTicks(t0, t1, Math.max(2, Math.round(px / (isX ? 90 : 56))));
    return nt.ticks.map((v) => ({ px: scale.map(v), text: formatTick(v, nt.step) }));
  }

  /** @returns {import('./render-common.js').Scene} */
  function buildScene() {
    const width = Math.max(320, plot.clientWidth || 640);
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
    /** @type {string | null} */
    let cornerLabel = null;
    if (showTrend && visible.length >= 2) {
      const xy = visible.map((m) => ({ x: m.point.x, y: m.point.y }));
      const stats = computeStats(xy);
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
      cornerLabel = `r = ${Number.isFinite(stats.r) ? stats.r.toFixed(2) : '—'}  (n = ${stats.n})`;
      if (typeof stats.p_value === 'number' && Number.isFinite(stats.p_value)) {
        cornerLabel += `  p = ${stats.p_value < 0.001 ? '<0.001' : stats.p_value.toFixed(3)}`;
      }
    }

    const lines = [];
    if (connectGroups) {
      for (const group of groups) {
        const pts = visible.filter((m) => m.group === group).sort((a, b) => a.x - b.x);
        if (pts.length < 2) continue;
        lines.push({
          group, slot: pts[0].slot, pts: /** @type {[number, number][]} */ (pts.map((m) => [sx.map(m.x), sy.map(m.y)])),
        });
      }
    }

    const means = (showMeans ? computeMeans(visible) : []).map((mean) => {
      const c = sx.map(mean.x);
      const half = kinds.x === 'log' ? LOG_MEAN_HALF_PX : Math.abs(sx.map(mean.x + MEAN_HALF_WIDTH) - c);
      return { x0: c - half, x1: c + half, y: sy.map(mean.y), mean };
    });

    return {
      width,
      height: HEIGHT,
      plot: { left, right, top, bottom },
      xTicks: tickList('x'),
      yTicks: tickList('y'),
      xLabel,
      yLabel,
      trend,
      cornerLabel,
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
   * @param {Hit | null} hit
   * @param {number} px
   * @param {number} py
   */
  function showTooltip(hit, px, py) {
    if (!hit) { hideTooltip(); return; }

    /** @type {[string, string][]} */
    let rows;
    let heading;
    if (hit.kind === 'point') {
      const { mark } = hit;
      heading = hasGroups ? mark.group || '(no group)' : '';
      rows = [[xLabel, xText(mark.point.x)], [yLabel, formatValue(mark.point.y)]];
      renderer.setHover({ px: sx.map(mark.x), py: sy.map(mark.y) });
    } else {
      const { mean } = hit;
      heading = 'Mean';
      rows = [[xLabel, xText(mean.x)], [yLabel, formatValue(mean.y)], ['n', String(mean.n)]];
      renderer.setHover(null);
    }

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

  /** @param {RendererKind} kind */
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
   * @param {'x' | 'y'} axis
   * @param {ScaleKind} kind
   */
  function setScale(axis, kind) {
    if (axis === 'x' && !xScalable) return;
    if (kind === kinds[axis]) return;
    kinds[axis] = kind;
    if (selects[axis]) selects[axis].value = kind;
    placeMarks();
    // The old view is in the other scale's units; start this axis over.
    home = { x: homeX(), y: homeY() };
    view = { ...view, [axis]: home[axis] };
    hideTooltip();
    render();
    reportHidden();
  }

  handle.setRenderer = setRenderer;
  handle.setScale = setScale;
  handle.getState = () => ({ renderer: rendererKind, xScale: kinds.x, yScale: kinds.y, hidden: countUnplottable() });

  async function downloadImage() {
    hideTooltip();
    const filename = `${safeFileName(title)}.${rendererKind === 'svg' ? 'svg' : 'png'}`;
    if (renderer.el instanceof HTMLCanvasElement) {
      const blob = await new Promise((resolve, reject) => {
        renderer.el.toBlob((value) => {
          if (value) resolve(value);
          else reject(new Error('Canvas export failed'));
        }, 'image/png');
      });
      triggerDownload(/** @type {Blob} */ (blob), filename);
      return;
    }
    if (renderer.el instanceof SVGSVGElement) {
      const svgText = new XMLSerializer().serializeToString(renderer.el);
      const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
      triggerDownload(blob, filename);
      return;
    }
    throw new Error('Unsupported renderer element for download');
  }

  downloadBtn.addEventListener('click', () => {
    downloadImage().catch(() => {});
  });
  handle.downloadImage = downloadImage;

  // ---- Legend -------------------------------------------------------------
  if (hasGroups) {
    groups.forEach((group, slot) => {
      const btn = htmlEl('button', 'legend-item');
      btn.type = 'button';
      btn.setAttribute('aria-pressed', 'true');
      btn.title = 'Click to show/hide';
      btn.append(markerSwatch(slot), htmlEl('span', '', group || '(no group)'));

      btn.addEventListener('click', () => {
        if (hidden.has(group)) hidden.delete(group); else hidden.add(group);
        btn.setAttribute('aria-pressed', String(!hidden.has(group)));
        hideTooltip();
        render();
        reportHidden();
      });
      const on = () => { highlighted = group; renderer.setHighlight(group); };
      const off = () => { highlighted = null; renderer.setHighlight(null); };
      btn.addEventListener('mouseenter', on);
      btn.addEventListener('focus', on);
      btn.addEventListener('mouseleave', off);
      btn.addEventListener('blur', off);
      legend.append(btn);
    });
  }
  if (showMeans) legend.append(lineKey('mean', 'Mean'));
  if (showTrend) legend.append(lineKey('trend', 'Linear fit'));

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

  // ---- Data table (accessible alternative to the picture) -----------------
  function buildTable() {
    const details = htmlEl('details', 'scatter-table');
    details.append(htmlEl('summary', '', 'Show data table'));
    const table = htmlEl('table');
    const headRow = htmlEl('tr');
    for (const h of [...(hasGroups ? ['Group'] : []), xLabel || 'X', yLabel || 'Y']) headRow.append(htmlEl('th', '', h));
    table.append(htmlEl('thead'));
    table.tHead?.append(headRow);

    const body = htmlEl('tbody');
    const sorted = [...points].sort((a, b) => (a.group ?? '').localeCompare(b.group ?? '') || a.x - b.x);
    for (const p of sorted) {
      const tr = htmlEl('tr');
      if (hasGroups) tr.append(htmlEl('td', '', p.group ?? ''));
      tr.append(htmlEl('td', 'num', xTickLabels?.[p.x] ?? formatValue(p.x)), htmlEl('td', 'num', formatValue(p.y)));
      body.append(tr);
    }
    table.append(body);
    details.append(table);
    return details;
  }

  // ---- Initial render + re-render on width change -------------------------
  plot.append(renderer.el, tooltip);
  render();
  reportHidden();
  let lastWidth = plot.clientWidth;
  new ResizeObserver(() => {
    if (plot.clientWidth === lastWidth) return;
    lastWidth = plot.clientWidth;
    hideTooltip();
    render();
  }).observe(plot);

  return handle;
}
