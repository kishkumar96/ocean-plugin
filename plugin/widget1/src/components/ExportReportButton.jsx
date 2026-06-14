import React, { useState, useRef } from 'react';
import { FileDown, Loader } from 'lucide-react';
import { exportSuitabilityPDF } from '../utils/SuitabilityPDFExporter';

const STYLES = {
  btn: {
    display:        'flex',
    alignItems:     'center',
    gap:            '6px',
    padding:        '6px 14px',
    background:     'linear-gradient(135deg, #1e3a5f 0%, #2e5266 100%)',
    borderWidth:    '1px',
    borderStyle:    'solid',
    borderColor:    'rgba(0,212,255,0.35)',
    borderRadius:   '8px',
    color:          '#00d4ff',
    fontSize:       '0.82rem',
    fontWeight:     '600',
    cursor:         'pointer',
    transition:     'all 0.2s ease',
    whiteSpace:     'nowrap',
    letterSpacing:  '0.02em',
  },
  btnHover: {
    background:     'linear-gradient(135deg, #2e5266 0%, #3e7b69 100%)',
    borderColor:    'rgba(0,212,255,0.7)',
    boxShadow:      '0 0 12px rgba(0,212,255,0.25)',
  },
  btnDisabled: {
    opacity:   0.6,
    cursor:    'not-allowed',
  },
  toast: {
    position:       'fixed',
    bottom:         '24px',
    right:          '24px',
    background:     '#161b22',
    borderWidth:    '1px',
    borderStyle:    'solid',
    borderColor:    '#30363d',
    borderRadius:   '10px',
    padding:        '12px 18px',
    color:          '#e6edf3',
    fontSize:       '0.82rem',
    zIndex:         9999,
    display:        'flex',
    alignItems:     'center',
    gap:            '10px',
    boxShadow:      '0 8px 24px rgba(0,0,0,0.4)',
    minWidth:       '220px',
  },
  toastDot: {
    width:        '8px',
    height:       '8px',
    borderRadius: '50%',
    flexShrink:   0,
  },
};

export default function ExportReportButton({
  mapRef,
  timeIndex    = 0,
  validTime    = null,
  runId        = null,
  suitabilityBaseUrl = '',
  selectedVessel = 'small_craft',
}) {
  const [busy,      setBusy]      = useState(false);
  const [busyMode,  setBusyMode]  = useState(null);   // 'pdf' | 'poster'
  const [status,    setStatus]    = useState('');
  const [hoverPdf,  setHoverPdf]  = useState(false);
  const [toastOk,   setToastOk]   = useState(false);
  const toastTimer = useRef(null);

  const showToast = (msg, ok = true) => {
    setStatus(msg);
    setToastOk(ok);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setStatus(''), 4000);
  };

  const handleExportPdf = async () => {
    if (busy) return;
    setBusy(true);
    setBusyMode('pdf');
    setStatus('Starting...');
    try {
      const mapEl = mapRef?.current
        ? mapRef.current.closest?.('.leaflet-container') ?? mapRef.current
        : document.querySelector('.leaflet-container');
      await exportSuitabilityPDF({
        mapElement: mapEl, timeIndex, validTime, runId,
        suitabilityBaseUrl, selectedVessel,
        publicUrl: process.env.PUBLIC_URL ?? '',
        onProgress: setStatus,
      });
      showToast('Report exported successfully', true);
    } catch (err) {
      console.error('PDF export failed:', err);
      showToast('Export failed - check console', false);
    } finally {
      setBusy(false);
      setBusyMode(null);
    }
  };

  const pdfBtnStyle = {
    ...STYLES.btn,
    ...(hoverPdf && !busy ? STYLES.btnHover : {}),
    ...(busy ? STYLES.btnDisabled : {}),
  };
  const isBusy = (mode) => busy && busyMode === mode;

  return (
    <>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <button
          style={pdfBtnStyle}
          onClick={handleExportPdf}
          disabled={busy}
          onMouseEnter={() => setHoverPdf(true)}
          onMouseLeave={() => setHoverPdf(false)}
          title="Export 4-page operational advisory PDF"
          aria-label="Export operational advisory PDF"
        >
          {isBusy('pdf')
            ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />
            : <FileDown size={14} />
          }
          {isBusy('pdf') ? (status || 'Exporting...') : 'Export Advisory'}
        </button>

        {/* <button
          style={posterBtnStyle}
          onClick={handleExportPoster}
          disabled={busy}
          onMouseEnter={() => setHoverPost(true)}
          onMouseLeave={() => setHoverPost(false)}
          title="Export competition poster — Same Ocean. Different Risk."
          aria-label="Export story poster"
        >
          {isBusy('poster')
            ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />
            : <Presentation size={14} />
          }
          {isBusy('poster') ? (status || 'Rendering...') : 'Export Story Poster'}
        </button> */}
      </div>

      {/* Toast notification */}
      {status && !busy && (
        <div style={STYLES.toast} role="status" aria-live="polite">
          <div style={{
            ...STYLES.toastDot,
            background: toastOk ? '#10b981' : '#c62828',
            boxShadow:  toastOk ? '0 0 6px rgba(16,185,129,0.5)' : '0 0 6px rgba(198,40,40,0.5)',
          }} />
          {status}
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </>
  );
}
