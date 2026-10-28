import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/** Markdown files whose links must resolve: the root guides and everything under docs/. */
function markdownFiles() {
  const out = ['README.md', 'CONTRIBUTING.md', 'AGENTS.md'];
  const walk = (dir) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.md')) out.push(path);
    }
  };
  walk('docs');
  return out;
}

test('relative links in README, CONTRIBUTING, AGENTS and docs/ point at files that exist', () => {
  const broken = [];
  for (const file of markdownFiles()) {
    const text = readFileSync(join(root, file), 'utf8');
    for (const [, target] of text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
      if (/^[a-z]+:/i.test(target)) continue;
      if (!existsSync(join(root, dirname(file), target))) broken.push(`${file} -> ${target}`);
    }
  }
  assert.deepEqual(broken, []);
});
