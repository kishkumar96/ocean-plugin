import test from 'node:test';
import assert from 'node:assert/strict';
import { useUIState } from '../useUIState.js';

test('useUIState is a local platform hook function', () => {
  assert.equal(typeof useUIState, 'function');
});
