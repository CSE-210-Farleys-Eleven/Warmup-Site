// @ts-check
/**
 * SVG renderer: draws a Scene as retained-mode SVG, styled by styles.css.
 */
import { POINT_R, colorFor, shapePath } from './render-common.js';

/** @typedef {import('./render-common.js').Scene} Scene */
/** @typedef {import('./render-common.js').Renderer} Renderer */

const SVG_NS = 'http://www.w3.org/2000/svg';
let clipCounter = 0; // unique clipPath ids when several charts share a page

/**
 * Creates an SVG element in the SVG namespace, sets its attributes and optionally appends it.
 * Attribute values are converted with `String`. Throws a DOMException for an invalid tag or
 * attribute name.
 * @param {string} tag  element name, e.g. 'path'
 * @param {Record<string, string | number>} [attrs]  attributes to set (default none)
 * @param {Element} [parent]  element to append the new one to; not appended when omitted
 * @returns {any}  typed loosely so callers can treat it as the specific SVG element
 * @example
 * svgEl('line', { x1: 0, x2: 10, y1: 5, y2: 5 }, svgRoot)  // => the new <line>, already in svgRoot
 */
export function svgEl(tag, attrs = {}, parent) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (parent) parent.appendChild(node);
  return node;
}

/**
 * Creates a renderer that draws scenes as SVG, styled by styles.css (the Canvas renderer's
 * counterpart; both take the same `Scene`).
 * Side effects: `draw` rebuilds all children of the `<svg>`, so any previous hover ring is gone
 * (hidden until `setHover` shows it again). Each renderer uses its own clip-path id so several
 * charts can share a page. Nothing is drawn until `draw` is called, and `setHover` before
 * that does nothing. No listeners or timers are created.
 * @returns {Renderer}  `el` is the `<svg>` (not yet in the page); `setHover(null)` hides the
 *   ring; `setHighlight(group)` dims every other group, and `null` clears it; `destroy()`
 *   removes the `<svg>`.
 */
export function createSvgRenderer() {
  const clipId = `scatter-clip-${++clipCounter}`;
  /** @type {SVGSVGElement} */
  const svg = svgEl('svg', { role: 'img' });
  /** @type {{group: string, el: Element}[]} */
  let dimmable = [];
  /** @type {SVGCircleElement | null} */
  let ring = null;
  /** @type {string | null} */
  let highlighted = null;

  function applyHighlight() {
    for (const { group, el } of dimmable) {
      el.classList.toggle('dimmed', highlighted !== null && group !== highlighted);
    }
  }

  /** @param {Scene} scene */
  function draw(scene) {
    const { width, height, plot } = scene;
    const { left, right, top, bottom } = plot;
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('aria-label', scene.ariaLabel);
    svg.replaceChildren();
    dimmable = [];

    const defs = svgEl('defs', {}, svg);
    svgEl('rect', { x: left, y: top, width: right - left, height: bottom - top }, svgEl('clipPath', { id: clipId }, defs));

    const grid = svgEl('g', { class: 'grid' }, svg);
    const axis = svgEl('g', { class: 'axis' }, svg);

    for (const { px: y, text } of scene.yTicks) {
      svgEl('line', { x1: left, x2: right, y1: y, y2: y }, grid);
      svgEl('text', { x: left - 8, y, class: 'tick-label', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, axis).textContent = text;
    }
    for (const { px: x, text } of scene.xTicks) {
      svgEl('line', { x1: x, x2: x, y1: top, y2: bottom }, grid);
      svgEl('text', { x, y: bottom + 18, class: 'tick-label', 'text-anchor': 'middle' }, axis).textContent = text;
    }

    svgEl('line', { x1: left, x2: right, y1: bottom, y2: bottom, class: 'baseline' }, axis);
    svgEl('line', { x1: left, x2: left, y1: top, y2: bottom, class: 'baseline' }, axis);
    if (scene.xLabel) {
      svgEl('text', { x: (left + right) / 2, y: height - 10, class: 'axis-title', 'text-anchor': 'middle' }, axis).textContent = scene.xLabel;
    }
    if (scene.yLabel) {
      svgEl('text', {
        x: -(top + bottom) / 2, y: 18, class: 'axis-title', 'text-anchor': 'middle', transform: 'rotate(-90)',
      }, axis).textContent = scene.yLabel;
    }

    // Data is clipped to the plot area so zoom/pan doesn't spill over the axes.
    const data = svgEl('g', { 'clip-path': `url(#${clipId})` }, svg);

    if (scene.trend) {
      svgEl('polyline', {
        class: 'trend', fill: 'none', points: scene.trend.map(([x, y]) => `${x},${y}`).join(' '),
      }, data);
    }

    // Lines go under the points so the markers stay visible on top.
    for (const line of scene.lines) {
      const d = line.pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join('');
      const el = svgEl('path', { d, class: 'series-line', stroke: colorFor(line.slot), fill: 'none' }, data);
      dimmable.push({ group: line.group, el });
    }

    for (const m of scene.marks) {
      const el = svgEl('path', {
        class: 'point', d: shapePath(m.slot, POINT_R), transform: `translate(${m.px},${m.py})`, fill: colorFor(m.slot),
      }, data);
      dimmable.push({ group: m.group, el });
    }

    // Means go on top of the points so the bar is always readable.
    for (const mean of scene.means) {
      const attrs = { x1: mean.x0, x2: mean.x1, y1: mean.y, y2: mean.y };
      svgEl('line', { ...attrs, class: 'mean-halo' }, data);
      svgEl('line', { ...attrs, class: 'mean' }, data);
    }

    ring = svgEl('circle', { class: 'hover-ring', r: POINT_R + 4, visibility: 'hidden' }, data);
    applyHighlight();
  }

  return {
    el: svg,
    draw,
    setHover(pos) {
      if (!ring) return;
      if (!pos) { ring.setAttribute('visibility', 'hidden'); return; }
      ring.setAttribute('cx', String(pos.px));
      ring.setAttribute('cy', String(pos.py));
      ring.setAttribute('visibility', 'visible');
    },
    setHighlight(group) {
      highlighted = group;
      applyHighlight();
    },
    destroy() { svg.remove(); },
  };
}
