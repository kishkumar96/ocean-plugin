import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import CookIslandsRouteForecastPanel from '../CookIslandsRouteForecastPanel';

jest.mock('../../../utils/CookIslandsRouteAdvisoryPdf', () => ({
  exportCookIslandsRouteAdvisoryPdf: jest.fn(() => Promise.resolve('x.pdf')),
}));
const { exportCookIslandsRouteAdvisoryPdf } = require('../../../utils/CookIslandsRouteAdvisoryPdf');

// Plotly can't load under jsdom (no TextDecoder); the chart has its own coverage.
jest.mock('../../wave/CookIslandsWaveTimeseriesChart', () => ({
  __esModule: true,
  // The real chart reports hovered times through onHoverTime; this stand-in lets a test do the same.
  default: ({ site, onHoverTime }) => (
    <div data-testid="wave-chart">
      {site.name}
      <button type="button" onClick={() => onHoverTime?.(Date.UTC(2026, 8, 30, 2))}>hover-in-voyage</button>
      <button type="button" onClick={() => onHoverTime?.(Date.UTC(2026, 8, 30, 20))}>hover-after-arrival</button>
      <button type="button" onClick={() => onHoverTime?.(null)}>hover-leave</button>
    </div>
  ),
}));

function baseResult(overrides = {}) {
  return {
    vessel: 'small_craft',
    summary: { distance_nm: 51.9, duration_hours: 6.5, worst_hazard_class: 2, recommendation: 'Warning' },
    samples: [],
    ...overrides,
  };
}

describe('CookIslandsRouteForecastPanel crossing identity', () => {
  test('shows "start → destination" when the result carries a named crossing', () => {
    render(
      <CookIslandsRouteForecastPanel
        data={{ result: baseResult({ start_label: 'Pukapuka', destination_label: 'Nassau' }), vessel: 'small_craft', speedKt: 8 }}
      />
    );
    expect(screen.getByText('Pukapuka → Nassau')).toBeInTheDocument();
  });

  test('omits the crossing-name line for a manually-drawn route (no labels)', () => {
    render(
      <CookIslandsRouteForecastPanel
        data={{ result: baseResult(), vessel: 'small_craft', speedKt: 8 }}
      />
    );
    expect(screen.queryByText(/→/)).not.toBeInTheDocument();
  });
});

describe('CookIslandsRouteForecastPanel PDF export: midpoint conditions', () => {
  const H = 3600e3;
  const T0 = Date.UTC(2026, 8, 30, 0);
  // A route running due south-east in a straight line; the sample at half the distance is the midpoint.
  const samples = [0, 1, 2, 3, 4].map((i) => ({
    sample_index: i, eta: new Date(T0 + i * H).toISOString(), distance_nm: i * 13, lon: -165.8 + i * 0.1, lat: -10.85 - i * 0.14,
    hazard_class: 2, hazard_label: 'Warning', wind_speed_kt: 22, wave_height_m: 3, available: true,
  }));
  const data = { result: baseResult({ samples, departure_time: new Date(T0).toISOString() }), vessel: 'small_craft', speedKt: 8 };
  const waveResponse = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      times: Array.from({ length: 24 }, (_, i) => new Date(T0 + i * H).toISOString()),
      variables: { hs: Array(24).fill(3), tpeak: Array(24).fill(9), dirp: Array(24).fill(125), hs_p1: Array(24).fill(2.9), tp_p1: Array(24).fill(9.1), dirp_p1: Array(24).fill(126), hs_p2: Array(24).fill(0.9), tp_p2: Array(24).fill(11), dirp_p2: Array(24).fill(184) },
      distance_degrees: 0,
    }),
  });

  beforeEach(() => { exportCookIslandsRouteAdvisoryPdf.mockClear(); delete global.fetch; });

  test('fetches the wave feed at the route midpoint and passes the conditions at the vessel ETA to the PDF', async () => {
    global.fetch = jest.fn(waveResponse);
    render(<CookIslandsRouteForecastPanel data={data} />);
    fireEvent.click(screen.getByRole('button', { name: /Download PDF/ }));
    await waitFor(() => expect(exportCookIslandsRouteAdvisoryPdf).toHaveBeenCalledTimes(1));
    const { midpointConditions } = exportCookIslandsRouteAdvisoryPdf.mock.calls[0][0];
    expect(String(global.fetch.mock.calls[0][0])).toContain('/wave/ugrid/timeseries');
    expect(midpointConditions).toEqual(expect.objectContaining({ hsM: 3, tpS: 9, dirPoint: 'SE' }));
    expect(midpointConditions.etaIso).toBe(samples[2].eta); // half of 52 nm is the 26 nm sample
    expect(midpointConditions.primarySwell.hsM).toBe(0.9);
    expect(midpointConditions.windSea.hsM).toBe(2.9);
  });

  test('when the wave feed fails the PDF still exports, with midpointConditions = null (stated unavailable, not omitted)', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('network down')));
    render(<CookIslandsRouteForecastPanel data={data} />);
    fireEvent.click(screen.getByRole('button', { name: /Download PDF/ }));
    await waitFor(() => expect(exportCookIslandsRouteAdvisoryPdf).toHaveBeenCalledTimes(1));
    expect(exportCookIslandsRouteAdvisoryPdf.mock.calls[0][0].midpointConditions).toBeNull();
  });
});

describe('CookIslandsRouteForecastPanel map probe', () => {
  const H = 3600e3;
  const T0 = Date.UTC(2026, 8, 30, 0);
  const samples = [0, 1, 2, 3, 4].map((i) => ({
    sample_index: i, eta: new Date(T0 + i * H).toISOString(), distance_nm: i * 13, lon: -165.8 + i * 0.1, lat: -10.85 - i * 0.14,
    hazard_class: 2, hazard_label: 'Warning', wind_speed_kt: 22, wave_height_m: 3, available: true,
  }));
  const data = { result: baseResult({ samples, departure_time: new Date(T0).toISOString() }), vessel: 'small_craft', speedKt: 8 };
  const open = (onRouteProbeChange) => {
    const utils = render(<CookIslandsRouteForecastPanel data={data} onRouteProbeChange={onRouteProbeChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Wave forecast at route midpoint/ }));
    return utils;
  };
  const last = (fn) => fn.mock.calls[fn.mock.calls.length - 1][0];

  test('while the midpoint chart is open, the map is told the midpoint (and no boat until you hover)', () => {
    const onProbe = jest.fn();
    open(onProbe);
    const probe = last(onProbe);
    expect(probe.midpoint).toEqual({ lon: expect.any(Number), lat: expect.any(Number) });
    expect(probe.vessel).toBeNull();
  });

  test('hovering a time inside the voyage places the boat on the route and says so', () => {
    const onProbe = jest.fn();
    open(onProbe);
    fireEvent.click(screen.getByRole('button', { name: 'hover-in-voyage' })); // 02:00 = the 26 nm sample
    const probe = last(onProbe);
    expect(probe.vessel.lon).toBeCloseTo(-165.6, 5);
    expect(probe.vessel.lat).toBeCloseTo(-11.13, 5);
    expect(typeof probe.vessel.label).toBe('string');
    expect(screen.getByText(/the boat would be 26\.0 nm along the route/)).toBeInTheDocument();
  });

  test('hovering outside the voyage shows no boat and explains why', () => {
    const onProbe = jest.fn();
    open(onProbe);
    fireEvent.click(screen.getByRole('button', { name: 'hover-after-arrival' }));
    expect(last(onProbe).vessel).toBeNull();
    expect(screen.getByText(/the boat is not under way at/)).toBeInTheDocument();
  });

  test('moving off the chart removes the boat but keeps the midpoint', () => {
    const onProbe = jest.fn();
    open(onProbe);
    fireEvent.click(screen.getByRole('button', { name: 'hover-in-voyage' }));
    fireEvent.click(screen.getByRole('button', { name: 'hover-leave' }));
    const probe = last(onProbe);
    expect(probe.vessel).toBeNull();
    expect(probe.midpoint).not.toBeNull();
  });

  test('closing the chart, and unmounting the panel, clear the map', () => {
    const onProbe = jest.fn();
    const { unmount } = open(onProbe);
    fireEvent.click(screen.getByRole('button', { name: /Wave forecast at route midpoint/ })); // collapse
    expect(last(onProbe)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Wave forecast at route midpoint/ })); // reopen
    expect(last(onProbe)).not.toBeNull();
    unmount();
    expect(last(onProbe)).toBeNull();
  });

  test('works without the callback (panel used standalone)', () => {
    expect(() => open(undefined)).not.toThrow();
  });
});
