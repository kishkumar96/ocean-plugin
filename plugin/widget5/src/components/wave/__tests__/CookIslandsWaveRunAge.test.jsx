import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import CookIslandsWaveRunAge from '../CookIslandsWaveRunAge';

const RUN = '2026-09-30T00:00:00Z';
const at = (iso) => Date.parse(iso);

describe('CookIslandsWaveRunAge', () => {
  test('fresh run: quiet info line, no alert', () => {
    render(<CookIslandsWaveRunAge runStart={RUN} now={at('2026-09-30T10:00:00Z')} />);
    expect(screen.getByText(/Wave model run starts/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  test('older than 30 h: alert with the rounded age', () => {
    render(<CookIslandsWaveRunAge runStart={RUN} now={at('2026-10-01T10:00:00Z')} />);
    expect(screen.getByRole('alert')).toHaveTextContent('it is 34h old');
  });
  test('exactly 30 h is not yet stale; renders nothing without a run start', () => {
    const { rerender, container } = render(<CookIslandsWaveRunAge runStart={RUN} now={at('2026-10-01T06:00:00Z')} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    rerender(<CookIslandsWaveRunAge runStart={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
