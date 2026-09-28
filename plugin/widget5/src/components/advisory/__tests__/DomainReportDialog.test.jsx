import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import DomainReportDialog from '../DomainReportDialog';

jest.mock('../../../reports/suitabilityReportService', () => ({ fetchSuitabilityMeta: jest.fn() }));
// eslint-disable-next-line import/first
import { fetchSuitabilityMeta } from '../../../reports/suitabilityReportService';

const base = { open: true, onClose: jest.fn(), defaultVessel: 'small_craft', hasViewport: true, viewportBounds: { west: -160, south: -22, east: -159.5, north: -21 }, validTime: '2026-09-24T00:00:00Z' };

describe('DomainReportDialog', () => {
  beforeEach(() => { fetchSuitabilityMeta.mockImplementation(() => Promise.resolve({ runId: '2026092312' })); base.onClose.mockClear(); });
  test('previews scope, model run and page count, and passes the chosen options to onGenerate', async () => {
    const onGenerate = jest.fn(() => Promise.resolve());
    render(<DomainReportDialog {...base} onGenerate={onGenerate} />);
    expect(await screen.findByText(/2026-09-23 12:00 UTC/)).toBeInTheDocument();
    expect(screen.getByText(/Current map view \(W -160\.00/)).toBeInTheDocument();
    expect(screen.getByText(/6 pages/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Period'), { target: { value: '0' } });
    expect(screen.getByText(/2 pages/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Vessel'), { target: { value: 'larger_vessels' } });
    fireEvent.change(screen.getByLabelText('Area'), { target: { value: 'domain' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate PDF/ }));

    await waitFor(() => expect(onGenerate).toHaveBeenCalled());
    expect(onGenerate.mock.calls[0][0]).toEqual({ kind: 'advisory', vessel: 'larger_vessels', scope: 'domain', horizonHours: 0 });
    expect(onGenerate.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    await waitFor(() => expect(base.onClose).toHaveBeenCalled());
  });

  test('current map view is unavailable without a viewport and the area defaults to the domain', async () => {
    render(<DomainReportDialog {...base} hasViewport={false} viewportBounds={null} onGenerate={jest.fn()} />);
    expect(screen.getByLabelText('Area').value).toBe('domain');
    expect(screen.getByRole('option', { name: /Current map view \(not available\)/ }).disabled).toBe(true);
    // Flushes the dialog's own fetchSuitabilityMeta().then(setMeta) effect before the test
    // (and RTL's auto-unmount) ends, so that update isn't left dangling outside act(). Awaits
    // the exact promise the effect is awaiting (not just "was it called"), inside act(), so
    // this is deterministic regardless of how many render passes settling takes.
    await act(async () => { await fetchSuitabilityMeta.mock.results[0].value; });
  });

  test('shows progress and a working Cancel, and reports cancellation instead of an error', async () => {
    let capturedSignal;
    const onGenerate = jest.fn((opts, { signal, onProgress }) => new Promise((_, reject) => {
      capturedSignal = signal;
      onProgress({ done: 3, total: 10, label: 'Outlook' });
      signal.addEventListener('abort', () => { const e = new Error('Report generation cancelled.'); e.name = 'ReportAbortError'; reject(e); });
    }));
    render(<DomainReportDialog {...base} onGenerate={onGenerate} />);
    fireEvent.click(screen.getByRole('button', { name: /Generate PDF/ }));
    expect(await screen.findByRole('progressbar')).toHaveAttribute('aria-valuenow', '30');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(capturedSignal.aborted).toBe(true);
    expect(await screen.findByRole('alert')).toHaveTextContent('Cancelled.');
  });

  test('a failed generation shows the error and stays open', async () => {
    render(<DomainReportDialog {...base} onGenerate={() => Promise.reject(new Error('boom'))} />);
    fireEvent.click(screen.getByRole('button', { name: /Generate PDF/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
  });

  test('the poster is one A3 page, needs an outlook, and is labelled as a communications product', async () => {
    const onGenerate = jest.fn(() => Promise.resolve());
    render(<DomainReportDialog {...base} onGenerate={onGenerate} />);
    fireEvent.change(screen.getByLabelText('Report'), { target: { value: 'poster' } });
    expect(screen.getByText(/1 page \(A3\)/)).toBeInTheDocument();
    expect(screen.getByText(/not an advisory/)).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Current time only' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Generate PDF/ }));
    await waitFor(() => expect(onGenerate).toHaveBeenCalled());
    expect(onGenerate.mock.calls[0][0]).toMatchObject({ kind: 'poster', horizonHours: 72 });
  });
});
