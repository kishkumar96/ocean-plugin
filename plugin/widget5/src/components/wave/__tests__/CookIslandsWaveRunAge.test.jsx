import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import CookIslandsWaveRunAge from '../CookIslandsWaveRunAge';

const RUN = '2026-09-30T00:00:00Z';
const at = (iso) => Date.parse(iso);

describe('CookIslandsWaveRunAge', () => {
  test('normal day: quiet line saying when it updated, not the model init age', () => {
    render(<CookIslandsWaveRunAge runStart={RUN} updatedAt={new Date(at('2026-09-30T22:00:00Z'))} now={at('2026-10-01T04:00:00Z')} />);
    expect(screen.getByText(/Wave forecast updated .* \(6 h ago\)/)).toBeInTheDocument();
    expect(screen.queryByText(/28/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  test('no update for more than 13 h: alert with how long', () => {
    render(<CookIslandsWaveRunAge runStart={RUN} updatedAt={new Date(at('2026-09-30T14:00:00Z'))} now={at('2026-10-01T06:00:00Z')} />);
    expect(screen.getByRole('alert')).toHaveTextContent('has not updated for 16 h');
  });
  test('recent updates with model data over 30 h old still alert', () => {
    render(<CookIslandsWaveRunAge runStart={RUN} updatedAt={new Date(at('2026-10-01T08:00:00Z'))} now={at('2026-10-01T10:00:00Z')} />);
    expect(screen.getByRole('alert')).toHaveTextContent('no newer model data since');
  });
  test('update time unknown: falls back to the 30 h model-data rule; nothing without a run start', () => {
    const { rerender, container } = render(<CookIslandsWaveRunAge runStart={RUN} updatedAt={null} now={at('2026-10-01T06:00:00Z')} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(/model data from/)).toBeInTheDocument();
    rerender(<CookIslandsWaveRunAge runStart={RUN} updatedAt={null} now={at('2026-10-01T10:00:00Z')} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    rerender(<CookIslandsWaveRunAge runStart={null} updatedAt={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
