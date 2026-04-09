import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('useMapInteraction is implemented locally in platform hook module', () => {
  const source = readFileSync(new URL('../useMapInteraction.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /widget5\/src\/hooks\/useMapInteraction/);
  assert.match(source, /export const useMapInteraction/);
});
