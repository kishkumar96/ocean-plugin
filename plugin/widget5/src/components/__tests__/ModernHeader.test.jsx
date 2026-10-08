import React from 'react';
import { render, screen } from '@testing-library/react';
import ModernHeader from '../ModernHeader';

describe('ModernHeader forecast status', () => {
  const NOW = Date.UTC(2026, 9, 1, 3, 35); // 1 Oct 03:35 UTC
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(NOW); });
  afterEach(() => { jest.useRealTimers(); });
  const ago = (hours) => new Date(NOW - hours * 3600e3);

  test('leads with when the forecast updated, not the model init age, never just "Live"', () => {
    render(<ModernHeader modelRunStart={ago(19)} updatedAt={ago(3)} />);
    const status = screen.getByTestId('forecast-status');
    expect(status).toHaveTextContent(/Updated .* · 3 h ago · Current/);
    expect(status).not.toHaveTextContent(/19 h/);
    expect(status.getAttribute('title')).toMatch(/Model data: GFS cycle/);
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
  });

  test('a missed run turns it aging, two missed runs stale', () => {
    const { rerender } = render(<ModernHeader modelRunStart={ago(22)} updatedAt={ago(9)} />);
    expect(screen.getByTestId('forecast-status')).toHaveTextContent(/9 h ago · Aging/);
    rerender(<ModernHeader modelRunStart={ago(28)} updatedAt={ago(14)} />);
    expect(screen.getByTestId('forecast-status')).toHaveTextContent(/14 h ago · Stale/);
  });

  test('recent updates that keep re-sending an old model cycle are still stale', () => {
    render(<ModernHeader modelRunStart={ago(34)} updatedAt={ago(2)} />);
    expect(screen.getByTestId('forecast-status')).toHaveTextContent(/2 h ago · Stale/);
  });

  test('without an update time it falls back to the model-run age rules', () => {
    const { rerender } = render(<ModernHeader modelRunStart={ago(19)} />);
    expect(screen.getByTestId('forecast-status')).toHaveTextContent(/Model data .* · Current/);
    rerender(<ModernHeader modelRunStart={ago(34)} />);
    expect(screen.getByTestId('forecast-status')).toHaveTextContent(/Stale/);
  });

  test('without a known run it says so rather than implying a live feed', () => {
    render(<ModernHeader />);
    expect(screen.getByTestId('forecast-status')).toHaveTextContent('Forecast run unknown');
  });
});
