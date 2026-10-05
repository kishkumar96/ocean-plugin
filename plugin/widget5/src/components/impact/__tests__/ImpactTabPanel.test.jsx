/* eslint-disable testing-library/no-node-access */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, within, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ImpactTabPanel from '../ImpactTabPanel';
import { normalizeImpactAssetsResponse } from '../../../services/cookIslandsImpactService';

// The doughnut needs a real canvas; irrelevant to what is tested here.
jest.mock('../ImpactSectorChart', () => () => <div data-testid="sector-chart" />);

// This file doesn't test MHWS behaviour (see ImpactTabPanel.mhws.test.jsx for that), but
// ImpactTabPanel always mounts both useMhwsSummaries and a child MhwsInundationSection,
// each firing its own fetch on mount/prop-change. Rather than guess how many ticks it takes
// each of those independent chains to settle (a fixed-delay flush proved unreliable -- it
// made the warning count worse, not better, because MhwsInundationSection refetches on
// every scenario-prop change some of these tests trigger), give both a fetch that never
// resolves: matches the pattern CookIslandsSuitabilityReadinessCard.test.jsx already uses
// for the same reason. Nothing here asserts on MHWS data, so leaving it perpetually
// "loading" is harmless -- and a promise that never settles can never update state outside
// act() after the test (and RTL's auto-unmount) has already moved on.
beforeEach(() => { global.fetch = jest.fn(() => new Promise(() => {})); });
afterEach(() => { delete global.fetch; });

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../services/__tests__/impactAssetsBlock01.fixture.json'), 'utf8'));
const geojson = normalizeImpactAssetsResponse(fixture);
const scenario = 'block01_2026-09-20_to_2026-09-23';

const data = {
  loading: false,
  error: null,
  result: {
    cycleId: '2026092006',
    label: 'forecast impact estimate',
    blocks: [{
      scenario, dateStart: '2026-09-20', dateEnd: '2026-09-23',
      totalLoss: 1558570, totalExposedValue: 9051907, totalExposedBuildings: 9,
      population: { value: 0, validated: true },
      lossesBySector: { education: 0, infrastructure: 1305942, productive: 18451, public: 0, residential: 234177, other: 0 },
    }],
  },
};

function renderPanel(props = {}) {
  return render(
    <ImpactTabPanel
      data={data}
      assets={{ loading: false, error: null, geojson }}
      onWindowSelect={() => {}}
      onScenarioChange={() => {}}
      {...props}
    />
  );
}

describe('ImpactTabPanel', () => {
  it('leads with the summary, then hazard, exposure and impact in causal order, then the lists', () => {
    const { container } = renderPanel();
    const text = container.textContent;
    // the sticky summary (buildings, population, damage) leads; the detail sections follow in order
    const order = ['Buildings', 'Population', '1 · Hazard', '2 · Exposure', 'Exposed assets by type', '3 · Impact', 'Estimated economic damage', 'Most damaged assets'];
    const positions = order.map((label) => text.indexOf(label));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('keeps depth (hazard), counts and values (exposure) and dollars (impact) in their own sections', () => {
    renderPanel();
    const section = (n) => screen.getByText(new RegExp(`^${n} · `)).parentElement.parentElement;
    expect(within(section(1)).getByText(/^Deepest flooding at an exposed asset/)).toBeInTheDocument();
    expect(within(section(1)).queryByText('Estimated economic damage')).not.toBeInTheDocument();
    expect(within(section(2)).getByText('Buildings exposed')).toBeInTheDocument();
    expect(within(section(2)).getByText('Total exposed asset value')).toBeInTheDocument();
    expect(within(section(2)).queryByText('Estimated economic damage')).not.toBeInTheDocument();
    expect(within(section(3)).getByText('Estimated economic damage')).toBeInTheDocument();
    expect(within(section(3)).queryByText('Buildings exposed')).not.toBeInTheDocument();
  });

  it('the hazard depth leaves out port segments, which sample harbour water, not flooding', () => {
    const feats = [
      { type: 'Feature', id: 1, geometry: { type: 'Point', coordinates: [0, 0] }, properties: { asset: 'Port', use_type: 'Wharf', details: 'Avatiu', hazard: 9.5, total_loss: 1000, scenario: data.result.blocks[0].scenario } },
      { type: 'Feature', id: 2, geometry: { type: 'Point', coordinates: [0, 0] }, properties: { asset: 'Building', use_type: 'Residential', hazard: 0.42, total_loss: 50, scenario: data.result.blocks[0].scenario } },
    ];
    renderPanel({ assets: { loading: false, error: null, geojson: normalizeImpactAssetsResponse({ features: feats }) } });
    const row = screen.getByText('Deepest flooding at an exposed asset (excluding ports)').parentElement;
    expect(row).toHaveTextContent('0.4 m');
    expect(row).not.toHaveTextContent('9.5 m');
  });

  it('expands an asset type to its assets and shows the top damaged assets once per port', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Ports/ }));
    expect(screen.getAllByText('Avatiu Ports - International (main port)').length).toBeGreaterThanOrEqual(2);
    const top = screen.getByText('Most damaged assets').parentElement.parentElement;
    expect(within(top).getAllByText('Avatiu Ports - International (main port)')).toHaveLength(1);
  });


  describe('when nothing is impacted', () => {
    const zeroBlock = (n, d) => ({
      scenario: `block0${n}_2026-09-${d}`, dateStart: `2026-09-${d}`, dateEnd: `2026-09-${d}`,
      totalLoss: 0, totalExposedValue: 0, totalExposedBuildings: 0,
      population: { value: 0, validated: true },
      lossesBySector: { education: 0, infrastructure: 0, productive: 0, public: 0, residential: 0, other: 0 },
    });
    const zeroData = { ...data, result: { ...data.result, blocks: [zeroBlock(1, 20), zeroBlock(2, 21)] } };
    const emptyAssets = { loading: false, error: null, geojson: { type: 'FeatureCollection', features: [] } };

    it('renders zero windows with a plain no-impact message and no "highest" marker', () => {
      renderPanel({ data: zeroData, assets: emptyAssets });
      expect(screen.getByRole('status')).toHaveTextContent('No assets are forecast to be flooded in this window.');
      expect(screen.getByText('Estimated economic damage').parentElement).toHaveTextContent('$0');
      expect(screen.getByText('No per-asset detail for this window.')).toBeInTheDocument();
      expect(screen.getByText('No assets with modelled damage in this window.')).toBeInTheDocument();
      // All windows tie at zero, so no chip is "the worst"
      expect(screen.queryByText('●')).not.toBeInTheDocument();
    });

    it('does not claim no impact while the asset list is still loading or failed', () => {
      const { unmount } = renderPanel({ data: zeroData, assets: { loading: true, error: null, geojson: null } });
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      unmount();
      renderPanel({ data: zeroData, assets: { loading: false, error: 'boom', geojson: null } });
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('does not show the no-impact message for a window that has impact', () => {
      renderPanel();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('shows the empty state when the run has no windows at all', () => {
      renderPanel({ data: { ...data, result: { ...data.result, blocks: [] } } });
      expect(screen.getByText('No impact assessment available for this forecast cycle yet.')).toBeInTheDocument();
    });
  });

  describe('shared scenario', () => {
    const mk = (n, loss) => ({
      scenario: `s${n}`, dateStart: `2026-09-2${n}`, dateEnd: `2026-09-2${n}`,
      totalLoss: loss, totalExposedValue: loss, totalExposedBuildings: 1,
      population: { value: 0, validated: true },
      lossesBySector: { education: 0, infrastructure: 0, productive: 0, public: 0, residential: loss, other: 0 },
    });
    const two = { ...data, result: { ...data.result, blocks: [mk(1, 100), mk(2, 5000)] } };

    it('opens on the shared window instead of the worst one', () => {
      const onScenarioChange = jest.fn();
      renderPanel({ data: two, initialScenario: 's1', onScenarioChange });
      expect(onScenarioChange).toHaveBeenLastCalledWith('s1');
    });

    it('falls back to the worst window when the shared one is gone', () => {
      const onScenarioChange = jest.fn();
      renderPanel({ data: two, initialScenario: 'old-cycle', onScenarioChange });
      expect(onScenarioChange).toHaveBeenLastCalledWith('s2');
    });
  });
});
