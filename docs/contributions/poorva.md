# Contribution record: Poorva

This page records Poorva's implementation, documentation and testing work with commit
evidence, and says which code in the same files came from other contributors. Read
[chart image export](../chart-image-export.md) for how the export code works.

**Applies to:** `main` through PR #29 · **Files:** [chart-image.js](../../src/chart-image.js),
[chart.js](../../src/chart.js), [site.cy.js](../../cypress/e2e/site.cy.js),
[ci.yml](../../.github/workflows/ci.yml) · **Related:** #12, #22, #23, #27, #28, #29

## Overview

Poorva added Save SVG to the chart export (PR #12), then documented the export code to
the team templates as her part of #23 (PR #27), and added Cypress end-to-end tests that
run in CI before every deploy (PR #29). She also turned on GitHub Issues for the repo
and opened the issues #17 to #25 and #28 for the team's task list.

## Implementation (PR #12)

| Change | Commit | Test |
| --- | --- | --- |
| Move the export header layout and the download step out of `chartPng`, so PNG and SVG share them | `602bfed` | Existing PNG export tests, unchanged |
| Add Save SVG: a standalone vector file with the same title, legend and caption as the PNG; on the Canvas renderer it explains that SVG is needed instead of saving a raster | `3294752` | `controls.test.js`: three export buttons, `chartSvg` output, the Canvas error |
| Keep each point's and mean's tooltip text as a native hover label in the saved SVG; the live chart and the export share one `tooltipContent` helper in `chart.js` | `3e4c6de` | `controls.test.js`: one `<title>` per drawn point, none added to the live chart |

## Documentation and cleanup (#23, PR #27)

| Change | Commit |
| --- | --- |
| `// @ts-check`, a file header, typedefs and function headers per [function-headers.md](../../templates/function-headers.md) for all of `chart-image.js`; two tests for the empty-title file name fallback | `e803005` |
| New [chart-image-export.md](../chart-image-export.md) page; README now lists Save SVG | `c5a1d07` |

PR #27 closed #22, Poorva's part of #23. Yinuo reviewed and approved it.

## End-to-end tests (PR #29)

| Change | Commit |
| --- | --- |
| Four Cypress specs: empty state, loading the Steps & sleep example, Canvas to SVG switch, data table and group filter; an `End-to-end (Cypress)` CI job that also gates the Pages deploy; `npm run test:e2e` | `5462ddd` |

PR #29 closed #28. Ekansh reviewed and approved it.

## Attribution

- The PNG export, Copy image and the export resource limits come from Anthony's PR #4.
  PR #12 reorganized that code to share it with SVG; PR #27 added headers to all of
  `chart-image.js`, including the PR #4 code, because the SVG export uses its helpers.
- Canvas and SVG rendering come from PR #1 and PR #3. The CI workflow that PR #29
  extends comes from Ekansh's PR #26, and the templates from Sritha.

## Follow-ups

- [ ] In a narrow window on the Canvas renderer, the Save SVG message shifts the export
  buttons (from Yinuo's review of #27).
- [ ] Non-ASCII dataset names drop out of export file names. Tracked in
  Yinuo's contribution record (#33) for `export-name.js`.

## Testing

Each commit message from PR #27 on states its test result. This page changes no
behavior: run `npm test`, `npm run test:e2e` and `npm run lint` before submitting.
