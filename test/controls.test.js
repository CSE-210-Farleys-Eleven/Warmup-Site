import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { buildPlotData } from '../src/data.js';
import { createModel, generatedPair } from '../src/model.js';
import { drawScatter } from '../src/chart.js';
import { chartPng } from '../src/chart-image.js';

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

test('an all-hidden chart retains every group control for recovery', () => {
  const root = document.createElement('section'); document.body.append(root);
  const model = createModel(...generatedPair(2).map(text=>buildPlotData(text)));
  const input = model.view({hiddenBySource:[['Person 00001','Person 00002']]}).charts[0];
  const handle = drawScatter(root,input,{renderer:'svg'});
  assert.equal(root.querySelectorAll('.legend-item[aria-pressed="false"]').length,2);
  assert.equal(root.querySelectorAll('.chart-image-actions button').length,2);
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
  handle.setRenderer('svg');
  assert.equal((await chartPng(root)).type,'image/png');
  assert.ok(sources.at(-1) instanceof Image);
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
  $('chart-a').querySelector('.legend-item').click();
  await until(() => $('line-a-note').textContent.includes('hidden by'));
  assert.equal($('chart-a').querySelector('.legend-item').getAttribute('aria-pressed'),'false');
  assert.equal($('chart-b').querySelector('.legend-item').getAttribute('aria-pressed'),'true');
  await until(() => $('data-table').tBodies[0].rows.length < initialRows);
  assert.ok(![...$('data-table').tBodies[0].rows].some(row=>row.cells[0].textContent===group));
  $('chart-a').querySelector('.legend-item').click();
  await until(() => $('data-table').tBodies[0].rows.length===initialRows);
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
    assert.deepEqual([...$(id).querySelectorAll('.chart-image-actions button')].map(b=>b.textContent),['Copy image','Save PNG']);
  }
  assert.equal(observers.size,3);
  assert.equal(themeListeners.size,0);
  dom.window.close();
});
