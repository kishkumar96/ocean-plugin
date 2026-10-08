import { parseUtcTimestamp } from '../backendTime';

describe('parseUtcTimestamp', () => {
  // Independent of the process timezone by construction: the expected value is Date.parse(... + 'Z').
  test.each([
    '2026-09-28T06:00:00.000000000',
    '2026-09-28T06:00:00',
    '2026-09-28 06:00:00',
    '2026-09-28T06:00',
    '2026-09-28T06:00:00Z',
    '2026-09-28T06:00:00.000Z',
  ])('%s is 06:00 UTC', (str) => {
    expect(parseUtcTimestamp(str).toISOString()).toBe('2026-09-28T06:00:00.000Z');
  });

  test('respects an explicit offset instead of forcing Z', () => {
    expect(parseUtcTimestamp('2026-09-28T06:00:00+10:00').toISOString()).toBe('2026-09-27T20:00:00.000Z');
    expect(parseUtcTimestamp('2026-09-28T06:00:00-10:00').toISOString()).toBe('2026-09-28T16:00:00.000Z');
  });

  test('date-only strings are UTC midnight', () => {
    expect(parseUtcTimestamp('2026-09-28').toISOString()).toBe('2026-09-28T00:00:00.000Z');
  });

  test('invalid or missing input is an Invalid Date (callers test isNaN), never a throw', () => {
    ['', null, undefined, 'nope', 42].forEach((v) => expect(Number.isNaN(parseUtcTimestamp(v).getTime())).toBe(true));
  });
});
