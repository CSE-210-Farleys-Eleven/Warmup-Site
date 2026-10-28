# Code hygiene checklist

Run through this before opening a PR. Reviewers can use it too.

## Code

- [ ] New files in `src/` start with `// @ts-check` and a file header. When you make a substantial change to an older file without them, add them.
- [ ] Exported functions and types have headers per [function-headers.md](function-headers.md).
- [ ] Names say what a value is (`meanX`, `hiddenGroups`), not how it is stored (`arr2`, `tmp`). Booleans read as questions (`isSampled`, `hasTrend`).
- [ ] Functions do one thing. Pure logic (stats, scales, model) stays free of DOM code so it can be tested in Node.
- [ ] Bad input returns a documented value (often `NaN` or an empty list) instead of throwing, unless the header says it throws.
- [ ] No leftover `console.log`, `debugger`, commented-out code or unused imports.
- [ ] No magic numbers: limits and sizes are named constants (e.g. `LIMITS.drawn`).
- [ ] Event listeners, observers, workers and timers are removed when their chart or view is replaced.
- [ ] User-facing text is English; labels from uploaded files are shown as text, never as HTML.
- [ ] No secrets, tokens or personal data in code, test data or commits.

## Formatting

- [ ] 2-space indent, single quotes, semicolons, matching the existing files.
- [ ] `const` by default, `let` only when reassigned, never `var`.
- [ ] ES modules (`import` / `export`) with `.js` extensions in import paths.
- [ ] New lines around 100 characters or less (don't reflow untouched lines just for this); files end with a newline.

## Tests

- [ ] New behavior has a test in `test/`, named after what it checks (`'stats provider can be swapped and restored'`).
- [ ] Bug fixes have a test that fails before the fix and passes after.
- [ ] `npm test` passes locally (and `npm run check:stats` if stats changed).

## Repository

- [ ] Branch name: `<type>/<short-description>`, where type is `feature`, `fix`, `docs`, `refactor`, `test` or `chore` (e.g. `fix/pr4-review-fixes`).
- [ ] Commits follow [commit-message.txt](commit-message.txt); one logical change per commit.
- [ ] PR description follows [pull-request.md](pull-request.md) and targets the right base branch.
- [ ] Docs in `docs/` follow [documentation.md](documentation.md) and are updated with the code.
- [ ] Your page in `docs/contributions/` lists this work, following [contribution-record.md](contribution-record.md).
- [ ] Generated or local files (`node_modules/`, `.DS_Store`, editor settings) are not committed; add them to `.gitignore` if needed.
- [ ] Dependencies are pinned to exact versions, and the lockfile is committed with any change to `package.json`.
