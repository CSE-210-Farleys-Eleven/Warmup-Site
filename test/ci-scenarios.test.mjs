// Sample-commit scenarios for the CI hygiene gate. Each one builds a throwaway git repo,
// makes the commits a contributor might make, runs scripts/ci/check-hygiene.mjs and checks
// which rules fire. "Clean" scenarios guard against the gate becoming overbearing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = resolve('scripts/ci/check-hygiene.mjs');
const HEADER = '// @ts-check\n/**\n * Example module.\n */\n';
const LONG = `const longLine = '${'x'.repeat(120)}';\n`;
const PKG = (deps = {}) => JSON.stringify({ name: 'demo', private: true, dependencies: deps }, null, 2) + '\n';
const TEMPLATE_BODY = '## Summary\n\n<!-- 2–4 sentences -->\n\n**Base:** `<target branch>` · **Closes:** #<issue>\n\n## How to test\n\n1. `npm test`, expect <N>/<N> pass.\n';
const GOOD_BODY = '## Summary\n\nFix the log-scale reset so both axes return to the data range.\n\n## How to test\n\n1. `npm test`\n2. Switch to log scale, then back; expect the full range.\n';

const git = (cwd, ...args) => execFileSync('git',
  ['-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'core.autocrlf=false', ...args],
  { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** Creates the base repo, applies `commits` on a new branch, and returns the CLI result. */
function run({ branch = 'fix/example', commits, body, extraArgs = [] }) {
  const dir = mkdtempSync(join(tmpdir(), 'hygiene-'));
  try {
    git(dir, 'init', '-q', '-b', 'main');
    const write = (file, content) => {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), content);
    };
    write('package.json', PKG({ papaparse: '5.7.0' }));
    write('package-lock.json', '{}\n');
    write('src/old.js', `${LONG}export const old = 1;\n`);
    write('test/old.test.js', 'export {};\n');
    write('docs/old.md', '# Old\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'Add base files');
    const base = git(dir, 'rev-parse', 'HEAD').trim();
    git(dir, 'checkout', '-q', '-b', branch);
    for (const { message, files = {}, remove = [] } of commits) {
      for (const [file, content] of Object.entries(files)) write(file, content);
      for (const file of remove) rmSync(join(dir, file));
      git(dir, 'add', '-A', '-f');
      git(dir, 'commit', '-q', '--allow-empty', '-m', message);
    }
    const head = git(dir, 'rev-parse', 'HEAD').trim();
    const args = [CLI, '--base', base, '--head', head, '--branch', branch, ...extraArgs];
    if (body !== undefined) {
      write('.pr-body.md', body);
      args.push('--pr-body-file', join(dir, '.pr-body.md'));
    }
    const res = spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8' });
    const rules = (level) => [...res.stdout.matchAll(new RegExp(`^::${level} [^:]*title=([\\w-]+)::`, 'gm'))].map((m) => m[1]);
    return { status: res.status, errors: rules('error'), warnings: rules('warning'), out: res.stdout + res.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const expectRun = (r, { status = 0, errors = [], warnings = [] }) => {
  assert.equal(r.status, status, r.out);
  assert.deepEqual([...new Set(r.errors)].sort(), errors.sort(), r.out);
  assert.deepEqual([...new Set(r.warnings)].sort(), warnings.sort(), r.out);
};

test('a typical well-formed change is silent', () => {
  expectRun(run({
    branch: 'feature/svg-export',
    commits: [{ message: 'Keep tooltip text as hover labels in exported SVG files',
      files: { 'src/old.js': `${LONG}export const old = 2;\n`, 'test/new.test.js': 'export {};\n', 'docs/new.md': '# New\n' } }],
    body: GOOD_BODY,
  }), {});
});

test('a docs-only change needs no test warning', () => {
  expectRun(run({ branch: 'docs/ci', commits: [{ message: 'Document the CI checks', files: { 'docs/ci.md': '# CI\n' } }] }), {});
});

test('merge, revert and fixup commit subjects are exempt', () => {
  expectRun(run({
    branch: 'revert-3-ui/renderer-controls',
    commits: [{ message: 'Revert "Add renderer controls"' }, { message: 'Merge branch main into feature' }, { message: 'fixup! Add base files' }],
  }), {});
});

test('bot branches skip the style checks but keep the safety checks', () => {
  expectRun(run({
    branch: 'dependabot/npm_and_yarn/eslint-10.14.0',
    commits: [{ message: 'chore(deps): bump eslint', files: { 'package.json': PKG({ eslint: '10.14.0' }), 'package-lock.json': '{"v":2}\n' } }],
    extraArgs: ['--skip-style'],
  }), {});
});

test('wording problems only warn and never fail the build', () => {
  expectRun(run({
    branch: 'MyFeature',
    commits: [{ message: 'Added a new thing.', files: { 'docs/x.md': '# X\n' } }],
  }), { warnings: ['branch-name', 'commit-subject'] });
});

test('src change without test or docs warns (twice) but passes', () => {
  expectRun(run({ commits: [{ message: 'Fix axis reset', files: { 'src/old.js': `${LONG}export const old = 3;\n` } }] }),
    { warnings: ['tests', 'docs'] });
});

test('an untouched PR template body warns; a filled one does not', () => {
  const commits = [{ message: 'Add notes', files: { 'docs/n.md': '# N\n' } }];
  expectRun(run({ commits, body: TEMPLATE_BODY }), { warnings: ['pr-body'] });
  expectRun(run({ commits, body: GOOD_BODY }), {});
});

test('a long line added to code warns, but old long lines do not', () => {
  expectRun(run({ commits: [{ message: 'Add long constant', files: {
    'src/old.js': `${LONG}export const old = 1;\n${LONG.replace('longLine', 'newLine')}`, 'test/t.test.js': 'export {};\n', 'docs/d.md': '# D\n' } }] }),
  { warnings: ['line-length'] });
});

test('many long lines in one file give a single warning', () => {
  const many = Array.from({ length: 12 }, (_, i) => LONG.replace('longLine', `line${i}`)).join('');
  const r = run({ commits: [{ message: 'Add long constants', files: {
    'src/old.js': `${LONG}export const old = 1;\n${many}`, 'test/t.test.js': 'export {};\n', 'docs/d.md': '# D\n' } }] });
  expectRun(r, { warnings: ['line-length'] });
  assert.equal(r.out.match(/title=line-length/g).length, 1, r.out);
});

test('a new src file without @ts-check or a header fails', () => {
  expectRun(run({ commits: [{ message: 'Add helper', files: { 'src/helper.js': 'export const a = 1;\n', 'test/h.test.js': 'export {};\n', 'docs/h.md': '# H\n' } }] }),
    { status: 1, errors: ['file-header'] });
});

test('a new src file with @ts-check and a header passes', () => {
  expectRun(run({ commits: [{ message: 'Add helper', files: { 'src/helper.js': `${HEADER}export const a = 1;\n`, 'test/h.test.js': 'export {};\n', 'docs/h.md': '# H\n' } }] }), {});
});

test('vendored code is not held to the file header rule', () => {
  expectRun(run({ commits: [{ message: 'Update Papa Parse', files: { 'src/vendor/lib.js': 'var a = 1;\n' } }] }), {});
});

test('committing .DS_Store or node_modules fails', () => {
  expectRun(run({ commits: [{ message: 'Add editor files', files: { '.DS_Store': 'x', 'node_modules/pkg/index.js': 'x' } }] }),
    { status: 1, errors: ['forbidden-file'] });
});

test('an unpinned dependency fails', () => {
  expectRun(run({ commits: [{ message: 'Add eslint', files: { 'package.json': PKG({ papaparse: '^5.7.0' }), 'package-lock.json': '{"v":2}\n' } }] }),
    { status: 1, errors: ['pinned-deps'] });
});

test('changing package.json without the lockfile fails', () => {
  expectRun(run({ commits: [{ message: 'Add dependency', files: { 'package.json': PKG({ papaparse: '5.7.0', jsdom: '30.1.2' }) } }] }),
    { status: 1, errors: ['lockfile'] });
});

test('an apparent token in added lines fails', () => {
  const token = `ghp_${'a'.repeat(36)}`;
  expectRun(run({ commits: [{ message: 'Add notes', files: { 'docs/n.md': `key: ${token}\n` } }] }),
    { status: 1, errors: ['secret'] });
});
