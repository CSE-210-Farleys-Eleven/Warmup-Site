# Instructions for AI agents

Rules for any AI agent (Claude, Copilot, Cursor, Codex or other) that edits this repository. They are the same rules people follow in [CONTRIBUTING.md](CONTRIBUTING.md); this file says where each one is written down and how to check it. If something here conflicts with a person's instruction in the chat, ask which to follow.

## Before you change anything

- Read [README.md](README.md) and [docs/architecture.md](docs/architecture.md) for the module map, and the [docs index](docs/README.md) for the page that covers the code you are editing.
- Use Node 24 and install with `npm ci --ignore-scripts`. Do not run `npm install`, which can rewrite the lockfile.
- Work on a branch named `<type>/<short-description>` (`feature`, `fix`, `docs`, `refactor`, `test` or `chore`), lower case. Never commit to `main` or force-push a branch you did not create.

## Templates to follow

| When you... | Follow |
| --- | --- |
| add or change a function, type or shared constant | [templates/function-headers.md](templates/function-headers.md): a JSDoc header with edge cases, whether it throws, units and an `@example` you ran. New files in `src/` start with `// @ts-check` and a file header |
| write a commit | [templates/commit-message.txt](templates/commit-message.txt): imperative subject, sentence case, no trailing period, then why, what and how it was tested |
| open a pull request | [templates/pull-request.md](templates/pull-request.md) (copied to `.github/pull_request_template.md`): fill in Summary and How to test with real commands and results |
| add or change a docs page | [templates/documentation.md](templates/documentation.md): every example run and its real output pasted |
| record someone's work | [templates/contribution-record.md](templates/contribution-record.md), in `docs/contributions/`: each row needs a commit and a test as evidence |
| review your own diff | [templates/code-hygiene-checklist.md](templates/code-hygiene-checklist.md) |
| review someone else's pull request | [templates/code-review.md](templates/code-review.md): what must be true, what to do by hand or with AI, what never to do, comment labels and the review summary |

## Code rules

- Match the surrounding code: 2-space indent, single quotes, semicolons, `const` by default, ES modules with `.js` extensions in import paths, lines of about 100 characters or fewer, a final newline.
- Pure logic (`stats.js`, `scales.js`, `model.js`) stays free of DOM code so it can be tested in Node.
- Bad input returns a documented value (often `NaN` or an empty list) instead of throwing, unless the header says it throws.
- No `console`, `debugger`, `var`, commented-out code or unused imports.
- Names say what a value is (`meanX`, `hiddenGroups`). Magic numbers become named constants.
- Labels from uploaded files are shown as text, never as HTML.
- Dependencies are pinned to exact versions (no `^` or `~`), and a change to a `package.json` dependency list comes with the updated `package-lock.json`.
- Never commit secrets, tokens, `node_modules/`, `.DS_Store`, `.idea/` or `data/result.json`.

## Tests and docs

- New behavior needs a test in `test/`, named after what it checks. A bug fix needs a test that fails before the fix and passes after.
- When behavior, commands or file formats change, update the README or the page in `docs/` in the same change, and keep headers current: a stale header is a bug.
- Do not describe work you did not run. Report real test output, and say plainly when something is unverified.
- Do not put names or dates in code headers; contributions are recorded in `docs/contributions/`.

## Run these before you commit

```sh
npm test
npm run check:stats
npm run typecheck
npm run lint
npm run check:hygiene -- --base origin/main --head HEAD --branch "$(git branch --show-current)"
```

Run `npm run test:e2e` when you change `index.html`, `styles.css` or anything the Cypress specs in `cypress/e2e/` touch (run `npx cypress install` once first).

CI runs the same checks, plus the Cypress job, on every pull request ([docs/ci.md](docs/ci.md)). Errors fail the run. Warnings, such as wording or line length, do not fail it, but fix them anyway. CI cannot check names, one-purpose functions, stale headers or browser behavior (light and dark, narrow width), so those are on you and on review.

## Scope

- Make the change that was asked for. Do not reformat or refactor code you were not asked to touch.
- Do not edit `.github/workflows/`, `eslint.config.mjs` or `tsconfig.json` to make a check pass; fix the code.
- Do not edit another contributor's page in `docs/contributions/` except to keep links and commands correct.
- Leave `src/vendor/` (Papa Parse) alone.
- Open a pull request into `main` and leave merging to a person after review ([CONTRIBUTING.md](CONTRIBUTING.md#5-review)).
