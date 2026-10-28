# Chart image export

How Copy image, Save PNG and Save SVG turn a chart into an image file, and what each export includes. For anyone changing the chart card, the legend or the renderers, since the exports read all three.

**Applies to:** `main` · **Files:** [chart-image.js](../src/chart-image.js), [chart.js](../src/chart.js) · **Related:** #4, #12, [renderer-and-tables.md](renderer-and-tables.md)

## Overview

Each chart card has three buttons at its bottom right:

| Button | Output | Renderer | Notes |
| --- | --- | --- | --- |
| Copy image | PNG on the clipboard | Canvas or SVG | Needs HTTPS or localhost and `ClipboardItem`; disabled otherwise |
| Save PNG | `<title>.png` download | Canvas or SVG | Up to 2× pixel ratio, capped at 4096 px per side and 16 million pixels |
| Save SVG | `<title>.svg` download | SVG only | Vector shapes; points and means keep their tooltip text on hover |

Every export shows the chart as it is on screen: the current zoom, the title, the legend entries that are switched on, and a caption with the drawing scope (for example "2 drawn of 2 observations") and the legend page when the legend is paged. Page controls and the data table are never included.

## API

### `chartPng(container)`

PNG of the chart card's current view. Works with both renderers: a canvas is copied directly, and an SVG is first loaded as an image.

| Parameter | Type | Description |
| --- | --- | --- |
| `container` | `HTMLElement` | The chart card that holds the `<h2>` title, the legend and `.scatter-plot` |

**Returns:** `Promise<Blob>`, of type `image/png`.

**Edge cases:** rejects when the chart has not been drawn ("Load chart data before exporting an image."), has no visible area, or the browser cannot create a canvas or decode the SVG.

### `chartSvg(container, tooltips)`

Standalone SVG file with the same header layout as the PNG.

| Parameter | Type | Description |
| --- | --- | --- |
| `container` | `HTMLElement` | The chart card |
| `tooltips` | `() => ExportTooltips \| null` | Optional. Hover text for each `.point` and `.mean`, in drawing order |

**Returns:** `Blob`, of type `image/svg+xml;charset=utf-8`.

**Edge cases:** throws "switch this chart to SVG first. Canvas charts can only be saved as PNG." when the Canvas renderer is active. Without `tooltips`, the file has no hover labels.

### `imageFileName(title, extension)` and `imageScale(width, height, ratio)`

The two pure helpers, tested without a DOM.

```js
imageFileName('Steps / Sleep')         // => 'Steps-Sleep.png'
imageFileName('Steps / Sleep', 'svg')  // => 'Steps-Sleep.svg'
imageFileName('../')                   // => 'chart.png'
imageScale(800, 600, 3)                // => 2
imageScale(3000, 2000)                 // => 1.3653333333333333
imageScale(0, 10)                      // throws 'The chart has no visible drawing area.'
```

### `addImageActions(container, { tooltips })`

Adds the three buttons and an `aria-live` status line to a chart card. Errors appear in the status line ("Could not save the SVG: …") instead of being thrown. Returns a function that removes the buttons; `drawScatter` calls it when the chart is replaced.

## Design

1. `chartDrawing` finds the `<canvas>` or `<svg>` inside `.scatter-plot` and measures it.
2. `exportHeader` lays out the title, the visible legend entries (wrapped to the chart width) and the caption once, so the PNG and the SVG match.
3. `chartPng` paints the header on a new canvas and draws the plot under it.
4. `chartSvg` builds a new `<svg>` with the same header, then appends a copy of the plot with its computed styles inlined, its hover rings removed, and a `<title>` added to each point and mean.
5. `addImageActions` wires the buttons, and `downloadBlob` starts the download.

## Decisions

- **One header layout for both formats.** It was pulled out of `chartPng` (commit `602bfed`) so Save SVG could reuse it instead of copying the drawing code.
- **SVG only from the SVG renderer.** A canvas has no shapes to save; wrapping its bitmap in an SVG file would look like a vector file without being one. The error message tells the user which renderer to switch to.
- **Styles are inlined.** A saved file does not have `styles.css`, so the computed fill, stroke and font properties are copied onto the exported shapes.
- **Hover text uses `<title>`.** Browsers show it without any script. The live chart does not get these titles, or users would see two tooltips.

## Limitations

- Save SVG needs the SVG renderer; charts drawn with Canvas can only be saved as PNG.
- A paged legend exports only the current page; the caption names the page.
- The SVG names the page's font family; a viewer without that font substitutes another.
- Copy image copies PNG only.

## Testing

[test/chart-image.test.mjs](../test/chart-image.test.mjs) covers file names and the size caps. In [test/controls.test.js](../test/controls.test.js), "Canvas and SVG export contracts include chart context and report clipboard denial without breaking controls" checks the PNG from each renderer, the SVG contents and hover labels, the Canvas error, and the clipboard error message.

```sh
npm test
```

By hand: `npm start`, load an example, then Save PNG with each renderer, switch to SVG and Save SVG, and open the `.svg` in a browser to check the hover labels.
