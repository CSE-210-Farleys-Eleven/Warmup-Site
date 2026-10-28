/**
 * Pure checks behind the CI "hygiene" job. Each check takes plain strings or lists and
 * returns issues, so it can be unit-tested without git or GitHub.
 *
 * Errors fail CI; warnings are shown as annotations only. Rules come from templates/*.
 * Node only (no DOM). No check here throws on odd input; each returns an empty list instead.
 */

/**
 * One finding from a check.
 * @typedef {Object} Issue
 * @property {'error' | 'warning'} level  Errors fail CI; warnings are advisory.
 * @property {string} rule                Short rule id, used as the annotation title ('secret').
 * @property {string} message             Human-readable explanation.
 * @property {string} [file]              Repo-relative path; missing for issues about the whole PR.
 */

/** Longest added line, in characters, before `checkAddedLines` warns. */
export const MAX_LINE = 100;
// The template says "about 72"; real commits here run to ~95, so warn only well past that.
/** Longest commit subject, in characters, before `checkCommitSubject` warns. */
export const MAX_SUBJECT = 100;
const BRANCH_TYPES = ['feature', 'fix', 'docs', 'refactor', 'test', 'chore'];
// Branches created by tools or GitHub itself, which we don't rename.
const BRANCH_EXEMPT = /^(dependabot\/|copilot\/|revert-|main$|main-backup$)/;
// Words ending in -ed / -ing that are still imperative verbs.
const IMPERATIVE_OK = new Set([
  'embed', 'feed', 'speed', 'seed', 'need', 'proceed', 'exceed', 'succeed', 'bring', 'string',
  'ring', 'swing', 'spring', 'sing', 'cling', 'fling', 'sling', 'wring', 'sting', 'bed', 'shed',
]);
// Paths that must never be committed (see .gitignore and the hygiene checklist).
const FORBIDDEN_PATH = /(^|\/)(node_modules\/|\.DS_Store$|\.idea\/|result\.json$)/;
const SECRET_PATTERNS = [
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
  /\bsk-[A-Za-z0-9_-]{32,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
];
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** @returns {Issue} An issue; `file` is left out of the object when not given. */
const issue = (level, rule, message, file) => ({ level, rule, message, ...(file ? { file } : {}) });

/**
 * Checks that a branch name looks like `<type>/<short-description>` in lower case.
 * An empty name, and bot or tool branches (dependabot, copilot, revert-, main), are exempt.
 * Never throws.
 * @param {string} name  Branch name, not a full ref (`docs/ci`, not `refs/heads/docs/ci`).
 * @returns {Issue[]}    One warning, or an empty list when the name is fine or exempt.
 * @example
 * checkBranchName('Fix_Bug')  // => [{level: 'warning', rule: 'branch-name', ...}]
 * checkBranchName('fix/pr4-review-fixes')  // => []
 */
export function checkBranchName(name) {
  if (!name || BRANCH_EXEMPT.test(name)) return [];
  const re = new RegExp(`^(${BRANCH_TYPES.join('|')})/[a-z0-9][a-z0-9._-]*$`);
  if (re.test(name)) return [];
  return [issue('warning', 'branch-name',
    `Branch "${name}" should be <type>/<short-description> in lower-case, where type is one of ` +
    `${BRANCH_TYPES.join(', ')} (e.g. fix/pr4-review-fixes).`)];
}

/**
 * Commit subject rules from templates/commit-message.txt: imperative, sentence case,
 * no trailing punctuation, about 72 characters (warns only past `MAX_SUBJECT`).
 * Merge, revert, fixup! and squash! commits are exempt. Never throws.
 * @param {string} subject  First line of the commit message; empty or missing counts as a problem.
 * @returns {Issue[]}       At most one warning per commit, listing every problem found.
 * @example
 * checkCommitSubject('Added tests.')
 * // => [{level: 'warning', rule: 'commit-subject', message: '"Added tests.": ...'}]
 * checkCommitSubject('Add tests')  // => []
 */
export function checkCommitSubject(subject) {
  const s = (subject || '').trim();
  if (/^(Merge |Revert |fixup! |squash! )/.test(s)) return [];
  const problems = [];
  const warn = (message) => problems.push(message);
  if (!s) return [issue('warning', 'commit-subject', 'Empty commit subject.')];
  if (s.length > MAX_SUBJECT) warn(`subject is ${s.length} characters; keep it to ${MAX_SUBJECT} or fewer.`);
  if (/[.!?:;,]$/.test(s)) warn('subject should not end with punctuation.');
  if (!/^[A-Z]/.test(s)) warn('start with a capital letter (sentence case).');
  const first = s.split(/\s+/)[0].toLowerCase();
  if (/(ed|ing)$/.test(first) && first.length > 4 && !IMPERATIVE_OK.has(first)) {
    warn(`use the imperative ("Add", not "${s.split(/\s+/)[0]}").`);
  }
  // One warning per commit, however many things are wrong with it.
  return problems.length ? [issue('warning', 'commit-subject', `"${s}": ${problems.join(' ')}`)] : [];
}

/**
 * Checks that every dependency is pinned to an exact version (`1.2.3`, optionally with a
 * pre-release suffix); `^`, `~`, `*`, ranges and tags are errors. Looks at `dependencies`,
 * `devDependencies` and `optionalDependencies`; missing sections are skipped. Never throws.
 * @param {Object} pkg  Parsed package.json.
 * @returns {Issue[]}   One error per unpinned dependency, in file order.
 * @example
 * checkPinnedDependencies({devDependencies: {eslint: '^10.0.0'}})
 * // => [{level: 'error', rule: 'pinned-deps', file: 'package.json',
 * //      message: 'devDependencies.eslint is "^10.0.0"; pin an exact version ...'}]
 */
export function checkPinnedDependencies(pkg) {
  const out = [];
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [name, range] of Object.entries(pkg[section] || {})) {
      if (!EXACT_VERSION.test(range)) {
        out.push(issue('error', 'pinned-deps',
          `${section}.${name} is "${range}"; pin an exact version (no ^, ~ or ranges).`, 'package.json'));
      }
    }
  }
  return out;
}

/**
 * Checks that a change to a package.json dependency list comes with a lockfile change. Edits
 * that leave `dependencies`, `devDependencies`, `optionalDependencies` and `peerDependencies`
 * alone (scripts, metadata) need no lockfile update. A base that is missing or not valid JSON
 * counts as changed. Never throws; an unreadable head reports nothing, because
 * `checkPinnedDependencies` already needs it parsed.
 * @param {string | null} baseText  package.json at the merge base; null when it did not exist.
 * @param {string} headText         package.json at the PR head.
 * @param {boolean} lockfileChanged Whether package-lock.json is among the changed files.
 * @returns {Issue[]}               One error, or an empty list.
 * @example
 * checkLockfile('{"scripts":{"a":"x"}}', '{"scripts":{}}', false)  // => []
 * checkLockfile('{}', '{"dependencies":{"a":"1.0.0"}}', false)     // => [{rule: 'lockfile', ...}]
 */
export function checkLockfile(baseText, headText, lockfileChanged) {
  if (lockfileChanged) return [];
  const sections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
  /** @param {string | null} text */
  const dependencyLists = (text) => {
    try {
      const pkg = JSON.parse(text ?? '');
      return JSON.stringify(sections.map((name) => pkg[name] ?? null));
    } catch {
      return null;
    }
  };
  const headLists = dependencyLists(headText);
  if (headLists === null || headLists === dependencyLists(baseText)) return [];
  return [issue('error', 'lockfile',
    'package.json dependencies changed but package-lock.json did not; commit the lockfile with it.',
    'package.json')];
}

/**
 * Flags files that must never be committed: `node_modules/`, `.DS_Store`, `.idea/` and
 * `result.json`, at any depth. Never throws.
 * @param {string[]} files  Repo-relative paths added or changed in the PR, with `/` separators.
 * @returns {Issue[]}       One error per forbidden path; empty for an empty list.
 * @example
 * checkForbiddenFiles(['src/a.js', 'docs/.DS_Store'])
 * // => one 'forbidden-file' error, for docs/.DS_Store
 */
export function checkForbiddenFiles(files) {
  return files.filter((f) => FORBIDDEN_PATH.test(f))
    .map((f) => issue('error', 'forbidden-file', `${f} must not be committed; add it to .gitignore.`, f));
}

/**
 * Checks that a new file in `src/` starts with `// @ts-check` followed by a `/** ... *\/` file
 * header. Files outside `src/`, non-`.js` files and `src/vendor/` are ignored. A leading
 * byte-order mark is allowed. Never throws.
 * @param {string} file     Repo-relative path of the newly added file.
 * @param {string} content  Full text of the file.
 * @returns {Issue[]}       One error naming everything that is missing; empty if the file is fine.
 * @example
 * checkNewSrcFile('src/new.js', 'export const a = 1;\n')
 * // => [{level: 'error', rule: 'file-header', ...}]
 * checkNewSrcFile('test/new.js', '')  // => []
 */
export function checkNewSrcFile(file, content) {
  if (!/^src\/(?!vendor\/).+\.js$/.test(file)) return [];
  const lines = (content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content).split('\n');
  const missing = [];
  const hasTsCheck = lines[0].trim() === '// @ts-check';
  if (!hasTsCheck) missing.push('start with "// @ts-check"');
  if (!lines.slice(hasTsCheck ? 1 : 0).join('\n').trimStart().startsWith('/**')) {
    missing.push('have a /** ... */ file header after it');
  }
  return missing.length
    ? [issue('error', 'file-header', `New file ${file} must ${missing.join(' and ')} (see templates/function-headers.md).`, file)]
    : [];
}

/**
 * Checks only the lines a PR adds, so older long lines and old secrets in history don't fail it.
 * Secrets (AWS keys, GitHub and `sk-` tokens, private keys) are errors in any file. Lines over
 * `MAX_LINE` characters are warnings, only in .js, .mjs, .css and .html files outside `vendor/`,
 * and are grouped into one warning per file. Never throws; an empty diff gives an empty list.
 * @param {string} diff  Output of `git diff -U0 --no-color` (zero context lines, so line numbers
 *                       come from the `@@` hunk headers).
 * @returns {Issue[]}    Secret errors in diff order, then one line-length warning per file.
 * @example
 * checkAddedLines('+++ b/a.js\n@@ -0,0 +1 @@\n+' + 'x'.repeat(120))
 * // => [{level: 'warning', rule: 'line-length', file: 'a.js',
 * //      message: 'a.js has 1 added line(s) over 100 characters (line 1).'}]
 */
export function checkAddedLines(diff) {
  const out = [];
  const longLines = new Map();
  let file = '';
  let lineNo = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) { file = raw.slice(4).replace(/^b\//, ''); continue; }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw);
    if (hunk) { lineNo = Number(hunk[1]); continue; }
    if (!raw.startsWith('+') || raw.startsWith('+++')) continue;
    const text = raw.slice(1);
    const where = `${file}:${lineNo}`;
    if (SECRET_PATTERNS.some((p) => p.test(text))) {
      out.push(issue('error', 'secret', `${where} looks like a secret or private key. Remove it and rotate it.`, file));
    }
    const isCode = /\.(m?js|css|html)$/.test(file) && !file.includes('vendor/');
    if (isCode && text.length > MAX_LINE) {
      if (!longLines.has(file)) longLines.set(file, []);
      longLines.get(file).push(lineNo);
    }
    lineNo += 1;
  }
  // One warning per file, so a big new file doesn't bury the other warnings.
  for (const [name, numbers] of longLines) {
    const shown = numbers.slice(0, 3).join(', ');
    const more = numbers.length > 3 ? ` and ${numbers.length - 3} more` : '';
    out.push(issue('warning', 'line-length',
      `${name} has ${numbers.length} added line(s) over ${MAX_LINE} characters (line ${shown}${more}).`, name));
  }
  return out;
}

/**
 * Nudges (never failures): a change to `src/` (outside `vendor/`) usually comes with a test in
 * `test/` and with an update to `docs/` or README.md. Never throws.
 * @param {string[]} files  Repo-relative paths changed in the PR.
 * @returns {Issue[]}       Up to two warnings ('tests', 'docs'); empty when `src/` is untouched.
 * @example
 * checkTestsAndDocs(['src/stats.js'])  // => a 'tests' warning and a 'docs' warning
 * checkTestsAndDocs(['src/stats.js', 'test/stats.test.js', 'docs/x.md'])  // => []
 */
export function checkTestsAndDocs(files) {
  const srcChanged = files.some((f) => /^src\/(?!vendor\/).+\.js$/.test(f));
  const out = [];
  if (srcChanged && !files.some((f) => /^test\//.test(f))) {
    out.push(issue('warning', 'tests', 'src/ changed but nothing in test/ did. New behavior and bug fixes need a test.'));
  }
  if (srcChanged && !files.some((f) => /^(docs\/|README\.md$)/.test(f))) {
    out.push(issue('warning', 'docs', 'src/ changed but docs/ and README.md did not. Update docs in the same PR if behavior changed.'));
  }
  return out;
}

/**
 * Checks that the PR description has a filled-in `## Summary` and `## How to test` section.
 * HTML comments, bold template lines and `<placeholder>` text from the template count as empty.
 * Never throws.
 * @param {string} body  PR description; null, undefined or empty reports both sections missing.
 * @returns {Issue[]}    One warning covering every problem, or an empty list.
 * @example
 * checkPullRequestBody('## Summary\nAdds tests.\n\n## How to test\nRun `npm test`.')  // => []
 * checkPullRequestBody('')  // => one 'pr-body' warning: both sections missing
 */
export function checkPullRequestBody(body) {
  const text = (body || '').replace(/<!--[\s\S]*?-->/g, '');
  const problems = [];
  for (const heading of ['Summary', 'How to test']) {
    const m = new RegExp(`^##\\s+${heading}\\s*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'im').exec(text);
    const section = m ? m[1].replace(/`[^`\n]*`/g, '') : '';
    const content = section.replace(/^\*\*[^\n]*$/gm, '').trim();
    if (!m) problems.push(`Missing a "## ${heading}" section.`);
    else if (/<[^>\n]{1,40}>/.test(section)) problems.push(`"## ${heading}" still has <placeholder> text from the template.`);
    else if (!content) problems.push(`"## ${heading}" is empty.`);
  }
  // One warning for the whole description.
  return problems.length
    ? [issue('warning', 'pr-body', `PR description: ${problems.join(' ')} See .github/pull_request_template.md.`)]
    : [];
}

/**
 * Formats issues as GitHub workflow commands (`::error file=...,title=...::message`), which
 * Actions shows as annotations. Escapes `%`, CR and LF in the message. Never throws.
 * @param {Issue[]} issues
 * @returns {string[]}  One command line per issue, in the same order; empty for no issues.
 * @example
 * toAnnotations([{level: 'error', rule: 'secret', message: 'bad', file: 'a.js'}])
 * // => ['::error file=a.js,title=secret::bad']
 */
export function toAnnotations(issues) {
  const esc = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  return issues.map((i) => `::${i.level} ${i.file ? `file=${i.file},` : ''}title=${i.rule}::${esc(i.message)}`);
}
