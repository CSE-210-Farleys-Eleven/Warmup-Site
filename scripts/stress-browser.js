// Browser stress harness: measures load, hover, zoom and pan in the real page.
// Run `npm run stress:gen`, start the site (`npm start`), open it, then in
// the page's console:
//
//   const { measure } = await import('/scripts/stress-browser.js');
//   await measure('wide-10000', 'canvas');   // or 'svg'
//
// For big fixtures that outlast a console await, start it and poll instead:
//   start('tall-100000', 'canvas', { hover: 5, zoom: 3, pan: 3 });
//   window.__stress   // { running } until it finishes, then the result or { error }
//
// Reload the page between calls so each run starts from a fresh page.
//
// Files go in through the real upload inputs (a DataTransfer on #file-a /
// #file-b), so parsing, pairing, the three charts, legends and data tables
// are all included in `loadMs`. Interaction timings are the event handler's
// synchronous work plus a forced style/layout (offsetHeight); browser paint
// is not included.

// Two frames, or 1 s if frames don't run (a hidden tab pauses requestAnimationFrame).
const nextFrame = () => Promise.race([
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  new Promise((r) => setTimeout(r, 1000)),
]);
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const round = (v) => Math.round(v * 10) / 10;

/** Time `fn` plus the style/layout it causes. */
function timed(fn) {
  const t = performance.now();
  fn();
  void document.body.offsetHeight;
  return performance.now() - t;
}

/** @param {HTMLInputElement} input @param {string} text @param {string} name */
function setFile(input, text, name) {
  const dt = new DataTransfer();
  dt.items.add(new File([text], name, { type: 'text/csv' }));
  input.files = dt.files;
}

/**
 * @param {string} fixture  e.g. 'tall-10000' (files data/stress/<fixture>-a.csv / -b.csv)
 * @param {'canvas' | 'svg'} renderer
 * @param {{hover?: number, zoom?: number, pan?: number}} [samples]  events per chart
 */
export async function measure(fixture, renderer, { hover: nHover = 20, zoom: nZoom = 10, pan: nPan = 10 } = {}) {
  const [textA, textB] = await Promise.all(['a', 'b'].map(async (s) => {
    const res = await fetch(`/data/stress/${fixture}-${s}.csv`);
    if (!res.ok) throw new Error(`${fixture}-${s}.csv: ${res.status} (run npm run stress:gen)`);
    return res.text();
  }));

  // Pick the renderer before loading, so the first draw uses it.
  /** @type {HTMLButtonElement} */ (document.querySelector(`button[data-renderer="${renderer}"]`)).click();

  const status = /** @type {HTMLElement} */ (document.getElementById('status'));
  const before = status.textContent;
  const inputA = /** @type {HTMLInputElement} */ (document.getElementById('file-a'));
  const inputB = /** @type {HTMLInputElement} */ (document.getElementById('file-b'));
  setFile(inputA, textA, `${fixture}-a.csv`);
  setFile(inputB, textB, `${fixture}-b.csv`);

  // showCharts sets the status line after it has parsed and drawn all three
  // charts synchronously, so the observer's timestamp is the load time (style,
  // layout and paint come after; `firstFrameMs` adds them when frames run).
  const t0 = performance.now();
  const loaded = new Promise((resolve) => {
    const obs = new MutationObserver(() => {
      if (status.textContent === before || status.textContent?.startsWith('Now pick')) return;
      obs.disconnect();
      resolve(performance.now());
    });
    obs.observe(status, { childList: true, characterData: true, subtree: true });
  });
  inputB.dispatchEvent(new Event('change'));
  const loadMs = (await loaded) - t0;
  await nextFrame();
  const firstFrameMs = performance.now() - t0;

  const plots = [...document.querySelectorAll('#charts .scatter-plot')];
  const result = {
    fixture, renderer,
    status: status.textContent,
    loadMs: round(loadMs),
    firstFrameMs: round(firstFrameMs),
    visible: document.visibilityState === 'visible',
    domNodes: document.getElementsByTagName('*').length,
    legendButtons: document.querySelectorAll('.legend-item').length,
    tableRows: document.querySelectorAll('.scatter-table tbody tr').length,
    charts: {},
  };

  const names = ['line A', 'line B', 'scatter'];
  for (const [i, plot] of plots.entries()) {
    const r = plot.getBoundingClientRect();
    const at = (fx, fy) => ({ clientX: r.left + r.width * fx, clientY: r.top + r.height * fy, bubbles: true, pointerId: 1 });

    // Hover: positions spread over the plot (nearest point + tooltip).
    const hover = [];
    for (let k = 0; k < nHover; k++) {
      hover.push(timed(() => plot.dispatchEvent(new PointerEvent('pointermove', at(0.1 + 0.04 * k, 0.2 + 0.03 * k)))));
    }
    plot.dispatchEvent(new PointerEvent('pointerleave', at(0.5, 0.5)));

    // Zoom: Ctrl+wheel steps in about the centre (rebuilds the scene each time).
    const zoom = [];
    for (let k = 0; k < nZoom; k++) {
      zoom.push(timed(() => plot.dispatchEvent(new WheelEvent('wheel', { ...at(0.5, 0.5), deltaY: -50, ctrlKey: true, cancelable: true }))));
    }

    // Pan: one drag (each move re-renders).
    const pan = [];
    plot.dispatchEvent(new PointerEvent('pointerdown', { ...at(0.5, 0.5), button: 0 }));
    for (let k = 1; k <= nPan; k++) pan.push(timed(() => plot.dispatchEvent(new PointerEvent('pointermove', at(0.5 + 0.01 * k, 0.5)))));
    plot.dispatchEvent(new PointerEvent('pointerup', at(0.6, 0.5)));
    plot.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); // back to the home view
    await nextFrame();

    result.charts[names[i] ?? `chart ${i}`] = {
      hoverMs: round(median(hover)), zoomMs: round(median(zoom)), panMs: round(median(pan)),
      worstMs: round(Math.max(...hover, ...zoom, ...pan)),
    };
  }
  return result;
}

/** Run `measure` without awaiting it; the outcome lands on window.__stress. */
export function start(fixture, renderer, samples) {
  window.__stress = { running: `${fixture} ${renderer}` };
  measure(fixture, renderer, samples).then(
    (r) => { window.__stress = r; },
    (e) => { window.__stress = { fixture, renderer, error: `${e.constructor.name}: ${e.message}` }; },
  );
}
