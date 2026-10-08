import VESSEL_THRESHOLDS from '../vesselThresholds.generated.json';
import {
  CUSTOM_ENVELOPE_FIELDS,
  VESSEL_CLASS_OPTIONS,
  VESSEL_OPERATING_ENVELOPE,
  resolveOperatingEnvelope,
} from '../CookIslandsSuitabilityOverlay';

// The numbers themselves are generated from vessel_suitability_rules.yaml
// (scripts/sync_vessel_thresholds.py --check flags a stale file); these tests
// guard the wiring between that file and what the UI and map consume.
describe('vessel presets', () => {
  test('every selectable vessel class has a preset built from the generated thresholds', () => {
    for (const { value } of VESSEL_CLASS_OPTIONS) {
      const preset = VESSEL_OPERATING_ENVELOPE[value];
      expect(preset).toBeDefined();
      for (const field of CUSTOM_ENVELOPE_FIELDS) {
        expect(preset[field]).toBe(VESSEL_THRESHOLDS[value][field]);
      }
    }
  });

  test('every preset is a valid envelope', () => {
    for (const code of Object.keys(VESSEL_OPERATING_ENVELOPE)) {
      expect(() => resolveOperatingEnvelope(code)).not.toThrow();
    }
  });

  test('the generated file carries exactly the vessel classes the UI offers', () => {
    expect(Object.keys(VESSEL_THRESHOLDS).sort()).toEqual(VESSEL_CLASS_OPTIONS.map((v) => v.value).sort());
  });
});
