import test from 'node:test';
import assert from 'node:assert/strict';
import { double } from '../src/ci-sample.js';

test('double returns twice the value and NaN for non-finite input', () => {
  assert.equal(double(2), 4);
  assert.ok(Number.isNaN(double(Infinity)));
});
