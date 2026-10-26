/**
 * Pure checks behind the CI "hygiene" job. Each check takes plain strings or lists and
 * returns issues, so it can be unit-tested without git or GitHub.
 *
 * An issue is `{ level: 'error' | 'warning', rule, message, file? }`. Errors fail CI;
 * warnings are shown as annotations only. Rules come from templates/*.
 */

export const MAX_LINE = 100;
// The template says "about 72"; real commits here run to ~95, so warn only well past that.
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

const issue = (level, rule, message, file) => ({ level, rule, message, ...(file ? { file } : {}) });

/**
 * Branch name must look like `<type>/<short-description>`.
 * @param {string} name Branch name (not a ref).
 * @returns {object[]} Warnings; empty when the name is fine or exempt.
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
 * no trailing period, about 72 characters (warns past 100). Merge, revert and fixup commits are exempt.
 * @param {string} subject First line of the commit message.
 * @returns {object[]} Warnings.
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
 * Every dependency must be pinned to an exact version.
 * @param {object} pkg Parsed package.json.
 * @returns {object[]} Errors.
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
 * Files that should never be in the repository.
 * @param {string[]} files Paths added or changed in the PR.
 * @returns {object[]} Errors.
 */
export function checkForbiddenFiles(files) {
  return files.filter((f) => FORBIDDEN_PATH.test(f))
    .map((f) => issue('error', 'forbidden-file', `${f} must not be committed; add it to .gitignore.`, f));
}

/**
 * New files in src/ start with `// @ts-check` and a file header comment.
 * @param {string} file Path of the newly added file.
 * @param {string} content Its contents.
 * @returns {object[]} Errors.
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
 * @param {string} diff Output of `git diff -U0`.
 * @returns {object[]} Long lines (warnings) and apparent secrets (errors).
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
 * Nudges (never failures): behavior changes in src/ usually come with a test, and with docs.
 * @param {string[]} files Paths changed in the PR.
 * @returns {object[]} Warnings.
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
 * The PR description must have a filled-in Summary and How to test section.
 * HTML comments and `<placeholder>` text from the template count as empty.
 * @param {string} body PR description.
 * @returns {object[]} Warnings.
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
 * Formats issues as GitHub workflow commands (inline annotations).
 * @param {object[]} issues
 * @returns {string[]}
 */
export function toAnnotations(issues) {
  const esc = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  return issues.map((i) => `::${i.level} ${i.file ? `file=${i.file},` : ''}title=${i.rule}::${esc(i.message)}`);
}
