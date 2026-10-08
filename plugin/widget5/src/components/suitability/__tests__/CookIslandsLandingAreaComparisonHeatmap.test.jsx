import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import CookIslandsLandingAreaComparisonHeatmap from '../CookIslandsLandingAreaComparisonHeatmap';

const rows = [
  {
    id: 'avatiu', name: 'Avatiu Harbour', statistics_basis: 'area_500m',
    steps: [
      { time_index: 0, valid_time: '2026-09-20T00:00:00Z', hazard_class: 0 },
      { time_index: 1, valid_time: '2026-09-20T12:00:00Z', hazard_class: 1 },
    ],
  },
  {
    id: 'avarua', name: 'Avarua Fishing Ground', statistics_basis: 'nearest_point_fallback',
    steps: [
      { time_index: 0, valid_time: '2026-09-20T00:00:00Z', hazard_class: 2 },
    ],
  },
];

describe('CookIslandsLandingAreaComparisonHeatmap', () => {
  it('shows a loading message while loading', () => {
    render(<CookIslandsLandingAreaComparisonHeatmap rows={[]} loading />);
    expect(screen.getByText('Loading landing area comparison…')).toBeInTheDocument();
  });

  it('shows an empty message when there is no comparison data', () => {
    render(<CookIslandsLandingAreaComparisonHeatmap rows={[]} loading={false} />);
    expect(screen.getByText('No comparison data available.')).toBeInTheDocument();
  });

  it('renders one row per site, with the vessel label and basis in the caption', () => {
    render(<CookIslandsLandingAreaComparisonHeatmap rows={rows} loading={false} vesselLabel="Small craft" />);
    expect(screen.getByText('Avatiu Harbour')).toBeInTheDocument();
    expect(screen.getByText('Avarua Fishing Ground')).toBeInTheDocument();
    expect(screen.getByText(/Small craft · next 7 days/)).toBeInTheDocument();
    expect(screen.getByText(/500 m area/)).toBeInTheDocument();
  });

  it('shows the hazard/unavailable legend', () => {
    render(<CookIslandsLandingAreaComparisonHeatmap rows={rows} loading={false} />);
    expect(screen.getByText('Suitable')).toBeInTheDocument();
    expect(screen.getByText('Caution')).toBeInTheDocument();
    expect(screen.getByText('Warning')).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
  });
});
