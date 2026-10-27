# PR #5 — review fixes for PR #4

**Applies to:** `fix/pr4-review-fixes` (PR #5, merged 2026-10-19) · **Files:** [main.js](../src/main.js), [model.js](../src/model.js), [export-name.js](../src/export-name.js), [chart.js](../src/chart.js), [index.html](../index.html), [styles.css](../styles.css) · **Related:** #4, #5, #32

This is a historical goal list: the goals, decisions and test counts describe PR #5 when it merged and are not updated. For how the code behaves now, read the headers in the files above.

Branch `fix/pr4-review-fixes`, based on `feature/scalable-tables-chart-export` (PR #4).
PR #5 targets PR #4's branch. Goals come from the PR #4 review: **Y** = reviewer findings,
**M** = additional issues found while reviewing.

## Goals

| ID | Goal | Decision | Commit |
|----|------|----------|--------|
| Y1 | Switching Linear ↔ Log after zooming distorts the chart | Reset **both** axes to the home view on a scale change (same as Reset view) | `4aa4042` |
| M4 | Scatter ignores `setStatsProvider()` because the worker fit always overrides it | Send `statsOverride` **only when the scatter is sampled** (> 3,000 points). Numbers are unchanged on all 5 examples; metric cards (Pearson, means, medians, SD) and summary tables still come from the worker and are untouched | `5beb066` |
| M1 | Matched pairs "Group / original category order" sorts by the second file's value | Sort by each row's original category position, kept as its own field (`order`) in the model | `50d21b3` |
| Y3 | Sort is one dropdown; only Value/mean has both directions; matched pairs can't be sorted by the second file's value | Split into **Sort by** + **Order** (Ascending / Descending). Fixed option keys; labels follow the table's columns ("Step Count", "Hours of Sleep", "Mean"). Matched pairs → All observations can sort by either value column; summaries add Median, Sample SD, Min, Max | `50d21b3`, `1bf9e9c` |
| Y4 | Statistics table mixes 0, 1 and 3 decimals in one column | One fixed decimal count per column from the file's precision, capped at 3: counts 0, Min/Max = precision, Mean/Median/SD = precision + 1 | `2f661ea` |
| Y2 | CSV export covers all filtered rows, which isn't obvious | **Text only:** the existing export note now says Export CSV saves all matching rows across every page, not only the rows shown. Same element and style; button label unchanged | `ae42baf` |
| M3 | Export filename hard-coded to `steps-sleep-…` | `<A>_vs_<B>__<view>__<rows>r__<id>.csv` — dataset names from header labels, view codes (`f1`/`f2`/`pairs` + `obs`/`bycat`/`bygrp`, `-flt` when filtered or legend groups hidden), row count, 6-character fingerprint of the cleaned data | `ae42baf` |
| M2 | Toggling a legend item rebuilds the charts and drops keyboard focus | Remember chart + group when the toggle came from a focused legend button; only the redraw started by that toggle focuses the group's new button (no scroll). Later updates, a superseded redraw, a group off the current legend page, or a toggle not from the focused button leave focus alone | `228d4a5` |
| Y6 | Plot width is set per chart only | "Width for all charts" at the right of the pinned bar sets every chart; each chart keeps its own "Maximum width" to override just that chart (kept across redraws); the global control shows "Mixed (set per chart)" when they differ, so picking any size applies to all. Both hidden below 600px | `0931323`, `9e7eccc`, `0c41af8` |
| Y7-6a | Narrow screens: Fullscreen lands mid-row when the toolbar wraps | Hint left, controls packed right, so a wrapped row keeps Reset view and Fullscreen together at the right edge; empty status spans take no slot | `6242413` |
| Y7-6b | "Show data table" and Copy image / Save PNG sit on different rows | Table button is the first item of the image-actions row (left); Copy image / Save PNG grouped on the right so they wrap together | `6242413` |
| Y5 | The filter row (search, line display, means/fit) scrolls away | **CSS only, ≥ 1024px:** the filter row pins at the top and the Canvas/SVG bar pins directly below it; unpinned below 1024px | `80d9d25` |

Commits `6242413` and `80d9d25` are kept separate so each can be dropped on its own if a layout regression appears.

## Decisions taken

- Y3: "Sort by" includes Median, SD, Min and Max for summary tables (hidden in "All observations" mode).
- M3: filename format as above.
- Y5: option (a), CSS-only pinning on wide screens, as its own commit.
- Y6 (after PR review): keep per-chart width choices alongside the global control.
- Y3 (after PR review): sort matched pairs by either value column, with stable option keys.
- Y6 (after PR review): the global control shows "Mixed" when charts differ, so re-picking the same size still applies to all.
- Y8: statistics stay out of the pinned bars — confirmed: only the filter row and the Canvas/SVG bar are pinned.

## Deviations from the plan

Each is also explained in its commit message.

- **Y4** also applies to the metric cards above the charts, which had the same mixed formatting.
- **M3** lives in a new `src/export-name.js` instead of `model.js`, so the page doesn't load the CSV parser on the main thread just to name a file.
- **M2** adds a one-line guard in `chart.js`: highlighting skips hidden groups. Restoring focus to a now-hidden legend item otherwise dimmed every visible group (a behaviour that predates this PR).
- **Y7-6b** adds a two-line wrapper in `chart-image.js` so Copy image / Save PNG wrap as a pair; at 375px the three buttons need 329px of a 317px row.
- **Y7-6a** changes the wide-screen toolbar slightly: controls cluster to the right of the hint instead of being spread with equal gaps.
- **Y6** first replaced the per-chart selects (`0931323`); after review they were restored with the global control on top (`9e7eccc`), and the `widthControl` option added for the replacement was reverted. Per-chart width is now hidden below 600px (visible on phones in #4).
- **Y3** follow-up (`1bf9e9c`) was originally out of scope; added after review.
- **Y5** pins the filter row *above* the Canvas/SVG bar (the filter row comes first on the page), with a fixed 5.625rem height so the bar knows where to stop.

## Out of scope (follow-ups)

- **Y8** — pinned basic-statistics row: a design decision for the team.
- Running a custom stats provider inside the worker, so sampled (> 3,000 point) scatters can use it too.
- With a custom provider set, the Pearson card (worker) and the scatter legend (provider) could show different r.
- Redrawing only the toggled chart instead of all three after a legend click.
- `// @ts-check` missing from `main.js` and the new PR #4 modules.
- From the PR #4 review, not addressed here: the worker re-implements `data.js` CSV validation; each chart re-renders twice on window resize; the worker's `generated` dataset path is unreachable.

## Verification

- `npm test`: 42/42 pass (PR #4 had 33); `npm run check:stats`: all checks passed. Every fix added a test that failed before it, except Y5 (layout only).
- Y7 before/after measurements at 375, 560, 1024 (960 and 640 plot width) and 1920 px (960 and fit, Canvas and SVG); re-measured after per-chart widths returned at 560, 700, 1280 and 1920 px: Fullscreen 0px from its row's right edge at every width; table button on the image row wherever it fits; 0 overlapping controls; 0px horizontal overflow.
- Y5: scrolling in 25px steps at 1024, 1280 and 1920 px — filter row at 0px, bar at 90px, 0px overlap; unpinned at 1000px.
- All 5 examples load in Canvas and SVG with no console errors.
- Not re-checked on this branch: dark mode, native fullscreen (only the expanded fallback was exercised), clipboard copy.
