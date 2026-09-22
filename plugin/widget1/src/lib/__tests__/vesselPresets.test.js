import VESSEL_THRESHOLDS from '../vesselThresholds.generated.json';
import {
  CUSTOM_ENVELOPE_FIELDS,
  VESSEL_OPERATING_ENVELOPE,
  resolveOperatingEnvelope,
} from '../NiueSuitabilityOverlay';

// The numbers themselves are generated from vessel_suitability_rules.yaml
// (scripts/sync_vessel_thresholds.py --check flags a stale file); these tests
// guard the wiring between that file and what the UI and map consume.
describe('vessel presets', () => {
  test('every preset is built from the generated thresholds', () => {
    expect(Object.keys(VESSEL_OPERATING_ENVELOPE).sort()).toEqual(Object.keys(VESSEL_THRESHOLDS).sort());
    for (const [code, preset] of Object.entries(VESSEL_OPERATING_ENVELOPE)) {
      for (const field of CUSTOM_ENVELOPE_FIELDS) {
        expect(preset[field]).toBe(VESSEL_THRESHOLDS[code][field]);
      }
    }
  });

  test('every preset is a valid envelope', () => {
    for (const code of Object.keys(VESSEL_OPERATING_ENVELOPE)) {
      expect(() => resolveOperatingEnvelope(code)).not.toThrow();
    }
  });

  test('the hand-written waveText still quotes the generated wave range', () => {
    for (const preset of Object.values(VESSEL_OPERATING_ENVELOPE)) {
      const range = `${preset.cautionWaveHeightM.toFixed(1)}-${preset.maxWaveHeightM.toFixed(1)} m`;
      expect(preset.waveText).toContain(range);
    }
  });
});
