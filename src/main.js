// @ts-check
/**
 * Coordinate uploads, worker requests, chart state and the shared table on the page.
 * Keep the prior worker active until a candidate import succeeds. Request versions
 * discard stale import/view/page replies; charts own their interaction listeners.
 * CSV downloads use all selected rows, while image controls export the current view.
 */

/** @typedef {ReturnType<typeof import('./model.js').createModel>} DataModel */
/** @typedef {ReturnType<DataModel['view']>} ModelView */
/** @typedef {ReturnType<DataModel['page']>} ModelPage */
/** @typedef {import('./chart.js').ChartHandle} ChartHandle */
/** @typedef {import('./chart.js').RendererKind} RendererKind */
/** @typedef {{blob: Blob, rows: number}} CsvResult */
/**
 * Terminal result type selected by a worker request name.
 * @typedef {Object} Results
 * @property {ModelView} load Initial view after a successful import.
 * @property {ModelView} view Complete-data analysis plus bounded chart inputs.
 * @property {ModelPage} page One capped table page.
 * @property {CsvResult} export Complete selected-view CSV and row count.
 */

/**
 * The request correlation entry stored only until completion, error or stop().
 * @typedef {Object} PendingRequest
 * @property {(result: Results[keyof Results]) => void} resolve Complete the request.
 * @property {(error: Error) => void} reject Reject failures and cancellation.
 * @property {(message: string) => void} [progress] Nonterminal progress receiver.
 */

/**
 * File sources for a candidate import. Example paths are fetched with cancellation.
 * @typedef {Object} LoadOptions
 * @property {File[]} [files] Exactly two browser files when paths are absent.
 * @property {string[]} [paths] Exactly two same-origin example paths.
 * @property {HTMLElement} [example] Button to mark only after a successful import.
 */

import { drawScatter } from './chart.js';
import { exportFileName } from './export-name.js';

/**
 * Static DOM types shared by UI callbacks; no elements are created by this type.
 * @typedef {Object} UiElements
 * @property {HTMLInputElement} file-a
 * @property {HTMLInputElement} file-b
 * @property {HTMLInputElement} group-filter
 * @property {HTMLInputElement} show-means
 * @property {HTMLInputElement} show-trend
 * @property {HTMLSelectElement} overview
 * @property {HTMLSelectElement} plot-width
 * @property {HTMLSelectElement} table-mode
 * @property {HTMLSelectElement} table-sort
 * @property {HTMLSelectElement} table-direction
 * @property {HTMLSelectElement} page-size
 * @property {HTMLButtonElement} cancel-task
 * @property {HTMLButtonElement} export
 * @property {HTMLButtonElement} prev
 * @property {HTMLButtonElement} next
 * @property {HTMLTableElement} data-table
 * @property {HTMLDetailsElement} table-details
 * @property {HTMLElement} status
 * @property {HTMLElement} task
 * @property {HTMLElement} task-message
 * @property {HTMLElement} charts
 * @property {HTMLElement} file-a-name
 * @property {HTMLElement} file-b-name
 * @property {HTMLElement} dataset-label
 * @property {HTMLElement} metrics
 * @property {HTMLElement} quality
 * @property {HTMLElement} quality-title
 * @property {HTMLElement} warnings
 * @property {HTMLElement} scope-note
 * @property {HTMLElement} chart-a
 * @property {HTMLElement} chart-b
 * @property {HTMLElement} chart-scatter
 * @property {HTMLElement} scatter-note
 * @property {HTMLElement} line-a-note
 * @property {HTMLElement} line-b-note
 * @property {HTMLElement} table-empty
 * @property {HTMLElement} table-count
 * @property {HTMLElement} page-label
 * @property {HTMLElement} table-note
 */

/**
 * Resolve a static element declared by index.html; callers supply an existing id.
 * Missing ids still return null at runtime and are programming errors at call sites.
 * @template {keyof UiElements} K
 * @param {K} id Static control id.
 * @returns {UiElements[K]} The existing element; this cast performs no validation.
 */
const $ = id => /** @type {UiElements[K]} */ (document.getElementById(id));
/** Format finite counts with at most the requested places; NaN/Infinity use a dash.
 * @param {number} v @param {number} [decimals] @returns {string}
 */
const number = (v, decimals = 2) => Number.isFinite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: decimals }) : '—';
// Exactly `decimals` places, so values in one column or card line up (Y4).
/** Format finite values with exactly decimals places; NaN/Infinity use a dash.
 * @param {number} v @param {number} decimals @returns {string}
 */
const fixed = (v, decimals) => Number.isFinite(v) ? v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : '—';
/** @type {ReturnType<typeof workerClient> | undefined} */
let active, candidate;
/** @type {(() => void) | null} */
let task;
let request = 0, loadVersion = 0, viewVersion = 0, pageVersion = 0;
/** @type {ChartHandle[]} */
let charts = [];
/** @type {ModelView | undefined} */
let current;
let page = 0, source = 0;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let filterTimer;
/** @type {RendererKind} */
let rendererKind = 'canvas';
let hiddenBySource = [[], [], []];
/** @type {{id: keyof UiElements, label: string} | null} */
let refocus = null; // { id, label } of a legend item to focus after the next redraw
/** @type {{x: import('./scales.js').ScaleKind, y: import('./scales.js').ScaleKind}[]} */
const chartSettings = [{ x: 'linear', y: 'linear' }, { x: 'linear', y: 'linear' }, { x: 'linear', y: 'linear' }];

/**
 * Start one module worker and correlate its progress/result/error replies by id.
 * stop() rejects every pending request and terminates the worker. cancelExport()
 * is cooperative and does not destroy the model. Native postMessage errors may throw.
 * @returns A handle with send(), stop() and cancelExport() for this worker.
 */
function workerClient() {
  const worker = new Worker(new URL('./pipeline.worker.js', import.meta.url), { type: 'module' });
  /** @type {Map<number, PendingRequest>} */
  const pending = new Map();
  worker.onmessage = ({ data }) => {
    const item = pending.get(data.id);
    if (!item) return;
    if (data.progress) { item.progress?.(data.progress); return; }
    pending.delete(data.id);
    if (data.error) item.reject(new Error(data.error)); else item.resolve(data.result);
  };
  worker.onerror = event => { for (const p of pending.values()) p.reject(new Error(event.message || 'The background processor stopped. Try a smaller file.')); pending.clear(); };
  return {
    /**
     * @template {keyof Results} K
     * @param {K} type
     * @param {object} payload
     * @param {(message: string) => void} [progress]
     * @returns {{id: number, promise: Promise<Results[K]>}}
     */
    send(type, payload, progress) {
      const id = ++request;
      const promise = new Promise(
        /** @param {(value: Results[K]) => void} resolve */
        (resolve, reject) => pending.set(id, { resolve, reject, progress }),
      );
      worker.postMessage({ id, type, payload });
      return { id, promise };
    },
    stop() { worker.terminate(); for (const p of pending.values()) p.reject(new Error('Cancelled.')); pending.clear(); },
    cancelExport(id) { worker.postMessage({ type: 'cancel-export', payload: { id } }); } };
}
/** Update the visible English status and optional error style.
 * @param {string} text @param {boolean} [error] @returns {void}
 */
function status(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
/** Show a cancellable task and disable a second CSV export until idle().
 * @param {string} text @param {() => void} cancel @returns {void}
 */
function busy(text, cancel) { task = cancel; $('task').hidden = false; $('task-message').textContent = text; $('export').disabled = true; }
/** Hide task progress and enable export only when a dataset is active.
 * @returns {void}
 */
function idle() { task = null; $('task').hidden = true; $('export').disabled = !active; }
$('cancel-task').onclick = () => task?.();

/**
 * Load two files in a candidate worker and promote it after both parse successfully.
 * Cancel superseded work; discard stale replies and retain prior results on an
 * import failure/cancellation. Display errors in status rather than rejecting.
 * @param {LoadOptions} payload File pair or example paths.
 * @returns {Promise<void>} The import and initial table update have settled.
 */
async function load(payload) {
  if (task) task();
  const version = ++loadVersion;
  const example = payload.example ?? null;
  candidate?.stop();
  const client = workerClient(); candidate = client;
  const controller = new AbortController();
  let cancelled = false;
  const cancel = () => { cancelled = true; controller.abort(); client.stop(); if (candidate === client) candidate = null; if (version === loadVersion) { idle(); status('Import cancelled. The previous dataset is still available.'); } };
  busy('Preparing your data…', cancel);
  try {
    if (payload.paths) {
      const paths = payload.paths;
      payload = { files: await Promise.all(paths.map(async path => { const r = await fetch(path, { signal: controller.signal }); if (!r.ok) throw new Error('Could not load the example.'); return new File([await r.blob()], path.split('/').pop()); })) };
    }
    const result = await client.send('load', payload, text => { if (version === loadVersion) $('task-message').textContent = text; }).promise;
    if (cancelled || version !== loadVersion) { client.stop(); return; }
    active?.stop(); active = client; candidate = null;
    viewVersion++; pageVersion++; $('group-filter').value = ''; $('overview').value = 'auto'; page = 0;
    hiddenBySource = [[], [], []];
    $('charts').removeAttribute('aria-busy');
    markCurrentExample(example);
    current = result; $('charts').hidden = false;
    idle(); paintView(); await loadPage();
    status(`Ready · ${number(result.groups, 0)} ${result.groups === 1 ? 'group' : 'groups'} · ${number(result.counts[2], 0)} matched pairs. All processing stayed in your browser.`);
  } catch (e) {
    client.stop();
    if (cancelled || version !== loadVersion) return;
    candidate = null; idle(); status(`${e.message} Previous results have been kept.`, true);
  }
}
/** Reflect chosen names and start an import only when both file inputs are set.
 * @returns {void}
 */
function loadSelectedFiles() {
  const files = [$('file-a').files[0], $('file-b').files[0]];
  for (const id of /** @type {const} */ (['file-a', 'file-b'])) {
    $(`${id}-name`).textContent = $(id).files[0]?.name || 'No file selected';
  }
  if (files.some(f => !f)) { status('Choose both CSV files to see the charts.'); return; }
  load({ files });
}
for (const id of /** @type {const} */ (['file-a', 'file-b'])) $(id).onchange = loadSelectedFiles;
for (const b of /** @type {NodeListOf<HTMLButtonElement>} */ (
  document.querySelectorAll('[data-a]')
)) b.onclick = () => {
  $('file-a').value = ''; $('file-b').value = '';
  $('file-a-name').textContent = b.dataset.a.split('/').pop();
  $('file-b-name').textContent = b.dataset.b.split('/').pop();
  load({ paths: [b.dataset.a, b.dataset.b], example: b });
};

/** Build one metric card with textContent, keeping uploaded labels out of HTML.
 * @param {string} label @param {string} value @param {string} detail
 * @returns {HTMLElement} Detached card.
 */
function metric(label, value, detail) {
  const el = document.createElement('article'); el.className = 'metric';
  for (const [tag, cls, text] of [['span', 'metric-label', label], ['strong', '', value], ['p', '', detail]]) { const n = document.createElement(tag); n.className = cls; n.textContent = text; el.append(n); }
  return el;
}
/** Paint complete-data summaries/warnings and recreate the bounded charts.
 * @param {boolean} [preserve] Keep zoom and legend state during a legend redraw.
 * @returns {void} No-op when no successful view exists.
 */
function paintView(preserve = false) {
  if (!current) return;
  const { labels, stats, fit, counts, groups, statDecimals = [2, 2] } = current;
  const stat = (i, field) => fixed(stats[i][field], statDecimals[i]);
  $('dataset-label').textContent = `${number(groups, 0)} ${groups === 1 ? 'group' : 'groups'} · ${current.names.join(' + ')}`;
  $('metrics').replaceChildren(
    metric('MATCHED OBSERVATIONS', number(counts[2], 0), `${number(counts[0], 0)} first-file values · ${number(counts[1], 0)} second-file values`),
    metric('PEARSON CORRELATION', fixed(fit.r, 3), 'Original values · correlation does not imply causation'),
    metric(`MEAN · ${labels[0]}`, stat(0, 'mean'), `Median ${stat(0, 'median')} · sample SD ${stat(0, 'sd')}`),
    metric(`MEAN · ${labels[1]}`, stat(1, 'mean'), `Median ${stat(1, 'median')} · sample SD ${stat(1, 'sd')}`),
  );
  const warnings = current.warnings;
  $('quality').hidden = !warnings.length;
  $('quality-title').textContent = `${warnings.length} data quality notes · blank, invalid or duplicate values`;
  $('warnings').replaceChildren(...warnings.map(w => { const li = document.createElement('li'); li.textContent = w; return li; }));
  $('scope-note').textContent = 'Click a group name in a chart to hide or restore that group in that chart. File means follow each line chart; correlation follows the comparison chart. Statistics use all visible groups in original units. Drawing samples, pagination and log axes do not change the analysis sample.';
  paintCharts(preserve);
}
// widthOverride: set by the global width control; otherwise each chart keeps its own width choice.
/**
 * Replace chart handles after releasing their listeners and renderer resources.
 * Widths survive view resets; preserve=true also keeps zoom, legend and fullscreen.
 * This function requires current; global width overrides exclude the 'mixed' label.
 * @param {boolean} [preserve] Preserve interaction state; default true.
 * @param {string} [widthOverride] Supported width value, or '' for available width.
 * @returns {void}
 */
function paintCharts(preserve = true, widthOverride) {
  const states = charts.map(h => {
    const state = h.getState();
    return preserve ? state : { maxWidth: state.maxWidth };
  });
  charts.forEach(h => h.destroy?.(preserve)); charts = [];
  const ids = /** @type {const} */ (['chart-a', 'chart-b', 'chart-scatter']);
  current.charts.forEach((input, i) => {
    const renderer = rendererKind;
    let note;
    if (i < 2 && input.aggregate) note = `Category means across ${number(input.sourceTotal, 0)} observations. Filter to 20 groups or fewer to explore individual lines.`;
    else note = `${number(input.points.length, 0)} drawn of ${number(input.total, 0)} observations${input.points.length < input.total ? ' · deterministic drawing sample; statistics and exports use the full filtered data' : ''}.`;
    if (input.hiddenObservations) note += ` ${number(input.hiddenObservations, 0)} observations hidden by this chart's legend.`;
    $(ids[i]).dataset.exportNote = input.aggregate ? `Category means from ${input.sourceTotal} observations` : `${input.points.length} drawn of ${input.total} observations`;
    const noteId = i === 2 ? 'scatter-note' : i === 0 ? 'line-a-note' : 'line-b-note';
    const fullNote = note;
    const handle = drawScatter($(ids[i]), {
      ...input,
      showMeans: $('show-means').checked && i < 2,
      showTrend: i === 2 && $('show-trend').checked,
    }, /** @type {import('./chart.js').PlotOptions} */ ({
      ...states[i], renderer, xScale: chartSettings[i].x, yScale: chartSettings[i].y,
      // Y6: global default, per-chart override; "mixed" is a display state, never a width.
      maxWidth: widthOverride ?? states[i]?.maxWidth ?? ($('plot-width').value === 'mixed' ? undefined : $('plot-width').value),
      onVisibilityChange(hidden) {
        // The redraw replaces the legend, so remember the toggled item if it had focus (M2).
        const focused = document.activeElement;
        const toggled = [...hidden, ...hiddenBySource[i]].find(g => hidden.includes(g) !== hiddenBySource[i].includes(g));
        refocus = focused?.classList.contains('legend-item') && $(ids[i]).contains(focused) ? { id: ids[i], label: toggled || '(no group)' } : null;
        hiddenBySource[i] = hidden; updateView(true);
      },
      onHidden(_sampleCount, kinds) {
        chartSettings[i] = kinds;
        const hidden = kinds.x === 'log' && kinds.y === 'log' ? input.eitherNonPositive : kinds.x === 'log' ? input.xNonPositive : kinds.y === 'log' ? input.yNonPositive : 0;
        $(noteId).textContent = fullNote + (hidden ? ` ${number(hidden, 0)} non-positive ${input.aggregate ? 'category means' : 'observations'} cannot appear on the selected log axes.` : '');
      },
    }));
    charts.push(handle);
    const tableLink = document.createElement('button'); tableLink.type = 'button'; tableLink.className = 'chart-table-link'; tableLink.textContent = 'Show data table';
    tableLink.onclick = () => { selectSource(i); $('table-details').open = true; $('table-details').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    // Same row as Copy image / Save PNG: table button on the left, image buttons on the right (6b).
    const imageActions = $(ids[i]).querySelector('.chart-image-actions');
    if (imageActions) imageActions.prepend(tableLink); else $(ids[i]).append(tableLink);
  });
  syncGlobalWidth();
}
// The global width shows the charts' common width, or "Mixed" when a chart was set on its own.
// From "Mixed", picking any size is a change, so it always applies to every chart.
/** Show the common chart width or the display-only 'mixed' option.
 * @returns {void}
 */
function syncGlobalWidth() {
  const widths = charts.map(h => h.getState().maxWidth);
  if (widths.length) $('plot-width').value = widths.every(w => w === widths[0]) ? widths[0] : 'mixed';
}
$('charts').addEventListener('change', e => {
  if (/** @type {Element} */ (e.target).closest('.scatter .chart-width')) syncGlobalWidth();
});
/**
 * Request full-data statistics for the current filter and per-chart hidden groups.
 * Drop stale replies and restore legend focus only for the toggle that caused it.
 * Errors update status. With no active worker this resolves without changing UI.
 * @param {boolean} [preserve] Keep interaction state during a legend redraw.
 * @returns {Promise<void>}
 */
async function updateView(preserve = false) {
  if (!active) return;
  const version = ++viewVersion, client = active;
  // Only the redraw started by a legend toggle restores focus; later updates find nothing pending.
  const focusTarget = refocus; refocus = null;
  $('charts').setAttribute('aria-busy', 'true');
  try {
    const view = await client.send('view', { query: $('group-filter').value, overview: $('overview').value, hiddenBySource: hiddenBySource.map(groups => [...groups]) }).promise;
    if (version !== viewVersion || client !== active) return;
    current = view; page = 0; paintView(preserve);
    if (focusTarget) [.../** @type {NodeListOf<HTMLButtonElement>} */ (
      $(focusTarget.id).querySelectorAll('.legend-item')
    )].find(b => b.textContent === focusTarget.label)?.focus({ preventScroll: true });
    await loadPage();
  } catch (e) { if (version === viewVersion) status(e.message, true); }
  finally { if (version === viewVersion) $('charts').removeAttribute('aria-busy'); }
}
$('group-filter').oninput = () => { clearTimeout(filterTimer); filterTimer = setTimeout(updateView, 220); };
$('group-filter').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(filterTimer); updateView(); } };
$('overview').onchange = () => updateView();
for (const button of /** @type {NodeListOf<HTMLButtonElement>} */ (
  document.querySelectorAll('[data-renderer]')
)) button.onclick = () => {
  rendererKind = /** @type {RendererKind} */ (button.dataset.renderer);
  for (const b of /** @type {NodeListOf<HTMLButtonElement>} */ (
    document.querySelectorAll('[data-renderer]')
  )) b.setAttribute('aria-pressed', String(b === button));
  charts.forEach(h => h.setRenderer(rendererKind));
};
$('show-means').onchange = () => current && paintCharts();
$('show-trend').onchange = () => current && paintCharts();
$('plot-width').onchange = () => current && paintCharts(true, $('plot-width').value);

/** Capture the selected source, exclusions, sorting and zero-based page.
 * @returns {import('./model.js').TableOptions} A new request options object.
 */
function tableOptions() { return { source, mode: $('table-mode').value, sortBy: $('table-sort').value, direction: $('table-direction').value, query: $('group-filter').value, excludedGroups: [...hiddenBySource[source]], size: Number($('page-size').value), page }; }
/**
 * Request one capped page and replace the shared table with text-only cells.
 * Discard stale replies; empty data keeps headers and shows the empty-state message.
 * Errors update status; with no active worker this is a no-op.
 * @returns {Promise<void>}
 */
async function loadPage() {
  if (!active) return;
  const version = ++pageVersion, client = active;
  try {
    const result = await client.send('page', tableOptions()).promise;
    if (version !== pageVersion || client !== active) return;
    page = result.page;
    const head = document.createElement('tr');
    labelSortOptions(result.columns, tableOptions().mode);
    result.columns.forEach(c => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = c; head.append(th); });
    $('data-table').tHead.replaceChildren(head);
    const fragment = document.createDocumentFragment();
    result.rows.forEach(row => { const tr = document.createElement('tr'); row.forEach((value, i) => { const td = document.createElement('td'); if (typeof value === 'number') td.className = 'num'; td.textContent = typeof value === 'number' ? fixed(value, result.decimals?.[i] ?? 3) : value; tr.append(td); }); fragment.append(tr); });
    $('data-table').tBodies[0].replaceChildren(fragment);
    $('table-empty').hidden = result.total !== 0;
    const start = result.total ? page * result.size + 1 : 0, end = Math.min((page + 1) * result.size, result.total);
    $('table-count').textContent = `${number(start, 0)}–${number(end, 0)} of ${number(result.total, 0)} rows`;
    $('page-label').textContent = `${page + 1} / ${result.pages}`;
    $('prev').disabled = page === 0; $('next').disabled = page + 1 >= result.pages;
    $('table-note').textContent = result.note || 'Complete filtered data · only this page is added to the screen.';
  } catch (e) { if (client === active) status(e.message, true); }
}
/** Select A/B/pairs, reset the page and refresh valid sorting controls.
 * @param {number} index 0 = file A, 1 = file B, 2 = pairs.
 * @returns {void}
 */
function selectSource(index) {
  source = index; page = 0;
  for (const tab of /** @type {NodeListOf<HTMLButtonElement>} */ (
    document.querySelectorAll('[data-source]')
  )) tab.setAttribute('aria-pressed', String(Number(tab.dataset.source) === source));
  syncSortOptions(); loadPage();
}
for (const b of /** @type {NodeListOf<HTMLButtonElement>} */ (
  document.querySelectorAll('[data-source]')
)) b.onclick = () => selectSource(Number(b.dataset.source));
// Median, SD, Min and Max only exist for summaries; detail rows fall back to value.
// The second file's value is a separate column only in matched pairs (All observations).
/** Hide summary/pair-only sort keys when unavailable and choose a valid fallback.
 * @returns {void}
 */
function syncSortOptions() {
  const detail = $('table-mode').value === 'detail';
  for (const option of /** @type {NodeListOf<HTMLOptionElement>} */ (
    $('table-sort').querySelectorAll('[data-summary]')
  )) option.hidden = option.disabled = detail;
  for (const option of /** @type {NodeListOf<HTMLOptionElement>} */ (
    $('table-sort').querySelectorAll('[data-pairs]')
  )) option.hidden = option.disabled = !(detail && source === 2);
  if ($('table-sort').selectedOptions[0]?.disabled) $('table-sort').value = 'value';
}
// Option keys stay fixed; only their labels follow the table's own column names (e.g. "Step Count", "Mean").
/** Keep sort labels consistent with the current table's measurement headers.
 * @param {string[]} columns @param {string} mode 'detail', 'group' or 'category'.
 * @returns {void}
 */
function labelSortOptions(columns, mode) {
  const option = value => /** @type {HTMLOptionElement} */ (
    $('table-sort').querySelector(`option[value="${value}"]`)
  );
  option('value').textContent = mode === 'detail' ? columns.at(-1) : 'Mean';
  if (mode === 'detail' && columns.length > 3) option('second').textContent = columns[2];
}
syncSortOptions();
for (const id of /** @type {const} */ (
  ['table-mode', 'table-sort', 'table-direction', 'page-size']
)) $(id).onchange = () => { syncSortOptions(); page = 0; loadPage(); };
$('prev').onclick = () => { page--; loadPage(); };
$('next').onclick = () => { page++; loadPage(); };
$('export').onclick = async () => {
  if (!active || task) return;
  const client = active, options = tableOptions();
  const job = client.send('export', options, text => $('task-message').textContent = text);
  let cancelled = false;
  busy('Preparing the complete filtered export…', () => { cancelled = true; client.cancelExport(job.id); idle(); status('Export cancelled.'); });
  try {
    const result = await job.promise;
    if (cancelled) return;
    const url = URL.createObjectURL(result.blob), a = document.createElement('a');
    a.href = url; a.download = exportFileName(current, options, result.rows); a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status(`Exported ${number(result.rows, 0)} rows across all pages · ${options.mode === 'detail' ? 'cleaned observations' : 'summary statistics'}.`);
  } catch (e) { if (!cancelled) status(e.message, true); }
  finally { if (!cancelled && task) idle(); }
};

/** Mark the example actually displayed; null clears all example markers.
 * @param {HTMLElement | null} currentExample @returns {void}
 */
function markCurrentExample(currentExample) {
  for (const button of /** @type {NodeListOf<HTMLButtonElement>} */ (
    document.querySelectorAll('[data-a][data-b]')
  )) {
    if (button === currentExample) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  }
}
