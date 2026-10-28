# Contribution record: Noy

This page records Noy's (`noyfisher-SD`) frontend and process work with commit evidence: the controls around the Canvas/SVG renderers, a set of small UI fixes, and the contributor workflow. It also says which code in the same files came from other contributors. Read [renderers](../renderers.md) and [scales](../scales.md) for how the chart code works, and [CONTRIBUTING.md](../../CONTRIBUTING.md) for the workflow itself.

**Applies to:** `main` · **Files:** [styles.css](../../styles.css), [index.html](../../index.html), [chart.js](../../src/chart.js), [scales.js](../../src/scales.js), [main.js](../../src/main.js), [CONTRIBUTING.md](../../CONTRIBUTING.md) · **Related:** #1, #3, #8, #11, #20, #21, #25, #31

## Overview

Noy built the frontend side of the Canvas/SVG integration on top of Ekansh's renderers (PR #1), plus small UI fixes, as nine commits in PR #3. PR #3 merged on 2026-10-19 and was reverted an hour later (#8). #11 merged it again, and Yinuo restored the parts the revert had dropped. PR #3's description told Ekansh that the legend change removes `cornerLabel` from his `Scene`, and reported crowded log-axis ticks, which he then fixed. Noy then wrote the contributor workflow in `CONTRIBUTING.md` (PR #31, closing #21), which Ekansh reviewed and approved.

## Implementation: Canvas/SVG controls (PR #3)

| Change | Commit | Test |
| --- | --- | --- |
| The Canvas/SVG buttons become one segmented control: a shared border, a filled pressed button and a visible focus ring. Markup and JS are unchanged, because `role=group`, `aria-label` and `aria-pressed` already described the control | `c61fdbf` | None: CSS only. The switch itself is covered by `site.cy.js`: "redraws the charts as SVG when the SVG renderer is chosen" (Poorva, #29) |
| The toggle moves into a sticky bar at the top of `#charts`, hidden until there are charts, with a one-line note on what Canvas and SVG mean. `scroll-padding-top` stops keyboard focus from landing under the bar | `e469909` | None automated. In the browser, without the padding a focused Reset button near the top stayed hidden under the bar |
| The Linear/Log selects get the Reset button's border, radius, height and focus ring. They stay native selects | `4c9f7b4` | None: CSS only |
| "r = … (n = …)" moves from the plot corner, where it hid a point on "Study hours & quiz scores", into the legend next to "Linear fit". `cornerLabel` is removed from the `Scene` and both renderers | `f7fe43f` | `controls.test.js`: "original empty state, examples and automatic two-file loading…" checks `n = 35` in `.trend-stat` and no `.corner-label` (Anthony, #4); "the scatter legend uses a custom stats provider when the data is not sampled" reads `.trend-stat` (Yinuo, #5) |

## Implementation: small UI fixes (PR #3)

| Change | Commit | Test |
| --- | --- | --- |
| Category labels that would overlap at phone width ("MondayTuesday…" at 375 px) are thinned. The widest label is measured with the tick font, and every n-th category is labelled, chosen by index so labels don't jump while panning | `739e1c4` | `scales.test.js`: "categoryLabelStep keeps every label when they fit", "… skips labels that would overlap", "… shows every label for a degenerate axis" |
| The minimum chart width drops from 320 to 240 px, so charts no longer stick 9 px out of their cards on a 360 px phone | `a928b15` | None automated. Checked in the browser at 360 px |
| Light-mode `--text-muted` darkens to `#74736d`, taking tick labels from 3.5:1 to 4.6:1 contrast on the surface (WCAG AA asks for 4.5:1). Dark mode keeps `#898781` explicitly | `d357eea` | None: CSS only. Contrast ratios measured on both backgrounds |
| The example on screen gets `aria-current="true"` and the same filled style as the selected renderer. It is set only after the charts draw, and cleared on upload or error | `95de8e4` | `controls.test.js`: "original empty state, examples and automatic two-file loading…" checks `aria-current` after an example loads and none after a file pair is uploaded (Anthony, #4) |
| The selected style keeps `font-weight: 600`, so it stays visible in Windows High Contrast mode, where fills are replaced | `eeecac7` | None: CSS only |

At the time PR #3 reported `npm test` 13/13 (Ekansh's 10 plus the 3 `categoryLabelStep` tests) and a clean type check on every commit. It was also checked in the browser in Canvas and SVG, light and dark, at 360 px, 375 px and desktop width.

## Documentation (#21, PR #31)

| Change | Commit |
| --- | --- |
| [CONTRIBUTING.md](../../CONTRIBUTING.md): local setup, branch names, the checks to run before pushing, PRs, review (1 approval from the same area and no self-merging, from #20 and #25), squash merges into `development`, release PRs with merge commits, checking the Pages deploy, syncing `main` back into `development`, and fixing lint. Each step labels what works today, what is team policy and what was pending. The README links to it | `c47da96` |

PR #31 merged on 2026-10-28 after Ekansh's approval. Its description lists the steps still needed to adopt the workflow: a `development` branch, the rulesets and the repository settings.

## Attribution

- Canvas and SVG rendering, the `Scene` contract, the log scale and the scale selects come from Ekansh's PR #1. PR #3 restyles his toggle and selects and moves the r/n text out of his `Scene`. It does not change how either renderer draws.
- Ekansh fixed the crowded log-axis ticks that PR #3 reported (`a55ae07`).
- After the PR #3 revert, Yinuo restored `categoryLabelStep`, `widestLabelPx`, their tests and the PR #3 styles (`4c975c8`, `b9934eb`). The code is PR #3's; the restore commits put it back.
- Anthony's PR #4 reworked `main.js`, including `markCurrentExample`, and wrote the integration test that covers the legend text and the example highlight. His `d029c72` (#30) added the header on `markCurrentExample`, and Ekansh's `603883f` (#34) extended the one on `categoryLabelStep`.
- Ekansh updated `CONTRIBUTING.md` in `662ff48` (#38) for whole-tree lint, the Cypress job and contribution records.

## Follow-ups

- [ ] A comment in `stats.js` still calls the legend text a "corner label". PR #3 left it because #1 and #2 both rewrote that block.
- [ ] Hovering the current example changes its border colour. `.examples button:hover` has the same specificity as the selected rule and comes later in `styles.css`.
- [ ] PR #3 noted a rare race: uploading a file while an example is still loading can leave the example highlighted. This has not been re-checked since.
- [ ] GitHub doesn't enforce the workflow in `CONTRIBUTING.md` yet: there is no `development` branch, and the `main` ruleset is still open in #25.

## Testing

This page changes no behavior. The code above is covered by `scales.test.js` (the `categoryLabelStep` tests), `controls.test.js` (legend text and example highlight) and the Cypress renderer-switch spec in `cypress/e2e/site.cy.js`. The CSS-only changes have no automated test.

```sh
npm test
npm run test:e2e
```
