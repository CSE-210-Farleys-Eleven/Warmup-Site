/** PNG and SVG exports of the current chart view, including its title and visible legend. */
export function imageFileName(title, extension = 'png') {
  return `${String(title || 'chart').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 100) || 'chart'}.${extension}`;
}

export function imageScale(width, height, ratio = 2) {
  if (!(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)) throw new Error('The chart has no visible drawing area.');
  return Math.min(Math.max(1, ratio), 2, 4096 / width, 4096 / height, Math.sqrt(16_000_000 / (width * height)));
}

// The live chart is styled by styles.css, which a saved file won't have, so copy the
// computed styles onto a clone. Used by both the PNG (via an <img>) and the SVG export.
function styledCopy(svg) {
  const copy = svg.cloneNode(true);
  const originals = [svg, ...svg.querySelectorAll('*')];
  const copies = [copy, ...copy.querySelectorAll('*')];
  const properties = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-family', 'font-size', 'font-weight', 'paint-order', 'text-anchor'];
  originals.forEach((element, index) => {
    const style = getComputedStyle(element);
    for (const property of properties) copies[index].style.setProperty(property, style.getPropertyValue(property));
  });
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.querySelectorAll('.hover-ring').forEach(ring => ring.remove());
  return copy;
}

async function svgImage(svg) {
  const copy = styledCopy(svg);
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('The SVG chart could not be converted to an image.')); image.src = url; });
    return image;
  } finally { URL.revokeObjectURL(url); }
}

function chartDrawing(container) {
  const drawing = container.querySelector('.scatter-plot > canvas, .scatter-plot > svg');
  if (!drawing) throw new Error('Load chart data before exporting an image.');
  const rect = drawing.getBoundingClientRect();
  return { drawing, width: Math.round(rect.width), plotHeight: Math.round(rect.height) };
}

// Title, visible legend entries and caption, positioned once so PNG and SVG exports match.
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
  const image = drawing.tagName.toLowerCase() === 'canvas' ? drawing : await svgImage(drawing);
  ctx.drawImage(image, 0, header, width, plotHeight);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The chart image could not be created.')), 'image/png'));
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgNode(tag, attrs, parent) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  parent?.append(node);
  return node;
}

/** A standalone vector file of the chart. Only possible when the chart is drawn with the SVG renderer. */
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
  const plot = styledCopy(drawing);
  plot.removeAttribute('xmlns'); // createElementNS already gives it the namespace; a second copy breaks strict XML parsers
  plot.setAttribute('x', '0'); plot.setAttribute('y', String(header));
  plot.setAttribute('width', String(width)); plot.setAttribute('height', String(plotHeight));
  addHoverText(plot, tooltips?.());
  root.append(plot);
  return new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n', new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml;charset=utf-8' });
}

// Browsers show an SVG <title> on hover, so the saved file keeps the chart's tooltips
// without any script. The live chart doesn't get these, or it would show two tooltips.
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

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = fileName;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

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
