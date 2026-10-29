import test from 'node:test';
import assert from 'node:assert/strict';
import { csv, fixtures, measure } from '../scripts/perf-fixtures.mjs';

// Feed every fixture pair from scripts/perf-fixtures.mjs to the real worker and check
// that it loads or is rejected as the README's limits promise. Same harness as
// worker.test.js: only the browser FileReader transport is substituted.
const messages = [];
globalThis.self = { postMessage(message) { messages.push(message); } };
globalThis.FileReader = class {
  readAsText(blob) {
    blob.text().then(text => this.onload({ target: { result: text } }))
      .catch(e => { this.error = e; this.onerror?.(e); });
  }
};
await import('../src/pipeline.worker.js');
let id = 0;
async function send(type, payload) {
  const requestId = ++id;
  await self.onmessage({ data: { id: requestId, type, payload } });
  return messages.findLast(m => m.id === requestId && ('result' in m || 'error' in m));
}

// Rejected today because blank lines count toward the record limit (#43).
const KNOWN_BUGS = new Set(['rows-at-limit', 'rows-at-limit-trailing-blanks']);
const total = async () => (await send('page', { source: 0, mode: 'detail' })).result.total;

// Tests run in order, so each rejection is checked against the last pair that loaded.
let lastTotal;
for (const f of fixtures()) {
  const todo = KNOWN_BUGS.has(f.name) ? 'blank lines count as CSV records' : undefined;
  const verb = f.expect === 'load' ? 'loads' : 'is rejected';
  test(`${f.name} ${verb}: ${f.purpose}`, { todo }, async () => {
    const files = ['a', 'b'].map(side => new File([csv(f[side])], `${f.name}-${side}.csv`));
    const reply = await send('load', { files });
    if (f.expect === 'reject') {
      assert.match(reply.error ?? 'loaded', new RegExp(f.reason));
      if (lastTotal !== undefined) assert.equal(await total(), lastTotal, 'previous dataset kept');
      return;
    }
    assert.equal(reply.error, undefined);
    // Blank and dirty cells are dropped by design; every other cell must be kept.
    if (!f.a.blank && !f.a.dirty) assert.equal(reply.result.counts[0], measure(csv(f.a)).cells);
    lastTotal = await total();
  });
}
