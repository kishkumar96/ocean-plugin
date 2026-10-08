import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import SuitabilityTasks, { ThresholdBasisBadge } from '../SuitabilityTasks';

const tasks = () => ({
  route: jest.fn(() => <div>ROUTE TOOLS</div>),
  compare: jest.fn(() => <div>COMPARE TOOLS</div>),
  export: jest.fn(() => <div>EXPORT TOOLS</div>),
  thresholds: jest.fn(() => <div>THRESHOLD TOOLS</div>),
});

describe('SuitabilityTasks', () => {
  test('nothing is open by default, and no task renderer is even called', () => {
    const t = tasks();
    render(<SuitabilityTasks tasks={t} />);
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.queryByText('ROUTE TOOLS')).toBeNull();
    Object.values(t).forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });

  test('exactly one task is open at a time, and clicking the open tab closes it', () => {
    const t = tasks();
    render(<SuitabilityTasks tasks={t} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Plan route' }));
    expect(screen.getByText('ROUTE TOOLS')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Export' }));
    expect(screen.queryByText('ROUTE TOOLS')).toBeNull();
    expect(screen.getByText('EXPORT TOOLS')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Export' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Export' }));
    expect(screen.queryByText('EXPORT TOOLS')).toBeNull();
    expect(t.compare).not.toHaveBeenCalled();
  });
});

describe('ThresholdBasisBadge', () => {
  test('says the preset is used, or that custom thresholds change the map only', () => {
    const { rerender } = render(<ThresholdBasisBadge isCustom={false} />);
    expect(screen.getByRole('note')).toHaveTextContent('Uses the vessel preset thresholds.');
    rerender(<ThresholdBasisBadge isCustom />);
    expect(screen.getByRole('note')).toHaveTextContent(/Custom thresholds change the map only.*still uses the vessel preset/);
  });
});
