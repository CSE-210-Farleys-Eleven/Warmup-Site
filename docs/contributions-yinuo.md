# Contribution record: Yinuo

This page records Yinuo's review, implementation and documentation work with commit
evidence, and says which code in the same files came from other contributors. Read it
alongside the [PR #5 goal list](pr5-review-fixes.md), which has the full decisions.

**Applies to:** `main` through PR #5 and the post-revert repair, plus Yinuo's portion of
#23 (#32) · **Files:** [main.js](../src/main.js), [model.js](../src/model.js),
[export-name.js](../src/export-name.js), [chart.js](../src/chart.js),
[styles.css](../styles.css) · **Related:** #4, #5, #23, #30, #32

## Overview

Yinuo reviewed PR #4 and turned the findings into a goal list (Y = review findings,
M = issues found while reviewing). PR #5 implemented every goal except Y8, which was
left to the team as a design decision. Each goal has its own commit and a test that
failed before the change, except the layout-only Y5. It took the suite from 33 to 42
tests and merged on 2026-10-19. After PR #3 was reverted on `main`,
Yinuo restored the helpers and styles the revert had dropped.

## Implementation (PR #5)

| ID | Change | Commit | Test that fails before, passes after |
| --- | --- | --- | --- |
| Y1 | Switching linear/log resets both axes, not one | `4aa4042` | switching an axis scale while zoomed restores the home view on both axes |
| M4 | Worker fit overrides the scatter only when it is sampled | `5beb066` | the scatter legend uses a custom stats provider when the data is not sampled; the scatter carries a model-computed fit only when its points are a drawing sample |
| M1, Y3 | Pairs keep category order; sort is column + direction | `50d21b3` | matched pairs keep original category order within each group (M1); sorting takes a column and a direction, including summary statistics (Y3) |
| Y4 | One decimal count per table column and metric card | `2f661ea` | tables report one decimal count per column from the data precision, capped at 3 (Y4) |
| Y2, M3 | Clearer CSV export note; file names from the datasets | `ae42baf` | export file names name both datasets, the view and a data fingerprint (M3) |
| M2 | Focus returns to the toggled legend item after a redraw | `228d4a5` | focusing or hovering a hidden legend item does not dim the visible groups |
| Y6 | One width for all charts, per-chart overrides, "Mixed" | `0931323`, `9e7eccc`, `0c41af8` | new width assertions in the integration test "original empty state, examples and automatic two-file loading…" |
| Y7 | Fullscreen stays right; table button on the image row | `6242413` | new image-row assertion in the same integration test |
| Y5 | Filter row and Canvas/SVG bar pinned on wide screens | `80d9d25` | none (CSS only); checked in the browser at 1000–1920 px |
| Y3 | Pairs sort by either value column | `1bf9e9c` | matched pairs sort by either value column, in both directions (Y3 follow-up) |

## Repair after the PR #3 revert

The revert of PR #3 (`f34376f`) removed several helpers, but later merges brought back
code that calls them, which left `main` failing 8 of 39 tests. `4c975c8` restored those helpers in `chart.js`,
`data.js`, `scales.js` and the renderers, together with PR #3's own
`categoryLabelStep` tests, and `main` went to 45/45. `b9934eb` restored the PR #3
styles and comments the revert had also dropped. This code was written for PR #3 by
other contributors; the restore commits only put it back.

## Documentation and cleanup (#23, issue #32)

- Checked the 13 headers #30 adds to Yinuo's functions in `main.js`, `model.js` and
  `export-name.js` against the code (the one-line `stat` helper needs none), and ran
  their testable claims. Corrections go
  to #30 as review comments, so the two PRs don't edit the same files.
- `setScale` in `chart.js` now has a header covering the Y1 reset, its no-op cases
  and side effects.
- The PR #5 goal list has the template heading line and is marked as historical.
- Removed the unused `lastHidden` in `chart.js`, the one #24 lint error that #30
  does not fix.

## Collaboration and attribution

- The modules these changes live in (`model.js`, `main.js`, the table, CSV export,
  width and fullscreen controls) come from Anthony's PR #4. PR #5 changed them; it did
  not write them.
- The headers on Yinuo's functions in `main.js`, `model.js` and `export-name.js` are
  written by Anthony in #30, which also credits this work in its own contribution
  record.
- Charts, Canvas/SVG rendering and log axes come from PR #1 and PR #3; the SVG export
  comes from Poorva's PR #12.

## Follow-ups

- [ ] Summary sort puts NaN values (e.g. the SD of a group with one value) first in
  descending order, although the comment in `model.js` says they sort last.
- [ ] CSV and image export file names drop non-ASCII letters: a Chinese header gives
  `data_vs_data__…csv` and `chart.png`.

Both are bugs in code covered above and need a fix with a failing test first, after #30
merges, since `model.js` and `export-name.js` are #30's files.

## Testing

Each commit message in the tables above states its `npm test` result at the time. This
documentation changes no behavior: run `npm test`, `npm run typecheck` and changed-file
ESLint before submitting.
