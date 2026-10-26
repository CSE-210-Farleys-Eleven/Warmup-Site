/**
 * Lints only the JavaScript files changed since a base commit: `node scripts/ci/lint-changed.mjs <base>`.
 * Older files still have a few style violations, so linting the whole tree would fail on code
 * nobody touched. With no usable base (new branch), it lints nothing and says so.
 */
import { execFileSync, spawnSync } from 'node:child_process';

const base = process.argv[2];
if (!base || /^0+$/.test(base)) {
  console.log('lint: no base commit, skipping.');
  process.exit(0);
}
const out = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`], { encoding: 'utf8' });
const files = out.split('\n').filter((f) => /\.m?js$/.test(f) && !f.startsWith('src/vendor/') && !f.startsWith('demo/'));
if (!files.length) {
  console.log('lint: no changed JavaScript files.');
  process.exit(0);
}
console.log(`lint: ${files.length} changed file(s)\n  ${files.join('\n  ')}`);
const run = spawnSync('npx', ['eslint', '--max-warnings=0', ...files], { stdio: 'inherit', shell: true });
process.exit(run.status ?? 1);
