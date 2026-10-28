// @ts-check
/**
 * Canvas renderer: draws a Scene with the 2D context. Immediate mode, so
 * hover and highlight changes redraw the whole frame (the data is small).
 * Colors come from the same CSS custom properties the SVG renderer uses, read
 * at draw time so light/dark themes work.
 */
import { POINT_R, seriesVar, shapePath } from './render-common.js';

/** @typedef {import('./render-common.js').Scene} Scene */
/** @typedef {import('./render-common.js').Renderer} Renderer */

/**
 * Creates a renderer that draws scenes onto a new `<canvas>` (grid, ticks, axis titles, trend
 * line, series lines, markers, mean bars and hover ring, in that order).
 * Side effects: `draw` and the other methods repaint the whole canvas and resize its backing
 * store for the device pixel ratio; a listener on the OS color-scheme change is added and is
 * only removed by `destroy`, so call it when the chart is replaced. Nothing is drawn until
 * `draw` is called, and `setHover` / `setHighlight` before that only store state.
 * @returns {Renderer}  `el` is the canvas (not yet in the page); `draw(scene)` replaces the
 *   frame and clears any hover ring; `setHover(null)` hides the ring; `setHighlight(group)`
 *   dims every other group, and `null` clears it; `destroy()` detaches the canvas.
 */
export function createCanvasRenderer() {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));

  /** @type {Scene | null} */ let scene = null;
  /** @type {{px: number, py: number} | null} */ let hover = null;
  /** @type {string | null} */ let highlighted = null;
  /** @type {Map<number, Path2D>} */ const shapes = new Map();

  /** @param {number} slot */
  function shape(slot) {
    let p = shapes.get(slot);
    if (!p) { p = new Path2D(shapePath(slot, POINT_R)); shapes.set(slot, p); }
    return p;
  }

  function paint() {
    if (!scene) return;
    const { width, height, plot } = scene;
    const { left, right, top, bottom } = plot;
    const style = getComputedStyle(canvas);
    const css = (/** @type {string} */ name) => style.getPropertyValue(name).trim() || '#888';
    const font = style.fontFamily;
    const dpr = window.devicePixelRatio || 1;

    // Resizing the backing store clears it and resets the transform.
    const bw = Math.round(width * dpr);
    const bh = Math.round(height * dpr);
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = 'butt';
    ctx.setLineDash([]);

    // Grid
    ctx.strokeStyle = css('--grid');
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const { px: y } of scene.yTicks) { ctx.moveTo(left, y); ctx.lineTo(right, y); }
    for (const { px: x } of scene.xTicks) { ctx.moveTo(x, top); ctx.lineTo(x, bottom); }
    ctx.stroke();

    // Tick labels
    ctx.fillStyle = css('--text-muted');
    ctx.font = `12px ${font}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const { px: y, text } of scene.yTicks) ctx.fillText(text, left - 8, y);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (const { px: x, text } of scene.xTicks) ctx.fillText(text, x, bottom + 18);

    // Baselines
    ctx.strokeStyle = css('--axis');
    ctx.beginPath();
    ctx.moveTo(left, bottom); ctx.lineTo(right, bottom);
    ctx.moveTo(left, top); ctx.lineTo(left, bottom);
    ctx.stroke();

    // Axis titles
    ctx.fillStyle = css('--text-secondary');
    ctx.font = `13px ${font}`;
    ctx.textAlign = 'center';
    if (scene.xLabel) ctx.fillText(scene.xLabel, (left + right) / 2, height - 10);
    if (scene.yLabel) {
      ctx.save();
      ctx.translate(18, (top + bottom) / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(scene.yLabel, 0, 0);
      ctx.restore();
    }

    // Data, clipped to the plot area
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, right - left, bottom - top);
    ctx.clip();

    const dim = (/** @type {string} */ group) => (highlighted !== null && group !== highlighted ? 0.15 : 1);

    if (scene.trend) {
      ctx.strokeStyle = css('--text-secondary');
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      scene.trend.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = 2;
    for (const line of scene.lines) {
      ctx.globalAlpha = highlighted !== null && line.group !== highlighted ? 0.12 : 1;
      ctx.strokeStyle = css(seriesVar(line.slot));
      ctx.beginPath();
      line.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }

    ctx.strokeStyle = css('--surface'); // thin surface ring separates overlapping points
    ctx.lineWidth = 1.5;
    for (const m of scene.marks) {
      ctx.globalAlpha = dim(m.group);
      ctx.save();
      ctx.translate(m.px, m.py);
      ctx.fillStyle = css(seriesVar(m.slot));
      const p = shape(m.slot);
      ctx.fill(p);
      ctx.stroke(p);
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    ctx.lineCap = 'round';
    for (const mean of scene.means) {
      ctx.beginPath();
      ctx.moveTo(mean.x0, mean.y); ctx.lineTo(mean.x1, mean.y);
      ctx.strokeStyle = css('--surface'); ctx.lineWidth = 6; ctx.stroke();
      ctx.strokeStyle = css('--text-primary'); ctx.lineWidth = 2.5; ctx.stroke();
    }

    if (hover) {
      ctx.strokeStyle = css('--text-primary');
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(hover.px, hover.py, POINT_R + 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Colors are read at draw time, so repaint when the OS theme flips.
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  media?.addEventListener('change', paint);

  return {
    el: canvas,
    draw(s) {
      scene = s;
      hover = null; // a new frame means the view moved; the ring would be stale (SVG rebuilds it hidden too)
      canvas.setAttribute('aria-label', s.ariaLabel);
      paint();
    },
    setHover(pos) {
      if (!pos && !hover) return;
      hover = pos;
      paint();
    },
    setHighlight(group) { if (highlighted === group) return; highlighted = group; paint(); },
    destroy() { media?.removeEventListener('change', paint); canvas.remove(); },
  };
}
