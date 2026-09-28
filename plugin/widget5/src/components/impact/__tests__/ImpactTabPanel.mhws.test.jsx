/* eslint-disable testing-library/no-node-access */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ImpactTabPanel from '../ImpactTabPanel';
import block01 from '../../../services/__tests__/mhwsInundationBlock01.fixture.json';

jest.mock('../ImpactSectorChart', () => () => null);

const block = (n, extra = {}) => ({
  scenario: `block0${n}_2026-09-23_to_2026-09-26`, dateStart: '2026-09-23', dateEnd: '2026-09-26',
  totalLoss: 0, totalExposedBuildings: 0, totalExposedValue: 0, lossesBySector: {}, ...extra,
});
const data = (cycleId = '2026092306') => ({ loading: false, error: null, result: { cycleId, blocks: [block(1), block(2)] } });
const props = (overrides = {}) => ({
  data: data(), assets: { loading: false, error: null, geojson: { features: [] } },
  districts: { loading: false, error: null, districts: { districts: [] } }, ...overrides,
});

const okResponse = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });

describe('ImpactTabPanel: area inundated above MHWS', () => {
  beforeEach(() => { global.fetch = jest.fn(() => okResponse(block01)); });
  afterEach(() => { delete global.fetch; });

  it('fetches the block matching the selected window and shows real live-payload numbers', async () => {
    render(<ImpactTabPanel {...props()} />);
    expect(await screen.findByText('4.13 ha')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith('/cok/inundation/latest/mhws-adjusted?block=1&min_depth_m=0.1');
    expect(screen.getByText('akaoa arorangi')).toBeInTheDocument();
    expect(screen.getByText('Area inundated above MHWS + 17.5 cm')).toBeInTheDocument();
    expect(screen.getByText(/0\.503 m above MSL/)).toBeInTheDocument();
    expect(screen.getByText(/Outside census districts/)).toBeInTheDocument();
    expect(screen.getByText('3.28 ha')).toBeInTheDocument();
    expect(screen.queryByText(/differs from the impact estimate/)).toBeNull();
  });

  it('refetches with the 5 cm threshold when toggled', async () => {
    render(<ImpactTabPanel {...props()} />);
    await screen.findByText('4.13 ha');
    fireEvent.click(screen.getByRole('button', { name: /5 cm/ }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/cok/inundation/latest/mhws-adjusted?block=1&min_depth_m=0.05'));
  });

  it('flags a hazard/impact cycle mismatch instead of silently pairing them', async () => {
    render(<ImpactTabPanel {...props({ data: data('2026092212') })} />);
    expect(await screen.findByText(/differs from the impact estimate/)).toBeInTheDocument();
  });

  it('shows a readable message when the endpoint is not deployed (404)', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ detail: 'Not Found' }) }));
    render(<ImpactTabPanel {...props()} />);
    expect(await screen.findByText('Not available in this deployment yet.')).toBeInTheDocument();
  });

  it('states the Port share right under the damage headline, with the figure excluding Port', async () => {
    const d = { loading: false, error: null, result: { cycleId: '2026092306', blocks: [block(1, { totalLoss: 1000000 }), block(2)] } };
    const feats = [{ properties: { asset: 'Port', total_loss: 800000, scenario: block(1).scenario } }];
    render(<ImpactTabPanel {...props({ data: d, assets: { loading: false, error: null, geojson: { features: feats } } })} />);
    expect(await screen.findByText(/80% \(\$800K\) is Port assets, likely overstated/)).toBeInTheDocument();
    expect(screen.getByText('$200K')).toBeInTheDocument();
  });

  it('leads with a summary of buildings, population and damage for the selected window', async () => {
    const d = { loading: false, error: null, result: { cycleId: '2026092306', blocks: [block(1, { totalLoss: 1500000, totalExposedBuildings: 3, population: { value: 0, validated: true } }), block(2)] } };
    render(<ImpactTabPanel {...props({ data: d })} />);
    expect(screen.getByText('Buildings')).toBeInTheDocument();
    expect(screen.getByText('Population')).toBeInTheDocument();
    expect(screen.getByText('Est. damage')).toBeInTheDocument();
    expect(screen.getAllByText('$1.50M').length).toBeGreaterThanOrEqual(1);
    await screen.findAllByText('4.13 ha');
  });

  it('keeps the land-area analysis available but as an advanced, folded section', async () => {
    render(<ImpactTabPanel {...props()} />);
    const summary = screen.getByText(/Advanced: land flooded above the tide line/);
    expect(summary.closest('details')).not.toHaveAttribute('open');
    await screen.findByText('4.13 ha'); // still rendered inside the fold
  });
});
