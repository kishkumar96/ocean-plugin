import React from 'react';
import { render, screen } from '@testing-library/react';
import ModernHeader from '../ModernHeader';

describe('ModernHeader forecast status', () => {
  const NOW = Date.UTC(2026, 9, 1, 3, 35); // 1 Oct 03:35 UTC
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(NOW); });
  afterEach(() => { jest.useRealTimers(); });
  const run = (hoursAgo) => new Date(NOW - hoursAgo * 3600e3);

  test('says when the forecast was issued and how old it is, never just "Live"', () => {
    render(<ModernHeader modelRunStart={run(19)} />);
    const status = screen.getByTestId('forecast-status');
    expect(status).toHaveTextContent(/Forecast issued .* · 19 h old · Current/);
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
  });

  test('ages from current to aging to stale', () => {
    const { rerender } = render(<ModernHeader modelRunStart={run(27)} />);
    expect(screen.getByTestId('forecast-status')).toHaveTextContent(/27 h old · Aging/);
    rerender(<ModernHeader modelRunStart={run(34)} />);
    expect(screen.getByTestId('forecast-status')).toHaveTextContent(/34 h old · Stale/);
  });

  test('without a known run it says so rather than implying a live feed', () => {
    render(<ModernHeader />);
    expect(screen.getByTestId('forecast-status')).toHaveTextContent('Forecast run unknown');
  });
});
