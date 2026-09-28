import {
  cleanAssetDetails,
  normalizeImpactAssetsResponse,
  groupImpactAssetUnits,
  topImpactAssetUnits,
  summarizeImpactAssetTypes,
  mhwsBlockIndexFromScenario,
  normalizeMhwsInundationResponse,
  mhwsFloodFeatureCollection,
  mhwsMarginLabel,
  normalizeMhwsSummaryResponse,
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

describe('mhwsBlockIndexFromScenario', () => {
  it('reads the 1-based hazard block index from an impact window name', () => {
    expect(mhwsBlockIndexFromScenario('block01_2026-09-23_to_2026-09-26')).toBe(1);
    expect(mhwsBlockIndexFromScenario('block02_2026-09-26_to_2026-10-02')).toBe(2);
    expect(mhwsBlockIndexFromScenario('block2')).toBe(2);
  });
  it('returns null for anything that is not a block window', () => {
    expect(mhwsBlockIndexFromScenario(null)).toBeNull();
    expect(mhwsBlockIndexFromScenario('')).toBeNull();
    expect(mhwsBlockIndexFromScenario('block00_x')).toBeNull();
    expect(mhwsBlockIndexFromScenario('nonblock01_x')).toBeNull();
  });
});

describe('normalizeMhwsInundationResponse', () => {
  const payload = {
    cycle_id: '2026092306', block: 1, area_inundated_m2: 18169.9, area_inundated_ha: 1.817,
    area_inundated_km2: 0.01817, depth_threshold_m: 0.05, mhws_elevation_m_msl: 0.328,
    land_mask_source: 'districts', methodology_version: 'mhws-adjusted-v1',
    districts: [
      { cdid: '01', district_name: 'kiikii-ooa', area_inundated_m2: 1.8, area_inundated_ha: 0.0002, percentage_of_total: 0.01 },
      { cdid: '02', district_name: 'akaoa arorangi', area_inundated_m2: 6761.7, area_inundated_ha: 0.676, percentage_of_total: 37.21 },
    ],
  };

  it('maps fields and sorts districts by area, largest first', () => {
    const out = normalizeMhwsInundationResponse(payload);
    expect(out.cycleId).toBe('2026092306');
    expect(out.areaHa).toBe(1.817);
    expect(out.mhwsElevationM).toBe(0.328);
    expect(out.districts.map((d) => d.districtName)).toEqual(['akaoa arorangi', 'kiikii-ooa']);
  });

  it('keeps a missing total as null rather than coercing it to a real 0', () => {
    const out = normalizeMhwsInundationResponse({ ...payload, area_inundated_m2: null, area_inundated_ha: null });
    expect(out.areaM2).toBeNull();
    expect(out.areaHa).toBeNull();
  });

  it('keeps a genuine zero as 0 and tolerates a missing districts list', () => {
    const out = normalizeMhwsInundationResponse({ ...payload, area_inundated_ha: 0, districts: undefined });
    expect(out.areaHa).toBe(0);
    expect(out.districts).toEqual([]);
  });
});

describe('mhwsFloodFeatureCollection', () => {
  const geometry = { type: 'MultiPolygon', coordinates: [[[[-159.8, -21.2], [-159.79, -21.2], [-159.79, -21.19], [-159.8, -21.2]]]] };

  it('keeps the flooded-land geometry through normalization and wraps it for a map source', () => {
    const result = normalizeMhwsInundationResponse({ area_inundated_ha: 1.8, geometry, districts: [] });
    expect(result.geometry).toEqual(geometry);
    const fc = mhwsFloodFeatureCollection(result);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry).toEqual(geometry);
  });

  it('returns an empty collection for a dry window or no result, so the layer clears', () => {
    expect(mhwsFloodFeatureCollection(null).features).toEqual([]);
    expect(mhwsFloodFeatureCollection(normalizeMhwsInundationResponse({ area_inundated_ha: 0, geometry: null })).features).toEqual([]);
  });
});

describe('mhwsMarginLabel', () => {
  it('names the line actually used, so a raised water mark is never labelled plain MHWS', () => {
    expect(mhwsMarginLabel(0.175)).toBe('MHWS + 17.5 cm');
    expect(mhwsMarginLabel(0.15)).toBe('MHWS + 15 cm');
  });
  it('falls back to plain MHWS when there is no margin', () => {
    expect(mhwsMarginLabel(0)).toBe('MHWS');
    expect(mhwsMarginLabel(null)).toBe('MHWS');
    expect(mhwsMarginLabel(undefined)).toBe('MHWS');
  });
  it('carries margin and filter level through normalization', () => {
    const out = normalizeMhwsInundationResponse({ mhws_elevation_m_msl: 0.328, margin_above_mhws_m: 0.175, filter_elevation_m_msl: 0.503, districts: [] });
    expect(out.marginAboveMhwsM).toBe(0.175);
    expect(out.filterElevationM).toBe(0.503);
  });
});

describe('normalizeMhwsSummaryResponse', () => {
  it('maps every water mark to hectares per window and per district', () => {
    const out = normalizeMhwsSummaryResponse({
      cycle_id: '2026092306', block: 1, depth_threshold_m: 0.05, default_margin_cm: 17.5,
      levels: [
        { margin_above_mhws_cm: 0, filter_elevation_m_msl: 0.328, area_inundated_ha: 6.2575, outside_districts_ha: 5.1,
          districts: [{ cdid: '05', district_name: 'avatiu valley', area_inundated_ha: 0.4 }] },
        { margin_above_mhws_cm: 17.5, filter_elevation_m_msl: 0.503, area_inundated_ha: 4.1269, outside_districts_ha: 3.28, districts: [] },
      ],
    });
    expect(out.cycleId).toBe('2026092306');
    expect(out.levels.map((l) => [l.marginCm, l.areaHa])).toEqual([[0, 6.2575], [17.5, 4.1269]]);
    expect(out.levels[0].districts[0]).toEqual({ districtId: '05', districtName: 'avatiu valley', areaHa: 0.4 });
  });

  it('tolerates an empty payload', () => {
    expect(normalizeMhwsSummaryResponse(null).levels).toEqual([]);
  });
});
