<!--
Documentation page template for docs/.

File name: lower-case-with-hyphens.md, named after the subject
  (stats-module.md, renderer-and-tables.md, pr5-review-fixes.md).

Pick the sections for your page type and delete the rest:
  - Module reference:  Overview, API, Examples, Edge cases, Testing
  - Design / implementation notes:  Overview, Context, Design, Decisions, Limitations
  - PR goal list:  Overview, Goals, Decisions, Testing, Follow-ups

Style:
  - Plain English, short sentences, present tense ("The worker parses…").
  - Code names in `backticks`; link files with relative paths.
  - Tables for anything with more than three comparable items.
  - Every example must be run and its output pasted, not guessed.
  - Update the page in the same PR as the code it describes.
Delete this comment.
-->

# <Title>

<One paragraph: what this page covers, who it is for, and what to read first.>

**Applies to:** `<branch or version>` · **Files:** [<file>](../src/<file>) · **Related:** #<PR>, [<other doc>](<other-doc>.md)

## Overview

<What the thing does and why it exists. 1–3 short paragraphs.>

## Context

<Background a reader needs: the problem, constraints, prior work, related PRs.>

## API

<!-- Module reference pages: one subsection per export. -->

### `<functionName>(<params>)`

<What it does, in one or two sentences.>

| Parameter | Type | Description |
| --- | --- | --- |
| `<name>` | `<Type>` | <meaning, units, default> |

**Returns:** `<Type>`, <meaning>.

**Edge cases:** <empty input, NaN, invalid values; whether it throws>.

```js
<call>
// => <actual output>
```

## Design

<How it works. A numbered list for data flow, a table for comparing options.>

1. <step>
2. <step>

## Goals

<!-- PR goal list pages. -->

| ID | Goal | Decision | Commit |
| --- | --- | --- | --- |
| <ID> | <goal> | <decision> | `<sha>` |

## Decisions

- **<Decision>:** <what was chosen and why; alternatives considered>.

## Limitations

- <known gaps, performance limits, browser support>

## Testing

<Which tests cover this (link them), and how to check it by hand.>

```sh
npm test
```

## Follow-ups

- [ ] <open work, with an issue link>
