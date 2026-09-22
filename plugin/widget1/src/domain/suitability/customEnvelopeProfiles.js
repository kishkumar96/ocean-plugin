// Custom wind/wave thresholds are scoped to a vessel class. A single shared
// object is unsafe: switching from a larger vessel to a traditional craft can
// otherwise carry the larger vessel's much more permissive limits with it.
export function getCustomEnvelopeForVessel(profiles, vesselCode) {
  return profiles?.[vesselCode] ?? null;
}

export function updateCustomEnvelopeForVessel(profiles, vesselCode, update) {
  if (!vesselCode) return profiles ?? {};

  const currentProfiles = profiles ?? {};
  const currentEnvelope = getCustomEnvelopeForVessel(currentProfiles, vesselCode);
  const nextEnvelope = typeof update === 'function' ? update(currentEnvelope) : update;

  if (nextEnvelope === null || nextEnvelope === undefined) {
    if (!Object.prototype.hasOwnProperty.call(currentProfiles, vesselCode)) return currentProfiles;
    const nextProfiles = { ...currentProfiles };
    delete nextProfiles[vesselCode];
    return nextProfiles;
  }

  if (nextEnvelope === currentEnvelope) return currentProfiles;
  return {
    ...currentProfiles,
    [vesselCode]: { ...nextEnvelope },
  };
}
