import { useState } from 'react';

/**
 * Generic UI state hook for platform consumers.
 *
 * @param {any} initialState
 * @returns {[any, Function]}
 */
export function useUIState(initialState = null) {
  return useState(initialState);
}
