import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import CookIslandsLandingAreaComparisonPanel from '../CookIslandsLandingAreaComparisonPanel';
import { __resetCookIslandsAreaTimeseriesAvailabilityForTests } from '../../../lib/CookIslandsSuitabilityOverlay';

// Plotly needs window.URL.createObjectURL (via mapbox-gl), which jsdom
// doesn't provide -- same reason ImpactTabPanel.test.jsx mocks
// ImpactSectorChart rather than exercising the real chart in jsdom.
jest.mock('../CookIslandsLandingAreaTimeseries', () => ({
  __esModule: true,
  default: ({ steps, vesselLabel }) => (
    <div data-testid="landing-area-chart">{vesselLabel}: {steps?.length ?? 0} steps</div>
  ),
}));

beforeEach(() => {
  delete global.fetch;
  __resetCookIslandsAreaTimeseriesAvailabilityForTests();
});

const advice = {
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-159.7833, -21.2039] },
      properties: { name: 'Avatiu Harbour', type: 'landing_site', vessel_class: 'traditional_craft' },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-159.775, -21.2078] },
      properties: { name: 'Avarua Fishing Ground', type: 'fishing_ground', vessel_class: 'traditional_craft' },
    },
  ],
};

function mockAdviceAndArea() {
  global.fetch = jest.fn((url) => {
    if (url.includes('/cok/suitability/advice/0')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(advice) });
    }
    if (url.includes('/cok/suitability/area/timeseries')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          point_count: 2, used_nearest_point_fallback: false,
          steps: [{ time_index: 0, valid_time: '2026-09-20T00:00:00Z', hazard_class: 0 }],
        }),
      });
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  });
}

describe('CookIslandsLandingAreaComparisonPanel', () => {
  // No open/closed state of its own any more -- this panel now only mounts
  // inside BottomOffCanvas's 'landing-area-comparison' mode (see
  // Home.jsx's handleShowLandingAreaComparison), so mounting IS "opened" and
  // the fetch fires immediately.
  it('fetches the advice layer on mount, and shows the heatmap by default', async () => {
    global.fetch = jest.fn((url) => {
      if (url.includes('/cok/suitability/advice/0')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ features: [] }) });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    });
    render(<CookIslandsLandingAreaComparisonPanel vesselClass="traditional_craft" />);
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/cok/suitability/advice/0'));
    expect(await screen.findByText('No named landing or fishing-ground sites in this deployment.')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Compare all' })).toHaveAttribute('aria-selected', 'true');
  });

  it('switches to "This location" and lets the user pick a site from the same fetched data (no second fetch)', async () => {
    mockAdviceAndArea();
    render(<CookIslandsLandingAreaComparisonPanel vesselClass="traditional_craft" />);
    await screen.findByText('Avatiu Harbour'); // heatmap row, confirms data loaded

    const fetchCountAfterCompare = global.fetch.mock.calls.length;
    fireEvent.click(screen.getByRole('tab', { name: 'This location' }));

    const select = await screen.findByRole('combobox');
    expect(select).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Avatiu Harbour' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Avarua Fishing Ground' })).toBeInTheDocument();
    expect(screen.getByTestId('landing-area-chart')).toHaveTextContent('1 steps');

    fireEvent.change(select, { target: { value: screen.getByRole('option', { name: 'Avarua Fishing Ground' }).value } });
    expect(screen.getByTestId('landing-area-chart')).toBeInTheDocument();

    // Switching tabs and picking a site must not trigger any new network call.
    expect(global.fetch.mock.calls.length).toBe(fetchCountAfterCompare);
  });
});
