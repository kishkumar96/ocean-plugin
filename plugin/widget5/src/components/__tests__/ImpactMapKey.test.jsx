import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ImpactMapKey, { pickTicks } from '../ImpactMapKey';
import ImpactLayerSwitches from '../ImpactLayerSwitches';

jest.mock('../../hooks/useZarrMap', () => ({ MHWS_LINE_COLORS: { 0: '#a', 15: '#b', 17.5: '#c', 20: '#d' } }));

const depthLegend = { gradient: 'linear-gradient(to top, #000 0%, #fff 100%)', min: 0.1, max: 3, units: 'm', ticks: [0.1, 0.8, 1.5, 2.3, 3] };
const layers = { impactDistricts: true, riskPoints: true, mhwsContour: true, mhwsAltContours: false, mhwsFlood: true };

describe('ImpactMapKey', () => {
  beforeEach(() => { window.localStorage.clear(); });

  test('folded by default: only the depth ramp is on the map', () => {
    render(<ImpactMapKey activeLayers={layers} depthLegend={depthLegend} />);
    expect(screen.getByRole('img', { name: /Inundation depth from 0\.1m to 3m/ })).toBeInTheDocument();
    expect(screen.queryByText('Over $1M')).toBeNull();
    expect(screen.getByRole('button', { name: /More key/ })).toHaveAttribute('aria-expanded', 'false');
  });

  test('unfolding adds a legend only for layers that are switched on, and the choice is remembered', () => {
    const { unmount } = render(<ImpactMapKey activeLayers={{ ...layers, riskPoints: false }} depthLegend={depthLegend} />);
    fireEvent.click(screen.getByRole('button', { name: /More key/ }));
    expect(screen.getByText('Over $1M')).toBeInTheDocument(); // district damage on
    expect(screen.queryByText('Moderate Risk')).toBeNull(); // risk markers off -> no legend
    expect(screen.getByText(/MHWS \+ 17\.5 cm \(0\.503 m\), working mark/)).toBeInTheDocument();
    expect(screen.queryByText('MHWS + 15 cm')).toBeNull(); // comparison lines off
    unmount();
    render(<ImpactMapKey activeLayers={layers} depthLegend={depthLegend} />);
    expect(screen.getByText('Over $1M')).toBeInTheDocument(); // still open after remount
  });

  test('comparison lines appear in the key only when switched on', () => {
    render(<ImpactMapKey activeLayers={{ ...layers, mhwsAltContours: true }} depthLegend={depthLegend} />);
    fireEvent.click(screen.getByRole('button', { name: /More key/ }));
    expect(screen.getByText('MHWS + 15 cm')).toBeInTheDocument();
    expect(screen.getByText('MHWS + 20 cm')).toBeInTheDocument();
  });

  test('renders nothing with no depth layer and every other layer off', () => {
    const { container } = render(<ImpactMapKey activeLayers={{ impactDistricts: false, riskPoints: false, mhwsContour: false, mhwsAltContours: false, mhwsFlood: false }} depthLegend={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ImpactLayerSwitches', () => {
  test('is a compact list of switches with no legends, and toggles call back', () => {
    const setActiveLayers = jest.fn();
    render(<ImpactLayerSwitches activeLayers={layers} setActiveLayers={setActiveLayers} />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(5);
    expect(screen.queryByText('Over $1M')).toBeNull();
    expect(screen.getByRole('checkbox', { name: /Compare lines/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: /Compare lines/ }));
    expect(setActiveLayers.mock.calls[0][0]({}).mhwsAltContours).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /District damage/ }));
    expect(setActiveLayers.mock.calls[1][0]({ impactDistricts: true }).impactDistricts).toBe(false);
  });
});

describe('pickTicks', () => {
  test('keeps first and last and caps the count', () => {
    const picked = pickTicks(Array.from({ length: 20 }, (_, i) => i / 2), 5);
    expect(picked.length).toBeLessThanOrEqual(5);
    expect(picked[0]).toBe(0);
    expect(picked[picked.length - 1]).toBe(9.5);
    expect(pickTicks(null)).toEqual([]);
  });
});
