import React from 'react';
import { usePlatformInfo } from '../hooks/usePlatformInfo';
import { formatPlatformTagline } from '../utils/platformMetadata';

const containerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.75rem',
  padding: '0.75rem 1rem',
  borderRadius: '12px',
  border: '1px dashed rgba(0, 122, 255, 0.25)',
  background: 'linear-gradient(120deg, rgba(0, 122, 255, 0.05), rgba(0, 122, 255, 0.08))',
  color: '#0f172a',
  boxShadow: '0 6px 20px rgba(15, 23, 42, 0.08)',
};

const badgeStyle = {
  fontSize: '0.75rem',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#0ea5e9',
  background: 'rgba(14, 165, 233, 0.08)',
  padding: '0.35rem 0.65rem',
  borderRadius: '999px',
  border: '1px solid rgba(14, 165, 233, 0.3)',
  whiteSpace: 'nowrap',
};

const textStyle = {
  flex: 1,
  fontSize: '0.95rem',
  lineHeight: 1.4,
  minWidth: 0,
};

const versionStyle = {
  fontSize: '0.75rem',
  color: '#475569',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
};

export const PlatformPlaceholder = ({ widgetName, message }) => {
  const info = usePlatformInfo();
  const widgetLabel = widgetName || info.name;

  return (
    <div style={containerStyle} role="note" aria-label="ocean widget platform placeholder">
      <span style={badgeStyle}>ocean-widget-platform</span>
      <span style={textStyle}>{message || formatPlatformTagline(widgetLabel)}</span>
      <span style={versionStyle}>v{info.version}</span>
    </div>
  );
};
