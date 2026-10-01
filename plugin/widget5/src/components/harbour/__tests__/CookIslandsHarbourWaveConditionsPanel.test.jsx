import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import CookIslandsHarbourWaveConditionsPanel from '../CookIslandsHarbourWaveConditionsPanel';
import { COOK_ISLANDS_HARBOUR_POINTS } from '../../../config/cookIslandsHarbourPoints';

jest.mock('../../../utils/CookIslandsHarbourAdvisoryPdf', () => ({
  exportCookIslandsHarbourAdvisoryPdf: jest.fn(() => Promise.resolve('x.pdf')),
}));
const { exportCookIslandsHarbourAdvisoryPdf } = require('../../../utils/CookIslandsHarbourAdvisoryPdf');

// Plotly can't load under jsdom (no TextDecoder); the chart has its own coverage.
jest.mock('../../wave/CookIslandsWaveTimeseriesChart', () => ({
  __esModule: true,
  default: ({ site }) => <div data-testid="wave-chart">{site.name}</div>,
}));

const NOT_SET = {
  schema: 1, status: 'not_set', version: 0, approvedBy: null, approvedOn: null, effectiveFrom: null,
  default: { caution: { hsM: null, tpS: null, windKt: null }, stop: { hsM: null, tpS: null, windKt: null } },
  harbours: {}, history: [],
};
const provisional = (stop) => ({ ...NOT_SET, status: 'provisional', default: { caution: { hsM: null, tpS: null, windKt: null }, stop: { hsM: stop, tpS: null, windKt: null } } });
const approved = (stop, extra = {}) => ({
  ...NOT_SET, status: 'approved', version: 2, approvedBy: 'Cook Islands Ports Authority', approvedOn: '2026-09-01T00:00:00Z',
  effectiveFrom: '2026-09-02T00:00:00Z', history: [{ version: 2, date: '2026-09-01', by: 'CIPA', summary: 'Initial limits' }],
  default: { caution: { hsM: null, tpS: null, windKt: null }, stop: { hsM: stop, tpS: null, windKt: null } }, ...extra,
});

// Routes the published-limits file separately from the per-harbour timeseries.
function mockFetch(timeseries, limits = NOT_SET, limitsOk = true) {
  return jest.fn((url) => {
    if (String(url).includes('harbour-limits.json')) {
      return limitsOk
        ? Promise.resolve({ ok: true, json: () => Promise.resolve(limits) })
        : Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
    }
    return Promise.resolve(timeseries);
  });
}

beforeEach(() => {
  delete global.fetch;
  window.localStorage.clear();
  // "Now" is the forecast step nearest the clock; pin it to the fixture's first step so the 24 h
  // window is the fixture's own 24 steps.
  jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 8, 29, 6));
});

afterEach(() => {
  jest.restoreAllMocks();
});

function timeseriesResponse(waveHeightM, windSpeedKt, hazardClass) {
  return {
    ok: true,
    json: () => Promise.resolve({
      available: true,
      steps: Array.from({ length: 24 }, (_, i) => ({
        time_index: i,
        valid_time: new Date(Date.UTC(2026, 8, 29, 6) + i * 3600e3).toISOString(),
        hazard_class: hazardClass,
        hazard_label: 'Suitable',
        wind_speed_kt: windSpeedKt,
        wave_height_m: waveHeightM + i * 0.05,
      })),
    }),
  };
}

describe('CookIslandsHarbourWaveConditionsPanel', () => {
  test('does not fetch anything while disabled', () => {
    global.fetch = jest.fn();
    render(<CookIslandsHarbourWaveConditionsPanel enabled={false} />);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('shows a loading state, then every harbour with its wave height and wind', async () => {
    global.fetch = mockFetch(timeseriesResponse(1.2, 14, 1));
    render(<CookIslandsHarbourWaveConditionsPanel enabled />);

    expect(screen.getByText(/Loading harbour wave conditions/)).toBeInTheDocument();

    await waitFor(() => expect(screen.queryByText(/Loading harbour wave conditions/)).not.toBeInTheDocument());

    expect(screen.getByText('Avatiu Harbour')).toBeInTheDocument();
    expect(screen.getByText('Nassau Harbour')).toBeInTheDocument();
    expect(screen.getAllByText('1.2 m')).toHaveLength(COOK_ISLANDS_HARBOUR_POINTS.length);
    expect(screen.getAllByText('14 kt')).toHaveLength(COOK_ISLANDS_HARBOUR_POINTS.length);
  });

  test('shows "Unavailable" for a harbour outside the model domain without blanking the rest', async () => {
    global.fetch = jest.fn((url) => (
      url.includes('-165.4233') // Nassau Harbour
        ? Promise.reject(new Error('out of domain'))
        : Promise.resolve(timeseriesResponse(0.8, 10, 0))
    ));
    render(<CookIslandsHarbourWaveConditionsPanel enabled />);

    await waitFor(() => expect(screen.queryByText(/Loading harbour wave conditions/)).not.toBeInTheDocument());

    expect(screen.getByText('Nassau Harbour')).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.getAllByText('0.8 m').length).toBeGreaterThan(0);
  });

  test('expanding a harbour shows its wave chart for that harbour, collapsing hides it', async () => {
    global.fetch = mockFetch(timeseriesResponse(1.2, 14, 2));
    render(<CookIslandsHarbourWaveConditionsPanel enabled />);
    await waitFor(() => expect(screen.queryByText(/Loading harbour wave conditions/)).not.toBeInTheDocument());

    expect(screen.queryByTestId('wave-chart')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Avatiu Harbour/ }));
    expect(screen.getByTestId('wave-chart')).toHaveTextContent('Avatiu Harbour');
    fireEvent.click(screen.getByRole('button', { name: /Avatiu Harbour/ }));
    expect(screen.queryByTestId('wave-chart')).not.toBeInTheDocument();
  });
});

describe('unloading limits', () => {
  beforeEach(() => window.localStorage.clear());

  test('with no limits set there is no verdict column; editing creates a labelled DRAFT that persists', async () => {
    global.fetch = mockFetch(timeseriesResponse(1.2, 14, 1));
    const { unmount } = render(<CookIslandsHarbourWaveConditionsPanel enabled />);
    await waitFor(() => expect(screen.queryByText(/Loading harbour wave conditions/)).not.toBeInTheDocument());
    expect(screen.queryByText('Unloading')).not.toBeInTheDocument();
    expect(screen.getByText(/No approved unloading limits yet/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Edit unloading limits/ }));
    fireEvent.change(screen.getByLabelText('Wave height stop limit'), { target: { value: '1' } });
    // 1.2 m now >= 1 m stop limit at every harbour.
    expect(screen.getByText('Unloading (draft)')).toBeInTheDocument();
    expect(screen.getByText(/DRAFT limits \(local to this browser, not approved\)/)).toBeInTheDocument();
    expect(screen.getAllByText('Stop').length).toBeGreaterThan(0);

    unmount();
    render(<CookIslandsHarbourWaveConditionsPanel enabled />);
    await waitFor(() => expect(screen.queryByText(/Loading harbour wave conditions/)).not.toBeInTheDocument());
    expect(screen.getByText('Unloading (draft)')).toBeInTheDocument();
  });

  test('a per-harbour override takes precedence over the default', async () => {
    global.fetch = mockFetch(timeseriesResponse(1.2, 14, 1));
    render(<CookIslandsHarbourWaveConditionsPanel enabled />);
    await waitFor(() => expect(screen.queryByText(/Loading harbour wave conditions/)).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Edit unloading limits/ }));
    fireEvent.change(screen.getByLabelText('Wave height stop limit'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/^Applies to/), { target: { value: '29' } });
    fireEvent.click(screen.getByRole('button', { name: /Set custom limits for this harbour/ }));
    fireEvent.change(screen.getByLabelText('Wave height stop limit for Avatiu Harbour'), { target: { value: '3' } });
    const avatiu = screen.getAllByRole('row').find((r) => within(r).queryByRole('button', { name: /Avatiu Harbour/ }));
    expect(avatiu).not.toHaveTextContent('Stop');
    expect(avatiu).toHaveTextContent('OK');
  });

  test('a period limit with no period available shows Incomplete, never OK (even with Hs/wind well within limits)', async () => {
    global.fetch = mockFetch(timeseriesResponse(0.3, 5, 0)); // calm; no period feed at all
    render(<CookIslandsHarbourWaveConditionsPanel enabled />);
    await waitFor(() => expect(screen.queryByText(/Loading harbour wave conditions/)).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Edit unloading limits/ }));
    fireEvent.change(screen.getByLabelText('Wave height stop limit'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Peak period stop limit'), { target: { value: '14' } });
    expect(screen.getAllByText('Incomplete').length).toBeGreaterThan(0);
    expect(screen.queryByText('OK')).not.toBeInTheDocument();
  });

  test('editor warns when Stop is not above Caution', async () => {
    global.fetch = mockFetch(timeseriesResponse(1, 5, 0));
    render(<CookIslandsHarbourWaveConditionsPanel enabled />);
    await waitFor(() => expect(screen.queryByText(/Loading harbour wave conditions/)).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Edit unloading limits/ }));
    fireEvent.change(screen.getByLabelText('Wave height caution limit'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Wave height stop limit'), { target: { value: '1.5' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/Stop must be higher than Caution for wave height/);
  });

  describe('limits authority', () => {
    const load = async () => {
      render(<CookIslandsHarbourWaveConditionsPanel enabled />);
      await waitFor(() => expect(screen.queryByText(/Loading harbour wave conditions/)).not.toBeInTheDocument());
    };

    test('approved + effective limits drive verdicts and are attributed, with no draft label', async () => {
      global.fetch = mockFetch(timeseriesResponse(1.2, 14, 0), approved(1));
      await load();
      await screen.findByText(/version 2, approved by Cook Islands Ports Authority/);
      expect(screen.getByText('Unloading')).toBeInTheDocument();
      expect(screen.getAllByText('Stop').length).toBeGreaterThan(0);
      expect(screen.queryByText(/DRAFT limits/)).not.toBeInTheDocument();
    });

    test('provisional limits drive verdicts but are labelled PROVISIONAL, never approved', async () => {
      global.fetch = mockFetch(timeseriesResponse(1.2, 14, 0), provisional(1));
      await load();
      expect(await screen.findByText(/PROVISIONAL unloading limits \(placeholder values, not confirmed by Cook Islands Government\)/)).toBeInTheDocument();
      expect(screen.getByText('Unloading (provisional)')).toBeInTheDocument();
      expect(screen.getAllByText('Stop').length).toBeGreaterThan(0);
      expect(screen.queryByText(/approved by/)).not.toBeInTheDocument();
    });

    test('entering your own limits replaces provisional values (as a labelled draft)', async () => {
      global.fetch = mockFetch(timeseriesResponse(1.2, 14, 0), provisional(1)); // 1.2 m >= 1 m => Stop
      await load();
      await screen.findByText('Unloading (provisional)');
      fireEvent.click(screen.getByRole('button', { name: /Edit unloading limits/ }));
      fireEvent.change(screen.getByLabelText('Wave height stop limit'), { target: { value: '3' } });
      expect(screen.getByText('Unloading (draft)')).toBeInTheDocument();
      expect(screen.queryByText('Stop')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Discard draft/ }));
      expect(screen.getByText('Unloading (provisional)')).toBeInTheDocument();
    });

    test('the PDF is exported under the provisional basis', async () => {
      exportCookIslandsHarbourAdvisoryPdf.mockClear();
      global.fetch = mockFetch(timeseriesResponse(1.2, 14, 0), provisional(1));
      await load();
      await screen.findByText('Unloading (provisional)');
      fireEvent.click(screen.getByRole('button', { name: /Download advisory PDF/ }));
      await waitFor(() => expect(exportCookIslandsHarbourAdvisoryPdf).toHaveBeenCalledTimes(1));
      const bundle = exportCookIslandsHarbourAdvisoryPdf.mock.calls[0][0];
      expect(bundle.basis).toBe('provisional');
      expect(bundle.basisStatement).toMatch(/PROVISIONAL/);
    });

    test('approved limits that are not yet effective apply nothing', async () => {
      global.fetch = mockFetch(timeseriesResponse(1.2, 14, 0), approved(1, { effectiveFrom: '2999-01-01T00:00:00Z' }));
      await load();
      await screen.findByText(/take effect/);
      expect(screen.queryByText('Unloading')).not.toBeInTheDocument();
    });

    test('a file that cannot be loaded says so; it is never shown as "no limits set"', async () => {
      global.fetch = mockFetch(timeseriesResponse(1.2, 14, 0), null, false);
      await load();
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not be loaded.*no verdict is shown/));
      expect(screen.queryByText(/No approved unloading limits yet/)).not.toBeInTheDocument();
    });

    test('an approved file that fails validation is rejected, not half-applied', async () => {
      global.fetch = mockFetch(timeseriesResponse(1.2, 14, 0), approved(1, { approvedBy: null }));
      await load();
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not be validated.*approvedBy is required/));
      expect(screen.queryByText('Unloading')).not.toBeInTheDocument();
    });

    test('a local draft overrides approved limits but is labelled DRAFT; discarding restores approved', async () => {
      global.fetch = mockFetch(timeseriesResponse(1.2, 14, 0), approved(3)); // 1.2 m < 3 m stop => OK
      await load();
      await screen.findByText('Unloading');
      fireEvent.click(screen.getByRole('button', { name: /Edit unloading limits/ }));
      fireEvent.change(screen.getByLabelText('Wave height stop limit'), { target: { value: '1' } });
      expect(screen.getByText('Unloading (draft)')).toBeInTheDocument();
      expect(screen.getByText(/DRAFT limits/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Discard draft/ }));
      expect(screen.getByText('Unloading')).toBeInTheDocument();
      expect(screen.queryByText(/DRAFT limits/)).not.toBeInTheDocument();
    });

    test('the editor lists the approved-limits history', async () => {
      global.fetch = mockFetch(timeseriesResponse(1.2, 14, 0), approved(3));
      await load();
      await screen.findByText(/version 2/);
      fireEvent.click(screen.getByRole('button', { name: /Edit unloading limits/ }));
      expect(screen.getByText(/v2 · 2026-09-01 · CIPA — Initial limits/)).toBeInTheDocument();
    });
  });

  describe('advisory PDF', () => {
    beforeEach(() => exportCookIslandsHarbourAdvisoryPdf.mockClear());
    const load = async () => {
      render(<CookIslandsHarbourWaveConditionsPanel enabled />);
      await waitFor(() => expect(screen.queryByText(/Loading harbour wave conditions/)).not.toBeInTheDocument());
    };

    test('is disabled until data has loaded', () => {
      global.fetch = jest.fn(() => new Promise(() => {})); // never resolves
      render(<CookIslandsHarbourWaveConditionsPanel enabled />);
      expect(screen.getByRole('button', { name: /Download advisory PDF/ })).toBeDisabled();
    });

    test('exports a bundle carrying every harbour and the approved-limits authority', async () => {
      global.fetch = mockFetch(timeseriesResponse(1.2, 14, 0), approved(1));
      await load();
      await screen.findByText(/approved by Cook Islands Ports Authority/);
      fireEvent.click(screen.getByRole('button', { name: /Download advisory PDF/ }));
      await waitFor(() => expect(exportCookIslandsHarbourAdvisoryPdf).toHaveBeenCalledTimes(1));
      const bundle = exportCookIslandsHarbourAdvisoryPdf.mock.calls[0][0];
      expect(bundle.harbours).toHaveLength(16);
      expect(bundle.basis).toBe('approved');
      expect(bundle.basisStatement).toMatch(/version 2, approved by Cook Islands Ports Authority/);
      expect(bundle.judged).toBe(true);
    });

    test('with the approved file unreadable, the report says so and carries no verdicts', async () => {
      global.fetch = mockFetch(timeseriesResponse(1.2, 14, 0), null, false);
      await load();
      await screen.findByRole('alert');
      fireEvent.click(screen.getByRole('button', { name: /Download advisory PDF/ }));
      await waitFor(() => expect(exportCookIslandsHarbourAdvisoryPdf).toHaveBeenCalledTimes(1));
      const bundle = exportCookIslandsHarbourAdvisoryPdf.mock.calls[0][0];
      expect(bundle.basis).toBe('unavailable');
      expect(bundle.judged).toBe(false);
      expect(bundle.harbours.every((h) => h.verdictNow === null)).toBe(true);
    });

    test('a draft is exported as a draft, never as approved', async () => {
      global.fetch = mockFetch(timeseriesResponse(1.2, 14, 0));
      await load();
      fireEvent.click(screen.getByRole('button', { name: /Edit unloading limits/ }));
      fireEvent.change(screen.getByLabelText('Wave height stop limit'), { target: { value: '1' } });
      fireEvent.click(screen.getByRole('button', { name: /Download advisory PDF/ }));
      await waitFor(() => expect(exportCookIslandsHarbourAdvisoryPdf).toHaveBeenCalledTimes(1));
      expect(exportCookIslandsHarbourAdvisoryPdf.mock.calls[0][0].basis).toBe('draft');
    });

    test('an export failure is reported, not swallowed', async () => {
      // The component deliberately logs the failure; assert that instead of tripping the
      // global "unexpected console.error" safety net.
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      exportCookIslandsHarbourAdvisoryPdf.mockRejectedValueOnce(new Error('boom'));
      global.fetch = mockFetch(timeseriesResponse(1.2, 14, 0));
      await load();
      fireEvent.click(screen.getByRole('button', { name: /Download advisory PDF/ }));
      expect(await screen.findByText('boom')).toBeInTheDocument();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('PDF export failed'), expect.any(Error));
      errorSpy.mockRestore();
    });
  });

  describe('partial forecast windows', () => {
    test('a forecast with only 10 h shows the 24 h figure marked, and the 24 h verdict Incomplete rather than OK', async () => {
      global.fetch = mockFetch(timeseriesResponse(0.3, 5, 0), approved(3)); // calm: would be OK with a full window
      // 10 steps only
      const short = { ok: true, json: async () => ({ ...(await timeseriesResponse(0.3, 5, 0).json()), steps: (await timeseriesResponse(0.3, 5, 0).json()).steps.slice(0, 10) }) };
      global.fetch = mockFetch(short, approved(3));
      render(<CookIslandsHarbourWaveConditionsPanel enabled />);
      await waitFor(() => expect(screen.queryByText(/Loading harbour wave conditions/)).not.toBeInTheDocument());
      await screen.findByText(/version 2, approved by/);
      expect(screen.getAllByText(/\*$/, { exact: false }).length).toBeGreaterThan(0);
      expect(screen.getAllByText('Incomplete').length).toBeGreaterThan(0);
    });
  });

  describe('why a verdict is what it is, on screen', () => {
    const load = async () => {
      render(<CookIslandsHarbourWaveConditionsPanel enabled />);
      await waitFor(() => expect(screen.queryByText(/Loading harbour wave conditions/)).not.toBeInTheDocument());
    };

    test('the expanded harbour states the controlling variable, its peak against the limit, and when', async () => {
      global.fetch = mockFetch(timeseriesResponse(1.2, 14, 0), approved(1)); // Hs 1.2 m and rising; stop at 1 m
      await load();
      await screen.findByText(/version 2, approved by/);
      fireEvent.click(screen.getByRole('button', { name: /Avatiu Harbour/ }));
      const lines = await screen.findAllByText(/Wave height peaks [\d.]+ m \(stop 1\.0 m\)/, { selector: 'div' });
      expect(lines).toHaveLength(2); // one for "Now", one for "Next 24 h"
      expect(screen.getByText('Now:', { exact: false })).toBeInTheDocument();
      expect(screen.getByText('Next 24 h:', { exact: false })).toBeInTheDocument();
    });

    test('nothing to explain when conditions are within limits', async () => {
      global.fetch = mockFetch(timeseriesResponse(0.3, 5, 0), approved(3));
      await load();
      await screen.findByText(/version 2, approved by/);
      fireEvent.click(screen.getByRole('button', { name: /Avatiu Harbour/ }));
      expect(screen.queryByText(/peaks/)).not.toBeInTheDocument();
    });

    test('a location with no step near the clock says why it is unavailable (tooltip) instead of showing a stale value', async () => {
      Date.now.mockReturnValue(Date.UTC(2026, 8, 29, 6) + 6 * 24 * 3600e3); // a week past the fixture's 24 steps
      global.fetch = mockFetch(timeseriesResponse(1.2, 14, 0));
      await load();
      const cells = screen.getAllByText('Unavailable');
      expect(cells.length).toBe(16);
      expect(cells[0]).toHaveAttribute('title', expect.stringMatching(/no step within 90 min of now/));
    });
  });
});
