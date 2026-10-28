<!--
Code review template, for reviewing someone else's pull request.

How to use it:
  1. Walk the checklist below with the PR's branch checked out.
  2. Leave inline comments with a label (blocking, suggestion, question, nit).
  3. Submit the review with the summary at the end as its body.

CI already runs tests, type check, lint, Cypress and hygiene (docs/ci.md).
Do not repeat them by hand.
This comment is not part of the review; do not paste it.
-->

# Code review checklist

Use this when you review someone else's pull request. Authors check their own diff with [code-hygiene-checklist.md](code-hygiene-checklist.md) before asking for review.

## Must be true

Do not start the review until both hold.

- [ ] You are not the author of the PR.
- [ ] CI is green on the **latest** commit. If it is red, ask the author to fix it first.

## Must do (by hand or with AI)

- [ ] The code does what the PR says it does: compare what it runs with the intent in the Summary and the linked issue.
- [ ] Go through the tests: new behavior has a test, and a bug fix has a test that would fail without the fix.

## Must do by hand

- [ ] The PR targets the right base branch.
- [ ] The description follows [pull-request.md](pull-request.md): Summary, linked issue (`Closes #N`), How to test with real results, and Plan deviations.

## Strongly recommended

- [ ] Read through the code yourself.
- [ ] Check test coverage of the changed code.
- [ ] For a feature or frontend change, run the app (`npm start`), follow the PR's How to test steps, and look at light mode, dark mode and a narrow width.

## Never

- Approve or merge your own PR.
- Approve while CI is red or a `blocking:` comment is open.
- Post a comment you have not read and cannot stand behind, including one an AI drafted. You are accountable for every comment in your review.

## Comment labels

Start each inline comment with one label so the author knows what must change before merge.

| Label | Meaning | Blocks approval |
| --- | --- | --- |
| `blocking:` | Wrong behavior, a missing test for new behavior, a secret or a broken link | Yes |
| `suggestion:` | A better way that the author can take or leave | No |
| `question:` | You need an answer before you can judge the change | Until answered |
| `nit:` | Wording, naming or style; fix it if it is cheap | No |

## Decision

- **Approve** when every "Must" item holds and no `blocking:` comment is open.
- **Request changes** only for `blocking:` comments. Say what would make you approve.
- **Comment** when you have only questions or suggestions.

Re-review after the author pushes fixes. The PR merges only after 1 approval and green CI, and never by its author ([CONTRIBUTING.md](../CONTRIBUTING.md#5-review)).

## Review summary

Paste this as the body of your review.

```md
**Checked:** <what you did to review, e.g. pulled the branch, compared the code with the issue, read the new tests, opened the app in dark mode at 375px>
**Blocking:** <none, or one line per blocking comment>
**Suggestions:** <none, or a short list>
**Decision:** Approve | Request changes | Comment
```
