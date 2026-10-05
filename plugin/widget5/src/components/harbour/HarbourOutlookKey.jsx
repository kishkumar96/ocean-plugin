import React from 'react';
import { HARBOUR_STATE_COLORS } from '../../lib/harbourOutlookLayer';

// A small inline copy of the map badge: fill = now, ring = next 24 h.
function Badge({ now, next, size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="20" cy="20" r="17.5" fill={HARBOUR_STATE_COLORS[next]} stroke="rgba(2,6,23,0.7)" strokeWidth="1" />
      <circle cx="20" cy="20" r="12.6" fill="#ffffff" />
      <circle cx="20" cy="20" r="11.2" fill={HARBOUR_STATE_COLORS[now]} />
      <g fill="none" stroke={now === 'caution' ? '#0f172a' : '#ffffff'} strokeWidth="2.1" strokeLinecap="round">
        <circle cx="20" cy="13.2" r="1.9" />
        <path d="M20 15.3V26.5M15.2 18.6H24.8M13.6 21.6C13.6 28 26.4 28 26.4 21.6" />
      </g>
    </svg>
  );
}

// Short rows: the title already says whose limits these are ("provisional limits"), so each row needn't.
const KEY_LABELS = { 0: 'Within limits', 1: 'Over caution limit', 2: 'Over stop limit' };

// Map key for the harbour badges on the Forecast map. The title names the limits' authority, so
// provisional limits never read as approved operational guidance.
export default function HarbourOutlookKey({ bundle }) {
  const basis = bundle?.basis;
  const judged = Boolean(bundle?.judged);
  const qualifier = basis === 'provisional' ? ' · provisional limits' : basis === 'draft' ? ' · draft limits' : '';
  return (
    <div data-testid="harbour-outlook-key">
      <div className="marine-legend-title">Harbour unloading{qualifier}</div>
      {judged ? (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginTop: '0.45rem' }}>
            {[['ok', 0], ['caution', 1], ['stop', 2]].map(([state, verdict]) => (
              <div key={state} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.76rem', color: '#e0f7ff' }}>
                <span style={{ width: 12, height: 12, borderRadius: '50%', background: HARBOUR_STATE_COLORS[state], border: '1.5px solid rgba(255,255,255,0.3)', flexShrink: 0 }} />
                {KEY_LABELS[verdict]}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginTop: '0.45rem', fontSize: '0.68rem', color: 'rgba(224,247,255,0.8)', lineHeight: 1.3 }}>
            <Badge now="ok" next="stop" />
            <span>Centre = now<br />Ring = worst next 24 h</span>
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginTop: '0.45rem', fontSize: '0.7rem', color: 'rgba(224,247,255,0.8)' }}>
          <Badge now="none" next="none" />
          <span>{basis === 'unavailable' ? 'Limits unavailable: no verdict' : 'No limits set: forecast values only'}</span>
        </div>
      )}
    </div>
  );
}
