import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, within, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ImpactTabPanel from '../ImpactTabPanel';
import { normalizeImpactAssetsResponse } from '../../../services/cookIslandsImpactService';

// The doughnut needs a real canvas; irrelevant to what is tested here.
jest.mock('../ImpactSectorChart', () => () => <div data-testid="sector-chart" />);

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
  it('leads with exposure, then aggregated information, then the lists', () => {
    const { container } = renderPanel();
    const text = container.textContent;
    const order = ['Exposure', 'Buildings exposed', 'Aggregated information', 'Estimated economic damage', 'Most damaged assets'];
    const positions = order.map((label) => text.indexOf(label));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
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
