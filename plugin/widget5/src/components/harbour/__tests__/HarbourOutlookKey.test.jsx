import React from 'react';
import { render, screen } from '@testing-library/react';
import HarbourOutlookKey from '../HarbourOutlookKey';

describe('HarbourOutlookKey', () => {
  test('provisional limits: the title says so, rows stay short', () => {
    render(<HarbourOutlookKey bundle={{ judged: true, basis: 'provisional' }} />);
    expect(screen.getByText('Harbour unloading · provisional limits')).toBeInTheDocument();
    expect(screen.getByText('Over stop limit')).toBeInTheDocument();
    expect(screen.getByText(/Centre = now/)).toBeInTheDocument();
  });

  test('approved: no qualifier in the title', () => {
    render(<HarbourOutlookKey bundle={{ judged: true, basis: 'approved' }} />);
    expect(screen.getByText('Harbour unloading')).toBeInTheDocument();
    expect(screen.getByText('Over stop limit')).toBeInTheDocument();
  });

  test('no limits: no colour key, says forecast values only', () => {
    render(<HarbourOutlookKey bundle={{ judged: false, basis: 'none' }} />);
    expect(screen.getByText('No limits set: forecast values only')).toBeInTheDocument();
    expect(screen.queryByText('Over stop limit')).not.toBeInTheDocument();
  });
});
