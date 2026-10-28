# Contribution record: Ekansh

This page records Ekansh's implementation, CI, review and documentation work with commit evidence, and says which code in the same files came from other contributors. Read [renderers](../renderers.md), [scales](../scales.md) and [hygiene checks](../hygiene-checks.md) for how that code works.

**Applies to:** `main` through PR #33, plus PR #34 · **Files:** [scales.js](../../src/scales.js), [render-common.js](../../src/render-common.js), [render-canvas.js](../../src/render-canvas.js), [render-svg.js](../../src/render-svg.js), [chart.js](../../src/chart.js), [stats.js](../../src/stats.js), [hygiene-lib.mjs](../../scripts/ci/hygiene-lib.mjs), [ci.yml](../../.github/workflows/ci.yml) · **Related:** #1, #18, #23, #26, #34

## Overview

Ekansh built the Canvas renderer, the SVG/Canvas switch and the per-axis log scale (PR #1), then the GitHub Actions CI that enforces the repo templates (PR #26, closing #18). For his part of #23 (PR #34) he added headers to that code, wrote the module reference pages above, and fixed a crash in `niceTicks` that the headers work exposed. He also reviewed and approved PRs #29, #30, #31 and #33.

## Implementation: Canvas, SVG and log scale (PR #1)

| Change | Commit | Test |
| --- | --- | --- |
| Split `chart.js` into a renderer-neutral `Scene` and two backends (`render-canvas.js`, `render-svg.js`) with shared `render-common.js`; Canvas is the default; interaction listeners moved to the wrapping `div` so switching renderers does not rebind them | `e55aa79` | Covered today by `controls.test.js`; the scale code has its own tests below |
| Independent linear/log scale per axis, with pure `scales.js` (t-space, `makeScale`, `logTicks`, `formatLogTick`, `paddedExtent`) and a per-chart scale select | `e55aa79` | `scales.test.js`: scale maps and round trips, non-positive values rejected, `paddedExtent`, `logTicks` over many decades and fractional ranges, `formatLogTick` |
| `computeStats()` and `setStatsProvider()` so the trend line and `r` label can use another statistics library | `e55aa79` | `scales.test.js`: stats provider can be swapped and restored |
| Fix a stale hover ring on Canvas after hover then pan; wheel zoom about 20% per notch instead of about 2.7x | `e55aa79` | None recorded in the commit message |
| Thin out log-axis ticks when a sub-decade range would crowd them (raised by noyfisher-SD in review) | `a55ae07` | `scales.test.js`: crowded case, every multiple fits, `maxTicks` sweep |

PR #1 merged on 2026-10-19.

## Implementation: CI (PR #26, issue #18)

| Change | Commit | Test |
| --- | --- | --- |
| Pin ESLint and TypeScript as dev tools; opt-in type checking for files with `// @ts-check` | `c914b25` | `npm test` 45/45; `npm run typecheck` passes |
| `ci.yml` (tests, type check, changed-file lint, hygiene) and `deploy.yml` gated on it; `hygiene-lib.mjs`, `check-hygiene.mjs`, `lint-changed.mjs`; `docs/ci.md` | `516909a` | `ci-hygiene.test.mjs` (unit tests per check) and `ci-scenarios.test.mjs` (15 sample-commit scenarios); `npm test` 67/67 |
| One hygiene warning per commit and per PR description | `e1599f1` | a commit with several wording problems gives one warning; 68/68 |
| One file-header error per new file; current action versions | `e2b8039` | scenario tests unchanged; 68/68 |
| One line-length warning per file | `29ddb03` | many long lines in one file give a single warning; 69/69 |

PR #26 merged on 2026-10-26 after Poorva's approval. Ekansh also opened the throwaway PRs #13 to #16 to show how CI reports clean, warning, error and failing changes; they were closed, not merged.

## Documentation and fix (#23, PR #34)

| Change | Commit |
| --- | --- |
| Function headers per [function-headers.md](../../templates/function-headers.md) for every check in `hygiene-lib.mjs`, with an `Issue` typedef | `d527a09` |
| Function headers for all of `scales.js`, `render-common.js`, `render-canvas.js` and `render-svg.js`, with examples that were run | `603883f` |
| `niceTicks` returns no ticks for an empty range instead of throwing a `RangeError` (it looped on a step of 0); new test | `03e78e9` |
| Module reference pages [scales.md](../scales.md), [renderers.md](../renderers.md) and [hygiene-checks.md](../hygiene-checks.md); headers for the `chart.js` helpers `reportHidden`, `tickList`, `buildScene`, `setRenderer` and the `builtinProvider` in `stats.js`; direct tests for the SVG renderer (`renderers.test.js`) | this PR |

## Reviews

Approved #29 (Cypress tests), #30 (architecture and Anthony's contracts), #31 (contributor workflow) and #33 (Yinuo's record).

## Attribution

- `categoryLabelStep` and its tests are noyfisher-SD's (`739e1c4`); Yinuo restored them after PR #3 was reverted (`4c975c8`). They sit in `scales.js` beside Ekansh's functions and are documented in [scales.md](../scales.md).
- The Y1 reset of both axes in `setScale` is Yinuo's (`4aa4042`); Ekansh wrote the original `setScale`.
- Tooltips and export hooks in `chart.js` are Poorva's (`3e4c6de`) and ex188's (`3d82f1b`); grouped statistics in `stats.js` are Sritha's (`61c7ce3`).
- The templates that the CI rules enforce are Sritha's (`docs/repo-templates`). The Cypress job added to `ci.yml` is Poorva's (PR #29).

## Follow-ups

- [ ] `niceTicks` can drop the top tick through float rounding; see [scales.md](../scales.md).
- [ ] `render-canvas.js` has no direct unit test.
- [ ] Require the CI checks before merging to `main` (#25) and fix the existing lint errors so CI can lint the whole tree (#24).

## Testing

This page changes no behavior. The code it describes is covered by `scales.test.js`, `renderers.test.js`, `ci-hygiene.test.mjs` and `ci-scenarios.test.mjs`.

```sh
npm test
```
