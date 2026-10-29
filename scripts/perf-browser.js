/* global window, document, performance, fetch, File, DataTransfer, Event, KeyboardEvent,
   PointerEvent, WheelEvent, MutationObserver, PerformanceObserver, requestAnimationFrame */
// In-page timing for the perf fixtures, run against `npm start` with fixtures from
// `npm run perf:gen`. Load the page fresh for each fixture, then in the console:
//   const { run } = await import('/scripts/perf-browser.js');
//   await run('rows-at-limit');
// It feeds the pair to the real file inputs (only the file dialog is skipped), then
// times the page's own interactions. Times run to the next animation frame after the
// page settles; paint itself is not included. A hidden tab pauses animation frames,
// so keep the page visible: `frameTimedOut` in the result says when a wait gave up.
// Plain .js, not .mjs: server.js has no .mjs content type, and app code stays untouched.

const FRAME_TIMEOUT_MS = 1000;
const SETTLE_TIMEOUT_MS = 60000;
let frameTimedOut = false;

const $ = id => document.getElementById(id);

/** Resolve on the next animation frame, or after FRAME_TIMEOUT_MS if frames are paused. */
function nextFrame() {
  return new Promise(resolve => {
    const timer = window.setTimeout(() => { frameTimedOut = true; resolve(); }, FRAME_TIMEOUT_MS);
    requestAnimationFrame(() => { window.clearTimeout(timer); resolve(); });
  });
}

/**
 * Resolve once `done()` is true, checking after every DOM change under `root`.
 * Rejects after SETTLE_TIMEOUT_MS so a stuck page fails the run instead of hanging.
 * @param {() => boolean} done
 * @param {Node} [root]
 */
function until(done, root = document.body) {
  if (done()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      if (done()) { observer.disconnect(); window.clearTimeout(timer); resolve(); }
    });
    const giveUp = () => { observer.disconnect(); reject(new Error('timed out')); };
    const timer = window.setTimeout(giveUp, SETTLE_TIMEOUT_MS);
    observer.observe(root,
      { subtree: true, childList: true, attributes: true, characterData: true });
  });
}

/** Milliseconds from now until `action()` has run and the page has drawn its next frame. */
async function timed(action) {
  const start = performance.now();
  await action();
  await nextFrame();
  return performance.now() - start;
}

/** Run `action`, then wait until a view redraw it started has finished (aria-busy cleared). */
const redraw = action => timed(async () => {
  action();
  await until(() => !$('charts').hasAttribute('aria-busy'));
});

/**
 * Run `action`, then wait for the table to be redrawn. Every redraw rewrites the row
 * count's text, even when the rows are the same or there are none, so that is the signal.
 */
const tablePage = action => timed(async () => {
  let replaced = false;
  const observer = new MutationObserver(() => { replaced = true; });
  observer.observe($('table-count'), { childList: true });
  action();
  await until(() => replaced, $('table-count'));
  observer.disconnect();
});

/** Set a <select> and fire its change event, as a person choosing an option would. */
function choose(id, value) {
  $(id).value = value;
  $(id).dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Collect long main-thread tasks (over 50 ms) while `work` runs.
 * @returns {Promise<{longestTaskMs: number, blockingMs: number, longTasks: number}>}
 */
async function longTasksDuring(work) {
  const durations = [];
  const observer = new PerformanceObserver(list => {
    for (const entry of list.getEntries()) durations.push(entry.duration);
  });
  observer.observe({ type: 'longtask' });
  await work();
  // Long-task entries are delivered asynchronously; give the last one a frame to arrive.
  await nextFrame();
  observer.disconnect();
  return {
    longestTaskMs: Math.max(0, ...durations),
    // Total blocking time: the part of each long task beyond 50 ms.
    blockingMs: durations.reduce((sum, ms) => sum + ms - 50, 0),
    longTasks: durations.length,
  };
}

/** Fetch one fixture file from data/stress/limits/ as a File, like a picked file. */
async function fixtureFile(name, side) {
  const response = await fetch(`/data/stress/limits/${name}-${side}.csv`);
  if (!response.ok) throw new Error(`${name}-${side}.csv: run npm run perf:gen first`);
  return new File([await response.blob()], `${name}-${side}.csv`, { type: 'text/csv' });
}

/** Put a file on one of the page's file inputs and fire change. */
function pick(id, file) {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  $(id).files = transfer.files;
  $(id).dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Time the synchronous handler of each pointer event on a chart's plot, which is where
 * the chart redraws (pan, zoom) or places the tooltip (hover). Returns the median and
 * worst handler time, plus the time to the next frame after the last event.
 */
async function pointerTimes(plot, events) {
  // Synthetic pointers have no capturable pointer id; the drag works without capture.
  plot.setPointerCapture = () => {};
  const times = [];
  const start = performance.now();
  for (const event of events) {
    const t = performance.now();
    plot.dispatchEvent(event);
    times.push(performance.now() - t);
  }
  await nextFrame();
  const sorted = [...times].sort((a, b) => a - b);
  return { medianMs: sorted[sorted.length >> 1], worstMs: sorted[sorted.length - 1],
    totalToFrameMs: performance.now() - start, events: times.length };
}

/** Pointer events for hovering across the plot, dragging it, and Ctrl+wheel zooming. */
function gestures(plot) {
  const box = plot.getBoundingClientRect();
  const at = (fraction, y = 0.5) => ({ clientX: box.left + box.width * fraction,
    clientY: box.top + box.height * y, bubbles: true, pointerId: 1, button: 0 });
  const steps = Array.from({ length: 20 }, (_, i) => 0.1 + (0.8 * i) / 19);
  return {
    hover: steps.map(f => new PointerEvent('pointermove', at(f))),
    pan: [new PointerEvent('pointerdown', at(0.3)),
      ...steps.map(f => new PointerEvent('pointermove', at(0.3 + (f - 0.1) / 4))),
      new PointerEvent('pointerup', at(0.5))],
    zoom: Array.from({ length: 10 }, () => new WheelEvent('wheel',
      { ...at(0.5), deltaY: -100, ctrlKey: true, cancelable: true })),
  };
}

/**
 * Load one fixture pair through the file inputs and time the load and each interaction.
 * Expects a freshly loaded page, so the first file does not pair with an old second file.
 * Never throws for a rejected pair: the result has `rejected` and the status text.
 * @param {string} name Fixture name from data/stress/limits/manifest.json.
 * @returns {Promise<object>} Timings in ms, DOM size and the final status text.
 */
export async function run(name) {
  frameTimedOut = false;
  const [a, b] = await Promise.all([fixtureFile(name, 'a'), fixtureFile(name, 'b')]);
  pick('file-b', b);
  let firstFeedbackMs;
  const settled = () => $('task').hidden && /^Ready|Previous results/.test($('status').textContent);
  const start = performance.now();
  const blocking = await longTasksDuring(async () => {
    pick('file-a', a);
    await nextFrame();
    if (!$('task').hidden) firstFeedbackMs = performance.now() - start;
    await until(settled);
    await nextFrame();
  });
  const loadMs = performance.now() - start;
  const result = { name, loadMs, firstFeedbackMs, ...blocking, status: $('status').textContent,
    rejected: $('status').classList.contains('error'),
    domNodes: document.getElementsByTagName('*').length };
  if (result.rejected) return { ...result, frameTimedOut };

  const plot = $('chart-scatter').querySelector('.scatter-plot');
  const { hover, pan, zoom } = gestures(plot);
  const interactions = {
    scatterHover: await pointerTimes(plot, hover),
    scatterPan: await pointerTimes(plot, pan),
    scatterZoom: await pointerTimes(plot, zoom),
    legendToggle: await redraw(() => $('chart-a').querySelector('.legend-item').click()),
    // Restore the group, so later steps see all the data (and a one-group table isn't empty).
    legendRestore: await redraw(() => $('chart-a').querySelector('.legend-item').click()),
    filterEnter: await redraw(() => {
      $('group-filter').value = 'person 1';
      $('group-filter').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    }),
    filterClear: await redraw(() => {
      $('group-filter').value = '';
      $('group-filter').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    }),
  };
  $('table-details').open = true;
  Object.assign(interactions, {
    // A one-page table has nothing to page to; the disabled button would never redraw.
    tableNextPage: $('next').disabled ? null : await tablePage(() => $('next').click()),
    tableSortByValue: await tablePage(() => choose('table-sort', 'value')),
    tableGroupSummary: await tablePage(() => choose('table-mode', 'group')),
    rendererSvg: await timed(() => $('renderer-svg').click()),
    domNodesSvg: document.getElementsByTagName('*').length,
    rendererCanvas: await timed(() => $('renderer-canvas').click()),
    width640: await timed(() => choose('plot-width', '640')),
  });
  return { ...result, interactions, frameTimedOut };
}
