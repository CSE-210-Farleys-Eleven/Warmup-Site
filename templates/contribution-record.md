<!--
Contribution record template for docs/contributions/.

File name: docs/contributions/<first-name>.md, lower case (anthony.md, ekansh.md).
One page per contributor; add to it as you contribute more, instead of starting a new page.

Pick the sections that apply and delete the rest. Keep the order below.

Style (same rules as templates/documentation.md):
  - Plain English, short sentences, present tense.
  - Every claim has evidence: a short commit sha in `backticks`, a PR or issue number, or a test name.
    Do not describe work you cannot point to.
  - Say what you wrote and what you only moved, reviewed or documented. Credit other people's code
    that sits in the same files in Attribution.
  - Do not put names or dates in code headers; this page is where names go.
  - Link files with relative paths (../../src/<file>). Do not use PR numbers in "Applies to";
    say `main`, or the version you describe.
  - Add the page to docs/README.md and the README docs table.
Delete this comment.
-->

# Contribution record: <Name>

<One paragraph: whose work this records, what kind (implementation, CI, review, documentation), and which docs to read for how the code works.>

**Applies to:** `main` · **Files:** [<file>](../../src/<file>) · **Related:** #<PR or issue>, [<doc>](../<doc>.md)

## Overview

<2–4 sentences: what the person built or changed, in order, with PR numbers. Include reviews they did.>

## Implementation (<PR or area>)

<!-- One table per PR or area. Tests: name the test that covers the change, or write "None" and why. -->

| Change | Commit | Test |
| --- | --- | --- |
| <what changed and why it matters> | `<short sha>` | <test file: test name, or "None: CSS only"> |

## Documentation and cleanup (#<issue>)

| Change | Commit |
| --- | --- |
| <headers, docs pages or cleanup> | `<short sha>` |

## Reviews

<PRs reviewed and what the review checked or caught. Omit if none.>

## Attribution

- <Code in the same files that someone else wrote, with their commit or PR.>
- <Code you wrote that others later changed.>

## Follow-ups

- [ ] <known gap or bug in this code, with an issue link when one exists>

## Testing

<Which tests cover the code on this page, and the commands to run them.>

```sh
npm test
```
