import React from 'react';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import CookIslandsImpactPanel from '../CookIslandsImpactPanel';
import { exportCookIslandsImpactInundationPdf } from '../../../utils/CookIslandsImpactInundationPdf';

jest.mock('../ImpactSectorChart', () => () => null);
jest.mock('../ImpactCategoryAccordion', () => () => null);
jest.mock('../../../utils/CookIslandsImpactInundationPdf', () => ({ exportCookIslandsImpactInundationPdf: jest.fn() }));

const block = (n, extra = {}) => ({
  scenario: `block0${n}_2026-09-23_to_2026-09-26`, dateStart: '2026-09-23', dateEnd: '2026-09-26',
  totalLoss: n === 1 ? 1000 : 500, totalExposedBuildings: 3, totalExposedValue: 0, lossesBySector: {},
  sectorReconciles: true, population: { value: null, validated: false }, ...extra,
});
const AREAS = { 1: [6.2575, 4.3626, 4.1269, 3.8995], 2: [12.45, 8.6429, 8.1677, 7.6897] };
const summary = (blockIdx) => ({
  cycle_id: '2026092306', block: blockIdx, depth_threshold_m: 0.05, default_margin_cm: 17.5,
  levels: [0, 15, 17.5, 20].map((cm, i) => ({
    margin_above_mhws_cm: cm, filter_elevation_m_msl: 0.328 + cm / 100, area_inundated_ha: AREAS[blockIdx][i],
    outside_districts_ha: 0,
    districts: [{ cdid: '05', district_name: 'avatiu valley', area_inundated_ha: 0.5 + i }],
  })),
});
const data = {
  loading: false, error: null,
  result: { cycleId: '2026092306', label: 'Cook Islands', blocks: [block(1), block(2)] },
  districts: { districts: { districts: [
    { districtId: '05', districtName: 'avatiu valley', scenario: block(1).scenario, totalLoss: 900, totalExposedBuildings: 2 },
  ] } },
};

describe('CookIslandsImpactPanel: area above each MHWS water mark', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    exportCookIslandsImpactInundationPdf.mockResolvedValue('report.pdf');
    global.fetch = jest.fn((url) => {
      const b = Number(/block=(\d)/.exec(url)[1]);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(summary(b)) });
    });
  });
  afterEach(() => { delete global.fetch; });

  it('adds one area column per water mark to the forecast-window table', async () => {
    render(<CookIslandsImpactPanel data={data} />);
    const table = screen.getByRole('grid', { name: 'Impact by forecast window' });
    for (const label of ['MHWS', '+15 cm', '+17.5 cm', '+20 cm']) {
      expect(within(table).getByRole('columnheader', { name: new RegExp(`^${label.replace('+', '\\+')}`) })).toBeInTheDocument();
    }
    await waitFor(() => expect(within(table).getByText('4.13 ha')).toBeInTheDocument());
    expect(within(table).getByText('6.26 ha')).toBeInTheDocument();
    expect(within(table).getByText('3.90 ha')).toBeInTheDocument();
    expect(within(table).getByText('8.64 ha')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith('/cok/inundation/latest/mhws-adjusted/summary?block=1&min_depth_m=0.1');
    expect(global.fetch).toHaveBeenCalledWith('/cok/inundation/latest/mhws-adjusted/summary?block=2&min_depth_m=0.1');
  });

  it('explains the water marks: datum, working mark, depth cut-off, and that this is land area not damage', async () => {
    render(<CookIslandsImpactPanel data={data} />);
    expect(screen.getByText(/0\.328 m above/)).toBeInTheDocument();
    expect(screen.getByText(/MHWS \+ 17\.5 cm \(0\.503 m\)/)).toBeInTheDocument();
    expect(screen.getByText(/at least 10 cm/)).toBeInTheDocument();
    expect(screen.getByText(/land area, not RiskScape/)).toBeInTheDocument();
    const table = screen.getByRole('grid', { name: 'Impact by forecast window' });
    expect(within(table).getByRole('columnheader', { name: /working mark/ })).toBeInTheDocument();
    await screen.findAllByText('4.13 ha');
  });

  it('says how much flooded land the district rows do not cover', async () => {
    render(<CookIslandsImpactPanel data={data} />);
    expect(await screen.findByText(/District rows list only districts with modelled damage/)).toBeInTheDocument();
    expect(screen.getByText(/is elsewhere/)).toBeInTheDocument();
  });

  it('shows per-district areas for the selected window', async () => {
    render(<CookIslandsImpactPanel data={data} />);
    const table = screen.getByRole('grid', { name: 'Impact by district' });
    await waitFor(() => expect(within(table).getByText('2.50 ha')).toBeInTheDocument());
    expect(within(table).getByText('0.50 ha')).toBeInTheDocument();
  });

  it('refetches at 5 cm depth when toggled', async () => {
    render(<CookIslandsImpactPanel data={data} />);
    await screen.findAllByText('4.13 ha');
    fireEvent.click(screen.getByRole('button', { name: /5 cm/ }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/cok/inundation/latest/mhws-adjusted/summary?block=1&min_depth_m=0.05'));
  });

  it('keeps the RiskScape table and shows the error when the summary is unavailable', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) }));
    render(<CookIslandsImpactPanel data={data} />);
    expect(await screen.findByText(/Not available in this deployment yet/)).toBeInTheDocument();
    expect(screen.getByRole('grid', { name: 'Impact by forecast window' })).toBeInTheDocument();
  });

  it('hides the area columns when the hazard cycle differs from the impact cycle', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true, status: 200, json: () => Promise.resolve({ ...summary(1), cycle_id: '2026092312' }),
    }));
    render(<CookIslandsImpactPanel data={data} />);
    expect(await screen.findByText(/the hazard run \(2026092312\) is newer than this impact estimate \(2026092306\)/)).toBeInTheDocument();
    expect(screen.queryByText('4.13 ha')).toBeNull();
    // no empty dash columns, and no depth toggle that would do nothing
    expect(screen.queryByRole('columnheader', { name: /17\.5 cm/ })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Minimum flood depth' })).toBeNull();
  });

  it('exports a report with the selected impact window and only cycle-matched inundation summaries', async () => {
    render(<CookIslandsImpactPanel data={data} />);
    await screen.findAllByText('4.13 ha');
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    await waitFor(() => expect(exportCookIslandsImpactInundationPdf).toHaveBeenCalledWith(expect.objectContaining({
      impact: data.result,
      selected: expect.objectContaining({ scenario: block(1).scenario }),
      selectedSummary: expect.objectContaining({ cycleId: '2026092306' }),
      summariesByScenario: expect.objectContaining({ [block(1).scenario]: expect.objectContaining({ cycleId: '2026092306' }) }),
    })));
  });

  it('drops the previous depth’s values while the new depth loads', async () => {
    render(<CookIslandsImpactPanel data={data} />);
    await screen.findAllByText('4.13 ha');
    let release;
    global.fetch = jest.fn(() => new Promise((res) => { release = () => res({ ok: true, status: 200, json: () => Promise.resolve(summary(1)) }); }));
    fireEvent.click(screen.getByRole('button', { name: /5 cm/ }));
    expect(screen.queryByText('4.13 ha')).toBeNull();
    release?.();
  });

  it('reports the flood geometry for the selected window when a parent asks (mobile sheet)', async () => {
    const onMhwsResult = jest.fn();
    global.fetch = jest.fn((url) => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve(/summary/.test(url)
        ? summary(1)
        : { ...summary(1).levels[2], cycle_id: '2026092306', block: 1, geometry: { type: 'Polygon', coordinates: [] } }),
    }));
    render(<CookIslandsImpactPanel data={data} onMhwsResult={onMhwsResult} />);
    await waitFor(() => expect(onMhwsResult.mock.calls.some(([r]) => r?.geometry)).toBe(true));
    expect(global.fetch).toHaveBeenCalledWith('/cok/inundation/latest/mhws-adjusted?block=1&min_depth_m=0.1');
  });

  describe('Port assets', () => {
    const portFeature = (scenario, loss) => ({ properties: { asset: 'Port', total_loss: loss, scenario } });
    const withAssets = () => ({
      ...data,
      result: { ...data.result, blocks: [
        block(1, { totalLoss: 1000000, lossesBySector: { infrastructure: 1000000 } }),
        block(2, { totalLoss: 500, lossesBySector: { infrastructure: 500 } }),
      ] },
      assets: { loading: false, error: null, geojson: { features: [portFeature(block(1).scenario, 800000), portFeature(block(1).scenario, 100000)] } },
    });

    it('states the Port share and lets the figures be shown without it', async () => {
      render(<CookIslandsImpactPanel data={withAssets()} />);
      expect(await screen.findByText(/Port assets \(wharf, marina, jetty\) are \$900K/)).toBeInTheDocument();
      expect(screen.getByText(/land-area columns further down are not affected/)).toBeInTheDocument();
      expect(screen.getAllByText('$1.00M').length).toBeGreaterThanOrEqual(2);
      fireEvent.click(screen.getByRole('checkbox', { name: /Exclude Port assets/ }));
      expect(screen.getAllByText('$100K').length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText('Estimated damage (excl. Port)')).toBeInTheDocument();
      expect(screen.queryByText('$1.00M')).toBeNull();
    });

    it('shows no Port note when the window has no Port loss', async () => {
      const d = withAssets();
      d.assets = { loading: false, error: null, geojson: { features: [] } };
      render(<CookIslandsImpactPanel data={d} />);
      await screen.findAllByText('4.13 ha');
      expect(screen.queryByText(/Exclude Port assets/)).toBeNull();
    });
  });
});
