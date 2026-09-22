import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import EnvelopeRangeSlider from '../EnvelopeRangeSlider';

function renderSlider(overrides = {}) {
  const onCautionChange = jest.fn();
  const onAvoidChange = jest.fn();
  render(
    <EnvelopeRangeSlider
      label="Wind"
      unit="kt"
      min={0}
      max={40}
      step={1}
      cautionValue={15}
      avoidValue={20}
      onCautionChange={onCautionChange}
      onAvoidChange={onAvoidChange}
      {...overrides}
    />
  );
  return {
    onCautionChange,
    onAvoidChange,
    cautionField: screen.getByRole('spinbutton', { name: /wind caution threshold, kt/i }),
    avoidField: screen.getByRole('spinbutton', { name: /wind avoid threshold, kt/i }),
    cautionSlider: screen.getByRole('slider', { name: /wind caution threshold$/i }),
  };
}

describe('EnvelopeRangeSlider number fields', () => {
  test('shows the current thresholds', () => {
    const { cautionField, avoidField } = renderSlider();
    expect(cautionField).toHaveValue(15);
    expect(avoidField).toHaveValue(20);
  });

  test('typing a finite value routes through the same onChange as the slider', () => {
    const { cautionField, onCautionChange } = renderSlider();
    fireEvent.change(cautionField, { target: { value: '17' } });
    expect(onCautionChange).toHaveBeenCalledWith(17);
  });

  test('an emptied field does not commit a threshold', () => {
    const { avoidField, onAvoidChange } = renderSlider();
    fireEvent.change(avoidField, { target: { value: '' } });
    expect(onAvoidChange).not.toHaveBeenCalled();
  });

  test('dragging the slider forwards a numeric value', () => {
    const { cautionSlider, onCautionChange } = renderSlider();
    fireEvent.change(cautionSlider, { target: { value: '12' } });
    expect(onCautionChange).toHaveBeenCalledWith(12);
  });

  test('a field the parent clamped snaps back to the value in force on blur', () => {
    const { avoidField } = renderSlider();
    fireEvent.change(avoidField, { target: { value: '' } });
    fireEvent.blur(avoidField);
    expect(avoidField).toHaveValue(20);
  });
});
