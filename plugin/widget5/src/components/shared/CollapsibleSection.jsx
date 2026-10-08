import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';

// A control group that starts folded: for settings and advanced tools that should not compete with
// the primary content. The header states what is inside; an optional `summary` shows the current
// state at a glance while folded. Open/closed is remembered per browser under `storageKey`.
export default function CollapsibleSection({ title, icon = null, summary = null, defaultOpen = false, storageKey = null, children }) {
  const [open, setOpen] = useState(() => {
    if (!storageKey) return defaultOpen;
    try {
      const saved = window.localStorage.getItem(storageKey);
      return saved === null ? defaultOpen : saved === 'open';
    } catch { return defaultOpen; }
  });
  const toggle = () => setOpen((prev) => {
    const next = !prev;
    if (storageKey) { try { window.localStorage.setItem(storageKey, next ? 'open' : 'closed'); } catch { /* storage unavailable */ } }
    return next;
  });
  return (
    <div className="control-group" role="group" aria-label={title}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', textAlign: 'left' }}
      >
        <h3 style={{ margin: 0, flex: 1 }}>{icon} {title}</h3>
        {!open && summary && <span style={{ fontSize: '0.66rem', color: 'rgba(203, 213, 225, 0.72)' }}>{summary}</span>}
        <ChevronDown size={15} style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 0.15s', flexShrink: 0 }} />
      </button>
      {open && <div style={{ marginTop: '0.6rem' }}>{children}</div>}
    </div>
  );
}
