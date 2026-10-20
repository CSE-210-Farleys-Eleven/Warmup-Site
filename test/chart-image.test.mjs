import test from 'node:test';
import assert from 'node:assert/strict';
import { imageFileName, imageScale } from '../src/chart-image.js';
test('image filenames are bounded and contain no path separators', () => {
  assert.equal(imageFileName('Steps / Sleep'), 'Steps-Sleep.png');
  assert.equal(imageFileName('../'), 'chart.png');
  assert.ok(imageFileName('A'.repeat(500)).length <= 104);
  assert.equal(imageFileName('Steps / Sleep', 'svg'), 'Steps-Sleep.svg');
});
test('image dimensions obey pixel and dimension budgets', () => {
  for (const [width, height] of [[800, 500], [8000, 4000], [2000, 10000]]) {
    const scale = imageScale(width, height, 3);
    assert.ok(width * scale <= 4096 && height * scale <= 4096);
    assert.ok(width * height * scale * scale <= 16000000);
  }
  assert.throws(() => imageScale(0, 10), /visible/);
});
