import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import CookIslandsRouteControls from '../CookIslandsRouteControls';
import { COOK_ISLANDS_PRESET_ROUTES } from '../../../config/cookIslandsPresetRoutes';

function baseProps(overrides = {}) {
  return {
    routePoints: [],
    routePickMode: false,
    setRoutePickMode: jest.fn(),
    routeSpeedKt: 8,
    setRouteSpeedKt: jest.fn(),
    routeDepartureTime: '2026-09-29T06:00',
    setRouteDepartureTime: jest.fn(),
    routeForecastLoading: false,
    routeForecastError: '',
    onRunRouteForecast: jest.fn(),
    onClearRoute: jest.fn(),
    onUndoRoutePoint: jest.fn(),
    ...overrides,
  };
}

describe('CookIslandsRouteControls preset crossings', () => {
  test('renders a button for every configured preset route', () => {
    render(<CookIslandsRouteControls {...baseProps({ onLoadPresetRoute: jest.fn() })} />);
    for (const route of COOK_ISLANDS_PRESET_ROUTES) {
      expect(screen.getByRole('button', { name: route.label })).toBeInTheDocument();
    }
  });

  test('clicking a preset calls onLoadPresetRoute with that route\'s id', () => {
    const onLoadPresetRoute = jest.fn();
    render(<CookIslandsRouteControls {...baseProps({ onLoadPresetRoute })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Pukapuka → Nassau' }));
    expect(onLoadPresetRoute).toHaveBeenCalledWith('pukapuka_to_nassau');

    fireEvent.click(screen.getByRole('button', { name: 'Nassau → Pukapuka' }));
    expect(onLoadPresetRoute).toHaveBeenCalledWith('nassau_to_pukapuka');

    fireEvent.click(screen.getByRole('button', { name: 'Manihiki → Rakahanga' }));
    expect(onLoadPresetRoute).toHaveBeenCalledWith('manihiki_to_rakahanga');

    fireEvent.click(screen.getByRole('button', { name: 'Rakahanga → Manihiki' }));
    expect(onLoadPresetRoute).toHaveBeenCalledWith('rakahanga_to_manihiki');
  });

  test('shows that vessel/speed are editable assumptions, not confirmed values', () => {
    render(<CookIslandsRouteControls {...baseProps({ onLoadPresetRoute: jest.fn() })} />);
    expect(screen.getByText(/starting assumptions/)).toBeInTheDocument();
  });

  test('omits the preset row entirely when onLoadPresetRoute is not provided', () => {
    render(<CookIslandsRouteControls {...baseProps()} />);
    expect(screen.queryByText('Preset crossings')).not.toBeInTheDocument();
    for (const route of COOK_ISLANDS_PRESET_ROUTES) {
      expect(screen.queryByRole('button', { name: route.label })).not.toBeInTheDocument();
    }
  });
});
