# Continuous integration

How GitHub Actions checks pull requests and gates deployment, and which rule from the templates each check enforces.

**Applies to:** `main` · **Files:** [ci.yml](../.github/workflows/ci.yml), [deploy.yml](../.github/workflows/deploy.yml), [scripts/ci/](../scripts/ci/) · **Related:** [code-hygiene-checklist.md](../templates/code-hygiene-checklist.md)

## Overview

[ci.yml](../.github/workflows/ci.yml) runs on every pull request, by hand (`workflow_dispatch`), and as the first job of [deploy.yml](../.github/workflows/deploy.yml), so a broken `main` is not published to Pages. Checks are either **errors** (fail the run) or **warnings** (shown as annotations and in the run summary, never failing).

## Design

| Job | Runs | What it checks | Fails the run? |
| --- | --- | --- | --- |
| Tests | `npm ci --ignore-scripts`, `npm test`, `npm run check:stats` on Node 24 | Test suite and stats sanity check | Yes |
| Type check | `npm run typecheck` | Files that start with `// @ts-check` (see [tsconfig.json](../tsconfig.json)) | Yes |
| Lint changed files | `scripts/ci/lint-changed.mjs` | ESLint on JavaScript changed in the PR: `var`, `prefer-const`, unused variables, `console`, `debugger`, single quotes, semicolons, 2-space indent, final newline | Yes |
| Hygiene (PRs only) | `scripts/ci/check-hygiene.mjs` | See below | Errors only |

Hygiene rules:

| Rule | Level | Source |
| --- | --- | --- |
| `forbidden-file`: `node_modules/`, `.DS_Store`, `.idea/`, `result.json` added | Error | Checklist, Repository |
| `pinned-deps`: a dependency with `^`, `~` or a range | Error | Checklist, Repository |
| `lockfile`: `package.json` changed without `package-lock.json` | Error | Checklist, Repository |
| `file-header`: new `src/` file lacks `// @ts-check` or a `/** */` header | Error | [function-headers.md](../templates/function-headers.md) |
| `secret`: an added line looks like a token or private key | Error | Checklist, Code |
| `line-length`: an added line is over 100 characters | Warning | Checklist, Formatting |
| `branch-name`: not `<type>/<short-description>` | Warning | Checklist, Repository |
| `commit-subject`: past tense or `-ing`, trailing punctuation, lower case, over 100 characters | Warning | [commit-message.txt](../templates/commit-message.txt) |
| `tests`, `docs`: `src/` changed with no change in `test/` or `docs/`/README | Warning | Checklist, Tests and Repository |
| `pr-body`: Summary or How to test missing, empty, or still the template | Warning | [pull-request.md](../templates/pull-request.md) |

## Decisions

- **Only changed files are linted.** Some older files still have style violations; linting the whole tree would fail PRs on code they did not touch. `npm run lint` lints everything for local cleanup.
- **Wording checks only warn.** A reasonable commit should not block a merge. The subject limit warns past 100 characters, not 72, because the repo's own PR #5 commits run to about 95.
- **Bots skip wording checks.** Bot actors (names ending in `[bot]`) get the safety checks (files, pins, secrets, headers) but not branch, commit or PR-body wording. Dependabot, Copilot and `revert-*` branch names are exempt from the branch rule.
- **`tsc` is not strict.** The existing `@ts-check` files do not pass `strict` mode (implicit `any`, nullable fields), so [tsconfig.json](../tsconfig.json) sets `strict: false`. Raise it as those files are cleaned up.
- **Untrusted text never reaches a shell.** The PR description, branch name and SHAs are passed through environment variables and a file, not interpolated into `run:`.
- **The PR template is copied.** GitHub only reads [.github/pull_request_template.md](../.github/pull_request_template.md); a test fails if it drifts from [templates/pull-request.md](../templates/pull-request.md).

## Limitations

- Not automatable, so left to review: meaningful names, one-purpose functions, no stale headers, browser checks (light/dark, narrow width).
- The imperative-mood check is a heuristic (words ending in `-ed` or `-ing`), with a small allow-list.
- Warnings do not block a merge. Making a check required is a repository setting (Settings, Rules); see Follow-ups.
- `npm audit` currently reports advisories in `undici`, pulled in by `jsdom`. This is not checked in CI.

## Testing

[test/ci-hygiene.test.mjs](../test/ci-hygiene.test.mjs) unit-tests each check, including subjects taken from real commits. [test/ci-scenarios.test.mjs](../test/ci-scenarios.test.mjs) builds throwaway git repos, makes sample commits (clean, wording slips, bad files, unpinned dependency, secret) and asserts which rules fire and whether the run fails.

```sh
npm test
npm run lint
npm run typecheck
npm run check:hygiene -- --base origin/main --head HEAD --branch "$(git branch --show-current)"
```

## Follow-ups

- [ ] Add a branch ruleset on `main` that requires the Tests, Type check and Lint changed files checks, and a pull request.
- [ ] Fix the existing lint violations (`npm run lint`) and then lint the whole tree in CI.
- [ ] Turn on `strict` type checking once the `@ts-check` files allow it.
