import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('useMapInteraction hook module re-exports named and default hook', () => {
  const source = readFileSync(new URL('../useMapInteraction.js', import.meta.url), 'utf8');
  assert.match(source, /useMapInteraction/);
  assert.match(source, /default/);
});
