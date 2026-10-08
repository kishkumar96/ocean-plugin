import { buildChartPrintHtml, escapeHtml } from '../chartPrintHtml';

describe('buildChartPrintHtml', () => {
  const base = { title: 'Landing <Area>', svgDataUrl: 'data:image/svg+xml;base64,AA==', disclaimer: 'Model guidance.', generatedUtc: new Date('2026-09-24T02:30:00Z') };

  test('includes provenance rows, disclaimer and generation time; drops empty values', () => {
    const html = buildChartPrintHtml({ ...base, meta: [['Site', 'Avatiu'], ['Model run', ''], ['Vessel', null], ['Location (lat, lon)', '-21.2000, -159.7800']] });
    expect(html).toMatch(/<th>Site<\/th><td>Avatiu<\/td>/);
    expect(html).toMatch(/-21\.2000, -159\.7800/);
    expect(html).not.toMatch(/Model run|Vessel/);
    expect(html).toMatch(/Model guidance\./);
    expect(html).toMatch(/Generated 2026-09-24 02:30 UTC/);
  });

  test('escapes titles and values', () => {
    const html = buildChartPrintHtml({ ...base, meta: [['Site', '<script>x</script>']] });
    expect(html).toMatch(/<title>Landing &lt;Area&gt;<\/title>/);
    expect(html).not.toMatch(/<td><script>x/);
    expect(escapeHtml(`a&b"c'`)).toBe('a&amp;b&quot;c&#39;');
  });
});
