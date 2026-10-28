# Documentation index

Every page in `docs/`, grouped by what you need it for. Start with [architecture](architecture.md) for the module map, then open the reference page for the code you are changing. The process pages outside this folder are listed at the end.

**Applies to:** `main` · **Files:** [docs/](.) · **Related:** [README](../README.md), [CONTRIBUTING](../CONTRIBUTING.md), [documentation.md](../templates/documentation.md)

## Reference

| Page | Covers |
| --- | --- |
| [Architecture](architecture.md) | Every source module, the main/worker boundary, the data-flow diagram, deployment and CI. |
| [Data pipeline](data-pipeline.md) | Import, model, table and CSV contracts, worker messages, error handling, executed examples. |
| [Scales](scales.md) | Linear and log scales, ticks, extents and label formats in `scales.js`. |
| [Renderers](renderers.md) | The `Scene` contract, the Canvas and SVG renderers, marker shapes, scale and renderer switching in `chart.js`, the stats provider. |
| [Chart layout](chart-layout.md) | Per-chart width, fullscreen, cleanup and state transfer. |
| [Chart image export](chart-image-export.md) | PNG and SVG export, Copy image, file names and limits. |

## Continuous integration

| Page | Covers |
| --- | --- |
| [CI](ci.md) | Each job, which rule is an error or a warning, and the remaining branch-rule work. |
| [Hygiene check scripts](hygiene-checks.md) | The functions and options behind the Hygiene job. |

## Contribution records

One page per contributor, with commit and test evidence and credit for other people's code in the same files. New pages follow [contribution-record.md](../templates/contribution-record.md).

| Page | Covers |
| --- | --- |
| [Anthony](contributions/anthony.md) | Worker pipeline, full-data model, tables, CSV and PNG export, and the architecture docs. |
| [Ekansh](contributions/ekansh.md) | Canvas and SVG renderers, log scale, CI and the reference pages for them. |
| [Noy](contributions/noy.md) | The Canvas/SVG toggle bar, r and n in the legend, category-label thinning and other small UI fixes, and the contributor workflow. |
| [Poorva](contributions/poorva.md) | Save SVG, export documentation and the Cypress tests. |
| [Yinuo](contributions/yinuo.md) | The PR #5 review fixes, the repair after the PR #3 revert, and `setScale` documentation. |

## Historical notes

These keep the validation results of the pull requests they describe. They are not updated as the code changes.

| Page | Covers |
| --- | --- |
| [Renderer and table notes](renderer-and-tables.md) | PR #4: branch integration, data flow and validation limits. |
| [PR #5 review fixes](pr5-review-fixes.md) | The goal list for PR #5, with decisions and tests. |

## Outside this folder

- [CONTRIBUTING.md](../CONTRIBUTING.md): branches, checks, reviews, releases and deployment.
- [AGENTS.md](../AGENTS.md): the same rules written for AI agents, with the commands to run before committing.
- [templates/](../templates/): function headers, commit messages, pull requests, docs pages, contribution records and the code hygiene checklist.
