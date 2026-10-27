// @ts-check
/**
 * Pieces shared by the SVG and Canvas renderers: the scene description both
 * draw, and the marker shapes.
 *
 * @typedef {Object} SceneMark
 * @property {number} px
 * @property {number} py
 * @property {number} slot
 * @property {string} group
 * @property {any} mark      original Mark, for hit-testing
 *
 * @typedef {Object} SceneMean
 * @property {number} x0     left end of the bar, px
 * @property {number} x1
 * @property {number} y
 * @property {any} mean      original Mean, for hit-testing
 *
 * @typedef {Object} Scene   everything a renderer needs; all coordinates in CSS pixels
 * @property {number} width
 * @property {number} height
 * @property {{left: number, right: number, top: number, bottom: number}} plot
 * @property {{px: number, text: string}[]} xTicks
 * @property {{px: number, text: string}[]} yTicks
 * @property {string} xLabel
 * @property {string} yLabel
 * @property {[number, number][] | null} trend     polyline
 * @property {{group: string, slot: number, pts: [number, number][]}[]} lines
 * @property {SceneMark[]} marks
 * @property {SceneMean[]} means
 * @property {string} ariaLabel
 *
 * @typedef {Object} Renderer
 * @property {HTMLElement | SVGElement} el
 * @property {(scene: Scene) => void} draw
 * @property {(pos: {px: number, py: number} | null) => void} setHover
 * @property {(group: string | null) => void} setHighlight
 * @property {() => void} destroy
 */

/** Marker radius in CSS pixels (10px markers). */
export const POINT_R = 5;
/** Number of distinct series colors and shapes; colors are `--series-1..8` in styles.css. */
export const SERIES_SLOTS = 8;
/** Half the width of a group's mean bar, in x-axis units; a log x axis uses a fixed pixel width. */
export const MEAN_HALF_WIDTH = 0.3;

// Secondary encoding: 8 colors can't all be told apart in one scatter
// (especially with color-vision deficiency), so each slot also gets a shape.
// Chosen so the most confusable color pairs (orange/red/green, blue/violet,
// aqua/green, orange/yellow) never share a shape.
//                   blue      orange    aqua        yellow     magenta     green     violet     red
const SLOT_SHAPES = ['circle', 'square', 'triangle', 'diamond', 'triangle', 'circle', 'diamond', 'cross'];

/**
 * CSS custom property name for a series slot. Slots from `SERIES_SLOTS` up share
 * `--series-other`. A negative slot gives a name that styles.css doesn't define. Never throws.
 * @param {number} slot  0-based series index
 * @returns {string}
 * @example
 * seriesVar(0)  // => '--series-1'
 * seriesVar(8)  // => '--series-other'
 */
export function seriesVar(slot) {
  return slot < SERIES_SLOTS ? `--series-${slot + 1}` : '--series-other';
}

/**
 * CSS color value for a series slot, for SVG `fill` and `stroke` attributes.
 * @param {number} slot  0-based series index
 * @returns {string}
 * @example
 * colorFor(2)  // => 'var(--series-3)'
 */
export function colorFor(slot) {
  return `var(${seriesVar(slot)})`;
}

/**
 * SVG path data for a marker shape centered on (0, 0); position it with a transform.
 * Each slot has its own shape so series stay distinguishable without color; slots from
 * `SERIES_SLOTS` up get a circle. Never throws.
 * @param {number} slot  0-based series index
 * @param {number} r     marker radius in pixels; the shapes are scaled to look the same size
 * @returns {string}     value for a path's `d` attribute (also accepted by `new Path2D`)
 * @example
 * shapePath(1, 5)  // => 'M-4.5,-4.5H4.5V4.5H-4.5Z' (a square)
 */
export function shapePath(slot, r) {
  const shape = slot < SERIES_SLOTS ? SLOT_SHAPES[slot] : 'circle';
  switch (shape) {
    case 'square': {
      const s = r * 0.9;
      return `M${-s},${-s}H${s}V${s}H${-s}Z`;
    }
    case 'triangle': {
      const h = r * 1.25;
      return `M0,${-h}L${h},${h * 0.75}L${-h},${h * 0.75}Z`;
    }
    case 'diamond': {
      const d = r * 1.25;
      return `M0,${-d}L${d},0L0,${d}L${-d},0Z`;
    }
    case 'cross': {
      const a = r * 1.1;
      const b = r * 0.38;
      return `M${-b},${-a}H${b}V${-b}H${a}V${b}H${b}V${a}H${-b}V${b}H${-a}V${-b}H${-b}Z`;
    }
    default:
      return `M${-r},0A${r},${r} 0 1,0 ${r},0A${r},${r} 0 1,0 ${-r},0Z`;
  }
}
