/**
 * CI hygiene gate: `node scripts/ci/check-hygiene.mjs --base <sha> --head <sha> [--branch <name>]
 * [--pr-body-file <path>] [--skip-style]`, run from the repository root.
 *
 * Checks what a PR adds (commits, new files, added lines) against templates/*. Errors exit 1;
 * warnings are printed and annotated but exit 0. `--skip-style` is for bot PRs: it skips the
 * commit, branch and PR-body wording checks and keeps the safety checks.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  checkAddedLines, checkBranchName, checkCommitSubject, checkForbiddenFiles, checkLockfile,
  checkNewSrcFile, checkPinnedDependencies, checkPullRequestBody, checkTestsAndDocs, toAnnotations,
} from './hygiene-lib.mjs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const lines = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean);

const { values } = parseArgs({
  options: {
    base: { type: 'string' },
    head: { type: 'string' },
    branch: { type: 'string', default: '' },
    'pr-body-file': { type: 'string' },
    'skip-style': { type: 'boolean', default: false },
  },
});
if (!values.base || !values.head) {
  console.error('usage: check-hygiene.mjs --base <sha> --head <sha> [--branch <name>] [--pr-body-file <path>]');
  process.exit(2);
}
const { base, head } = values;

const changed = lines(git('diff', '--name-only', '--diff-filter=ACMR', `${base}...${head}`));
const added = lines(git('diff', '--name-only', '--diff-filter=A', `${base}...${head}`));
const issues = [];

issues.push(...checkForbiddenFiles(changed));
if (changed.includes('package.json')) {
  const headPackage = git('show', `${head}:package.json`);
  issues.push(...checkPinnedDependencies(JSON.parse(headPackage)));
  const mergeBase = git('merge-base', base, head).trim();
  let basePackage = null;
  try { basePackage = git('show', `${mergeBase}:package.json`); } catch { /* new file */ }
  issues.push(...checkLockfile(basePackage, headPackage, changed.includes('package-lock.json')));
}
for (const file of added) issues.push(...checkNewSrcFile(file, git('show', `${head}:${file}`)));
issues.push(...checkAddedLines(git('diff', '-U0', '--no-color', `${base}...${head}`)));

if (!values['skip-style']) {
  issues.push(...checkBranchName(values.branch));
  for (const subject of lines(git('log', '--no-merges', '--format=%s', `${base}..${head}`))) {
    issues.push(...checkCommitSubject(subject));
  }
  issues.push(...checkTestsAndDocs(changed));
  if (values['pr-body-file']) {
    issues.push(...checkPullRequestBody(readFileSync(values['pr-body-file'], 'utf8')));
  }
}

const errors = issues.filter((i) => i.level === 'error');
const warnings = issues.filter((i) => i.level === 'warning');
for (const line of toAnnotations(issues)) console.log(line);
console.log(`hygiene: ${errors.length} error(s), ${warnings.length} warning(s), ${changed.length} file(s) changed`);

if (process.env.GITHUB_STEP_SUMMARY) {
  const row = (i) => `- ${i.level === 'error' ? '❌' : '⚠️'} **${i.rule}**: ${i.message}`;
  const body = issues.length ? issues.map(row).join('\n') : '✅ No hygiene issues.';
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Hygiene\n\n${body}\n\n` +
    'Warnings are advisory. See templates/code-hygiene-checklist.md.\n');
}
process.exit(errors.length ? 1 : 0);
