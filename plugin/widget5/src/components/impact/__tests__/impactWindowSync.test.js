import { describeWindowMismatch } from '../impactWindowSync';

const block = { windowStart: '2026-09-23T12:00:00Z', windowEnd: '2026-09-26T11:00:00Z' };

describe('describeWindowMismatch', () => {
  test('null when the map range matches the impact window (within 90 min)', () => {
    expect(describeWindowMismatch(block, { mode: 'custom', startTime: new Date('2026-09-23T12:00:00Z'), endTime: new Date('2026-09-26T11:00:00Z') })).toBeNull();
    expect(describeWindowMismatch(block, { mode: 'custom', startTime: '2026-09-23T13:00:00Z', endTime: '2026-09-26T10:00:00Z' })).toBeNull();
  });
  test('reports both labels when the map shows a different period (the screenshot case)', () => {
    const m = describeWindowMismatch(block, { mode: 'custom', startTime: '2026-09-26T12:00:00Z', endTime: '2026-09-29T11:00:00Z' });
    expect(m).toEqual({ impactLabel: '23 Sept – 26 Sept', mapLabel: '26 Sept – 29 Sept' });
  });
  test('a non-custom map mode is a mismatch too', () => {
    expect(describeWindowMismatch(block, { mode: 'single' }).mapLabel).toBe('a single time step');
    expect(describeWindowMismatch(block, { mode: '48h' }).mapLabel).toMatch(/48 h/);
  });
  test('nothing to compare without a block or with unparseable dates', () => {
    expect(describeWindowMismatch(null, { mode: 'single' })).toBeNull();
    expect(describeWindowMismatch({ windowStart: 'x', windowEnd: 'y' }, { mode: 'single' })).toBeNull();
  });
  test('falls back to calendar dates when the hour-precise window is missing', () => {
    expect(describeWindowMismatch({ dateStart: '2026-09-23', dateEnd: '2026-09-26' }, { mode: 'custom', startTime: '2026-09-23T00:00:00Z', endTime: '2026-09-26T23:59:59Z' })).toBeNull();
  });

  test('clips the impact window to the layer span, so a last block that runs past the data is not a mismatch', () => {
    const last = { windowStart: '2026-09-26T12:00:00Z', windowEnd: '2026-10-03T23:59:59Z' };
    const available = { minMs: Date.parse('2026-09-24T06:00:00Z'), maxMs: Date.parse('2026-10-03T18:00:00Z') };
    // the map range ends at the last real timestep (18:00Z), 6 h before the block's nominal end
    expect(describeWindowMismatch(last, { mode: 'custom', startTime: '2026-09-26T12:00:00Z', endTime: '2026-10-03T18:00:00Z' }, 'Pacific/Rarotonga', available)).toBeNull();
    // ...but the old truncated 3-day range is still caught
    expect(describeWindowMismatch(last, { mode: 'custom', startTime: '2026-09-26T12:00:00Z', endTime: '2026-09-29T11:00:00Z' }, 'Pacific/Rarotonga', available)).toMatchObject({ impactLabel: '26 Sept – 3 Oct', mapLabel: '26 Sept – 29 Sept' });
  });
  test('a window that starts before the layer does is compared from where the layer starts', () => {
    const first = { windowStart: '2026-09-23T12:00:00Z', windowEnd: '2026-09-26T11:00:00Z' };
    const available = { minMs: Date.parse('2026-09-24T06:00:00Z'), maxMs: Date.parse('2026-10-03T18:00:00Z') };
    expect(describeWindowMismatch(first, { mode: 'custom', startTime: '2026-09-24T06:00:00Z', endTime: '2026-09-26T11:00:00Z' }, 'Pacific/Rarotonga', available)).toBeNull();
  });
  test('a map range that is not clipped to the layer span matches the same window (no false alarm)', () => {
    const last = { windowStart: '2026-09-26T12:00:00Z', windowEnd: '2026-10-03T23:59:59Z' };
    const available = { minMs: Date.parse('2026-09-24T06:00:00Z'), maxMs: Date.parse('2026-10-03T18:00:00Z') };
    // exactly what the app stores after clicking the window: the requested range, 6 h past the last timestep
    expect(describeWindowMismatch(last, { mode: 'custom', startTime: new Date('2026-09-26T12:00:00Z'), endTime: new Date('2026-10-03T23:59:59Z') }, 'Pacific/Rarotonga', available)).toBeNull();
  });
});
