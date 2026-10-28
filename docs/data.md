# CSV parsing
 
This page describes how [src/data.js](../src/data.js) turns an uploaded CSV into chart data, and
what it tells the user about rows and cells it could not use. It is for anyone changing how files
are read or adding a new warning. Read the Overview, then the API section for the function you
are calling.
 
**Applies to:** `data_docs_n_cleanup` · **Files:** [data.js](../src/data.js), · **Related:** #23,#7
 
## Overview
 
`data.js` reads one CSV at a time. The top-left cell names the values (for example
`Step Count`), the first column holds groups (usually people), and the other headers become
the x axis. The result is one series of `[x, y]` points per group, plus a list of warnings in
plain English.
 
Real spreadsheets are messy, so the module never throws on bad data. Instead it skips what it
cannot use and says exactly what and where, for example `1 blank cell skipped: Ben (Week 3).`
Rows whose names differ only in capitalisation or spacing (`Jay`, `jay`, ` JAY `) are treated as
the same group.
 
## API
 
### `nameKey(name)`
 
Returns the form of a label used for matching groups.
 
| Parameter | Type | Description |
| --- | --- | --- |
| `name` | `string` | label as written in the file |
 
**Returns:** `string`, lowercased, with whitespace runs collapsed, ends trimmed, zero-width
characters and byte-order marks removed, and accented letters in one Unicode form (NFC).
 
**Edge cases:** a blank label returns `''`. Never throws.
 
```js
[nameKey('Jay'), nameKey(' JAY '), nameKey('Ana  Lopez')]
// => ["jay", "jay", "ana lopez"]
```
 
### `parseCsv(text)`
 
Splits CSV text into a header and data rows, without changing cell contents.
 
| Parameter | Type | Description |
| --- | --- | --- |
| `text` | `string` | raw CSV text, header row first, comma-separated |
 
**Returns:** `ParsedCsv`: `columns` (trimmed header names), `rows` (cells as strings),
`rowNumbers` (the file row of each entry in `rows`, with the header as row 1) and `warnings`.
 
**Edge cases:** an empty, blank or repeated header name rejects the whole file (empty `columns`
and `rows`, one warning). Fully blank lines are dropped silently. Rows Papa Parse cannot read,
or with the wrong number of fields, are dropped with a warning. Never throws.
 
```js
parseCsv('Steps,Mon\n\nJay,7440\n')
// => {"columns":["Steps","Mon"],"rows":[["Jay","7440"]],"rowNumbers":[3],"warnings":[]}
```
 
`rowNumbers` is `[3]`, not `[2]`, because the blank line is still counted. This keeps warnings
in line with the row numbers in user's spreadsheet.
 
### `buildPlotData(text, [options])`
 
Shortcut for `buildFromParsed(parseCsv(text), options)`. 
 
| Parameter | Type | Description |
| --- | --- | --- |
| `text` | `string` | raw CSV text |
| `options` | `PlotOptions` | optional; see `buildFromParsed` |
 
**Returns:** `PlotData`.
 
```js
const r = buildPlotData('Steps,Mon,Tue\nJay,7440,\njay,,10560\n');
r.series
// => [{"group":"Jay","points":[[0,7440],[1,10560]]}]
r.warnings
// => ['"Jay" appears in 2 rows (rows 2, 3) as "Jay", "jay"; combined into one.',
//     '2 blank cells skipped: Jay (Tue), jay (Mon).']
```
 
### `buildFromParsed(parsed, [options])`
 
Builds chart data from `parseCsv` output.
 
| Parameter | Type | Description |
| --- | --- | --- |
| `parsed` | `ParsedCsv` | output of `parseCsv`; its `warnings` array is added to |
| `options.xColumns` | `string[]` | headers to plot; default all except the first |
| `options.xType` | `'category' \| 'number'` | `'category'` (default) uses positions 0, 1, 2…; `'number'` parses each header as a number |
 
**Returns:** `PlotData`:
 
| Field | Type | Description |
| --- | --- | --- |
| `series` | `{group, points}[]` | one per group, sorted by label; points sorted by x, at most one per x |
| `valueHeader` | `string \| null` | top-left header; `null` if the file was rejected |
| `xType` | `'category' \| 'number'` | as passed in |
| `xTickLabels` | `Record<number, string>` | column name for each x; only for `'category'` |
| `warnings` | `string[]` | everything skipped or merged, in plain English |
 
**Edge cases:** see the next section. Invalid `xColumns` or `xType` return no series and a
warning. Never throws.
 
 
```js
buildFromParsed(parseCsv('Quiz,W1,W2\nAna,80,\nBen,70,75\n'), { xColumns: ['W2'] })
// => {"valueHeader":"Quiz","xType":"category","xTickLabels":{"0":"W2"},
//     "series":[{"group":"Ben","points":[[0,75]]}],
//     "warnings":["1 row has no data and was left out: Ana."]}
```
 
Ana has a `W1` value, but only `W2` was selected, so her row has no data for this chart.
 
## Edge cases
 
What happens to each kind of problem, in the order the warnings appear:
 
| Problem | What happens | Example warning |
| --- | --- | --- |
| Same group on several rows (any case or spacing) | combined into one series, labelled with the first spelling | `"Jay" appears in 2 rows (rows 6, 7) as "Jay", "JAY"; combined into one.` |
| Two rows give a value for the same column | first value kept, the rest ignored | `"Jay" has 2 values for Week 1: kept 1 (row 6), ignored 9 (row 7).` |
| Row with a name but no values | row left out | `1 row has no data and was left out: Farah.` |
| Row with values but no name | row skipped | `1 row skipped because the first column is empty: row 5.` |
| Blank cell | cell skipped; no point drawn | `3 blank cells skipped: Ben (Week 2), JAY (Week 2), JAY (Week 3).` |
| Cell that isn't a number | cell skipped | ``1 cell skipped because it isn't a number: Ana (Week 2: "n/a").`` |
 
All six example warnings above come from this one file:
 
```csv
Study Hours,Week 1,Week 2,Week 3
Ana,4.2,n/a,7.5
Ben,5.3,,2.6
Farah,,,
,6.1,5.0,7.2
Jay,1,2,3
JAY,9,,
```
 
Lists inside a warning stop after 5 items and end with `…and N more`, for example
`8 blank cells skipped: Ana (Mon), Ana (Tue), Ben (Mon), Ben (Tue), Cy (Mon) …and 3 more.` The
"appears in N rows" and "has N values" warnings are also limited to 5 each, followed by one
summary line such as `…and 2 more names combined from several rows.` The limit is
`WARNING_LIST_LIMIT` in `data.js`. The "left out" list is not shortened, so it names every row.
 
Blank and non-number cells are named with the spelling used on that row (`JAY (Week 2)`), so the
user can find the exact cell even after rows were combined.
 
## Limitations
 
- Only commas separate fields. A file saved with `;` reads as one
  column
- Numbers must be plain. A quoted `"10,560"` or `85%` is reported as not a number. An unquoted
  `7,5` splits into two fields, so the whole row is skipped as `wrong number of fields`.
- A trailing comma on a data row also gives it one field too many, so that row is skipped.
## Testing 
 
To check by hand, upload a pair of files with repeated names and blank cells, and confirm the
warnings above the charts name the right rows and cells, look in the directory data/testcases.