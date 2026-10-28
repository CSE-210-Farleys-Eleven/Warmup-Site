# Contributing

How a change moves from a branch to the live site, and which parts of that GitHub enforces today. Read [How changes flow](#how-changes-flow) first, then follow the numbered steps.

**Applies to:** `main` and `development` · **Files:** [ci.yml](.github/workflows/ci.yml), [deploy.yml](.github/workflows/deploy.yml), [PR template](.github/pull_request_template.md) · **Related:** [CI checks](docs/ci.md), [templates/](templates/)

Labels used below:

- **Today:** how this repository works now.
- **Policy:** agreed team practice that GitHub does not enforce yet.
- **Pending:** tooling in an open PR. It is not available until that PR merges.

## How changes flow

```
feature/… · fix/… · docs/… · chore/… · refactor/… · test/…
        │  pull request, squash merge
        ▼
   development        integration branch
        │  release pull request, merge commit
        ▼
       main           release branch → GitHub Pages
```

> **Today:** there is no `development` branch yet, so every pull request targets `main`, and `main` has no branch rules. Until `development` exists, read `development` below as `main`.

## 1. Set up locally

Use **Node.js 24**, the version CI uses.

```sh
npm ci --ignore-scripts   # install the exact versions in package-lock.json
npm start                 # serve the site at http://localhost:3000
```

Open the site through `npm start`. Opening `index.html` directly from disk does not work.

## 2. Start a branch from the latest `development`

Assign yourself the issue first, so two people don't take the same work ([#20](https://github.com/CSE-210-Farleys-Eleven/Warmup-Site/issues/20)).

```sh
git fetch origin
git switch --no-track -c feature/short-description origin/development
```

`--no-track` stops a later `git push` from targeting `development` itself. Push with `git push -u origin HEAD`.

| Prefix | Use it for |
| --- | --- |
| `feature/` | new behaviour |
| `fix/` | bug fixes |
| `docs/` | documentation only |
| `chore/` | tooling, CI, dependencies |
| `refactor/` | code changes with no change in behaviour |
| `test/` | tests only |

Use lower case after the prefix, and keep one change per branch.

> **Today:** the **Hygiene** check warns, but does not fail, when a branch name doesn't match `<type>/<short-description>`.

## 3. Make the change and validate it

- **Code:** a new file in `src/` must start with `// @ts-check` and a `/** */` header ([function-headers.md](templates/function-headers.md)). CI fails without them.
- **Docs:** when you change behaviour, commands or file formats, update `README.md` or a page in `docs/` ([documentation.md](templates/documentation.md)) in the same PR.
- **Commits:** follow [commit-message.txt](templates/commit-message.txt): an imperative subject, then why, what and how it was tested.

Before pushing, run the same checks as CI:

```sh
npm test
npm run check:stats
npm run typecheck
node scripts/ci/lint-changed.mjs origin/development
npm run check:hygiene -- --base origin/development --head HEAD --branch "$(git branch --show-current)"
```

`lint-changed.mjs` lints only the JavaScript you changed. `npm run lint` lints the whole tree, which still has older violations ([docs/ci.md](docs/ci.md#decisions)).

**Browser check:** run `npm start`, load each example and upload a CSV pair. Check Canvas and SVG, light and dark, and a narrow width (under 600 px) as well as desktop.

> **Pending:** [#29](https://github.com/CSE-210-Farleys-Eleven/Warmup-Site/pull/29) adds browser tests: `npm run test:e2e` (Cypress) locally, and an **End-to-end (Cypress)** job in CI.

## 4. Open a focused pull request into `development`

- Set **base: `development`**.
- The [PR template](.github/pull_request_template.md) fills in the description. At minimum, fill in:
  - **Summary**, including the `Base` line and `Closes #N` for your issue;
  - **How to test**, with the commands you ran and their results (for example `npm test`: N/N pass);
  - **Screenshots**, before and after, for any visible change.
- Give the PR a title in the commit-subject style. A squash merge uses it as the commit message.

> **Today:** CI runs on every pull request, whatever its base: **Tests**, **Type check**, **Lint changed files** and **Hygiene**. Errors fail the run. Warnings, such as a missing Summary or How to test, are only annotations. See [docs/ci.md](docs/ci.md).

## 5. Review

**Policy (all PRs):**

- 1 approval from someone other than the author, from the same area: frontend reviews frontend, backend reviews backend ([#20](https://github.com/CSE-210-Farleys-Eleven/Warmup-Site/issues/20)).
- No self-merging ([#20](https://github.com/CSE-210-Farleys-Eleven/Warmup-Site/issues/20)).
- All checks passing on the **latest** commit.
- Every review conversation resolved.

> **Today:** `main` has no branch protection and no ruleset. GitHub does not require a pull request, approvals or passing checks, and it allows direct pushes. [#25](https://github.com/CSE-210-Farleys-Eleven/Warmup-Site/issues/25) tracks adding the ruleset for `main`.

## 6. Merge feature PRs with **Squash and merge**

Each feature lands on `development` as one commit, with the PR title as its subject. Delete the branch after merging.

> **Today:** merge, squash and rebase are all allowed, and branches are not deleted automatically. Every PR merged so far used a merge commit.

## 7. Release: open a PR from `development` into `main`

- **Title:** `Release YYYY-MM-DD`.
- **Description**, in the template's sections:
  - the PRs included;
  - user-visible changes;
  - validation on the `development` head commit: test, type check and browser results;
  - known issues.
- **Approval:** a release needs the same review and passing checks as any PR.

> **Today:** **Hygiene** warns on release PRs because `development` doesn't match `<type>/<short-description>`. The warning does not fail the run.

## 8. Merge release PRs with **Create a merge commit**

Never squash or rebase a release. A merge commit keeps `development`'s commits in `main`'s history, so the two branches stay in step and the next release and sync merge cleanly.

## 9. Verify the deployment

Merging into `main` starts **Deploy to GitHub Pages**. It runs the CI checks first and publishes only if they pass. Then:

1. In **Actions → Deploy to GitHub Pages**, the run for the merge commit has succeeded, with both its `ci` and `deploy` jobs.
2. **Deployments → github-pages** shows the same commit as `main`.
3. Open <https://cse-210-farleys-eleven.github.io/Warmup-Site/> with a hard refresh. Load each example, upload a CSV pair, switch between Canvas and SVG, and check the browser console for errors.

> **Today:** deploy runs on every push to `main` and on manual dispatch. The `github-pages` environment only accepts deployments from `main`.

## 10. Sync `main` back into `development`

After every release, and after any fix or revert made on `main`:

1. Open a PR with **base `development`** and **compare `main`**, titled `Sync main into development`.
2. Merge it with **Create a merge commit**, never squash.
3. **If it conflicts:**
   ```sh
   git switch --no-track -c chore/sync-main-YYYYMMDD origin/development
   git merge origin/main
   ```
   Resolve the conflicts, push, and open that branch as the PR into `development`, again merged with a merge commit.

**Release fixes:**

1. Branch `fix/…` from `main`.
2. Open a PR into `main` and merge it with a merge commit.
3. Verify the deploy, then sync.

**Rollbacks:**

1. Revert the release on a branch from `main`: `git revert -m 1 <release-merge-sha>`.
2. Merge that revert into `main` with a merge commit, then sync.

> **Re-releasing reverted work:** first revert the revert, then merge. Git treats the original commits as already merged, so re-merging the old branch silently drops them. This happened here: PR #8 reverted #3, and re-merging the branch in #11 left part of #3 out until 4c975c8 and b9934eb restored it by hand.

## 11. Fixing lint

> **Today:** this repository has no automatic "Fix lint" workflow and no `lint:fix` script.

Fix lint locally, then commit the result yourself:

```sh
npx eslint --fix path/to/changed-file.js
node scripts/ci/lint-changed.mjs origin/development
```
