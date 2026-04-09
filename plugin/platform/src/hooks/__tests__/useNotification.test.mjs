import test from 'node:test';
import assert from 'node:assert/strict';
import { useNotification } from '../useNotification.js';

test('useNotification is exported as a function', () => {
  assert.equal(typeof useNotification, 'function');
});
