import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Filter } from 'lucide-react';
import {
  summarizeImpactAssetsByCategory,
  buildImpactAssetLabel,
  classifyImpactSeverity,
  IMPACT_SEVERITY_LABELS,
} from '../../services/cookIslandsImpactService';

const TEXT_PRIMARY = '#f8fafc';
const TEXT_MUTED = 'rgba(203, 213, 225, 0.72)';

// Same teal/amber/red family as HAZARD_COLORS/IMPACT_SECTOR_COLORS elsewhere
// in the app, not the risk-circles' own No/Minor/Moderate Risk blue/orange/
// red scale -- deliberately different colors for a deliberately different
// (and differently-named: "severity", not "risk") concept, so the two
// systems don't visually read as the same thing on the same map.
const SEVERITY_META = {
  low: { color: '#2A9D8F', text: '#f8fafc' },
  low_medium: { color: '#8bc9a8', text: '#0f172a' },
  medium: { color: '#F4A261', text: '#0f172a' },
  high: { color: '#E63946', text: '#f8fafc' },
};

// "Commercial" stays as-is; "Residential road" -> "Residential Road" -- the
// source data's own casing is inconsistent (RiskScape's UseType column),
// title-casing for display only, never touching the underlying value used
// for grouping/filtering.
function titleCase(str) {
  return String(str).replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

function fmtDepth(m) {
  return Number.isFinite(m) ? `${m.toFixed(2)} m` : '—';
}

function fmtUsdShort(value) {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${Math.round(value).toLocaleString()}`;
}

function SeverityBadge({ severity, size = 'normal' }) {
  const meta = SEVERITY_META[severity];
  if (!meta) return null;
  const label = IMPACT_SEVERITY_LABELS[severity];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', flexShrink: 0,
      padding: size === 'small' ? '0.1rem 0.4rem' : '0.15rem 0.5rem',
      borderRadius: 999, fontSize: size === 'small' ? '0.6rem' : '0.64rem', fontWeight: 700,
      color: meta.text, background: meta.color,
    }}>
      {label}
    </span>
  );
}

function AssetRow({ feature, index, onSelectAsset }) {
  const props = feature.properties ?? {};
  const severity = classifyImpactSeverity(props.lossRatio ?? 0);
  const label = buildImpactAssetLabel(feature, index);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelectAsset?.(feature)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectAsset?.(feature); } }}
      title={onSelectAsset ? `Zoom to ${label} on the map` : undefined}
      style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.6rem',
        padding: '0.45rem 0.5rem', borderRadius: 8, cursor: onSelectAsset ? 'pointer' : 'default',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        {/* Two-line allowance instead of hard truncation -- title attribute
            above still covers the rare name long enough to clip a third line. */}
        <div style={{
          fontSize: '0.76rem', color: TEXT_PRIMARY, fontWeight: 600,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {label}
        </div>
        <div style={{ fontSize: '0.66rem', color: TEXT_MUTED, marginTop: '0.15rem' }}>
          Depth {fmtDepth(props.hazard)} · Loss {fmtUsdShort(props.totalLoss)}
        </div>
      </div>
      {severity && <SeverityBadge severity={severity} size="small" />}
    </div>
  );
}

function CategoryRow({ category, expanded, onToggle, onSelectAsset, filters }) {
  const { useType, affectedCount, totalCount, maxSeverity, features } = category;

  const visibleFeatures = useMemo(() => {
    let list = features;
    if (filters.affectedOnly) list = list.filter((f) => (f.properties?.lossRatio ?? 0) > 0);
    if (filters.severity) {
      list = list.filter((f) => classifyImpactSeverity(f.properties?.lossRatio ?? 0) === filters.severity);
    }
    return list;
  }, [features, filters]);

  return (
    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
      {/* Whole header is the button (not just the chevron icon) -- the
          feedback that only the small chevron was clickable. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.6rem', width: '100%',
          padding: '0.6rem 0.4rem', background: 'transparent', border: 'none', cursor: 'pointer',
          color: TEXT_PRIMARY, textAlign: 'left',
        }}
      >
        {maxSeverity
          ? <SeverityBadge severity={maxSeverity} />
          : <span style={{
              padding: '0.15rem 0.5rem', borderRadius: 999, fontSize: '0.64rem', fontWeight: 700,
              color: TEXT_MUTED, border: '1px solid rgba(255,255,255,0.18)', flexShrink: 0,
            }}>None</span>}
        <span style={{ fontWeight: 700, fontSize: '0.82rem', flex: 1 }}>
          {titleCase(useType)}
          <span style={{ fontWeight: 500, color: TEXT_MUTED, marginLeft: '0.4rem', fontSize: '0.74rem' }}>
            · {affectedCount} affected / {totalCount}
          </span>
        </span>
        <ChevronDown
          size={20}
          style={{ flexShrink: 0, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
        />
      </button>
      {expanded && (
        <div style={{ padding: '0 0.4rem 0.6rem' }}>
          {visibleFeatures.length === 0 ? (
            <div style={{ fontSize: '0.72rem', color: TEXT_MUTED, padding: '0.4rem 0.5rem' }}>
              No assets match the current filters in this category.
            </div>
          ) : (
            visibleFeatures.map((feature, i) => (
              <AssetRow key={feature.id ?? i} feature={feature} index={i} onSelectAsset={onSelectAsset} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// Category accordion over a scenario's RiskScape assets -- "USE_TYPE · N
// affected / M total", highest-severity-first, filterable, with selecting a
// building flying the map to it. Deliberately no internal scrollbar on the
// building list (feedback: nested scrolling on top of the page/sheet's own
// scroll was hard to operate) -- it flows in-line with whatever scroll
// container this accordion itself sits in.
function ImpactCategoryAccordion({ features, onSelectAsset }) {
  const categories = useMemo(() => summarizeImpactAssetsByCategory(features ?? []), [features]);

  // Sticky expanded category + scroll position across scenario/window
  // changes (feedback: switching windows lost your place) -- restored only
  // if the category still exists in the new scenario's list; the scroll
  // container is the accordion's own wrapper, not a page-level ref, so this
  // works regardless of where the accordion is mounted.
  const [expandedUseType, setExpandedUseType] = useState(null);
  const [affectedOnly, setAffectedOnly] = useState(false);
  const [severityFilter, setSeverityFilter] = useState('');
  const containerRef = useRef(null);
  const scrollTopRef = useRef(0);

  useLayoutEffect(() => {
    if (containerRef.current) containerRef.current.scrollTop = scrollTopRef.current;
  }, [categories]);

  const filters = { affectedOnly, severity: severityFilter || null };
  const visibleCategories = categories.filter((c) => {
    if (affectedOnly && c.affectedCount === 0) return false;
    if (severityFilter && c.severityCounts[severityFilter] === 0) return false;
    return true;
  });

  if (categories.length === 0) {
    return (
      <div style={{ fontSize: '0.74rem', color: TEXT_MUTED, padding: '0.75rem 0.25rem' }}>
        No per-asset detail available for this window yet.
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap', marginBottom: '0.5rem', fontSize: '0.72rem', color: TEXT_MUTED }}>
        <Filter size={12} />
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={affectedOnly} onChange={(e) => setAffectedOnly(e.target.checked)} />
          Affected only
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          Severity
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            style={{ background: 'rgba(255,255,255,0.08)', color: TEXT_PRIMARY, border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6, padding: '0.15rem 0.35rem', fontSize: '0.72rem' }}
          >
            {/* Explicit background/color on each <option> -- the <select>'s
                own rgba() background is a translucent overlay meant to sit
                on this panel's dark chrome, but the native OS dropdown
                popup ignores that translucency and falls back to a plain
                white popup, leaving the inherited white text unreadable
                against it (confirmed live: options were there, just
                white-on-white). Chrome/Firefox do honor an explicit color
                on <option> itself, even inside that native popup. */}
            <option value="" style={{ background: '#0f172a', color: TEXT_PRIMARY }}>Any</option>
            <option value="high" style={{ background: '#0f172a', color: TEXT_PRIMARY }}>High</option>
            <option value="medium" style={{ background: '#0f172a', color: TEXT_PRIMARY }}>Medium</option>
            <option value="low_medium" style={{ background: '#0f172a', color: TEXT_PRIMARY }}>Low–Medium</option>
            <option value="low" style={{ background: '#0f172a', color: TEXT_PRIMARY }}>Low</option>
          </select>
        </label>
      </div>
      <div
        ref={containerRef}
        onScroll={(e) => { scrollTopRef.current = e.currentTarget.scrollTop; }}
      >
        {visibleCategories.length === 0 ? (
          <div style={{ fontSize: '0.74rem', color: TEXT_MUTED, padding: '0.5rem 0.25rem' }}>
            No categories match the current filters.
          </div>
        ) : (
          visibleCategories.map((category) => (
            <CategoryRow
              key={category.useType}
              category={category}
              expanded={expandedUseType === category.useType}
              onToggle={() => setExpandedUseType((prev) => (prev === category.useType ? null : category.useType))}
              onSelectAsset={onSelectAsset}
              filters={filters}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default ImpactCategoryAccordion;
