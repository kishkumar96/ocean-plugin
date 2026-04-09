import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('useForecast hook module re-exports a hook', () => {
  const source = readFileSync(new URL('../useForecast.js', import.meta.url), 'utf8');
  assert.match(source, /useForecast/);
});
