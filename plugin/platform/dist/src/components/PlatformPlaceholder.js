import React from 'react';

let spinnerStylesInjected = false;
let compassRoseStylesInjected = false;

function ensureSpinnerStyles() {
  if (typeof document === 'undefined') return;
  const existingTag = document.head && document.head.querySelector('style[data-owp-spinner="true"]');
  if (existingTag) {
    spinnerStylesInjected = true;
    return;
  }
  if (spinnerStylesInjected) return;
  const styleTag = document.createElement('style');
  styleTag.setAttribute('data-owp-spinner', 'true');
  styleTag.textContent = '@keyframes owp-spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }';
  document.head.appendChild(styleTag);
  spinnerStylesInjected = true;
}

function ensureCompassRoseStyles() {
  if (typeof document === 'undefined') return;
  const existingTag = document.head && document.head.querySelector('style[data-owp-compass-rose="true"]');
  if (existingTag) {
    compassRoseStylesInjected = true;
    return;
  }
  if (compassRoseStylesInjected) return;
  const styleTag = document.createElement('style');
  styleTag.setAttribute('data-owp-compass-rose', 'true');
  styleTag.textContent = `
    .owp-compass-rose-container {
      animation: owp-compass-fade-in 0.8s cubic-bezier(0.4, 0, 0.2, 1);
      user-select: none;
      -webkit-user-select: none;
      -ms-user-select: none;
      pointer-events: none;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .owp-compass-rose-svg {
      transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1), filter 0.2s ease-out;
      backdrop-filter: blur(1px);
      -webkit-backdrop-filter: blur(1px);
      pointer-events: none;
    }
    .owp-compass-rose-container:hover .owp-compass-rose-svg {
      filter: drop-shadow(0 8px 16px rgba(0, 0, 0, 0.4));
      transform: scale(1.03);
    }
    @keyframes owp-compass-fade-in {
      from { opacity: 0; transform: scale(0.9) translateY(8px); }
      to { opacity: 0.94; transform: scale(1) translateY(0); }
    }
    @media (max-width: 768px) {
      .owp-compass-rose-container { transform: scale(0.85); transform-origin: bottom left; }
    }
    @media (max-width: 480px) {
      .owp-compass-rose-container { transform: scale(0.75); transform-origin: bottom left; opacity: 0.88; }
    }
  `;
  document.head.appendChild(styleTag);
  compassRoseStylesInjected = true;
}

export function PlatformPlaceholder({ label = 'Ocean Widget Platform Ready' }) {
  return React.createElement('div', { 'data-testid': 'platform-placeholder', style: { display: 'none' } }, label);
}

function ArrowSVGBase({ angle, isDarkMode, size = 22, compassDirection = '', ariaLabel }) {
  const fillColor = isDarkMode ? '#f1f5f9' : '#000';
  const strokeColor = isDarkMode ? '#64748b' : '#666';

  return React.createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: `0 0 ${size} ${size}`,
      style: { display: 'inline-block', transform: `rotate(${angle}deg)`, filter: isDarkMode ? 'invert(1)' : 'none' },
      role: 'img',
      'aria-label': ariaLabel || `Direction: ${angle}° ${compassDirection}`
    },
    React.createElement('polygon', {
      points: `${size / 2},2 ${size * 0.73},${size * 0.82} ${size / 2},${size * 0.64} ${size * 0.27},${size * 0.82}`,
      fill: fillColor,
      stroke: strokeColor,
      strokeWidth: '1'
    })
  );
}

const MemoizedArrowSVG = React.memo(ArrowSVGBase);

export function ArrowSVG(props) {
  return React.createElement(MemoizedArrowSVG, props);
}

export function CompassRose({ position = 'bottom-left', size = 100, mapRotation = 0, responsive = true }) {
  const [currentPosition, setCurrentPosition] = React.useState(position);

  React.useEffect(() => {
    ensureCompassRoseStyles();
  }, []);

  React.useEffect(() => {
    if (!responsive || typeof window === 'undefined') return undefined;
    const handleResize = () => {
      const isMobile = window.innerWidth < 768;
      setCurrentPosition(isMobile && position === 'top-right' ? 'bottom-left' : position);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [position, responsive]);

  const positionStyles = {
    'top-left': { top: '15px', left: '15px' },
    'top-right': { top: '15px', right: '15px' },
    'bottom-left': { bottom: '120px', left: '15px' },
    'bottom-right': { bottom: '80px', right: '15px' },
    'center-left': { top: '50%', left: '15px', transform: 'translateY(-50%)' },
    'map-center': { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
  };

  return React.createElement(
    'div',
    { className: 'owp-compass-rose-container', style: { position: 'absolute', zIndex: 1000, pointerEvents: 'none', opacity: 0.94, ...positionStyles[currentPosition], width: `${size}px`, height: `${size}px` } },
    React.createElement(
      'svg',
      { className: 'owp-compass-rose-svg', width: size, height: size, viewBox: '0 0 120 120', style: { transform: mapRotation ? `rotate(${-mapRotation}deg)` : 'none', filter: 'drop-shadow(0 6px 12px rgba(0,0,0,0.35))' } },
      React.createElement('circle', { cx: '60', cy: '60', r: '55', fill: 'rgba(15,23,42,0.95)', stroke: 'rgba(148,163,184,0.4)', strokeWidth: '1.5' }),
      React.createElement('path', { d: 'M 60,12 L 65,45 L 60,40 L 55,45 Z', fill: '#22d3ee', stroke: '#0e7490', strokeWidth: '1.2' }),
      React.createElement('path', { d: 'M 108,60 L 75,65 L 80,60 L 75,55 Z', fill: '#94a3b8', stroke: '#475569', strokeWidth: '0.8' }),
      React.createElement('path', { d: 'M 60,108 L 55,75 L 60,80 L 65,75 Z', fill: '#94a3b8', stroke: '#475569', strokeWidth: '0.8' }),
      React.createElement('path', { d: 'M 12,60 L 45,55 L 40,60 L 45,65 Z', fill: '#94a3b8', stroke: '#475569', strokeWidth: '0.8' }),
      React.createElement('circle', { cx: '60', cy: '60', r: '4', fill: '#0891b2', stroke: '#22d3ee', strokeWidth: '1' }),
      React.createElement('text', { x: '60', y: '8', textAnchor: 'middle', fontSize: '14', fontWeight: 'bold', fill: '#22d3ee' }, 'N')
    )
  );
}

function getDefaultLogoSrc() {
  if (typeof process !== 'undefined' && process.env && typeof process.env.PUBLIC_URL === 'string') {
    return `${process.env.PUBLIC_URL}/COSPPaC_white_crop2.png`;
  }
  return '/COSPPaC_white_crop2.png';
}

export function ModernHeader({
  logoSrc = getDefaultLogoSrc(),
  title = 'Cook Islands Wave and Inundation Forecast System',
  subtitle = 'Marine Forecasting • Pacific Community (SPC) Data',
  statusText = 'Live',
  showClock = true
}) {
  const [currentTime, setCurrentTime] = React.useState(new Date());
  React.useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return React.createElement(
    'nav',
    { style: { background: 'linear-gradient(135deg, #0a2463 0%, #1e3a5f 40%, #2e5266 70%, #3e7b69 100%)', minHeight: '60px', padding: '0 30px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', zIndex: 1001, boxShadow: '0 2px 20px rgba(0,0,0,0.3)', borderBottom: '1px solid rgba(255,255,255,0.1)' } },
    React.createElement(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: '15px' } },
      React.createElement('img', { src: logoSrc, alt: 'COSPPaC Logo', height: '35', style: { filter: 'brightness(0) saturate(100%) invert(100%)' } }),
      React.createElement(
        'div',
        null,
        React.createElement('h1', { style: { margin: 0, color: '#00d4ff', fontSize: '1.5rem', fontWeight: '700' } }, title),
        React.createElement('p', { style: { margin: 0, color: 'rgba(255,255,255,0.8)', fontSize: '0.9rem', fontWeight: '300' } }, subtitle)
      )
    ),
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '20px', fontSize: '0.8rem', color: 'rgba(255,255,255,0.7)' } }, showClock ? `${statusText} ${currentTime.toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}` : statusText)
  );
}

export function LoadingSpinner({ size = 28, color = '#3b82f6', label = 'Loading...' }) {
  React.useEffect(() => {
    ensureSpinnerStyles();
  }, []);

  return React.createElement(
    'div',
    { style: { display: 'inline-flex', alignItems: 'center', gap: '10px' }, role: 'status', 'aria-live': 'polite', 'aria-busy': true },
    React.createElement('span', { style: { width: `${size}px`, height: `${size}px`, borderRadius: '50%', border: '3px solid rgba(148,163,184,0.35)', borderTopColor: color, animation: 'owp-spin 0.8s linear infinite', display: 'inline-block' }, 'aria-hidden': true }),
    React.createElement('span', null, label)
  );
}

export function LoadingOverlay({ visible = false, label = 'Loading data...' }) {
  if (!visible) return null;
  return React.createElement(
    'div',
    { style: { position: 'absolute', inset: 0, background: 'rgba(15,23,42,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 20 } },
    React.createElement('div', { style: { background: 'rgba(255,255,255,0.9)', padding: '12px 16px', borderRadius: '8px', color: '#0f172a' } }, React.createElement(LoadingSpinner, { label }))
  );
}

export function PanelContainer({ title, children, footer, className = '', style = {} }) {
  return React.createElement(
    'section',
    { className, style: { display: 'flex', flexDirection: 'column', borderRadius: '12px', overflow: 'hidden', ...style } },
    title ? React.createElement('header', { style: { padding: '10px 14px', fontWeight: 600 } }, title) : null,
    React.createElement('div', { style: { flex: 1 } }, children),
    footer ? React.createElement('footer', { style: { padding: '10px 14px' } }, footer) : null
  );
}

const DEFAULT_RANGE = '0,4';

function sanitizeRange(range) {
  const value = typeof range === 'string' ? range : String(range);
  const rangePattern = /^[+-]?\d+(\.\d+)?,[+-]?\d+(\.\d+)?$/;
  return rangePattern.test(value) ? value : DEFAULT_RANGE;
}

export function ProfessionalLegend({ range = DEFAULT_RANGE, className = '', style = {} }) {
  const safeRange = sanitizeRange(range);
  const url = `https://ocean-plotter.spc.int/legend?layer=wave_height&range=${encodeURIComponent(safeRange)}&palette=viridis`;
  return React.createElement('div', { className, style: { position: 'relative', borderRadius: '6px', overflow: 'hidden', background: '#fff', border: '1px solid #e2e8f0', ...style } },
    React.createElement('img', { src: url, alt: 'Legend for wave height', style: { maxWidth: '100%', height: 'auto' } })
  );
}
