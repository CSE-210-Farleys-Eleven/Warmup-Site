# Performance and input-size testing

This page records how the app behaves as uploaded CSV files grow, up to and just past the input limits: whether each limit rejects at the right point, how long loading and interacting take, and what large or unusual inputs look like on screen. It is for anyone changing parsing, the model, the charts or the limits, and for reviewers who want the numbers behind those changes. Read Overview for the verdict, then Findings for what still needs fixing.

**Applies to:** `test/performance-input-size` at `e1f0622` · **Files:** [perf-fixtures.mjs](../scripts/perf-fixtures.mjs), [perf-bench.mjs](../scripts/perf-bench.mjs), [perf-browser.js](../scripts/perf-browser.js), [worker-harness.mjs](../scripts/worker-harness.mjs), [worker-limits.test.mjs](../test/worker-limits.test.mjs) · **Related:** #43, [data pipeline](data-pipeline.md), [architecture](architecture.md)

## Overview

On a fast laptop, the app is quick at every input size it accepts. The largest allowed input (250,000 cells) loads in about 0.4 s in the browser, no main-thread task runs longer than 50 ms, every interaction responds within 133 ms, and the page holds about 700 DOM nodes whatever the input size. Oversized files are rejected with a clear message in under 0.1 s.

Testing found one limit bug, now fixed: a 20,000-row file that ended in a newline was rejected. It also found six display problems with large or unusual inputs that are not fixed yet. The most important one is that a single extreme value can stretch the scatter plot's axis while the point itself is not drawn.

## Context

The app has no backend. [server.js](../server.js) only serves static files, and parsing, statistics and drawing all run in the visitor's browser. Load-testing many concurrent users would measure the static host, not this code, so it is out of scope. Here, "throughput" means parse rate (cells per second), and "scalability" means how latency grows with input size.

Main enforces input limits, defined as `LIMITS` in [model.js](../src/model.js):

| Limit | Value |
| --- | --- |
| File size | 5 MiB per file |
| Data records | 20,000 per file |
| Value columns | 512 per file |
| Value cells | 250,000 across both files |
| Drawn points | 3,000 per chart (a deterministic sample) |
| Individual line groups | 20; above that, line charts show category means |

The branch `test/stress-large-datasets` (commits `58037e9`, `c285204`) measured main before these limits existed. Its numbers are the "before" column below. That branch will not be merged.

Targets were proposed in #43 for a development laptop:

| Metric | Target |
| --- | --- |
| Progress text appears | within 100 ms |
| Charts drawn | within 1 s at 10k rows, 3 s at the largest allowed input |
| Longest main-thread task during import | 200 ms or less |
| Each interaction | within 200 ms |
| Oversized file rejected | within 500 ms |

## Design

The tests run in four layers. Only the first runs in CI, because timing is too noisy for pass/fail checks.

1. **Fixtures.** `npm run perf:gen` writes 31 seeded file pairs to `data/stress/limits/` (gitignored), with a `manifest.json` that says whether each pair should load or be rejected. Sizes come from `LIMITS`, so each limit is tested exactly at the limit and one unit over it.
2. **Limit tests (CI).** [worker-limits.test.mjs](../test/worker-limits.test.mjs) sends every pair through the real worker protocol. Pairs meant to load must keep every non-blank cell. Pairs meant to be rejected must fail with their limit's message and keep the previous dataset. [perf-fixtures.test.mjs](../test/perf-fixtures.test.mjs) checks that each boundary pair is exactly at its limit or one unit over it.
3. **Node timing.** `npm run perf:bench` runs each pair in a fresh child process: one cold run, then five measured runs, reported as medians. It also times the worker requests behind hiding a group, filtering, a sorted table page, a group summary and a full CSV export.
4. **Browser timing and screenshots.** [perf-browser.js](../scripts/perf-browser.js) runs inside the page. It puts each pair on the real file inputs (skipping only the file dialog) and times the load and the interactions to the next animation frame. It also records long main-thread tasks and DOM size. Screenshots cover light and dark themes and a 360 px width.

The fixtures fall into these groups:

| Group | Pairs | Checks |
| --- | --- | --- |
| Rows (6 columns) | 100, 1k, 5k, 10k, 20,000 (three line endings), 20,001 | Row limit, scaling, 20,000-group legend |
| Columns (10 rows) | 7, 50, 200, 512, 513 | Column limit, x-axis with many categories |
| Cells | 125,000 + 125,000; 125,000 + 125,001; 250,000 + 1 | Cell limit across two files |
| Bytes | Exactly 5 MiB; 5 MiB + 1 byte | Byte limit, with long names so bytes run out before cells |
| Groups and pairs | 1, 20, 21 groups; 2,999 / 3,000 / 3,001 pairs | Switch to category means; drawing sample |
| Unusual input | One outlier, 30% blank, dirty, 2,000-character names, 500-character headers, constant, ±1e300 | Warnings, layout, axis edge cases |

Environment for every result below:

| Item | Value |
| --- | --- |
| Machine | Apple M5, 10 cores, 24 GB, macOS 26.6 |
| Node | v26.9.0 |
| Browser | Chromium 152 in the Claude desktop browser pane (visible), device pixel ratio 2 |
| Code | `src/` as of `daa50b5` (unchanged through `e1f0622`) |

## Results

### Against the targets

| Metric | Target | Measured (browser) | Met |
| --- | --- | --- | --- |
| Progress text appears | 100 ms | Shown synchronously when the second file is chosen, so it appears in the next frame (measured 0.1–15 ms, depending on frame timing) | Yes |
| Charts drawn at 10k rows | 1 s | 225 ms | Yes |
| Charts drawn at the largest input | 3 s | 391–407 ms (rows, cells and outlier pairs at the limit) | Yes |
| Longest main-thread task | 200 ms | No task over 50 ms in any of the 31 pairs | Yes |
| Slowest interaction | 200 ms | 133 ms (clearing a filter at the cell limit) | Yes |
| Oversized file rejected | 500 ms | 26–90 ms | Yes |

### Scaling in the worker (Node)

Medians of five runs, in ms. Load time grows linearly, at about 1.3–1.4 µs per cell from 12,000 to 250,000 cells, including at 512 columns.

| Pair | Cells | Load | Hide group | Filter | Sorted page | CSV export | Heap kept |
| --- | --- | --- | --- | --- | --- | --- | --- |
| rows-1000 | 12,000 | 17 | 3.3 | 1.8 | 3.0 | 10 | 8 MB |
| rows-10000 | 120,000 | 159 | 29 | 17 | 34 | 106 | 68 MB |
| rows-at-limit | 240,000 | 337 | 60 | 66 | 75 | 233 | 136 MB |
| cols-at-limit | 10,240 | 15 | 2.4 | 1.4 | 2.8 | 9.5 | 6 MB |
| cells-at-limit | 250,000 | 315 | 62 | 58 | 79 | 240 | 138 MB |
| bytes-at-limit | 4,000 | 136 | 1.0 | 28 | 28 | 6.0 | 24 MB |

Rejections take 0.0 ms for bytes, 0.1 ms for columns, 7 ms for rows and 36–51 ms for cells. The cell limit is only reached partway through the second file.

### In the browser

One run per pair on a freshly loaded page. Load is measured from choosing the second file to the next frame after the "Ready" status. Interactions are measured to the next frame, so anything under about 17 ms shows as one frame.

| Pair | Load (ms) | Slowest interaction (ms) | DOM nodes (Canvas) | DOM nodes (SVG) |
| --- | --- | --- | --- | --- |
| rows-100 | 61 | 29 | 701 | 1,621 |
| rows-1000 | 71 | 19 | 701 | 4,019 |
| rows-10000 | 225 | 67 | 701 | 4,027 |
| rows-at-limit | 393 | 119 | 701 | 4,029 |
| cols-at-limit | 66 | 42 | 558 | 11,598 |
| cells-at-limit | 403 | 133 | 701 | 4,039 |
| bytes-at-limit | 165 | 50 | 701 | 2,997 |
| pairs-3001 | 72 | 30 | 701 | 3,989 |

At the cell limit the slow interactions all wait on the worker: a legend toggle takes 96 ms, filtering 80 ms, clearing the filter 133 ms and a sorted table page 50 ms. Scatter hover, pan and zoom handlers take a median of about 2 ms per event, with a worst case of 22 ms.

### Before and after the limits

The old branch measured pre-limit main on the same kind of machine with different fixture shapes, so only the comparable measures are shown.

| Measure | Before (old branch) | After (this page) |
| --- | --- | --- |
| Largest input accepted | No limit; 13 MB / 1M-cell files were parsed | 5 MiB per file, 250,000 cells, rejected in under 0.1 s |
| 500,000 points | `RangeError` from `Math.min(...xs)` in the extent code | Cannot be loaded; extents no longer spread arguments (test in [model.test.js](../test/model.test.js)) |
| Many columns | Parsing grew faster than linearly: 7.2 s and 12.9 s at 50,000 columns | 512-column cap; 1.4 µs per cell at 512 columns |
| Browser load, 10k-cell tall pair | 553 ms (Canvas) | 140 ms at 30,000 cells per file (rows-5000) |
| DOM nodes, 10k-cell tall pair | 137,000 (4,287 legend buttons, 30,000 table rows) | 701 at every size (legend paged by 20, at most 100 table rows) |

## Findings

Severity is about what a user would actually hit with real class data, not about the synthetic extremes used to find the problem.

| # | Finding | Severity | Why it matters now | Status |
| --- | --- | --- | --- | --- |
| F1 | A 20,000-record file that ends in a newline was rejected with "exceeds 20,000 CSV records". Papa Parse reports the final newline as an empty record, and blank records counted toward the limit. | Medium | Most CSV writers end files with a newline, so the advertised limit was really 19,999 rows. | Fixed in `daa50b5`: blank records no longer count. 5 MiB of blank lines parses in 319 ms in Node. |
| F2 | One extreme value stretches the scatter's y-axis (to 1,000,000 in the fixture), but the 3,000-point drawing sample leaves that point out. The chart shows empty space above a flat band of points, with nothing on screen explaining why. | Medium | A single typo in real data (100,000 steps instead of 10,000) would give the same misleading chart. Statistics and the table do include the value. | Open |
| F3 | Legend entries are never truncated. A 2,000-character name makes one entry 13,972 px wide, the page 14,149 px wide and the legend 1,088 px tall. | Low | Any name wider than the card (roughly 130+ characters) overflows. Class data uses short names. | Open |
| F4 | X-axis labels are thinned by count, not by width, so 500-character category names merge into one strip of text. Short labels thin correctly even at 512 categories. | Low | Only long category headers are affected. | Open |
| F5 | Summary tiles print very large means in full: 1.7e299 shows as 300 digits and widens the page to 6,260 px. Sample SD shows "—" because squaring 1e300 overflows. | Low | Any value over about 1e21 is printed in full, for example an uploaded ID column. | Open |
| F6 | At 3,000 points the scatter overplots: opaque markers with outlines merge, so density cannot be seen. | Low | Visible at every input above about 1,000 pairs, including the class data scaled up. | Open |
| F7 | The rotated y-axis title overlaps tick labels of seven or more characters (for example 1,000,000). | Low | Only very large values. | Open |
| F8 | After one dataset is loaded, choosing a new first file starts an import against the old second file right away. Choosing the second file then cancels it, so "Import cancelled" flashes. | Low | Replacing both files is a common action, and the message looks like an error. | Open; may be intended behaviour |
| F9 | The worker keeps about 135 MB of heap at the largest input. | Low | Fine on laptops; may matter on phones. Not measured in a mobile browser. | Watch |

## Decisions

- **Blank lines do not count toward the record limit.** The old rule (blank rows count, documented by the worker's author) and the README ("data records") disagreed. We followed the README, because the measured cost of the loophole (319 ms for 5 MiB of blank lines) is about that of the largest valid input. Lines of commas still count toward the cell limit.
- **Timing stays out of CI.** Only pass/fail limit checks run in CI. The Node and browser timings are local scripts whose JSON output records the machine, Node version and commit.
- **The browser script does not time CSV export.** Export downloads a file, so it is timed on the worker in Node instead.
- **Fixtures are generated, not committed.** They are 36 MB, seeded and deterministic, so `npm run perf:gen` recreates identical files.
- **The browser script is plain `.js` in `scripts/`.** [server.js](../server.js) has no `.mjs` content type, app code stays untouched, and the Pages deploy copies only `index.html`, `styles.css`, `src/` and `data/`, so the script is never published.

## Limitations

- **One fast machine.** The M5 is much faster than a typical student laptop or phone. A 3–4× slower CPU would put the 60–80 ms worker steps at about 250 ms, over the 200 ms target. Not yet measured with CPU throttling.
- **One browser, one run.** Chromium only, one run per pair. Repeated runs moved load times by about 10% (for example cells-at-limit loaded in 315 ms in one Node run and 353 ms in another).
- **Synthetic events.** Pointer and wheel events are dispatched by script. Their times cover the handler and the next frame, not the paint itself.
- **Memory.** Heap use is measured in Node only. Peak RSS (0.8–1.1 GB) includes the script's own copies of the fixture text. No browser heap snapshots have been taken yet.
- **Uniform random data.** Values are uniform, so line charts look noisier and scatters more uniform than real data would.

## Testing

The limit tests run with the rest of the suite:

```sh
npm test
```

Generate the fixtures, then time the worker. Output from `e1f0622` (lines trimmed):

```sh
npm run perf:gen
# rows-100                         load      1200 cells  0.01 MB
# rows-1000                        load     12000 cells  0.08 MB
# rows-5000                        load     60000 cells  0.41 MB
# cells-at-limit                   load    250000 cells  1.57 MB
# cells-over-limit                 reject  250001 cells  1.55 MB
# cells-one-file-over              reject  250001 cells  1.54 MB
# bytes-at-limit                   load      4000 cells  10.49 MB
# bytes-over-limit                 reject    4000 cells  10.49 MB
# 31 pairs written to .../data/stress/limits/

npm run perf:bench -- --runs 5 --only rows-10000,cells-at-limit,bytes-over-limit
# fixture                           cells   cold   load hideGroup filter sortedPage groupSummary exportCsv µs/cell heapMB rssMB
# rows-10000                       120000    205    165        30     17         35          7.4       104    1.37   68.1   469
# cells-at-limit                   250000    435    353        63     60         83           16       244    1.41  138.7   940
# bytes-over-limit                   4000    0.1    0.0         -      -          -            -         -       -    0.2   111  rejected: bytes-over-limit-a.csv:
```

For the browser, run `npm start`, open `http://localhost:3000/` in a visible tab and run this in the console. Reload the page before each pair, so the first file does not pair with an old second file:

```js
const { run } = await import('/scripts/perf-browser.js');
await run('cells-at-limit');
// => { name: 'cells-at-limit', loadMs: 403.2, firstFeedbackMs: 0.2, longestTaskMs: 0,
//      longTasks: 0, domNodes: 701, rejected: false, frameTimedOut: false,
//      status: 'Ready · 15,625 groups · 125,000 matched pairs. All processing stayed in your browser.',
//      interactions: { legendToggle: 95.5, filterClear: 133.2, tableSortByValue: 50.1,
//        scatterPan: { medianMs: 1.8, worstMs: 2.2, ... }, ... } }
```

A hidden tab pauses animation frames. If `frameTimedOut` is `true`, a wait gave up after 1 s and the times are not valid.

## Follow-ups

- [ ] Run the browser script with Chrome DevTools CPU throttling at 4×, as a stand-in for a slower laptop or phone.
- [ ] Take heap snapshots over ten consecutive loads of the largest pair, to check that memory does not keep growing.
- [ ] Load the largest pair once in Safari and Firefox.
- [ ] Choose 2–3 files with the real file picker and compare the times with the script's.
- [ ] File issues for F2–F8, F2 first. A likely fix for F2 is to always include each axis's extreme points in the drawing sample.
