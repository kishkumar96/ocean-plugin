import {
  cleanAssetDetails,
  normalizeImpactAssetsResponse,
  groupImpactAssetUnits,
  topImpactAssetUnits,
  summarizeImpactAssetTypes,
} from '../cookIslandsImpactService';

const feature = (props) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-159.78, -21.2] },
  properties: { scenario: 'block01', sector: 'Infrastructure', ...props },
});

const build = (rows) => normalizeImpactAssetsResponse({ features: rows.map(feature) }).features;

describe('cleanAssetDetails', () => {
  it('drops the "nan" placeholders RiskScape joins into Details', () => {
    expect(cleanAssetDetails('Nan ; nan')).toBeNull();
    expect(cleanAssetDetails('White brick office ; nan ; nan ; nan')).toBe('White brick office');
    expect(cleanAssetDetails('Turangi Bridge')).toBe('Turangi Bridge');
    expect(cleanAssetDetails('')).toBeNull();
    expect(cleanAssetDetails(null)).toBeNull();
  });
});

describe('groupImpactAssetUnits', () => {
  const rows = [
    // one wharf split into 3 segments -- loss is per segment
    ...[100, 200, 300].map((loss, i) => ({ asset: 'Port', use_type: 'Wharf', sub_use: 'international', details: 'Avatiu Ports', total_loss: loss, hazard: i + 1, original_value: 1e7 })),
    // two distinct unnamed buildings must stay separate
    { asset: 'Building', use_type: 'Residential', details: 'Nan ; nan', total_loss: 250, hazard: 0.6, loss_ratio: 0.15 },
    { asset: 'Building', use_type: 'Residential', details: 'Nan ; nan', total_loss: 50, hazard: 0.2, loss_ratio: 0.02 },
    // unnamed segmented network merges into one unit
    ...[5, 5].map((loss) => ({ asset: 'Waterpipe', use_type: 'Ringmain', details: '', total_loss: loss, hazard: 0.1 })),
    { asset: 'Population', use_type: 'N/A', total_loss: null, hazard: 0.7 },
  ];
  const units = groupImpactAssetUnits(build(rows));

  it('counts assets, not segments, and skips population', () => {
    expect(units).toHaveLength(4);
    expect(units.some((u) => u.asset === 'Population')).toBe(false);
  });

  it('sums segment loss and keeps the worst segment as the map target', () => {
    const port = units.find((u) => u.asset === 'Port');
    expect(port.totalLoss).toBe(600);
    expect(port.segmentCount).toBe(3);
    expect(port.maxDepth).toBe(3);
    expect(port.label).toBe('Avatiu Ports');
    expect(port.representative.properties.totalLoss).toBe(300);
  });

  it('ranks by summed loss', () => {
    expect(topImpactAssetUnits(units, 2).map((u) => u.label)).toEqual(['Avatiu Ports', 'Residential #1']);
    expect(topImpactAssetUnits(units, 10).every((u) => u.totalLoss > 0)).toBe(true);
  });

  it('rolls up per asset type', () => {
    const types = summarizeImpactAssetTypes(units);
    expect(types.find((t) => t.asset === 'Building')).toMatchObject({ label: 'Buildings', count: 2, loss: 300 });
    expect(types.find((t) => t.asset === 'Port')).toMatchObject({ count: 1, loss: 600 });
    expect(types.find((t) => t.asset === 'Waterpipe')).toMatchObject({ label: 'Water pipes', count: 1, loss: 10 });
    expect(types.find((t) => t.asset === 'Building').units.map((u) => u.totalLoss)).toEqual([250, 50]);
  });
});
