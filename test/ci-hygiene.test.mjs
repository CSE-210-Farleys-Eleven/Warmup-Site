import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  checkBranchName, checkCommitSubject, checkPinnedDependencies, checkTestsAndDocs, toAnnotations,
} from '../scripts/ci/hygiene-lib.mjs';

const rules = (issues) => issues.map((i) => i.rule);

test('branch names: type/description passes; free-form warns; tool branches are exempt', () => {
  for (const ok of ['feature/svg-export', 'fix/pr4-review-fixes', 'docs/repo-templates', 'chore/github-actions-ci',
    'main', 'dependabot/npm_and_yarn/x-1.2.3', 'copilot/add-download', 'revert-3-ui/renderer-controls']) {
    assert.deepEqual(checkBranchName(ok), [], ok);
  }
  for (const bad of ['MyBranch', 'csv_parser-and-data', 'feature/Has Caps', 'feat/x', 'fix/']) {
    assert.deepEqual(rules(checkBranchName(bad)), ['branch-name'], bad);
  }
});

test('commit subjects: real subjects from this repo pass', () => {
  for (const ok of [
    'Keep tooltip text as hover labels in exported SVG files',
    'Add Save SVG for vector exports of SVG-rendered charts',
    'Pull export header layout and download step out of chartPng',
    'Restore PR #3 styles and comments still reverted on main',
    'Reset both axes when switching between linear and log scale (#12)',
    'Embed the license text', 'Merge pull request #12 from CSE-210-Farleys-Eleven/feature/svg-export',
  ]) assert.deepEqual(checkCommitSubject(ok), [], ok);
});

test('commit subjects: past tense, trailing period, lower case and length warn', () => {
  assert.deepEqual(rules(checkCommitSubject('Added the thing')), ['commit-subject']);
  assert.deepEqual(rules(checkCommitSubject('Adding the thing')), ['commit-subject']);
  assert.deepEqual(rules(checkCommitSubject('Add the thing.')), ['commit-subject']);
  assert.deepEqual(rules(checkCommitSubject('add the thing')), ['commit-subject']);
  assert.deepEqual(rules(checkCommitSubject(`Add ${'x'.repeat(100)}`)), ['commit-subject']);
});

test('dependencies must be exact versions', () => {
  assert.deepEqual(checkPinnedDependencies({ dependencies: { a: '1.2.3' }, devDependencies: { b: '10.0.0-rc.1' } }), []);
  assert.equal(checkPinnedDependencies({ dependencies: { a: '^1.2.3', b: '~1.0.0', c: '*', d: 'latest' } }).length, 4);
});

test('src changes without tests or docs warn; vendor and test-only changes do not', () => {
  assert.deepEqual(rules(checkTestsAndDocs(['src/stats.js'])), ['tests', 'docs']);
  assert.deepEqual(checkTestsAndDocs(['src/stats.js', 'test/stats.test.js', 'README.md']), []);
  assert.deepEqual(checkTestsAndDocs(['src/vendor/papa.js']), []);
  assert.deepEqual(checkTestsAndDocs(['test/a.test.js']), []);
});

test('annotations escape newlines and carry the file', () => {
  const [line] = toAnnotations([{ level: 'error', rule: 'secret', file: 'a.js', message: 'x\ny' }]);
  assert.equal(line, '::error file=a.js,title=secret::x%0Ay');
});

test('the PR template copy used by GitHub matches templates/pull-request.md', () => {
  assert.equal(readFileSync('.github/pull_request_template.md', 'utf8'), readFileSync('templates/pull-request.md', 'utf8'));
});
