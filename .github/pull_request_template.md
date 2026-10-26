<!--
PR title: same style as a commit subject.
  <Imperative verb> <what changed> [(<issue or goal IDs>)]
  e.g. Review fixes for #4: scale reset, table sorting and decimals, export naming
Delete these comments and any section that doesn't apply.
-->

## Summary

<!-- 2–4 sentences: what this PR does and why. A reviewer should understand the PR from this alone. -->

**Base:** `<target branch>` · **Closes:** #<issue> · **Related:** #<PR>

## Goals

<!-- One row per goal. Use IDs from the issue or review (Y1, M2…) so commits and docs can refer to them. -->

| ID | Goal | Decision | Commit |
| --- | --- | --- | --- |
| G1 | <problem or request> | <what was done, and any option chosen> | `<short sha>` |

## Changes

<!-- Grouped by area. Note anything removed, renamed or reverted. -->

- **<Area, e.g. Charts>:** <change>
- **<Area>:** <change>

## How to test

<!-- Steps a reviewer can follow. Include example data to use. -->

1. `npm test`, expect <N>/<N> pass.
2. `npm start`, open http://localhost:3000.
3. <click path> → expect <result>.

## Screenshots

<!-- Before / after for any UI change. Include narrow (< 600px) and dark mode when relevant. -->

| Before | After |
| --- | --- |
| | |

## Plan deviations and decisions

<!-- Anything that differs from the issue or agreed plan, and decisions reviewers should confirm. -->

- <none>

## Risks and follow-ups

<!-- What could break, what was not tested, and work left for later (link issues). -->

- <none>

## Checklist

- [ ] Commits follow [templates/commit-message.txt](../templates/commit-message.txt)
- [ ] New or changed functions have headers per [templates/function-headers.md](../templates/function-headers.md)
- [ ] Tests added or updated; `npm test` passes
- [ ] Checked in the browser (light/dark, narrow width) if the UI changed
- [ ] Docs in `docs/` or README updated if behavior changed
- [ ] [Code hygiene checklist](../templates/code-hygiene-checklist.md) done
