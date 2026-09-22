import {
  getCustomEnvelopeForVessel,
  updateCustomEnvelopeForVessel,
} from '../customEnvelopeProfiles';

describe('customEnvelopeProfiles', () => {
  test('keeps custom thresholds isolated by vessel class', () => {
    let profiles = {};
    profiles = updateCustomEnvelopeForVessel(profiles, 'traditional_craft', {
      cautionWindKt: 8,
      maxWindKt: 10,
    });
    profiles = updateCustomEnvelopeForVessel(profiles, 'larger_vessels', {
      cautionWindKt: 22,
      maxWindKt: 28,
    });

    expect(getCustomEnvelopeForVessel(profiles, 'traditional_craft')).toEqual({
      cautionWindKt: 8,
      maxWindKt: 10,
    });
    expect(getCustomEnvelopeForVessel(profiles, 'larger_vessels')).toEqual({
      cautionWindKt: 22,
      maxWindKt: 28,
    });
  });

  test('supports functional updates without mutating the previous profile map', () => {
    const original = {
      small_craft: { cautionWindKt: 15, maxWindKt: 20 },
    };
    const updated = updateCustomEnvelopeForVessel(original, 'small_craft', (current) => ({
      ...current,
      maxWindKt: 21,
    }));

    expect(updated).not.toBe(original);
    expect(updated.small_craft).not.toBe(original.small_craft);
    expect(original.small_craft.maxWindKt).toBe(20);
    expect(updated.small_craft.maxWindKt).toBe(21);
  });

  test('restoring one vessel removes only that vessel profile', () => {
    const profiles = {
      traditional_craft: { cautionWindKt: 8 },
      small_craft: { cautionWindKt: 16 },
    };
    const updated = updateCustomEnvelopeForVessel(profiles, 'traditional_craft', null);

    expect(updated).toEqual({ small_craft: { cautionWindKt: 16 } });
    expect(profiles).toHaveProperty('traditional_craft');
  });

  test('returns the same object for no-op resets and missing vessel codes', () => {
    const profiles = { small_craft: { maxWindKt: 21 } };
    expect(updateCustomEnvelopeForVessel(profiles, 'larger_vessels', null)).toBe(profiles);
    expect(updateCustomEnvelopeForVessel(profiles, '', { maxWindKt: 30 })).toBe(profiles);
  });
});
