<!--
Code review template, for reviewing someone else's pull request.

Use it when you are asked to review, or pick up a PR from your own area
(frontend reviews frontend, backend reviews backend). Never review or merge your own PR.

How to use it:
  1. Walk the checklist below with the PR's branch checked out.
  2. Leave inline comments with a label (blocking, suggestion, question, nit).
  3. Submit the review with the summary at the end as its body.

Style:
  - Plain English, short sentences. Comment on the code, not the person.
  - Say what you ran and what you did not. Do not approve something you only read
    if the PR says it was checked in the browser.
  - CI already runs tests, type check, lint, Cypress and hygiene (docs/ci.md).
    Do not repeat them by hand; spend the review on what CI cannot check.
This comment is not part of the review; do not paste it.
-->

# Code review checklist

Use this when you review someone else's pull request. It covers what CI cannot check ([docs/ci.md](../docs/ci.md#limitations)). Authors check their own diff with [code-hygiene-checklist.md](code-hygiene-checklist.md) before asking for review.

## Before you start

- [ ] You are not the author, and the PR is in your area (frontend or backend).
- [ ] CI is green on the **latest** commit. If it is red, ask the author to fix it before you review.
- [ ] The PR links its issue (`Closes #N`, or `Related to #N` for a shared issue) and targets the right base branch.
- [ ] The description follows [pull-request.md](pull-request.md): Summary, How to test with real results, and Plan deviations filled in.

## Code

- [ ] Each changed function's header matches what the code does now: edge cases, whether it throws, units. A stale header is a bug.
- [ ] Names say what a value is. Booleans read as questions.
- [ ] Each function does one thing. Pure logic (`stats.js`, `scales.js`, `model.js`) has no DOM code.
- [ ] The change does what the issue asked, and nothing unrelated: no reformatting, and no edits to workflows, `eslint.config.mjs` or `tsconfig.json` to make a check pass.

## Tests and evidence

- [ ] New behavior has a test named after what it checks. A bug fix has a test that would fail without the fix.
- [ ] Run at least one `@example` or docs example yourself and compare its output with what the PR pastes.
- [ ] Contribution record rows point at real commits and tests (CI does not check these).

## Browser (UI changes only)

- [ ] Pull the branch, run `npm start`, and follow the PR's How to test steps.
- [ ] Check light mode, dark mode and a narrow width (under 600px). Compare with the PR's screenshots.

## Comment labels

Start each inline comment with one label so the author knows what must change before merge.

| Label | Meaning | Blocks approval |
| --- | --- | --- |
| `blocking:` | Wrong behavior, a missing test for new behavior, a stale header, a secret or broken docs | Yes |
| `suggestion:` | A better way that the author can take or leave | No |
| `question:` | You need an answer before you can judge the change | Until answered |
| `nit:` | Wording, naming or style; fix it if it is cheap | No |

## Decision

- **Approve** when there are no open `blocking:` comments and CI is green on the latest commit.
- **Request changes** only for `blocking:` comments. Say what would make you approve.
- **Comment** when you have only questions or suggestions, or you reviewed part of the PR.

Re-review after the author pushes fixes. Resolve your own threads once they are fixed. The PR merges only after 1 approval and green CI, and never by its author ([CONTRIBUTING.md](../CONTRIBUTING.md#5-review)).

## Review summary

Paste this as the body of your review.

```md
**Checked:** <what you ran and looked at, e.g. pulled the branch, ran the setScale example, opened it in light/dark at 375px>
**Blocking:** <none, or one line per blocking comment>
**Suggestions:** <none, or a short list>
**Not checked:** <anything you did not verify, and why>
**Decision:** Approve | Request changes | Comment
```
