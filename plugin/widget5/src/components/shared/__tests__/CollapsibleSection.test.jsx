import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import CollapsibleSection from '../CollapsibleSection';

describe('CollapsibleSection', () => {
  beforeEach(() => { window.localStorage.clear(); });

  test('starts folded, shows its summary, and opens on click', () => {
    render(<CollapsibleSection title="Map settings" summary="layers, opacity"><div>INSIDE</div></CollapsibleSection>);
    expect(screen.queryByText('INSIDE')).toBeNull();
    expect(screen.getByText('layers, opacity')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Map settings/ }));
    expect(screen.getByText('INSIDE')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Map settings/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByText('layers, opacity')).toBeNull(); // summary only while folded
  });

  test('remembers its state under a storage key, and honours defaultOpen', () => {
    const { unmount } = render(<CollapsibleSection title="Settings" storageKey="k1"><div>INSIDE</div></CollapsibleSection>);
    fireEvent.click(screen.getByRole('button', { name: /Settings/ }));
    unmount();
    render(<CollapsibleSection title="Settings" storageKey="k1"><div>INSIDE</div></CollapsibleSection>);
    expect(screen.getByText('INSIDE')).toBeInTheDocument();
    render(<CollapsibleSection title="Other" defaultOpen><div>OPEN BY DEFAULT</div></CollapsibleSection>);
    expect(screen.getByText('OPEN BY DEFAULT')).toBeInTheDocument();
  });
});
