import React, { useCallback, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { DISTRICT_LOSS_COLOR_STOPS } from '../services/cookIslandsImpactService';
import { MHWS_LINE_COLORS } from '../hooks/useZarrMap';
import { RISK_COLORS, RISK_LABELS } from '../services/riskDataService';

// ONE key on the map, replacing the separate floating boxes. Folded, it is a slim card holding only
// what is needed to read the map at a glance: the depth ramp. Unfolded ("More"), it adds a legend
// for each OTHER layer that is switched on -- never for a hidden layer. The layer switches stay in
// the sidebar (ImpactLayerSwitches), so this is purely explanation, and it never grows the sidebar.
// Fold state is remembered per browser; it starts folded so the map stays as clear as possible.
const STORAGE_KEY = 'cok.impactMapKey.v1';
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MUTED = '#a5c4cf';
const TEXT = '#e0f7ff';

const readOpen = () => { try { return window.localStorage.getItem(STORAGE_KEY) === 'open'; } catch { return false; } };
const writeOpen = (open) => { try { window.localStorage.setItem(STORAGE_KEY, open ? 'open' : 'closed'); } catch { /* storage unavailable */ } };

// The legend config's gradient runs bottom-to-top; laid out here left-to-right (min at left).
const horizontalGradient = (g) => String(g ?? '').replace(/linear-gradient\(\s*(?:to (?:top|bottom)|\d+deg)/, 'linear-gradient(to right');

// At most `max` tick labels, evenly picked (always keeping first and last) so labels never collide.
export function pickTicks(ticks, max = 5) {
  const list = (ticks ?? []).filter((t) => Number.isFinite(t));
  if (list.length <= max) return list;
  const out = new Set([list[0], list[list.length - 1]]);
  for (let i = 1; i < max - 1; i += 1) out.add(list[Math.round((i * (list.length - 1)) / (max - 1))]);
  return [...out].sort((a, b) => a - b);
}

function DepthRamp({ legend }) {
  const { min, max, units = 'm' } = legend;
  const span = max - min;
  const pos = (t) => (span > 0 ? ((t - min) / span) * 100 : 0);
  return (
    <div>
      <div role="img" aria-label={`Inundation depth from ${min}${units} to ${max}${units}`} style={{ height: 9, borderRadius: 5, background: horizontalGradient(legend.gradient), border: '1px solid rgba(255,255,255,0.25)' }} />
      <div style={{ position: 'relative', height: 13, marginTop: 3 }}>
        {pickTicks(legend.ticks).map((t) => (
          <span key={t} style={{ position: 'absolute', left: `${pos(t)}%`, transform: pos(t) > 90 ? 'translateX(-100%)' : (pos(t) < 10 ? 'none' : 'translateX(-50%)'), fontSize: '0.6rem', color: MUTED }}>{t}{units}</span>
        ))}
      </div>
    </div>
  );
}

const Heading = ({ children }) => (
  <div style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#67e8f9', margin: '0.5rem 0 0.2rem' }}>{children}</div>
);

function Classes({ items }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.2rem 0.65rem' }}>
      {items.map(({ key, color, label, round }) => (
        <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.66rem', color: TEXT }}>
          <span style={{ width: 10, height: 10, borderRadius: round ? '50%' : 2, background: color, border: '1.5px solid rgba(255,255,255,0.3)', flexShrink: 0 }} />
          {label}
        </span>
      ))}
    </div>
  );
}

const sample = (color, dashed) => (
  <span style={{ width: 18, height: 0, borderTop: `${dashed ? 2 : 3}px ${dashed ? 'dashed' : 'solid'} ${color}`, boxShadow: dashed ? 'none' : '0 0 0 1px rgba(4, 47, 46, 0.7)', flexShrink: 0 }} />
);

const Line = ({ swatch, children }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.68rem', color: TEXT, padding: '0.08rem 0' }}>{swatch}{children}</div>
);

export default function ImpactMapKey({ activeLayers, depthLegend = null }) {
  const [open, setOpen] = useState(readOpen);
  const toggle = useCallback(() => setOpen((prev) => { writeOpen(!prev); return !prev; }), []);
  const on = (key) => activeLayers?.[key] !== false;
  const altOn = activeLayers?.mhwsAltContours === true;

  const showDistricts = on('impactDistricts');
  const showRisk = on('riskPoints');
  const showLines = on('mhwsContour') || altOn || on('mhwsFlood');
  const hasMore = showDistricts || showRisk || showLines;
  if (!depthLegend && !hasMore) return null;

  return (
    <div className="marine-legend" role="group" aria-label="Map key" style={{ width: 240, minWidth: 240, fontFamily: FONT, padding: '0.5rem 0.65rem 0.55rem' }}>
      {depthLegend && (
        <>
          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: TEXT, marginBottom: '0.3rem' }}>Inundation depth</div>
          <DepthRamp legend={depthLegend} />
        </>
      )}
      {hasMore && (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', background: 'none', border: 'none', padding: '0.3rem 0 0', cursor: 'pointer', color: '#7dd3fc', fontFamily: FONT, fontSize: '0.66rem' }}
        >
          {open ? 'Less' : 'More key'}
          <ChevronDown size={12} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
        </button>
      )}
      {hasMore && open && (
        <div>
          {showDistricts && (<><Heading>District damage</Heading><Classes items={DISTRICT_LOSS_COLOR_STOPS.map(({ color, label }) => ({ key: label, color, label }))} /></>)}
          {showRisk && (<><Heading>Coastal risk</Heading><Classes items={[0, 1, 2].map((l) => ({ key: l, color: RISK_COLORS[l], label: RISK_LABELS[l], round: true }))} /></>)}
          {showLines && (
            <>
              <Heading>Tide reference</Heading>
              {on('mhwsContour') && <Line swatch={sample(MHWS_LINE_COLORS[17.5], false)}>MHWS + 17.5 cm (0.503 m), working mark</Line>}
              {altOn && [[0, 'MHWS (0.328 m)'], [15, 'MHWS + 15 cm'], [20, 'MHWS + 20 cm']].map(([cm, label]) => <Line key={cm} swatch={sample(MHWS_LINE_COLORS[cm], true)}>{label}</Line>)}
              {on('mhwsFlood') && <Line swatch={<span style={{ width: 12, height: 12, borderRadius: 3, background: 'rgba(59, 130, 246, 0.55)', border: '1.5px solid #bfdbfe', flexShrink: 0 }} />}>Forecast flooding above the working mark</Line>}
              <div style={{ fontSize: '0.62rem', color: MUTED, lineHeight: 1.35, marginTop: '0.25rem' }}>
                MHWS is 0.328 m above mean sea level; 17.5 cm is added on the scientists’ advice. The line follows tidal channels inland; flooding is traced from a coarse model grid, so read it as approximate.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
