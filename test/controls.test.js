import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { buildPlotData } from '../src/data.js';
import { createModel, generatedPair } from '../src/model.js';
import { drawScatter } from '../src/chart.js';
import { setStatsProvider } from '../src/stats.js';
import { chartPng, chartSvg } from '../src/chart-image.js';

// DOM contract tests, not a substitute for browser layout, native fullscreen,
// clipboard permissions or actual PNG decoding. Network/worker transports and
// drawing contexts are substituted; application coordination and SVG are real.
const { JSDOM } = createRequire(import.meta.url)('jsdom');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/' });
const { window } = dom;
for (const key of ['document', 'Option', 'XMLSerializer']) globalThis[key] = window[key];
globalThis.window = window;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
const observers = new Set(), themeListeners = new Set();
globalThis.ResizeObserver = class { observe() { observers.add(this); } disconnect() { observers.delete(this); } };
window.matchMedia = () => ({ addEventListener(_event, listener) { themeListeners.add(listener); }, removeEventListener(_event, listener) { themeListeners.delete(listener); } });
window.HTMLElement.prototype.scrollIntoView = () => {};
globalThis.Path2D = class {};
let paints = 0;
window.HTMLCanvasElement.prototype.getContext = () => new Proxy({ measureText: text => ({width: text.length * 6}) }, { get(target, key) { return target[key] ?? (() => { paints++; }); } });
const $ = id => document.getElementById(id);
const change = node => node.dispatchEvent(new window.Event('change'));
const nextTurn = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) { if (predicate()) return; await nextTurn(); }
  assert.fail(`The expected application state did not arrive. Status: ${$('status')?.textContent}`);
}

test('chart controls retain zoom, width and fullscreen while groups are restored; listeners are released', async () => {
  const root = document.createElement('section'); document.body.append(root);
  const model = createModel(...generatedPair(30).map(text => buildPlotData(text)));
  let input = model.view().charts[0], hidden;
  let handle = drawScatter(root, input, {renderer:'svg', onVisibilityChange: value => {hidden = value;}, view:{x:[0,2],y:[1000,5000]}});
  assert.equal(root.querySelectorAll('.legend-item').length,20);
  const search = root.querySelector('.legend-paging input'); search.value = '00030'; search.dispatchEvent(new window.Event('input'));
  assert.equal(root.querySelectorAll('.legend-item').length,1);
  root.querySelector('.legend-item').click();
  assert.deepEqual(hidden,['Person 00030']);
  const width = root.querySelector('.chart-width select'); width.value = '640'; change(width);
  assert.equal(root.style.maxWidth, '640px');
  width.value = ''; change(width); assert.equal(root.style.maxWidth,'none');
  width.value = '640'; change(width);
  root.querySelector('.chart-fullscreen').click();
  await until(() => root.classList.contains('chart-expanded'));
  const state = handle.getState();
  handle.destroy(true);
  input = model.view({hiddenBySource:[hidden]}).charts[0];
  handle = drawScatter(root, input, {...state, onVisibilityChange:value=>{hidden=value;}});
  assert.equal(root.querySelector('.legend-item').getAttribute('aria-pressed'),'false');
  assert.equal(root.querySelector('.chart-fullscreen').textContent,'Exit fullscreen');
  assert.equal(root.style.maxWidth,'640px');
  assert.deepEqual(handle.getState().view,{x:[0,2],y:[1000,5000]});
  root.querySelector('.legend-item').click(); assert.deepEqual(hidden,[]);
  document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape'}));
  assert.equal(root.classList.contains('chart-expanded'),false);
  assert.equal(document.body.style.overflow,'');
  handle.setRenderer('canvas');
  assert.equal(themeListeners.size,1);
  const before = paints; [...themeListeners][0](); assert.ok(paints > before);
  handle.destroy(); root.remove();
  assert.equal(observers.size,0); assert.equal(themeListeners.size,0);
});

test('switching an axis scale while zoomed restores the home view on both axes', () => {
  const root = document.createElement('section'); document.body.append(root);
  const input = {title:'T',xLabel:'X',yLabel:'Y',points:[{x:1,y:10,group:'A'},{x:4,y:1000,group:'A'},{x:9,y:100,group:'B'}]};
  const home = drawScatter(root, input, {renderer:'svg', controls:false});
  const homeView = home.getState().view; home.destroy();
  const zoomed = {x:[homeView.x[0] * 5, homeView.x[1] * 5], y:[homeView.y[0] * 5, homeView.y[1] * 5]};
  const handle = drawScatter(root, input, {renderer:'svg', controls:false, view:zoomed});
  try {
    handle.setScale('y','log');
    assert.deepEqual(handle.getState().view.x, homeView.x, 'X must not stay zoomed when Y changes scale');
    handle.setScale('y','linear');
    assert.deepEqual(handle.getState().view, homeView);
  } finally { handle.destroy(); root.remove(); }
});

test('the scatter legend uses a custom stats provider when the data is not sampled', () => {
  const root = document.createElement('section'); document.body.append(root);
  const model = createModel(...generatedPair(5).map(text => buildPlotData(text)));
  setStatsProvider(points => ({ n: points.length, r: 0.5, slope: 1, intercept: 0 }));
  const handle = drawScatter(root, model.view().charts[2], {renderer:'svg', controls:false});
  try {
    assert.match(root.querySelector('.trend-stat').textContent, /r = 0\.50/);
  } finally { setStatsProvider(); handle.destroy(); root.remove(); }
});

test('focusing or hovering a hidden legend item does not dim the visible groups', () => {
  const root = document.createElement('section'); document.body.append(root);
  const input = {title:'T',xLabel:'X',yLabel:'Y',groupNames:['A','B'],hiddenGroups:['A'],points:[{x:1,y:1,group:'A'},{x:2,y:2,group:'B'},{x:3,y:1,group:'B'}]};
  const handle = drawScatter(root, input, {renderer:'svg', controls:false});
  try {
    const [hiddenItem, visibleItem] = root.querySelectorAll('.legend-item');
    hiddenItem.focus();
    assert.equal(root.querySelectorAll('.scatter-plot .dimmed').length, 0);
    visibleItem.focus();
    assert.equal(root.querySelectorAll('.scatter-plot .dimmed').length, 0, 'B is the only visible group');
  } finally { handle.destroy(); root.remove(); }
});

test('an all-hidden chart retains every group control for recovery', () => {
  const root = document.createElement('section'); document.body.append(root);
  const model = createModel(...generatedPair(2).map(text=>buildPlotData(text)));
  const input = model.view({hiddenBySource:[['Person 00001','Person 00002']]}).charts[0];
  const handle = drawScatter(root,input,{renderer:'svg'});
  assert.equal(root.querySelectorAll('.legend-item[aria-pressed="false"]').length,2);
  assert.equal(root.querySelectorAll('.chart-image-actions button').length,3);
  handle.destroy(); root.remove();
});

test('Canvas and SVG export contracts include chart context and report clipboard denial without breaking controls', async () => {
  const originalContext = window.HTMLCanvasElement.prototype.getContext;
  const originalBounds = window.Element.prototype.getBoundingClientRect;
  const root = document.createElement('section'); document.body.append(root);
  root.style.setProperty('--surface','#1a1a19'); root.style.setProperty('--text-primary','#ffffff');
  root.dataset.exportNote = '2 drawn of 2 observations';
  const text = [], fills = [], sources = [];
  window.HTMLCanvasElement.prototype.getContext = () => new Proxy({
    measureText:value=>({width:value.length*6}),
    fillText(value) { text.push(value); },
    fillRect() { fills.push(this.fillStyle); },
    drawImage(source) { sources.push(source); },
  }, {get(target,key) {return target[key]??(()=>{});}});
  window.Element.prototype.getBoundingClientRect = () => ({width:640,height:360,left:0,top:0});
  window.HTMLCanvasElement.prototype.toBlob = function(callback,type) { callback(new Blob(['test image transport'],{type})); };
  globalThis.Image = class { set src(value) { this.url = value; queueMicrotask(()=>this.onload()); } };
  globalThis.ClipboardItem = class { constructor(value) { this.value = value; } };
  let clipboardCalls = 0;
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{write() { clipboardCalls++; return Promise.reject(new Error('Permission denied')); }}});
  const input = {title:'Test chart',xLabel:'X',yLabel:'Y',showTrend:true,points:[{x:1,y:2,group:'A'},{x:2,y:3,group:'B'}]};
  const handle = drawScatter(root,input,{renderer:'canvas'});
  assert.equal((await chartPng(root)).type,'image/png');
  assert.ok(sources[0] instanceof window.HTMLCanvasElement);
  assert.ok(text.includes('Test chart')); assert.ok(text.includes('2 drawn of 2 observations'));
  assert.ok(text.some(label=>label.includes('Linear fit') && label.includes('n = 2')));
  assert.ok(fills.includes('#1a1a19'));
  // SVG export needs the SVG renderer; on canvas it explains why instead of saving a raster.
  assert.throws(()=>chartSvg(root),/switch this chart to SVG/);
  handle.setRenderer('svg');
  assert.equal((await chartPng(root)).type,'image/png');
  assert.ok(sources.at(-1) instanceof Image);
  const vector = chartSvg(root);
  assert.equal(vector.type,'image/svg+xml;charset=utf-8');
  const svgText = await vector.text();
  assert.ok(svgText.startsWith('<?xml'));
  assert.ok(svgText.includes('Test chart') && svgText.includes('2 drawn of 2 observations'));
  assert.ok(svgText.includes('class="point"'), 'the plotted points are kept as vector shapes');
  assert.ok(!svgText.includes('hover-ring'));
  // The Save SVG button passes the chart's tooltip text along, so points get native hover labels.
  const saveSvg = [...root.querySelectorAll('.chart-image-actions button')].find(button=>button.textContent==='Save SVG');
  const originalUrl = URL.createObjectURL, originalClick = window.HTMLAnchorElement.prototype.click;
  let saved;
  URL.createObjectURL = blob => { saved = blob; return 'blob:test'; };
  window.HTMLAnchorElement.prototype.click = () => {};
  saveSvg.click();
  URL.createObjectURL = originalUrl; window.HTMLAnchorElement.prototype.click = originalClick;
  const hoverText = await saved.text();
  assert.equal((hoverText.match(/<title>/g) || []).length, 2, 'one hover label per drawn point');
  assert.ok(hoverText.includes('<title>A\nX: 1\nY: 2</title>'));
  assert.equal(root.querySelectorAll('.scatter-plot title').length, 0, 'the live chart keeps only its own tooltip');
  root.querySelector('.chart-image-actions button').click();
  assert.equal(clipboardCalls,1);
  await until(()=>root.querySelector('.chart-image-status').textContent.includes('Permission denied'));
  assert.equal(root.querySelector('.chart-image-actions button').disabled,false);
  handle.destroy(); root.remove();
  window.HTMLCanvasElement.prototype.getContext = originalContext;
  window.Element.prototype.getBoundingClientRect = originalBounds;
  delete navigator.clipboard; delete globalThis.ClipboardItem;
});

test('original empty state, examples and automatic two-file loading coordinate with bounded tables and independent legends', async () => {
  const workers = [];
  class ModelWorker {
    constructor() { workers.push(this); }
    postMessage({id,type,payload}) {
      queueMicrotask(async () => {
        if (this.stopped) return;
        try {
          let result;
          if (type === 'load') {
            this.model = createModel(...await Promise.all(payload.files.map(async file => buildPlotData(await file.text()))));
            result = this.model.view();
          } else if (type === 'view') result = this.model.view(payload);
          else if (type === 'page') result = this.model.page(payload);
          if (!this.stopped) this.onmessage({data:{id,result}});
        } catch (e) { this.onmessage({data:{id,error:e.message}}); }
      });
    }
    terminate() { this.stopped = true; }
  }
  globalThis.Worker = ModelWorker;
  const paths = [];
  globalThis.fetch = async path => {
    paths.push(path);
    return new Response(await readFile(new URL(`../${path}`, import.meta.url)));
  };
  await import('../src/main.js');
  $('renderer-svg').click();
  assert.equal(workers.length,0);
  assert.equal($('charts').hidden,true);
  const examples = [...document.querySelectorAll('[data-a]')]; assert.equal(examples.length,5);
  examples[0].click();
  await until(() => $('status').textContent.startsWith('Ready'));
  assert.equal(paths.length,2);
  assert.equal(examples[0].getAttribute('aria-current'),'true');
  assert.equal($('charts').hidden,false);
  assert.equal($('table-details').open,false);
  assert.match($('chart-scatter').querySelector('.trend-stat').textContent,/n = 35/);
  assert.equal($('chart-scatter').querySelector('.corner-label'),null);
  assert.deepEqual([...document.querySelectorAll('#charts > section.scatter')].map(n=>n.id),['chart-a','chart-b','chart-scatter']);
  const initialRows = $('data-table').tBodies[0].rows.length;
  const group = $('chart-a').querySelector('.legend-item').textContent;
  $('chart-a').querySelector('.legend-item').focus();
  $('chart-a').querySelector('.legend-item').click();
  await until(() => $('line-a-note').textContent.includes('hidden by'));
  assert.equal(document.activeElement.textContent, group, 'focus returns to the toggled legend item after the redraw (M2)');
  assert.ok($('chart-a').contains(document.activeElement));
  assert.equal($('chart-a').querySelector('.legend-item').getAttribute('aria-pressed'),'false');
  assert.equal($('chart-b').querySelector('.legend-item').getAttribute('aria-pressed'),'true');
  await until(() => $('data-table').tBodies[0].rows.length < initialRows);
  assert.ok(![...$('data-table').tBodies[0].rows].some(row=>row.cells[0].textContent===group));
  $('chart-b').querySelector('.legend-item').focus();
  $('chart-a').querySelector('.legend-item').click();
  await until(() => $('data-table').tBodies[0].rows.length===initialRows);
  assert.ok($('chart-b').contains(document.activeElement) || document.activeElement === document.body, 'a toggle not made from the focused button does not move focus');
  assert.ok(!$('chart-a').contains(document.activeElement));
  // Y3 follow-up: sort options keep fixed keys, labelled by the table's columns.
  const sortOption = value => $('table-sort').querySelector(`option[value="${value}"]`);
  document.querySelector('[data-source="2"]').click();
  await until(() => $('data-table').tHead.rows[0]?.cells.length === 4);
  assert.equal(sortOption('second').disabled, false);
  assert.equal(sortOption('second').textContent, 'Hours of Sleep');
  assert.equal(sortOption('value').textContent, 'Step Count');
  $('table-sort').value = 'second'; change($('table-sort'));
  await until(() => { const v = [...$('data-table').tBodies[0].rows].map(r => Number(r.cells[2].textContent)); return v.length && v.every((x, i) => i === 0 || v[i - 1] <= x); });
  document.querySelector('[data-source="0"]').click();
  await until(() => $('data-table').tHead.rows[0]?.cells.length === 3);
  assert.equal(sortOption('second').disabled, true);
  assert.equal($('table-sort').value, 'value', 'falls back when the second column does not exist');
  $('table-mode').value = 'group'; change($('table-mode'));
  await until(() => sortOption('value').textContent === 'Mean');
  $('table-mode').value = 'detail'; change($('table-mode'));
  await until(() => $('data-table').tHead.rows[0]?.cells.length === 3);
  for (const example of examples.slice(1)) {
    example.click();
    await until(() => $('task').hidden);
    assert.match($('status').textContent,/^Ready/);
  }
  const texts = generatedPair(1000);
  for (const [i,id] of ['file-a','file-b'].entries()) {
    Object.defineProperty($(id),'files',{value:[new File([texts[i]],`${id}.csv`)],configurable:true});
    change($(id));
    if (i === 0) assert.match($('status').textContent,/Choose both/);
  }
  await until(() => $('status').textContent.includes('7,000 matched'));
  assert.equal(document.querySelector('[data-a][aria-current]'),null);
  assert.equal($('data-table').tBodies[0].rows.length,50);
  assert.equal($('chart-a').querySelectorAll('.legend-item').length,20);
  assert.equal($('chart-scatter').querySelectorAll('.scatter-plot path.point').length,3000);
  $('page-size').value = '100'; change($('page-size'));
  await until(() => $('data-table').tBodies[0].rows.length===100);
  $('next').click(); await until(() => $('page-label').textContent.startsWith('2 /'));
  assert.match($('table-count').textContent,/101–200 of 7,000/);
  $('chart-scatter').querySelector('.chart-table-link').click();
  assert.equal($('table-details').open,true);
  assert.equal(document.querySelector('[data-source="2"]').getAttribute('aria-pressed'),'true');
  for (const id of ['chart-a','chart-b','chart-scatter']) {
    assert.deepEqual([...$(id).querySelectorAll('.chart-image-actions button:not(.chart-table-link)')].map(b=>b.textContent),['Copy image','Save PNG','Save SVG']);
    assert.equal($(id).querySelector('.chart-image-actions').firstElementChild, $(id).querySelector('.chart-table-link'), 'table button shares the image-actions row (6b)');
  }
  // Y6: a global width in the pinned bar sets every chart; each chart can still override its own.
  const ownWidth = id => $(id).querySelector('.chart-width select');
  assert.ok($('plot-width').closest('.chart-settings'));
  for (const id of ['chart-a','chart-b','chart-scatter']) assert.ok(ownWidth(id), `${id} keeps its own width select`);
  $('plot-width').value = '640'; change($('plot-width'));
  for (const id of ['chart-a','chart-b','chart-scatter']) { assert.equal($(id).style.maxWidth, '640px'); assert.equal(ownWidth(id).value, '640'); }
  ownWidth('chart-b').value = '800'; change(ownWidth('chart-b'));
  assert.deepEqual(['chart-a','chart-b','chart-scatter'].map(id => $(id).style.maxWidth), ['640px','800px','640px']);
  $('chart-a').querySelector('.legend-item').click();
  await until(() => $('line-a-note').textContent.includes('hidden by'));
  assert.equal($('chart-b').style.maxWidth, '800px', 'a per-chart choice survives redraws');
  assert.equal($('plot-width').value, 'mixed', 'the global control says the charts differ');
  $('chart-a').querySelector('.legend-item').click();
  await until(() => !$('line-a-note').textContent.includes('hidden by'));
  $('plot-width').value = '640'; change($('plot-width'));   // the same size as before: must still apply to all
  assert.deepEqual(['chart-a','chart-b','chart-scatter'].map(id => $(id).style.maxWidth), ['640px','640px','640px']);
  assert.equal($('plot-width').value, '640');
  $('plot-width').value = ''; change($('plot-width'));
  for (const id of ['chart-a','chart-b','chart-scatter']) assert.equal($(id).style.maxWidth, 'none', 'the global choice resets every chart');
  assert.equal(observers.size,3);
  assert.equal(themeListeners.size,0);
  dom.window.close();
});
