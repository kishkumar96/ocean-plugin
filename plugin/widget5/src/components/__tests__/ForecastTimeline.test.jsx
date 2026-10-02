import React from 'react';
import { render, screen } from '@testing-library/react';
import ForecastTimeline from '../ForecastTimeline';

const base = {
  sliderIndex: 5, totalSteps: 100, isPlaying: false, timeDisplayZone: 'Pacific/Rarotonga',
  currentSliderDate: new Date('2026-10-01T03:00:00Z'), inline: true, // inline skips the floating form's ResizeObserver
};

describe('ForecastTimeline lead time', () => {
  test('shows hours since the model run started beside the clock time', () => {
    render(<ForecastTimeline {...base} capTime={{ availableTimestamps: [], modelRunStart: new Date('2026-09-30T08:00:00Z') }} />);
    expect(screen.getByText(/CKT · \+19 h$/)).toBeInTheDocument();
  });

  test('omits it when the run start is unknown or the step precedes the run (hindcast)', () => {
    const { rerender } = render(<ForecastTimeline {...base} capTime={{ availableTimestamps: [], modelRunStart: null }} />);
    expect(screen.queryByText(/\+\d+ h/)).not.toBeInTheDocument();
    rerender(<ForecastTimeline {...base} capTime={{ availableTimestamps: [], modelRunStart: new Date('2026-10-02T00:00:00Z') }} />);
    expect(screen.queryByText(/\+\d+ h/)).not.toBeInTheDocument();
  });
});
