import { CookIslandsSuitabilityOverlay } from '../CookIslandsSuitabilityOverlay';
import { CookIslandsSuitabilityDynamicOverlay } from '../CookIslandsSuitabilityDynamicOverlay';

// (babel-jest hoists jest.mock above the imports.) Same stub as the sibling overlay tests: the real maplibre-gl module can't initialise under jsdom.
jest.mock('maplibre-gl', () => ({ addProtocol: jest.fn(), removeProtocol: jest.fn() }));

// The backend's summary timestamps are UTC numpy strings with NO zone marker
// ("2026-09-28T06:00:00.000000000"). `new Date()` on such a string reads it as the
// VIEWER'S LOCAL time, so every timeline label shifted by the viewer's own UTC
// offset: 12 h early in NZ (seen in a live screenshot and a live PDF), 10 h late in
// Rarotonga. The expected values here are plain UTC, so this fails under ANY non-UTC
// process timezone if the bug returns. (Jest can't switch zone mid-process; run it with
// TZ=Pacific/Rarotonga / TZ=Pacific/Auckland / ... to exercise other viewers.)
const START = '2026-09-28T06:00:00.000000000';
const END = '2026-09-28T09:00:00.000000000';
const EXPECTED = ['2026-09-28 06:00 UTC', '2026-09-28 07:00 UTC', '2026-09-28 08:00 UTC', '2026-09-28 09:00 UTC'];

describe.each([
  ['Overlay', CookIslandsSuitabilityOverlay],
  ['DynamicOverlay', CookIslandsSuitabilityDynamicOverlay],
])('%s _buildTimeLabels reads backend timestamps as UTC, whatever the viewer timezone', (_name, Klass) => {
  const build = (a, b, n) => Klass.prototype._buildTimeLabels.call({}, a, b, n);

  test('numpy-style zone-less timestamp', () => {
    expect(build(START, END, 4)).toEqual(EXPECTED);
  });

  test('space-separated and already-Z-terminated timestamps give the same labels', () => {
    expect(build('2026-09-28 06:00:00', '2026-09-28 09:00:00', 4)).toEqual(EXPECTED);
    expect(build('2026-09-28T06:00:00Z', '2026-09-28T09:00:00Z', 4)).toEqual(EXPECTED);
  });

  test('garbage or empty input gives no labels, not a throw', () => {
    expect(build('not a date', END, 4)).toEqual([]);
    expect(build(START, END, 0)).toEqual([]);
    expect(build(undefined, END, 4)).toEqual([]);
  });
});
