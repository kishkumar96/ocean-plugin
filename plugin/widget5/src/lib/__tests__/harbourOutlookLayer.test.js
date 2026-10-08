import { buildHarbourOutlookFeatures, harbourPopupHtml, verdictState, harbourIconId } from '../harbourOutlookLayer';
import { INCOMPLETE } from '../../config/cookIslandsHarbourLimits';

const harbour = (over = {}) => ({
  riskPointId: 29, name: 'Avatiu Harbour', island: 'Rarotonga', lon: -159.7856, lat: -21.1978, available: true,
  verdictNow: 0, verdict24h: 2, hsM: 0.8, max24HsM: 1.9, missing24Hours: 0, windKt: 12, tpS: 9.5, dirDeg: 75, dirPoint: 'ENE',
  cause: 'Wave height 1.9 m vs stop 1.5 m', windowText: 'Within limits until Thu 14:00', nodeFar: false, nodeDistanceKm: 0.6,
  ...over,
});
const bundle = (harbours, over = {}) => ({ judged: true, basis: 'provisional', harbours, ...over });

describe('buildHarbourOutlookFeatures', () => {
  test('one badge per harbour: fill = now, ring = next 24 h', () => {
    const fc = buildHarbourOutlookFeatures(bundle([harbour()]));
    expect(fc.features).toHaveLength(1);
    const f = fc.features[0];
    expect(f.geometry.coordinates).toEqual([-159.7856, -21.1978]);
    expect(f.properties).toMatchObject({ riskPointId: 29, name: 'Avatiu Harbour', nowState: 'ok', nextState: 'stop', icon: harbourIconId('ok', 'stop') });
  });

  test('no limits, or no data: a neutral badge, never a green one', () => {
    expect(buildHarbourOutlookFeatures(bundle([harbour()], { judged: false })).features[0].properties.icon).toBe('cok-harbour-none-none');
    expect(buildHarbourOutlookFeatures(bundle([harbour({ available: false })])).features[0].properties.icon).toBe('cok-harbour-none-none');
  });

  test('worse states sort on top where badges collide', () => {
    const fc = buildHarbourOutlookFeatures(bundle([
      harbour({ riskPointId: 1, verdictNow: 0, verdict24h: 0 }),
      harbour({ riskPointId: 2, verdictNow: 2, verdict24h: 2 }),
    ]));
    expect(fc.features[1].properties.sortKey).toBeGreaterThan(fc.features[0].properties.sortKey);
  });

  test('incomplete has its own state and nothing is placed without coordinates', () => {
    expect(verdictState(INCOMPLETE)).toBe('incomplete');
    expect(buildHarbourOutlookFeatures(bundle([harbour({ lon: undefined })])).features).toHaveLength(0);
    expect(buildHarbourOutlookFeatures(null).features).toEqual([]);
  });
});

describe('harbourPopupHtml', () => {
  test('verdicts in provisional wording, with cause, window and the numbers', () => {
    const html = harbourPopupHtml(harbour(), bundle([]));
    expect(html).toContain('Avatiu Harbour');
    expect(html).toContain('Within provisional limits');
    expect(html).toContain('Over provisional stop limit');
    expect(html).toContain('Cause:</span> Wave height 1.9 m vs stop 1.5 m');
    expect(html).toContain('Within limits until Thu 14:00');
    expect(html).toContain('0.8 m');
    expect(html).toContain('ENE 75°');
    expect(html).toContain('PROVISIONAL limits, not approved');
  });

  test('approved limits use the plain words and no provisional note', () => {
    const html = harbourPopupHtml(harbour(), bundle([], { basis: 'approved' }));
    expect(html).toContain('>OK</span>'.replace('>OK', 'OK'));
    expect(html).toContain('Stop');
    expect(html).not.toContain('PROVISIONAL');
  });

  test('unavailable location shows the reason; names are escaped', () => {
    const html = harbourPopupHtml(harbour({ available: false, unavailableReason: 'No step <near> now', name: 'A & B' }), bundle([]));
    expect(html).toContain('No step &lt;near&gt; now');
    expect(html).toContain('A &amp; B');
  });
});
