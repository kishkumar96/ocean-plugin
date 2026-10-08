import React from 'react';
import { AlertCircle, Check, Share2 } from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import { formatZoned } from '../utils/timeZoneFormat';
import { modelRunAgeHours, updateFreshness, formatAge } from '../utils/modelRunTiming';

// What the status dot says about the FORECAST, not about the connection: how old the model run is.
const FRESHNESS = {
  current: { color: '#10b981', glow: 'rgba(16, 185, 129, 0.6)', word: 'Current' },
  aging: { color: '#f59e0b', glow: 'rgba(245, 158, 11, 0.6)', word: 'Aging' },
  stale: { color: '#ef4444', glow: 'rgba(239, 68, 68, 0.6)', word: 'Stale' },
  unknown: { color: '#94a3b8', glow: 'rgba(148, 163, 184, 0.5)', word: 'Forecast run unknown' },
};

const ModernHeader = ({ timeDisplayZone = 'Pacific/Rarotonga', onShareView, modelRunStart = null, updatedAt = null }) => {
  const [currentTime, setCurrentTime] = React.useState(new Date());
  const [shareStatus, setShareStatus] = React.useState('idle');
  const shareResetTimerRef = React.useRef(null);

  React.useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => {
      clearInterval(timer);
      clearTimeout(shareResetTimerRef.current);
    };
  }, []);

  const formatDateTime = (date) => formatZoned(date, timeDisplayZone, { second: '2-digit' });

  const handleShare = async () => {
    if (!onShareView || shareStatus === 'working') return;
    setShareStatus('working');
    const result = await onShareView();
    setShareStatus(result?.ok ? 'copied' : 'error');
    clearTimeout(shareResetTimerRef.current);
    shareResetTimerRef.current = setTimeout(() => setShareStatus('idle'), 3500);
  };

  const ShareIcon = shareStatus === 'copied'
    ? Check
    : shareStatus === 'error'
      ? AlertCircle
      : Share2;
  const shareLabel = shareStatus === 'copied'
    ? 'Link copied'
    : shareStatus === 'error'
      ? 'Could not copy link'
      : 'Copy shareable view link';

  return (
    <nav className="modern-header" style={{
      minHeight: '60px',
      padding: '0 30px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'relative',
      zIndex: 1001,
    }}>
      {/* Logo and Title */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '15px'
      }}>
        <img 
          src={process.env.PUBLIC_URL + '/COSPPaC_white_crop2.png'} 
          alt="COSPPaC Logo" 
          height="35" 
          style={{ 
            filter: 'brightness(0) saturate(100%) invert(100%)',
            transition: 'filter 0.3s ease'
          }}
        />
        <div>
          <h1 className="modern-header__title" style={{
            margin: 0,
            color: '#00d4ff',
            fontSize: '1.5rem',
            fontWeight: '700',
            textShadow: '0 2px 4px rgba(0,0,0,0.3)',
            background: 'linear-gradient(45deg, #00d4ff, #90e0ef)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text'
          }}>
            Cook Islands Wave and Inundation Forecast System
          </h1>
          <p style={{
            margin: 0,
            color: 'rgba(255,255,255,0.8)',
            fontSize: '0.9rem',
            fontWeight: '300'
          }}>
            Marine Forecasting • Pacific Community (SPC) Data
          </p>
        </div>
      </div>

      {/* Controls */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '20px'
      }}>
        {onShareView && (
          <div className="modern-header__share-wrap">
            <button
              type="button"
              className={`modern-header__share-btn modern-header__share-btn--${shareStatus}`}
              onClick={handleShare}
              disabled={shareStatus === 'working'}
              title={shareLabel}
              aria-label={shareLabel}
            >
              <ShareIcon size={17} aria-hidden="true" />
            </button>
            <span className="modern-header__share-status" aria-live="polite">
              {shareStatus === 'copied' || shareStatus === 'error' ? shareLabel : ''}
            </span>
          </div>
        )}
        <ThemeToggle />

        {/* Forecast status: when the forecast last updated (not a "live" connection light) */}
        {(() => {
          const now = currentTime.getTime();
          const runAgeHours = modelRunAgeHours(modelRunStart, now);
          const updateAgeHours = modelRunAgeHours(updatedAt, now);
          const { state } = updateFreshness(updateAgeHours, runAgeHours);
          const f = FRESHNESS[state];
          const fmt = (d) => (d instanceof Date && Number.isFinite(d.getTime())
            ? formatZoned(d, timeDisplayZone, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
            : null);
          const updated = fmt(updatedAt);
          const modelData = fmt(modelRunStart);
          // Lead with the update time; the model init time is ~16 h earlier even for a fresh
          // forecast, so as an "age" it reads like downtime that never happened.
          const tip = [
            updated && `Forecast updated ${updated} (${formatAge(updateAgeHours)} ago). The system updates every 6 h.`,
            modelData && `Model data: GFS cycle ${modelData}.`,
          ].filter(Boolean).join(' ') || 'The update time of the selected layer is not known.';
          let text = f.word;
          if (updated) text = <>Updated {updated} · {formatAge(updateAgeHours)} ago · <b style={{ color: f.color }}>{f.word}</b></>;
          else if (modelData) text = <>Model data {modelData} · <b style={{ color: f.color }}>{f.word}</b></>;
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} role="status" data-testid="forecast-status" title={tip}>
              <div aria-hidden="true" style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: f.color, boxShadow: `0 0 6px ${f.glow}` }} />
              <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.78)' }}>
                {text}
              </span>
              <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)', marginLeft: '10px' }}>
                {formatDateTime(currentTime)}
              </span>
            </div>
          );
        })()}
      </div>

      {/* Add the pulse animation as a style tag */}
      <style dangerouslySetInnerHTML={{__html: `
        .pulse-dot {
          animation: pulse-animation 2s infinite;
        }
        @keyframes pulse-animation {
          0% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.2); opacity: 0.7; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}} />
    </nav>
  );
};

export default ModernHeader;
