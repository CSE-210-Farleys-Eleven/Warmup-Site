import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>');
globalThis.document = dom.window.document;
const { createSvgRenderer, svgEl } = await import('../src/render-svg.js');
const { seriesVar, colorFor, shapePath, SERIES_SLOTS } = await import('../src/render-common.js');

/** A small scene with one mark in group A and one in group B. */
function sampleScene() {
  return {
    width: 200, height: 120, plot: { left: 40, right: 190, top: 10, bottom: 90 },
    xTicks: [{ px: 40, text: '0' }], yTicks: [{ px: 90, text: '0' }], xLabel: 'x', yLabel: 'y',
    trend: null, lines: [], means: [], ariaLabel: 'demo',
    marks: [
      { px: 100, py: 50, slot: 0, group: 'A', mark: {} },
      { px: 120, py: 60, slot: 1, group: 'B', mark: {} },
    ],
  };
}

test('svg renderer draws nothing until draw, then one path per mark', () => {
  const r = createSvgRenderer();
  assert.equal(r.el.children.length, 0);
  r.draw(sampleScene());
  assert.equal(r.el.getAttribute('aria-label'), 'demo');
  assert.equal(r.el.querySelectorAll('path.point').length, 2);
});

test('svg hover ring is ignored before draw, hidden after draw, and follows setHover', () => {
  const r = createSvgRenderer();
  r.setHover({ px: 1, py: 1 });
  r.draw(sampleScene());
  const ring = () => r.el.querySelector('.hover-ring');
  assert.equal(ring().getAttribute('visibility'), 'hidden');
  r.setHover({ px: 100, py: 50 });
  assert.equal(ring().getAttribute('visibility'), 'visible');
  assert.equal(ring().getAttribute('cx'), '100');
  r.setHover(null);
  assert.equal(ring().getAttribute('visibility'), 'hidden');
});

test('svg highlight dims other groups and null clears it', () => {
  const r = createSvgRenderer();
  r.draw(sampleScene());
  r.setHighlight('A');
  assert.equal(r.el.querySelectorAll('path.point.dimmed').length, 1);
  r.setHighlight(null);
  assert.equal(r.el.querySelectorAll('.dimmed').length, 0);
});

test('svg renderers on one page get different clip-path ids', () => {
  const ids = [createSvgRenderer(), createSvgRenderer()].map((r) => {
    r.draw(sampleScene());
    return r.el.querySelector('clipPath').id;
  });
  assert.notEqual(ids[0], ids[1]);
});

test('svgEl sets attributes, appends to the parent and rejects bad tag names', () => {
  const parent = svgEl('svg');
  const line = svgEl('line', { x1: 0, x2: 10 }, parent);
  assert.equal(line.parentNode, parent);
  assert.equal(line.getAttribute('x2'), '10');
  assert.throws(() => svgEl('bad tag'), { name: 'InvalidCharacterError' });
});

test('series colors and shapes: slots past the eighth share one color and a circle', () => {
  assert.equal(seriesVar(0), '--series-1');
  assert.equal(seriesVar(SERIES_SLOTS - 1), '--series-8');
  assert.equal(seriesVar(SERIES_SLOTS), '--series-other');
  assert.equal(colorFor(2), 'var(--series-3)');
  assert.equal(shapePath(1, 5), 'M-4.5,-4.5H4.5V4.5H-4.5Z');
  assert.equal(shapePath(SERIES_SLOTS, 5), shapePath(0, 5));
});

test('the first seven slots are told apart by color and shape together', () => {
  // Slots 0 and 5 share a circle, 2 and 4 a triangle, 3 and 6 a diamond; their colors differ.
  const seen = new Set();
  for (let slot = 0; slot < SERIES_SLOTS; slot++) {
    const key = `${shapePath(slot, 5)}|${seriesVar(slot)}`;
    assert.ok(!seen.has(key), `slot ${slot} repeats another slot's look`);
    seen.add(key);
  }
  assert.equal(shapePath(0, 5), shapePath(5, 5));
});
