# Data pipeline and inspection contracts

This reference explains the worker/model APIs and page coordination introduced for
scalable inspection. Use it when changing imports, exclusions, tables or CSV exports.

**Applies to:** `main` at `ef757cb`, with the #23 documentation update ·
**Files:** [`main.js`](../src/main.js), [`pipeline.worker.js`](../src/pipeline.worker.js),
[`model.js`](../src/model.js), [`export-name.js`](../src/export-name.js) ·
**Related:** [architecture](architecture.md), [contribution record](contributions-anthony.md)

## Overview

The page sends browser Files or fetched example Files to a candidate worker. Papa
Parse reads 256 KiB chunks. The worker validates headers/shape and budgets, then
passes parsed rows and their original row numbers to `buildFromParsed` in `data.js`.
The shared cleaner handles blanks, invalid numbers and duplicate normalized names.
The first valid value for a group/category wins; missing values do not become zero.

The model keeps complete cleaned observations and matched pairs. It normalizes
group keys and pairs exact trimmed category labels, even when columns are reordered.
Display spelling comes from the first encountered normalized group. File A is Y
and file B is X in scatter/table pairs; original category position is kept separately
as `order`, so sorting pairs does not accidentally sort by file B's measurement.

## API

### `createModel(a, b, names?)`

Both inputs contain `series`, `warnings`, `valueHeader` and optional `xTickLabels`.
The caller supplies cleaned finite values. This factory does not read files, apply
worker import budgets or validate arbitrary malformed structures.

It returns `view(options?)`, `table(options?)` and `page(options?)`. Queries mutate
private filter/table caches. Returned arrays are read-only by convention, not frozen.
Worker structured cloning keeps page code from mutating the retained worker model.

### `view(options?)`

| Option | Meaning |
| --- | --- |
| `query` | Normalized substring match on group names; default empty. |
| `overview` | `auto`, `overview` or `individual`; more than 20 visible line groups always use means. |
| `hiddenBySource` | Three independent arrays for first file, second file and pairs. |

Returns labels/names, visible and unfiltered counts, complete-data summaries/fit,
display precision, a fingerprint, bounded chart inputs and at most 60 diagnostics.
Each chart includes complete legend names, hidden names, full extents and counts of
non-positive values. Line inputs also include full-selected-data category means.

**Edge cases:** an empty selection gives zero counts and NaN for undefined
statistics. Legend metadata still includes hidden groups. Log display does not
change worker data; the chart-side unsampled fit can exclude non-plottable values.

### `table(options?)` and `page(options?)`

| Option | Meaning/default |
| --- | --- |
| `source` | `0` first file, `1` second file, `2` pairs; default `0`. |
| `mode` | `detail`, `group` or `category`; default `detail`. |
| `sortBy` | `group`, `category`, `value`, `second`, `median`, `sd`, `min` or `max`. |
| `direction` | `desc` reverses the primary key; otherwise ascending. |
| `query` | Shared group-name substring filter. |
| `excludedGroups` | Hidden names for the selected source. |
| `page` / `size` | Page only: zero-based integer index and 25/50/100 rows. |

`table()` returns complete sorted rows, columns, per-column display decimals and
a paired-summary scope note. Detail rows are group/category/value; pairs contain
group/category/B/A. Summary rows contain n/mean/median/sample SD/min/max of Y.
The model caches at most eight table variants for the current group query.

`page()` slices after global sorting, adds total/page/pages/size and falls back to
50 rows for unsupported sizes. It clamps the expected integer page index to bounds.
Empty tables still have headers and page 0 of 1. Callers supply supported source,
mode and sort keys; the model is not a general request validator.

### `sample(points, cap?)`, `extent(points, axis)` and `generatedPair(count, edge?)`

- `sample` chooses stable, evenly spaced references; an array that already fits is
  returned unchanged. Callers supply an integer cap of at least 2; the default is
  3,000. Empty input returns an empty array.
- `extent` returns raw `linear` bounds and strictly positive raw `log` bounds.
  Empty input gives two empty arrays. Coordinates must already be finite; this
  helper does not sanitize NaN/Infinity or take logarithms.
- `generatedPair` creates deterministic seven-category CSV strings for tests.
  A zero count produces headers only. The application UI does not expose synthetic
  fixtures; the worker's internal `generated` path still enforces import budgets.

### `exportFileName(dataset, options, rows)`

This pure helper returns
`<A>_vs_<B>__<source-display[-flt]>__<rows>r__<fingerprint>.csv`.
Label slugs are lowercase ASCII, accent-stripped, at most 24 characters and fall
back to `data`. `rows` is the complete exported row count, not one page's size.
The fingerprint is the model's six-hex identifier, not a uniqueness guarantee.
Inputs must contain two labels, a fingerprint and supported table options.

## Worker protocol

Ordinary requests use `{id, type, payload}`. Replies are `{id, progress}`, then
`{id, result}` or `{id, error}`. Progress text is nonterminal. Errors are English
messages; malformed inputs/native file errors are serialized rather than returned
as a successful empty dataset.

| Request | Payload | Result/effect |
| --- | --- | --- |
| `load` | Two Files, or an internal positive `generated` count and optional `edge`. | Parse both, replace the worker model, return its initial view. |
| `view` | View options. | Complete-data summaries with bounded drawing metadata. |
| `page` | Table options plus page/size. | One capped page. |
| `export` | Table options. | `{blob, rows}` for every selected table row. |
| `cancel-export` | `{id: exportRequestId}`; no outer id is needed. | Flag cancellation; no separate reply. The export's terminal reply reports cancellation. |

View/page/export before loading return `Load a dataset first.`. Unsupported request
types return an error. Requests are trusted internal application messages; payloads
are not exhaustively validated as if this were a public API.

CSV uses a UTF-8 BOM, CRLF records, formula-like text escaping and original numeric
precision. Serialization yields between 1,000-row batches so cancellation can be
processed. The complete table is prepared before those yields, so cancellation
does not interrupt a synchronous model query already in progress.

## Page coordination and cleanup

`main.js` correlates request ids and maintains separate import/view/page versions.
It ignores stale replies, preserves chart state on legend redraws and restores the
focused group button only for the toggle that caused that redraw. Width selectors
retain per-chart choices and show `Mixed` globally when widths differ.

Import cancellation aborts example fetches and terminates the candidate worker.
Stopping a worker rejects all its pending promises. CSV cancellation keeps the
active model available. Download object URLs are revoked after use. Chart handles
own renderer, observer, layout and image-control cleanup; see [layout](chart-layout.md).

## Examples

The following calls were run; [owned-contracts.test.mjs](../test/owned-contracts.test.mjs)
checks the shown output.

```js
import { buildPlotData } from './src/data.js';
import { createModel } from './src/model.js';

const a = buildPlotData('A,Mon,Tue\nAna,1,3\nJay,5,7');
const b = buildPlotData('B,Tue,Mon\nana,30,10\njay,70,50');
const model = createModel(a, b);

model.view().counts;
// => [4, 4, 4]
model.table({ source: 2 }).rows;
// => [['Ana', 'Mon', 10, 1], ['Ana', 'Tue', 30, 3],
//     ['Jay', 'Mon', 50, 5], ['Jay', 'Tue', 70, 7]]
model.view({ hiddenBySource: [['Ana'], [], []] }).counts;
// => [2, 4, 4]
model.page({ source: 0, excludedGroups: ['Ana'] }).total;
// => 2
```

```js
import { sample, extent } from './src/model.js';
import { exportFileName } from './src/export-name.js';

sample([0, 1, 2, 3, 4], 3);
// => [0, 2, 4]
extent([{ x: -1, y: 2 }, { x: 3, y: 4 }], 'x');
// => { linear: [-1, 3], log: [3, 3] }
exportFileName({ labels: ['Steps', 'Sleep'], fingerprint: 'abc123' },
  { source: 2, mode: 'detail' }, 35);
// => 'steps_vs_sleep__pairs-obs__35r__abc123.csv'
```

## Testing and limitations

Run `npm test`, `npm run typecheck` and `npm run check:stats` from the repository
root. Model, worker and control tests cover complete exports, budgets, exclusions,
sorting, state restoration and cancellation. The new contract tests check the
documented examples and empty-data behavior without changing product functionality.

The existing budgets and caches bound selected operations, not all possible browser
memory use. Invalid public-helper preconditions are not silently repaired. No
backend, additional upload request or new UI feature is introduced by this update.
