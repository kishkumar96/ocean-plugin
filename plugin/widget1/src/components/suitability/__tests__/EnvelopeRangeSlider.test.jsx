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
    minGap: 1,
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

  // Regression coverage for a real bug: the original four-separate-sliders
  // implementation always spanned the input's full min/max regardless of
  // the other handle's position, so dragging one past the other silently
  // clamped in JS and snapped the thumb back on the next render instead of
  // the native slider naturally refusing to move further.
  describe('dynamic min/max clamping (the caution/danger handles constrain each other)', () => {
    test("the caution handle's max is the danger value minus minGap", () => {
      const { cautionInput } = renderSlider({ cautionValue: 15, dangerValue: 20, minGap: 1 });
      expect(cautionInput).toHaveAttribute('max', '19');
    });

    test("the danger handle's min is the caution value plus minGap", () => {
      const { dangerInput } = renderSlider({ cautionValue: 15, dangerValue: 20, minGap: 1 });
      expect(dangerInput).toHaveAttribute('min', '16');
    });

    test("the caution handle's max never goes below the slider's own min", () => {
      const { cautionInput } = renderSlider({ min: 0, cautionValue: 0, dangerValue: 0, minGap: 1 });
      expect(cautionInput).toHaveAttribute('max', '0');
    });

    test("the danger handle's min never goes above the slider's own max", () => {
      const { dangerInput } = renderSlider({ max: 40, cautionValue: 40, dangerValue: 40, minGap: 1 });
      expect(dangerInput).toHaveAttribute('min', '40');
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

  test('wave-style props (fractional step/minGap) work the same way', () => {
    render(
      <EnvelopeRangeSlider
        label="Wave"
        unit="m"
        min={0}
        max={5}
        step={0.1}
        minGap={0.1}
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
    expect(cautionInput).toHaveAttribute('max', String(2 - 0.1));
    expect(dangerInput).toHaveAttribute('min', String(1.5 + 0.1));
  });
});
