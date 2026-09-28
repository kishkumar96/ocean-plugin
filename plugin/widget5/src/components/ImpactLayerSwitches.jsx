import React from 'react';
import { MHWS_LINE_COLORS } from '../hooks/useZarrMap';

// The layer switches for the Flood Impacts group: one compact line each, no legends. Explaining
// the layers is the map key's job (ImpactMapKey); keeping it out of here keeps the sidebar, and the
// impact table beneath it, short and quick to scan.
const line = (color, dashed) => (
  <span style={{ width: 16, height: 0, borderTop: `${dashed ? 2 : 3}px ${dashed ? 'dashed' : 'solid'} ${color}`, boxShadow: dashed ? 'none' : '0 0 0 1px rgba(4, 47, 46, 0.7)', flexShrink: 0 }} />
);

function Switch({ checked, onChange, sample, label }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.76rem', cursor: 'pointer', padding: '0.12rem 0' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {sample}
      {label}
    </label>
  );
}

export default function ImpactLayerSwitches({ activeLayers, setActiveLayers }) {
  const set = (key) => (value) => setActiveLayers?.((prev) => ({ ...prev, [key]: value }));
  const on = (key) => activeLayers?.[key] !== false;
  return (
    <div role="group" aria-label="Map layers" style={{ display: 'flex', flexDirection: 'column', marginBottom: '0.5rem' }}>
      <Switch checked={on('impactDistricts')} onChange={set('impactDistricts')} label="District damage" />
      <Switch checked={on('riskPoints')} onChange={set('riskPoints')} label="Coastal risk points" />
      <Switch checked={on('mhwsContour')} onChange={set('mhwsContour')} sample={line(MHWS_LINE_COLORS[17.5], false)} label="MHWS + 17.5 cm line" />
      <Switch checked={activeLayers?.mhwsAltContours === true} onChange={set('mhwsAltContours')} sample={line(MHWS_LINE_COLORS[0], true)} label="Compare lines (MHWS, +15, +20 cm)" />
      <Switch
        checked={on('mhwsFlood')}
        onChange={set('mhwsFlood')}
        sample={<span style={{ width: 11, height: 11, borderRadius: 3, background: 'rgba(59, 130, 246, 0.55)', border: '1.5px solid #bfdbfe', flexShrink: 0 }} />}
        label="Flooding above the line"
      />
    </div>
  );
}
