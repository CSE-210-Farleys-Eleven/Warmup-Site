import { drawScatter } from './chart.js';

const $ = id => document.getElementById(id);
const number = (v, decimals = 2) => Number.isFinite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: decimals }) : '—';
let active, candidate, task, request = 0, loadVersion = 0, viewVersion = 0, pageVersion = 0;
let charts = [], current, page = 0, source = 0, filterTimer;
let rendererKind = 'canvas';
let hiddenBySource = [[], [], []];
const chartSettings = [{ x: 'linear', y: 'linear' }, { x: 'linear', y: 'linear' }, { x: 'linear', y: 'linear' }];

function workerClient() {
  const worker = new Worker(new URL('./pipeline.worker.js', import.meta.url), { type: 'module' });
  const pending = new Map();
  worker.onmessage = ({ data }) => {
    const item = pending.get(data.id);
    if (!item) return;
    if (data.progress) { item.progress?.(data.progress); return; }
    pending.delete(data.id);
    if (data.error) item.reject(new Error(data.error)); else item.resolve(data.result);
  };
  worker.onerror = event => { for (const p of pending.values()) p.reject(new Error(event.message || 'The background processor stopped. Try a smaller file.')); pending.clear(); };
  return { send(type, payload, progress) { const id = ++request; const promise = new Promise((resolve, reject) => pending.set(id, { resolve, reject, progress })); worker.postMessage({ id, type, payload }); return { id, promise }; },
    stop() { worker.terminate(); for (const p of pending.values()) p.reject(new Error('Cancelled.')); pending.clear(); },
    cancelExport(id) { worker.postMessage({ type: 'cancel-export', payload: { id } }); } };
}
function status(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
function busy(text, cancel) { task = cancel; $('task').hidden = false; $('task-message').textContent = text; $('export').disabled = true; }
function idle() { task = null; $('task').hidden = true; $('export').disabled = !active; }
$('cancel-task').onclick = () => task?.();

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
function loadSelectedFiles() {
  const files = [$('file-a').files[0], $('file-b').files[0]];
  for (const id of ['file-a', 'file-b']) $(`${id}-name`).textContent = $(id).files[0]?.name || 'No file selected';
  if (files.some(f => !f)) { status('Choose both CSV files to see the charts.'); return; }
  load({ files });
}
for (const id of ['file-a', 'file-b']) $(id).onchange = loadSelectedFiles;
for (const b of document.querySelectorAll('[data-a]')) b.onclick = () => {
  $('file-a').value = ''; $('file-b').value = '';
  $('file-a-name').textContent = b.dataset.a.split('/').pop();
  $('file-b-name').textContent = b.dataset.b.split('/').pop();
  load({ paths: [b.dataset.a, b.dataset.b], example: b });
};

function metric(label, value, detail) {
  const el = document.createElement('article'); el.className = 'metric';
  for (const [tag, cls, text] of [['span', 'metric-label', label], ['strong', '', value], ['p', '', detail]]) { const n = document.createElement(tag); n.className = cls; n.textContent = text; el.append(n); }
  return el;
}
function paintView(preserve = false) {
  if (!current) return;
  const { labels, stats, fit, counts, groups } = current;
  $('dataset-label').textContent = `${number(groups, 0)} ${groups === 1 ? 'group' : 'groups'} · ${current.names.join(' + ')}`;
  $('metrics').replaceChildren(
    metric('MATCHED OBSERVATIONS', number(counts[2], 0), `${number(counts[0], 0)} first-file values · ${number(counts[1], 0)} second-file values`),
    metric('PEARSON CORRELATION', number(fit.r, 3), 'Original values · correlation does not imply causation'),
    metric(`MEAN · ${labels[0]}`, number(stats[0].mean), `Median ${number(stats[0].median)} · sample SD ${number(stats[0].sd)}`),
    metric(`MEAN · ${labels[1]}`, number(stats[1].mean), `Median ${number(stats[1].median)} · sample SD ${number(stats[1].sd)}`),
  );
  const warnings = current.warnings;
  $('quality').hidden = !warnings.length;
  $('quality-title').textContent = `${warnings.length} data quality notes · blank, invalid or duplicate values`;
  $('warnings').replaceChildren(...warnings.map(w => { const li = document.createElement('li'); li.textContent = w; return li; }));
  $('scope-note').textContent = 'Click a group name in a chart to hide or restore that group in that chart. File means follow each line chart; correlation follows the comparison chart. Statistics use all visible groups in original units. Drawing samples, pagination and log axes do not change the analysis sample.';
  paintCharts(preserve);
}
function paintCharts(preserve = true) {
  const states = charts.map(h => {
    const state = h.getState();
    return preserve ? state : { maxWidth: state.maxWidth };
  });
  charts.forEach(h => h.destroy?.(preserve)); charts = [];
  const ids = ['chart-a', 'chart-b', 'chart-scatter'];
  current.charts.forEach((input, i) => {
    const renderer = rendererKind;
    let note = '';
    if (i < 2 && input.aggregate) note = `Category means across ${number(input.sourceTotal, 0)} observations. Filter to 20 groups or fewer to explore individual lines.`;
    else note = `${number(input.points.length, 0)} drawn of ${number(input.total, 0)} observations${input.points.length < input.total ? ' · deterministic drawing sample; statistics and exports use the full filtered data' : ''}.`;
    if (input.hiddenObservations) note += ` ${number(input.hiddenObservations, 0)} observations hidden by this chart's legend.`;
    $(ids[i]).dataset.exportNote = input.aggregate ? `Category means from ${input.sourceTotal} observations` : `${input.points.length} drawn of ${input.total} observations`;
    const noteId = i === 2 ? 'scatter-note' : i === 0 ? 'line-a-note' : 'line-b-note';
    const fullNote = note;
    const handle = drawScatter($(ids[i]), { ...input, showMeans: $('show-means').checked && i < 2, showTrend: i === 2 && $('show-trend').checked }, {
      ...states[i], renderer, xScale: chartSettings[i].x, yScale: chartSettings[i].y,
      onVisibilityChange(hidden) { hiddenBySource[i] = hidden; updateView(true); },
      onHidden(_sampleCount, kinds) {
        chartSettings[i] = kinds;
        const hidden = kinds.x === 'log' && kinds.y === 'log' ? input.eitherNonPositive : kinds.x === 'log' ? input.xNonPositive : kinds.y === 'log' ? input.yNonPositive : 0;
        $(noteId).textContent = fullNote + (hidden ? ` ${number(hidden, 0)} non-positive ${input.aggregate ? 'category means' : 'observations'} cannot appear on the selected log axes.` : '');
      },
    });
    charts.push(handle);
    const tableLink = document.createElement('button'); tableLink.type = 'button'; tableLink.className = 'chart-table-link'; tableLink.textContent = 'Show data table';
    tableLink.onclick = () => { selectSource(i); $('table-details').open = true; $('table-details').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    $(ids[i]).insertBefore(tableLink, $(ids[i]).querySelector('.chart-image-actions'));
  });
}
async function updateView(preserve = false) {
  if (!active) return;
  const version = ++viewVersion, client = active;
  $('charts').setAttribute('aria-busy', 'true');
  try {
    const view = await client.send('view', { query: $('group-filter').value, overview: $('overview').value, hiddenBySource: hiddenBySource.map(groups => [...groups]) }).promise;
    if (version !== viewVersion || client !== active) return;
    current = view; page = 0; paintView(preserve); await loadPage();
  } catch (e) { if (version === viewVersion) status(e.message, true); }
  finally { if (version === viewVersion) $('charts').removeAttribute('aria-busy'); }
}
$('group-filter').oninput = () => { clearTimeout(filterTimer); filterTimer = setTimeout(updateView, 220); };
$('group-filter').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(filterTimer); updateView(); } };
$('overview').onchange = () => updateView();
for (const button of document.querySelectorAll('[data-renderer]')) button.onclick = () => {
  rendererKind = button.dataset.renderer;
  for (const b of document.querySelectorAll('[data-renderer]')) b.setAttribute('aria-pressed', String(b === button));
  charts.forEach(h => h.setRenderer(rendererKind));
};
$('show-means').onchange = () => current && paintCharts();
$('show-trend').onchange = () => current && paintCharts();

function tableOptions() { return { source, mode: $('table-mode').value, sort: $('table-sort').value, query: $('group-filter').value, excludedGroups: [...hiddenBySource[source]], size: Number($('page-size').value), page }; }
async function loadPage() {
  if (!active) return;
  const version = ++pageVersion, client = active;
  try {
    const result = await client.send('page', tableOptions()).promise;
    if (version !== pageVersion || client !== active) return;
    page = result.page;
    const head = document.createElement('tr');
    result.columns.forEach(c => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = c; head.append(th); });
    $('data-table').tHead.replaceChildren(head);
    const fragment = document.createDocumentFragment();
    result.rows.forEach(row => { const tr = document.createElement('tr'); row.forEach(value => { const td = document.createElement('td'); if (typeof value === 'number') td.className = 'num'; td.textContent = typeof value === 'number' ? number(value, 3) : value; tr.append(td); }); fragment.append(tr); });
    $('data-table').tBodies[0].replaceChildren(fragment);
    $('table-empty').hidden = result.total !== 0;
    const start = result.total ? page * result.size + 1 : 0, end = Math.min((page + 1) * result.size, result.total);
    $('table-count').textContent = `${number(start, 0)}–${number(end, 0)} of ${number(result.total, 0)} rows`;
    $('page-label').textContent = `${page + 1} / ${result.pages}`;
    $('prev').disabled = page === 0; $('next').disabled = page + 1 >= result.pages;
    $('table-note').textContent = result.note || 'Complete filtered data · only this page is added to the screen.';
  } catch (e) { if (client === active) status(e.message, true); }
}
function selectSource(index) {
  source = index; page = 0;
  for (const tab of document.querySelectorAll('[data-source]')) tab.setAttribute('aria-pressed', String(Number(tab.dataset.source) === source));
  loadPage();
}
for (const b of document.querySelectorAll('[data-source]')) b.onclick = () => selectSource(Number(b.dataset.source));
for (const id of ['table-mode', 'table-sort', 'page-size']) $(id).onchange = () => { page = 0; loadPage(); };
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
    a.href = url; a.download = `steps-sleep-${['first-file', 'second-file', 'matched-pairs'][options.source]}-${options.mode}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status(`Exported ${number(result.rows, 0)} rows across all pages · ${options.mode === 'detail' ? 'cleaned observations' : 'summary statistics'}.`);
  } catch (e) { if (!cancelled) status(e.message, true); }
  finally { if (!cancelled && task) idle(); }
};

function markCurrentExample(currentExample) {
  for (const button of document.querySelectorAll('[data-a][data-b]')) {
    if (button === currentExample) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  }
}
