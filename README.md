# Steps & Sleep

Upload two CSV files to explore two line charts and a paired scatter plot. The first file supplies Y and the second supplies X in the scatter. Titles and category labels come from the files, so the same layout works for steps/sleep, study/scores or other numeric measurements.

Files are processed in a browser worker and are never uploaded. The interface follows the system's light/dark setting and uses English labels. Data-provided labels keep their original spelling.

## Run

```sh
npm start
```

Open http://localhost:3000 . There is no build step and no package installation is needed to run the site. Papa Parse 5.7.0 is bundled, with its MIT license, under `src/vendor/`; runtime parsing needs no CDN. Serve the files over HTTP rather than opening `index.html` directly.

For the automated tests, use Node 24:

```sh
npm ci --ignore-scripts
npm test
npm run check:stats
npm run typecheck
npm run lint
```

`npm run test:e2e` runs the Cypress browser tests and starts the server itself. `--ignore-scripts` skips the Cypress binary download, so run `npx cypress install` once first.

The test-only jsdom dependency is pinned in the lockfile. The site's runtime dependency on Papa Parse retains the existing version.

To contribute, follow [CONTRIBUTING.md](CONTRIBUTING.md): branches, checks, reviews, releases and deployment.

## Use

Select both CSV files to load them automatically, or choose an existing example. The page starts without charts. A failed or cancelled replacement keeps the previous successful dataset available.

| Action | Control |
| --- | --- |
| Inspect a value | Hover a point for its tooltip |
| Focus on a group | Hover or focus its legend name |
| Hide/restore a whole group | Click its name in that chart's legend |
| Find a group in a large legend | Search or page through 20 names at a time |
| Zoom / pan / reset | Ctrl or Command + scroll; drag; double-click or Reset view |
| Change renderer | Sticky Canvas/SVG buttons above the charts; zoom is retained |
| Use a log axis | Linear/Log selector on each numeric axis; category axes stay linear |
| Change chart width | Maximum width: 640, 800, 960, 1200 px or Fit available width |
| Expand one chart | Fullscreen; Escape or Exit fullscreen to close |
| Copy a chart image | Copy image at the chart's bottom right |
| Save a chart image | Save PNG, or Save SVG for a vector file (SVG renderer only) |
| Inspect/export values | Show data table; choose source, display, sorting and page size; Export CSV |

The original examples, selected-example styling, sticky renderer toggle, measured category-label spacing, mobile chart sizing, hover, reset and system theme are retained from `ui/renderer-controls`. The duplicate-name example and parser rules from current main are also retained.

## Statistics and display scope

- Counts, means, medians, sample standard deviations and correlation summarize complete data for the selected visible groups, not just drawn points. Group/category summary tables also show minimum and maximum.
- Legend visibility belongs to each chart independently. Hiding a group in the first line chart updates that chart's means without hiding it in the second chart or scatter. Scatter exclusions update its fit and correlation. Table and CSV use their selected chart source's exclusions and the shared group filter.
- A log axis cannot draw zero or negative values. The chart note counts those
  exclusions; worker metric cards, tables and CSV keep the original selected data.
  An unsampled scatter's displayed fit uses its plottable points and the page's
  stats provider; a sampled scatter uses the worker's complete selected-data fit.
  Regression remains ordinary least squares in original units, not log-space.
- The scatter's r and n stay in its legend rather than covering plotted values. Mean markers and the scatter fit can be configured above the charts.
- Above 20 visible groups, line charts show labelled category averages. Filter to at most 20 groups to see individual lines. This cap also applies to the Individual groups option.
- Charts draw at most 3,000 deterministic samples. Sampling preserves drawing responsiveness but does not represent every point or the full distribution density. Notes and PNG captions state the drawn/full counts or averaging scope.

## Tables and exports

One initially collapsed table serves all three chart sources. It renders 25, 50 or 100 rows per page in a scrollable region, with global sorting before pagination. Choose All observations, Summary by group or Summary by category. Paired summaries describe the first file's Y values within matched pairs.

Export CSV includes **all pages** of the selected display, filter and visible groups. Summary mode exports summaries; All observations exports cleaned numeric observations. Downloads preserve numeric precision; on-screen values are rounded. Formula-like labels are escaped for spreadsheet use. CSV generation is cancellable.

PNG exports include the current plot/zoom, title, active displayed legend, r/n when enabled, system-theme background and drawing-scope caption. A paged legend is identified as a page; exports do not expand thousands of legend entries. PNG size is capped at 4096 px per dimension and 16 million pixels. Copy image requires a secure context (HTTPS or localhost), ClipboardItem support and clipboard permission. Unsupported copying is disabled; permission/encoding failures appear inline. Save PNG remains a separate action.

Save SVG writes the same title, legend and caption as the PNG, with the plot kept as vector shapes; opened in a browser, points and means show their tooltip text on hover. It needs the SVG renderer. See [chart image export](docs/chart-image-export.md).

## Input format and limits

```csv
Step Count,Monday,Tuesday,Wednesday
Eita,3608,4246,4116
Jay,7440,10560,6566
```

The top-left header names the measurement; the first column names each group; remaining headers name categories. Headers must be nonempty and unique after trimming. Numeric cells can include decimals and scientific notation. Blank/invalid values are skipped with warnings. Duplicate normalized names are combined; the first valid value for a group/category is kept. Pairing uses normalized names and matching category text, so reordered columns still pair correctly. Categories only present in one file remain in that file's line chart but do not become scatter pairs.

| Budget | Limit |
| --- | --- |
| File size | 5 MiB per file |
| CSV data records | 20,000 per file |
| Value columns | 512 per file |
| Combined input value cells | 250,000 |
| Plotted points | 3,000 per chart |
| Individual line groups | 20 |
| Table rows in the DOM | At most 100 |

Oversized input is rejected explicitly rather than silently truncated. Parsing uses 256 KiB chunks; import cancellation terminates the candidate worker. Table caches, warnings, drawing payloads and legend controls are bounded. Chart replacement releases observers, theme and resize listeners. These budgets reduce resource pressure; they do not guarantee performance on every browser/device.

## Code and integration

- `src/main.js`: UI coordination, atomic worker replacement, chart state, paginated inspection and CSV download.
- `src/pipeline.worker.js`: chunked parsing, budgets, model requests and cancellable CSV serialization.
- `src/data.js`: parser and normalized names; `buildFromParsed` reuses the same cleaning rules for worker chunks.
- `src/model.js`: full-data matching, per-chart exclusions, summaries, deterministic samples and cached tables.
- `src/chart.js`, `src/scales.js`, `src/render-*.js`: renderer-neutral interaction, axes and Canvas/SVG drawing.
- `src/chart-layout.js`, `src/chart-image.js`: width/fullscreen lifecycle and bounded PNG/SVG image export ([docs](docs/chart-image-export.md)).
- `src/stats.js`: existing fit/provider API plus grouped-statistics API from the grouped-stats branch.

`drawScatter` retains `setRenderer`, `setScale` and `getState`, and adds `destroy` for cleanup. It accepts optional full-data `statsOverride`/`meanPoints`, group/exclusion metadata and an `onVisibilityChange` callback for worker recalculation. Chart state includes view, width and legend search/page so legend changes retain interaction state.

The synchronous `setStatsProvider` extension remains available for direct chart
use and unsampled scatter fits. Sampled scatters receive a full-data worker fit;
replacing that calculation requires changing the worker's statistics pipeline.
A future backend should return complete raw-unit summaries and exclusion counts
separately from sampled drawing data; no backend or API service is introduced here.

See [renderer and table implementation notes](docs/renderer-and-tables.md) for data flow, branch integration and validation limits.

## Repository layout

| Path | Holds |
| --- | --- |
| `index.html`, `styles.css`, `server.js` | The page, its styles and the static server behind `npm start`. |
| `src/` | The site's code, described under Code and integration above. `src/vendor/` is Papa Parse. |
| `data/` | Example CSV files (`data/examples/`), the Steps & sleep pair and parser test cases (`data/testcases/`). |
| `test/` | Unit and integration tests for `npm test`. |
| `cypress/` | End-to-end specs for `npm run test:e2e`. |
| `scripts/` | `check-stats.mjs` and the CI hygiene check in `scripts/ci/`. |
| `templates/` | The templates every contribution follows: function headers, commit messages, pull requests, code reviews, docs pages, contribution records and the code hygiene checklist. |
| `docs/` | Reference pages and contribution records, indexed in [docs/README.md](docs/README.md). |
| `.github/` | The CI and deploy workflows and the pull request template. |
| `AGENTS.md`, `CLAUDE.md` | Rules for AI agents working in the repo; `CLAUDE.md` and `.github/copilot-instructions.md` point to `AGENTS.md`. |

## Contributing and documentation

Start with [CONTRIBUTING.md](CONTRIBUTING.md) for branches, checks, reviews and releases, and the [templates](templates/) for how code, commits, pull requests, docs and contribution records should look. CI checks many of these rules automatically ([docs/ci.md](docs/ci.md)).

[docs/README.md](docs/README.md) indexes every documentation page: architecture, the data pipeline, scales and renderers, chart layout and image export, CI, the historical PR notes, and one contribution record per contributor in [docs/contributions/](docs/contributions/).
