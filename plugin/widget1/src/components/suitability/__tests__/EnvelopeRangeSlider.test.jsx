import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import EnvelopeRangeSlider from '../EnvelopeRangeSlider';

function renderSlider(overrides = {}) {
  const onCautionChange = jest.fn();
  const onDangerChange = jest.fn();
  const props = {
    label: 'Wind',
    unit: 'kt',
    min: 0,
    max: 40,
    step: 1,
    cautionValue: 15,
    dangerValue: 20,
    onCautionChange,
    onDangerChange,
    ...overrides,
  };
  render(<EnvelopeRangeSlider {...props} />);
  return {
    onCautionChange,
    onDangerChange,
    cautionInput: screen.getByRole('slider', { name: /wind caution threshold/i }),
    dangerInput: screen.getByRole('slider', { name: /wind danger threshold/i }),
  };
}

describe('EnvelopeRangeSlider', () => {
  test('renders the label and formatted caution/danger readouts', () => {
    renderSlider({ formatValue: (v) => `${v} kt` });
    expect(screen.getByText('Wind')).toBeInTheDocument();
    expect(screen.getByText(/Caution 15 kt/)).toBeInTheDocument();
    expect(screen.getByText(/Danger 20 kt/)).toBeInTheDocument();
  });

  test('falls back to unit-suffixed formatting when formatValue is not given', () => {
    renderSlider({ unit: 'kt', formatValue: undefined });
    expect(screen.getByText(/Caution 15 kt/)).toBeInTheDocument();
  });

  // Regression coverage for a real, actively-misleading bug: an earlier
  // version narrowed each handle's own min/max to stop at the other
  // handle's position (for a "native slider physically refuses to drag
  // further" feel). That broke the two overlaid inputs' shared coordinate
  // system — a native range input always maps its thumb across its OWN
  // min-to-max onto its full rendered width, so with a narrowed range the
  // thumb renders at a different percentage than the color track's
  // boundary (computed against the fixed global min/max) uses. Verified
  // concretely: min=0/max=40, handles at 15/20 rendered the caution thumb
  // at 78.9% and the danger thumb at 16.7% — visually crossed, despite
  // caution(15) < danger(20). Both inputs must keep the *same* min/max as
  // each other and as the track's own percentage calculation for thumb
  // position and track color to ever agree.
  describe('both handles share the slider-wide min/max (not narrowed to each other)', () => {
    test('the caution handle keeps the full slider min/max regardless of where danger sits', () => {
      const { cautionInput } = renderSlider({ min: 0, max: 40, cautionValue: 15, dangerValue: 20 });
      expect(cautionInput).toHaveAttribute('min', '0');
      expect(cautionInput).toHaveAttribute('max', '40');
    });

    test('the danger handle keeps the full slider min/max regardless of where caution sits', () => {
      const { dangerInput } = renderSlider({ min: 0, max: 40, cautionValue: 15, dangerValue: 20 });
      expect(dangerInput).toHaveAttribute('min', '0');
      expect(dangerInput).toHaveAttribute('max', '40');
    });

    test('min/max stay identical even when the handles are adjacent', () => {
      const { cautionInput, dangerInput } = renderSlider({ min: 0, max: 40, cautionValue: 19, dangerValue: 20 });
      expect(cautionInput.min).toBe(dangerInput.min);
      expect(cautionInput.max).toBe(dangerInput.max);
    });
  });

  test('dragging the caution handle calls onCautionChange with the new numeric value', () => {
    const { cautionInput, onCautionChange } = renderSlider();
    fireEvent.change(cautionInput, { target: { value: '12' } });
    expect(onCautionChange).toHaveBeenCalledWith(12);
  });

  test('dragging the danger handle calls onDangerChange with the new numeric value', () => {
    const { dangerInput, onDangerChange } = renderSlider();
    fireEvent.change(dangerInput, { target: { value: '25' } });
    expect(onDangerChange).toHaveBeenCalledWith(25);
  });

  test('wave-style props (fractional step) work the same way', () => {
    render(
      <EnvelopeRangeSlider
        label="Wave"
        unit="m"
        min={0}
        max={5}
        step={0.1}
        cautionValue={1.5}
        dangerValue={2}
        onCautionChange={jest.fn()}
        onDangerChange={jest.fn()}
        formatValue={(v) => `${v.toFixed(1)} m`}
      />
    );
    const cautionInput = screen.getByRole('slider', { name: /wave caution threshold/i });
    const dangerInput = screen.getByRole('slider', { name: /wave danger threshold/i });

    expect(screen.getByText(/Caution 1.5 m/)).toBeInTheDocument();
    expect(screen.getByText(/Danger 2.0 m/)).toBeInTheDocument();
    expect(cautionInput).toHaveAttribute('max', '5');
    expect(dangerInput).toHaveAttribute('min', '0');
  });

  // Regression coverage for a second real bug found in the same review: the
  // caution handle's thumb was hardcoded green (the "suitable" zone color)
  // while its own readout text was correctly orange (the "caution" color)
  // — a visible mismatch between a control and its own label. Both must
  // come from the same SUITABILITY_HAZARD_COLORS source the map legend uses.
  test('the caution and danger CSS color variables come from SUITABILITY_HAZARD_COLORS, matching the readout text', () => {
    render(
      <EnvelopeRangeSlider
        label="Wind" unit="kt" min={0} max={40} step={1}
        cautionValue={15} dangerValue={20}
        onCautionChange={jest.fn()} onDangerChange={jest.fn()}
      />
    );
    const root = screen.getByRole('group', { name: /wind operating envelope/i });
    expect(root.style.getPropertyValue('--envelope-caution-color')).toBe('#FB8C00');
    expect(root.style.getPropertyValue('--envelope-danger-color')).toBe('#E53935');
  });
});
