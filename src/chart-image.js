// @ts-check
/**
 * PNG and SVG exports of the current chart view, including its title and visible legend.
 *
 * Runs on the main thread and needs the DOM: it reads the live chart's drawing
 * (a <canvas> or <svg> inside `.scatter-plot`), its <h2> title and its legend items.
 * Only `imageFileName` and `imageScale` are pure and can be tested without a DOM.
 * Exports never include page controls or the data table, and the PNG is capped at
 * 4096 px per side and 16 million pixels.
 */

/**
 * Text shown on hover for each drawn point and mean marker, in drawing order.
 * Created by the chart's `exportTooltips()` in chart.js.
 * @typedef {Object} ExportTooltips
 * @property {string[]} points   one tooltip per `.point` shape
 * @property {string[]} means    one tooltip per `.mean` shape
 */

/**
 * One legend entry laid out for an export, in CSS px from the image's top-left corner.
 * @typedef {Object} LegendEntry
 * @property {number} x
 * @property {number} y                 text baseline
 * @property {string} text
 * @property {string | null | undefined} path   SVG path `d` of the marker, if it has one
 * @property {boolean} line             true for line markers (series and trend lines)
 * @property {boolean} dashed           true for the dashed trend-line marker
 * @property {string} color             marker color
 */

/**
 * Title, legend and caption layout shared by the PNG and SVG exports.
 * @typedef {Object} ExportHeader
 * @property {string} font          CSS font family of the chart card
 * @property {string} color         text color
 * @property {string} background    background color for the whole image
 * @property {string} title
 * @property {LegendEntry[]} entries
 * @property {string} caption       export note and legend page, '' when neither applies
 * @property {number} header        height in px of the area above the plot
 * @property {number} padding       outer padding in px
 */

/**
 * Safe file name for a downloaded chart, built from the chart title.
 * Runs of characters other than a-z and 0-9 become one '-'; the name is at most
 * 100 characters before the extension. Falls back to 'chart' for an empty title or
 * one with no letters or digits. Never throws.
 * @param {string | null | undefined} title   chart title
 * @param {string} [extension='png']          file extension without the dot
 * @returns {string}
 * @example
 * imageFileName('Steps / Sleep')         // => 'Steps-Sleep.png'
 * imageFileName('Steps / Sleep', 'svg')  // => 'Steps-Sleep.svg'
 * imageFileName('../')                   // => 'chart.png'
 */
export function imageFileName(title, extension = 'png') {
  return `${String(title || 'chart').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 100) || 'chart'}.${extension}`;
}

/**
 * Pixel ratio for a PNG export: the requested ratio, kept between 1 and 2 and reduced
 * so the image stays within 4096 px per side and 16 million pixels.
 * Throws when width or height is not a positive finite number (no visible chart).
 * @param {number} width          chart width in CSS px
 * @param {number} height         chart height in CSS px, including the header
 * @param {number} [ratio=2]      wanted device pixel ratio
 * @returns {number}              pixels per CSS px, at most 2
 * @example
 * imageScale(800, 600, 3)  // => 2
 * imageScale(3000, 2000)   // => 1.3653333333333333 (capped by the 4096 px width)
 */
export function imageScale(width, height, ratio = 2) {
  if (!(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)) throw new Error('The chart has no visible drawing area.');
  return Math.min(Math.max(1, ratio), 2, 4096 / width, 4096 / height, Math.sqrt(16_000_000 / (width * height)));
}

// The live chart is styled by styles.css, which a saved file won't have, so copy the
// computed styles onto a clone. Used by both the PNG (via an <img>) and the SVG export.
/**
 * Clone of an SVG chart with its computed styles inlined and hover rings removed.
 * @param {SVGSVGElement} svg   the live chart drawing; not modified
 * @returns {SVGSVGElement}     a detached copy
 */
function styledCopy(svg) {
  const copy = /** @type {SVGSVGElement} */ (svg.cloneNode(true));
  const originals = [svg, ...svg.querySelectorAll('*')];
  const copies = /** @type {SVGElement[]} */ ([copy, ...copy.querySelectorAll('*')]);
  const properties = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-family', 'font-size', 'font-weight', 'paint-order', 'text-anchor'];
  originals.forEach((element, index) => {
    const style = getComputedStyle(element);
    for (const property of properties) copies[index].style.setProperty(property, style.getPropertyValue(property));
  });
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.querySelectorAll('.hover-ring').forEach(ring => ring.remove());
  return copy;
}

/**
 * Loads a styled copy of an SVG chart as an image, so it can be drawn onto a canvas.
 * Rejects if the browser cannot decode the SVG.
 * @param {SVGSVGElement} svg
 * @returns {Promise<HTMLImageElement>}
 */
async function svgImage(svg) {
  const copy = styledCopy(svg);
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('The SVG chart could not be converted to an image.')); image.src = url; });
    return image;
  } finally { URL.revokeObjectURL(url); }
}

/**
 * Finds the chart's drawing and its size on screen.
 * Throws if the chart has not been drawn yet.
 * @param {HTMLElement} container   chart card
 * @returns {{drawing: HTMLCanvasElement | SVGSVGElement, width: number, plotHeight: number}}
 *   sizes in CSS px, rounded
 */
function chartDrawing(container) {
  const drawing = /** @type {HTMLCanvasElement | SVGSVGElement | null} */ (
    container.querySelector('.scatter-plot > canvas, .scatter-plot > svg'));
  if (!drawing) throw new Error('Load chart data before exporting an image.');
  const rect = drawing.getBoundingClientRect();
  return { drawing, width: Math.round(rect.width), plotHeight: Math.round(rect.height) };
}

// Title, visible legend entries and caption, positioned once so PNG and SVG exports match.
/**
 * Lays out the export header: title, the legend entries that are switched on, and a
 * caption with the export note and legend page. Legend rows wrap to fit `width`.
 * Throws if the browser has no 2D canvas (needed to measure text).
 * @param {HTMLElement} container   chart card
 * @param {number} width            image width in CSS px
 * @returns {ExportHeader}
 */
function exportHeader(container, width) {
  const surface = getComputedStyle(container);
  const font = surface.fontFamily || 'sans-serif';
  const color = surface.getPropertyValue('--text-primary').trim() || surface.color;
  const background = surface.getPropertyValue('--surface').trim() || '#ffffff';
  const title = container.querySelector('h2')?.textContent || 'Chart';
  const legend = [...container.querySelectorAll('.legend-item, .legend-key')].filter(item => item.getAttribute('aria-pressed') !== 'false');
  const padding = 16;
  // Lay out the legend before sizing the bitmap. A bounded text layout avoids
  // exporting all page controls or an unrelated, potentially huge data table.
  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) throw new Error('Canvas image export is unavailable in this browser.');
  measure.font = `12px ${font}`;
  let x = padding, y = 48;
  const entries = legend.map(item => {
    const text = [...item.querySelectorAll(':scope > span')].map(span => span.textContent.trim()).join(' ') || item.textContent.trim();
    const entryWidth = Math.min(width - padding * 2, measure.measureText(text).width + 30);
    if (x + entryWidth > width - padding && x > padding) { x = padding; y += 20; }
    const path = item.querySelector('path'), line = item.querySelector('line');
    const entry = { x, y, text, path: path?.getAttribute('d'), line: !!line,
      dashed: !!line?.classList.contains('trend'),
      color: path ? getComputedStyle(path).fill : line ? getComputedStyle(line).stroke : color };
    x += entryWidth; return entry;
  });
  const legendCount = container.querySelector('.legend-count')?.textContent;
  const caption = [container.dataset.exportNote, legendCount ? `Legend page ${legendCount}` : ''].filter(Boolean).join(' · ');
  const header = (legend.length ? y + 18 : 40) + (caption ? 20 : 0);
  return { font, color, background, title, entries, caption, header, padding };
}

/**
 * PNG of the chart as it is on screen (current zoom and renderer), with the title,
 * visible legend and caption above the plot, on the theme's background color.
 * Works for both the Canvas and the SVG renderer.
 * Rejects when the chart has not been drawn, has no visible area, or the browser
 * cannot create the image.
 * @param {HTMLElement} container   chart card
 * @returns {Promise<Blob>}         'image/png'
 */
export async function chartPng(container) {
  const { drawing, width, plotHeight } = chartDrawing(container);
  const { font, color, background, title, entries, caption, header, padding } = exportHeader(container, width);
  const height = plotHeight + header + padding;
  const scale = imageScale(width, height, window.devicePixelRatio || 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas image export is unavailable in this browser.');
  ctx.scale(scale, scale); ctx.fillStyle = background; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = color; ctx.font = `600 16px ${font}`; ctx.fillText(title, padding, 25, Math.max(1, width - padding * 2));
  ctx.font = `12px ${font}`;
  for (const entry of entries) {
    ctx.save(); ctx.translate(entry.x + 4, entry.y - 4);
    ctx.fillStyle = entry.color; ctx.strokeStyle = entry.color;
    if (entry.line) {
      ctx.lineWidth = 2; ctx.setLineDash(entry.dashed ? [4, 2] : []); ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(6, 0); ctx.stroke();
    } else if (entry.path) { ctx.fill(new Path2D(entry.path)); }
    else { ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    ctx.fillStyle = color; ctx.fillText(entry.text, entry.x + 15, entry.y, Math.max(1, width - entry.x - padding - 15));
  }
  if (caption) { ctx.fillStyle = color; ctx.font = `11px ${font}`; ctx.fillText(caption, padding, header - 8, Math.max(1, width - padding * 2)); }
  // tagName narrows the type at run time; the casts tell @ts-check the same thing.
  const image = drawing.tagName.toLowerCase() === 'canvas'
    ? /** @type {HTMLCanvasElement} */ (drawing)
    : await svgImage(/** @type {SVGSVGElement} */ (drawing));
  ctx.drawImage(image, 0, header, width, plotHeight);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The chart image could not be created.')), 'image/png'));
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Creates an SVG element with the given attributes and appends it to `parent` if given.
 * @param {string} tag
 * @param {Record<string, string | number>} attrs   values are converted to strings
 * @param {Element} [parent]
 * @returns {SVGElement}
 */
function svgNode(tag, attrs, parent) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  parent?.append(node);
  return node;
}

/**
 * A standalone vector file of the chart, with the same title, legend and caption
 * layout as the PNG. Points and means keep their tooltip text as SVG <title>
 * elements, so browsers show it on hover without any script.
 * Only possible when the chart is drawn with the SVG renderer: throws for the Canvas
 * renderer, and when the chart has not been drawn.
 * @param {HTMLElement} container                     chart card
 * @param {() => (ExportTooltips | null)} [tooltips]  hover text for points and means
 * @returns {Blob}                                    'image/svg+xml'
 */
export function chartSvg(container, tooltips) {
  const { drawing, width, plotHeight } = chartDrawing(container);
  if (drawing.tagName.toLowerCase() !== 'svg') throw new Error('switch this chart to SVG first. Canvas charts can only be saved as PNG.');
  const { font, color, background, title, entries, caption, header, padding } = exportHeader(container, width);
  const height = plotHeight + header + padding;
  const root = svgNode('svg', { width, height, viewBox: `0 0 ${width} ${height}`, 'font-family': font });
  svgNode('rect', { width, height, fill: background }, root);
  svgNode('text', { x: padding, y: 25, fill: color, 'font-size': 16, 'font-weight': 600 }, root).textContent = title;
  // Same marker shapes and offsets the PNG export draws.
  for (const entry of entries) {
    const marker = svgNode('g', { transform: `translate(${entry.x + 4},${entry.y - 4})` }, root);
    if (entry.line) svgNode('line', { x1: -4, x2: 6, y1: 0, y2: 0, stroke: entry.color, 'stroke-width': 2, ...(entry.dashed ? { 'stroke-dasharray': '4 2' } : {}) }, marker);
    else if (entry.path) svgNode('path', { d: entry.path, fill: entry.color }, marker);
    else svgNode('circle', { r: 4, fill: entry.color }, marker);
    svgNode('text', { x: entry.x + 15, y: entry.y, fill: color, 'font-size': 12 }, root).textContent = entry.text;
  }
  if (caption) svgNode('text', { x: padding, y: header - 8, fill: color, 'font-size': 11 }, root).textContent = caption;
  const plot = styledCopy(/** @type {SVGSVGElement} */ (drawing)); // checked above
  plot.removeAttribute('xmlns'); // createElementNS already gives it the namespace; a second copy breaks strict XML parsers
  plot.setAttribute('x', '0'); plot.setAttribute('y', String(header));
  plot.setAttribute('width', String(width)); plot.setAttribute('height', String(plotHeight));
  addHoverText(plot, tooltips?.());
  root.append(plot);
  return new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n', new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml;charset=utf-8' });
}

// Browsers show an SVG <title> on hover, so the saved file keeps the chart's tooltips
// without any script. The live chart doesn't get these, or it would show two tooltips.
/**
 * Adds a <title> to each `.point` and `.mean` shape in an exported plot.
 * Does nothing without tooltips; shapes with no matching text are skipped.
 * Side effects: changes `plot`, which must be a copy, not the live chart.
 * @param {Element} plot
 * @param {ExportTooltips | null | undefined} tooltips
 */
function addHoverText(plot, tooltips) {
  if (!tooltips) return;
  const attach = (selector, texts) => plot.querySelectorAll(selector).forEach((shape, i) => {
    if (!texts[i]) return;
    const title = svgNode('title', {});
    title.textContent = texts[i];
    shape.prepend(title);
  });
  attach('.point', tooltips.points);
  attach('.mean', tooltips.means);
}

/**
 * Starts a browser download of `blob`.
 * Side effects: adds and clicks a temporary link, and revokes its object URL after 1 s.
 * @param {Blob} blob
 * @param {string} fileName
 */
function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = fileName;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Adds the Copy image, Save PNG and Save SVG buttons and a status message to a chart.
 * Failures are shown in the status message, never thrown. Copy image is disabled when
 * the browser has no image clipboard (it needs HTTPS or localhost and ClipboardItem).
 * Side effects: appends the buttons to `container`; status messages clear after 4 s.
 * @param {HTMLElement} container   chart card
 * @param {{tooltips?: () => (ExportTooltips | null)}} [options]
 *   `tooltips` supplies hover text for Save SVG
 * @returns {() => void}            removes the buttons and stops the message timer
 */
export function addImageActions(container, { tooltips } = {}) {
  const actions = document.createElement('div'); actions.className = 'chart-image-actions';
  const status = document.createElement('span'); status.className = 'chart-image-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copy image';
  const save = document.createElement('button'); save.type = 'button'; save.textContent = 'Save PNG';
  const saveSvg = document.createElement('button'); saveSvg.type = 'button'; saveSvg.textContent = 'Save SVG';
  saveSvg.title = 'Vector file for slides or papers, with hover labels when opened in a browser. Needs the SVG renderer.';
  let messageTimer;
  const message = text => { clearTimeout(messageTimer); status.textContent = text; messageTimer = setTimeout(() => { status.textContent = ''; }, 4000); };
  copy.disabled = !navigator.clipboard?.write || typeof ClipboardItem === 'undefined';
  if (copy.disabled) copy.title = 'Image clipboard access is unavailable in this browser. Use Save PNG instead.';
  copy.onclick = async () => {
    copy.disabled = true;
    try {
      // Start the write in the click handler to preserve browser user activation.
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': chartPng(container) })]);
      message('Image copied.');
    } catch (error) { message(`Could not copy the image: ${error.message}`); }
    finally { copy.disabled = false; }
  };
  save.onclick = async () => {
    save.disabled = true;
    try {
      downloadBlob(await chartPng(container), imageFileName(container.querySelector('h2')?.textContent));
      message('PNG download started.');
    } catch (error) { message(`Could not save the image: ${error.message}`); }
    finally { save.disabled = false; }
  };
  saveSvg.onclick = () => {
    try {
      downloadBlob(chartSvg(container, tooltips), imageFileName(container.querySelector('h2')?.textContent, 'svg'));
      message('SVG download started.');
    } catch (error) { message(`Could not save the SVG: ${error.message}`); }
  };
  // Grouped so the image buttons wrap together on narrow screens instead of splitting.
  const buttons = document.createElement('span'); buttons.className = 'chart-image-buttons'; buttons.append(copy, save, saveSvg);
  actions.append(status, buttons); container.append(actions);
  return () => { clearTimeout(messageTimer); actions.remove(); };
}
