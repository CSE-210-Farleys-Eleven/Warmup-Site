# Hygiene check scripts

This page is the reference for the scripts behind the CI jobs **Hygiene** and **Lint changed files**: [hygiene-lib.mjs](../scripts/ci/hygiene-lib.mjs) (the checks), [check-hygiene.mjs](../scripts/ci/check-hygiene.mjs) (the command that runs them on a PR) and [lint-changed.mjs](../scripts/ci/lint-changed.mjs). It is for anyone adding a rule or debugging a CI failure. [ci.md](ci.md) lists which rule is an error or a warning and why; this page documents the code.

**Applies to:** `main` through PR #34 · **Files:** [hygiene-lib.mjs](../scripts/ci/hygiene-lib.mjs), [check-hygiene.mjs](../scripts/ci/check-hygiene.mjs), [lint-changed.mjs](../scripts/ci/lint-changed.mjs) · **Related:** #18, #26, [ci.md](ci.md), [code-hygiene-checklist.md](../templates/code-hygiene-checklist.md)

## Overview

`hygiene-lib.mjs` holds pure checks: each takes plain strings or lists and returns a list of **issues**, so it can be tested without git or GitHub. `check-hygiene.mjs` is the only file that talks to git. It collects what a PR changed, calls the checks, prints GitHub annotations and exits 1 if any issue is an error.

An issue is an `Issue` object:

| Field | Type | Meaning |
| --- | --- | --- |
| `level` | `'error' \| 'warning'` | errors fail CI; warnings are annotations only |
| `rule` | `string` | short id shown as the annotation title, for example `secret` |
| `message` | `string` | explanation for the author |
| `file` | `string`, optional | repo-relative path; missing for issues about the whole PR |

No check throws on odd input. Each returns an empty list instead.

## API: hygiene-lib.mjs

All checks return `Issue[]`.

| Function | Input | Reports |
| --- | --- | --- |
| `checkBranchName(name)` | branch name, not a ref | warning `branch-name` unless it is `<type>/<short-description>` in lower case. Types: feature, fix, docs, refactor, test, chore. Empty names and `dependabot/`, `copilot/`, `revert-`, `main`, `main-backup` are exempt. |
| `checkCommitSubject(subject)` | first line of a commit message | one warning `commit-subject` listing every problem: over `MAX_SUBJECT` (100) characters, trailing punctuation, not capitalized, or a first word ending in `-ed`/`-ing` (not an imperative). Merge, revert, fixup! and squash! subjects are exempt. |
| `checkPinnedDependencies(pkg)` | parsed package.json | error `pinned-deps` per dependency that is not an exact version, in `dependencies`, `devDependencies` and `optionalDependencies`. |
| `checkForbiddenFiles(files)` | changed paths | error `forbidden-file` for `node_modules/`, `.DS_Store`, `.idea/` and `result.json`, at any depth. |
| `checkNewSrcFile(file, content)` | path and text of a newly added file | error `file-header` when a new `src/` `.js` file (not `src/vendor/`) lacks `// @ts-check` first or a `/** */` header after it. A leading byte-order mark is allowed. |
| `checkAddedLines(diff)` | output of `git diff -U0 --no-color` | error `secret` for an added line that looks like an AWS key, a GitHub or `sk-` token or a private key; one warning `line-length` per file with added lines over `MAX_LINE` (100) characters, in .js, .mjs, .css and .html files outside `vendor/`. |
| `checkTestsAndDocs(files)` | changed paths | warnings `tests` and `docs` when `src/` changed without a change in `test/` or in `docs/`/README. |
| `checkPullRequestBody(body)` | PR description | one warning `pr-body` when `## Summary` or `## How to test` is missing, empty, or still has template `<placeholder>` text. HTML comments and bold template lines count as empty. |
| `toAnnotations(issues)` | `Issue[]` | returns `string[]`, one GitHub workflow command per issue (`::error file=...,title=...::message`), with `%`, CR and LF escaped. |

Examples (each was run; long messages are cut with `...`):

```js
checkBranchName('Fix_Bug')
// => [{level: 'warning', rule: 'branch-name', message: 'Branch "Fix_Bug" should be <type>/<short-description> in lower-case, ...'}]
checkCommitSubject('Added tests.')
// => [{level: 'warning', rule: 'commit-subject', message: '"Added tests.": subject should not end with punctuation. use the imperative ("Add", not "Added").'}]
checkPinnedDependencies({devDependencies: {eslint: '^10.0.0'}})
// => [{level: 'error', rule: 'pinned-deps', file: 'package.json', message: 'devDependencies.eslint is "^10.0.0"; pin an exact version (no ^, ~ or ranges).'}]
checkForbiddenFiles(['src/a.js', 'docs/.DS_Store']).map((i) => i.file)
// => ['docs/.DS_Store']
checkAddedLines('+++ b/a.js\n@@ -0,0 +1 @@\n+' + 'x'.repeat(120))
// => [{level: 'warning', rule: 'line-length', file: 'a.js', message: 'a.js has 1 added line(s) over 100 characters (line 1).'}]
checkTestsAndDocs(['src/stats.js']).map((i) => i.rule)
// => ['tests', 'docs']
checkPullRequestBody('')
// => [{level: 'warning', rule: 'pr-body', message: 'PR description: Missing a "## Summary" section. Missing a "## How to test" section. See .github/pull_request_template.md.'}]
toAnnotations([{level: 'error', rule: 'secret', message: 'bad', file: 'a.js'}])
// => ['::error file=a.js,title=secret::bad']
```

## Commands

### `check-hygiene.mjs`

```sh
node scripts/ci/check-hygiene.mjs --base <sha> --head <sha> [--branch <name>] [--pr-body-file <path>] [--skip-style]
```

Run from the repository root. It checks what the PR **adds** (`base...head`), so old long lines and old problems do not fail it.

| Option | Meaning |
| --- | --- |
| `--base`, `--head` | commits to compare; both required |
| `--branch` | branch name for `checkBranchName` |
| `--pr-body-file` | file holding the PR description for `checkPullRequestBody` |
| `--skip-style` | for bot PRs: skips branch, commit-subject, tests/docs and PR-body checks, keeps the safety checks (files, pins, lockfile, headers, secrets, line length) |

It also raises error `lockfile` when `package.json` changed without `package-lock.json`.

**Exit codes:** 0 when there are no errors (warnings are fine), 1 when any error was found, 2 when `--base` or `--head` is missing. In GitHub Actions it also appends a summary to `GITHUB_STEP_SUMMARY`.

```sh
npm run check:hygiene -- --base origin/main --head HEAD --branch docs/function-headers
# ::warning title=docs::src/ changed but docs/ and README.md did not. Update docs in the same PR if behavior changed.
# hygiene: 0 error(s), 1 warning(s), 6 file(s) changed
```

### `lint-changed.mjs`

```sh
node scripts/ci/lint-changed.mjs <base>
```

Runs ESLint with `--max-warnings=0` on the `.js` and `.mjs` files changed since `<base>`, skipping `src/vendor/` and `demo/`. Older files still have a few style violations, so linting everything would fail PRs on code nobody touched.

**Edge cases:** with no base, or an all-zero SHA (a new branch), it prints `lint: no base commit, skipping.` and exits 0. With no changed JavaScript it prints `lint: no changed JavaScript files.` and exits 0. Otherwise it exits with ESLint's status.

## Design

1. CI passes the PR's base and head SHAs, the branch name and the description (as a file, so untrusted text never reaches a shell).
2. `check-hygiene.mjs` lists the changed files, the added files and the diff, and reads `package.json` and each new file at `head`.
3. It calls the checks and prints one annotation per issue.
4. It prints the totals and exits 1 if any issue is an error.

## Decisions

- **Pure checks, one git file.** Putting every rule in `hygiene-lib.mjs` lets [ci-hygiene.test.mjs](../test/ci-hygiene.test.mjs) test them with plain strings.
- **One warning per commit, per file and per PR description.** A commit with three wording problems gives one warning, a big new file gives one line-length warning, so real problems are not buried.
- **Wording only warns.** The subject limit is 100, not 72, because real commits here run to about 95. See [ci.md](ci.md).

## Limitations

- The imperative-mood check is a heuristic with a small allow-list (`embed`, `feed`, `bring`, ...). A verb it does not know that ends in `-ed` or `-ing` is flagged.
- Secret detection covers four patterns only (AWS access keys, GitHub tokens, `sk-` keys, private key headers).
- Line length is counted in characters of the added line, not columns.

## Testing

[ci-hygiene.test.mjs](../test/ci-hygiene.test.mjs) unit-tests each check, and [ci-scenarios.test.mjs](../test/ci-scenarios.test.mjs) runs the command on throwaway git repos with sample commits.

```sh
npm test
```

## Follow-ups

- [ ] Require the CI checks and one review before merging to `main` (#25).
