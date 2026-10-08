// HTML for the browser "Print / Save as PDF" chart pages. Shared so every chart
// print carries the same provenance block (what/where/when/how) and the same
// model-guidance disclaimer, instead of being a bare screenshot of the chart.
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// meta: [[label, value], ...]; null/empty values are dropped. Values are escaped.
export function buildChartPrintHtml({ title, svgDataUrl, alt, meta = [], stats = '', disclaimer, generatedUtc = new Date() }) {
  const rows = meta
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`)
    .join('');
  const stamp = generatedUtc.toISOString().slice(0, 16).replace('T', ' ');
  return `<!DOCTYPE html><html><head>
        <title>${escapeHtml(title)}</title>
        <style>
          body { margin: 20px; font-family: Inter, system-ui, sans-serif; color: #0f172a; }
          h2 { margin: 0 0 6px; font-size: 16px; }
          table.meta { border-collapse: collapse; font-size: 12px; margin: 4px 0 8px; }
          table.meta th { text-align: left; font-weight: 600; color: #475569; padding: 1px 14px 1px 0; vertical-align: top; white-space: nowrap; }
          table.meta td { padding: 1px 0; }
          img { max-width: 100%; margin-top: 10px; display: block; }
          .footer { margin-top: 12px; font-size: 11px; color: #64748b; }
          @media print { body { margin: 0; } }
        </style>
      </head><body>
        <h2>${escapeHtml(title)}</h2>
        <table class="meta">${rows}</table>
        ${stats}
        <img src="${svgDataUrl}" alt="${escapeHtml(alt ?? title)}" />
        <div class="footer">${escapeHtml(disclaimer)}<br/>Generated ${stamp} UTC</div>
        <script>window.onload = function() { window.print(); };</script>
      </body></html>`;
}
