import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import CookIslandsSuitabilityReadinessCard from '../CookIslandsSuitabilityReadinessCard';

function mockFetchOnce(body, { ok = true, status = 200 } = {}) {
  global.fetch = jest.fn(() => Promise.resolve({
    ok, status, json: () => Promise.resolve(body),
  }));
}

beforeEach(() => {
  delete global.fetch;
});

describe('CookIslandsSuitabilityReadinessCard', () => {
  it('shows Checking before the probe resolves', () => {
    global.fetch = jest.fn(() => new Promise(() => {})); // never resolves
    render(<CookIslandsSuitabilityReadinessCard selectedVessel="traditional_craft" />);
    expect(screen.getByText('Checking')).toBeInTheDocument();
  });

  it('probes /cok/suitability/area/timeseries at Avatiu Harbour with the selected vessel', () => {
    global.fetch = jest.fn(() => new Promise(() => {}));
    render(<CookIslandsSuitabilityReadinessCard selectedVessel="small_craft" />);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url] = global.fetch.mock.calls[0];
    expect(url).toContain('/cok/suitability/area/timeseries?');
    expect(url).toContain('lon=-159.7833');
    expect(url).toContain('lat=-21.2039');
    expect(url).toContain('vessel=small_craft');
  });

  it('shows Ready with the point count on a normal success response', async () => {
    mockFetchOnce({ point_count: 6, used_nearest_point_fallback: false });
    render(<CookIslandsSuitabilityReadinessCard selectedVessel="traditional_craft" />);
    await screen.findByText('Ready');
    expect(screen.getByText(/6 source points sampled at Avatiu Harbour/)).toBeInTheDocument();
  });

  it('shows Fallback when the endpoint used the nearest-point fallback', async () => {
    mockFetchOnce({ point_count: 1, used_nearest_point_fallback: true });
    render(<CookIslandsSuitabilityReadinessCard selectedVessel="traditional_craft" />);
    await screen.findByText('Fallback');
    expect(screen.getByText(/nearest-point fallback/)).toBeInTheDocument();
  });

  it('shows Fallback when the endpoint 404s (not deployed on this backend)', async () => {
    mockFetchOnce({}, { ok: false, status: 404 });
    render(<CookIslandsSuitabilityReadinessCard selectedVessel="traditional_craft" />);
    await screen.findByText('Fallback');
    expect(screen.getByText(/not deployed on this backend yet/)).toBeInTheDocument();
  });

  it('shows Unavailable on a server error or network failure', async () => {
    mockFetchOnce({}, { ok: false, status: 500 });
    const { unmount } = render(<CookIslandsSuitabilityReadinessCard selectedVessel="traditional_craft" />);
    await screen.findByText('Unavailable');
    expect(screen.getByText(/HTTP 500/)).toBeInTheDocument();
    unmount();

    global.fetch = jest.fn(() => Promise.reject(new Error('network down')));
    render(<CookIslandsSuitabilityReadinessCard selectedVessel="traditional_craft" />);
    await screen.findByText('Unavailable');
    expect(screen.getByText(/could not be checked from this browser/)).toBeInTheDocument();
  });

  it('shows the forecast time label when given one', async () => {
    mockFetchOnce({ point_count: 1 });
    render(<CookIslandsSuitabilityReadinessCard selectedVessel="traditional_craft" forecastTimeLabel="20 Sep, 06:00 NZT" />);
    expect(screen.getByText('20 Sep, 06:00 NZT')).toBeInTheDocument();
  });
});
