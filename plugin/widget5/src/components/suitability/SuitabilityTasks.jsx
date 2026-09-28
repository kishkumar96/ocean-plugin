import React, { useState } from 'react';

// Progressive disclosure for the Vessel Suitability tools. The sidebar used to stack six
// always-open sections (route, advisory, scenarios, landing areas, thresholds...) with equal
// weight; here the vessel choice stays on top and exactly ONE task is open at a time. Clicking the
// open tab closes it again, so the default view is short: pick a vessel, read the map.
export const SUITABILITY_TASKS = [
  { key: 'route', label: 'Plan route' },
  { key: 'compare', label: 'Compare' },
  { key: 'export', label: 'Export' },
  { key: 'thresholds', label: 'Thresholds' },
];

const TEXT_MUTED = 'rgba(203, 213, 225, 0.72)';

// tasks: { [key]: () => ReactNode } -- only the selected task's renderer is called.
export default function SuitabilityTasks({ tasks, initialTask = null }) {
  const [active, setActive] = useState(initialTask);
  return (
    <div>
      <div role="tablist" aria-label="Suitability tools" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
        {SUITABILITY_TASKS.map(({ key, label }) => {
          const selected = active === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              id={`suitability-task-${key}`}
              aria-selected={selected}
              aria-controls="suitability-task-panel"
              onClick={() => setActive(selected ? null : key)}
              style={{
                padding: '0.4rem 0.2rem', borderRadius: 8, cursor: 'pointer', fontSize: '0.72rem', fontWeight: selected ? 700 : 500,
                border: `1px solid ${selected ? 'rgba(56, 189, 248, 0.55)' : 'rgba(255,255,255,0.12)'}`,
                background: selected ? 'rgba(56, 189, 248, 0.16)' : 'rgba(255,255,255,0.04)',
                color: selected ? '#7dd3fc' : TEXT_MUTED,
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
      {active && tasks[active] ? (
        <div role="tabpanel" id="suitability-task-panel" aria-labelledby={`suitability-task-${active}`} style={{ marginTop: '0.7rem', padding: '0.75rem', borderRadius: 12, background: 'rgba(0, 0, 0, 0.22)', border: '1px solid rgba(255,255,255,0.08)' }}>
          {tasks[active]()}
        </div>
      ) : (
        <div style={{ fontSize: '0.68rem', color: TEXT_MUTED, marginTop: '0.45rem' }}>
          Choose a tool: plan a route, compare scenarios and landing areas, export an advisory, or change the thresholds.
        </div>
      )}
    </div>
  );
}

// States which thresholds a surface actually uses. Custom thresholds only recolour the map; routes,
// scenarios and reports are always classified against the vessel's server-side preset.
export function ThresholdBasisBadge({ isCustom }) {
  return (
    <div
      role="note"
      style={{
        display: 'inline-flex', alignItems: 'flex-start', gap: '0.4rem', fontSize: '0.68rem', lineHeight: 1.35, borderRadius: 8, padding: '0.3rem 0.5rem', marginBottom: '0.6rem',
        border: `1px solid ${isCustom ? 'rgba(251, 191, 36, 0.5)' : 'rgba(45, 212, 191, 0.4)'}`,
        background: isCustom ? 'rgba(251, 191, 36, 0.09)' : 'rgba(45, 212, 191, 0.07)',
        color: isCustom ? '#fde68a' : '#99f6e4',
      }}
    >
      {isCustom
        ? 'Custom thresholds change the map only. This tool still uses the vessel preset.'
        : 'Uses the vessel preset thresholds.'}
    </div>
  );
}
