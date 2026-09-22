import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import RiskDetailsPanel from '../RiskDetailsPanel';
import { getEffectiveRiskLevel, getRiskThresholdOverride } from '../../../services/riskDataService';

// WaterLevelChart renders a <canvas> via chart.js, which throws in jsdom
// (no real 2D context) -- irrelevant to what this test actually covers, so
// it's stubbed out rather than pulled into scope.
jest.mock('../WaterLevelChart', () => () => null);

// getEffectiveRiskLevel is the one function under test here (indirectly,
// via the badge it drives) -- mocked to a fixed "saved" value so the test
// controls it directly instead of depending on riskDataService's real
// localStorage/server-cache plumbing.
jest.mock('../../../services/riskDataService', () => ({
  getRiskThresholdOverride: jest.fn(() => null),
  saveRiskThresholdOverride: jest.fn(() => Promise.resolve()),
  getEffectiveRiskLevel: jest.fn(),
  RISK_COLORS: { 0: '#3498db', 1: '#f39c12', 2: '#e74c3c' },
  RISK_LABELS: { 0: 'No Risk', 1: 'Minor Risk', 2: 'Moderate Risk' },
}));

// CRA's jest preset sets resetMocks: true, which strips a jest.fn(impl)'s
// implementation before every test -- so the return value has to be set
// here, per test, not just once in the factory above (confirmed live: the
// factory's `() => 0` was silently gone by the time the test body ran,
// leaving every call return undefined instead).
beforeEach(() => {
  getEffectiveRiskLevel.mockReturnValue(0);
  getRiskThresholdOverride.mockReturnValue(null);
});

const basePoint = {
  id: 1,
  lat: -21.28,
  lon: -159.75,
  riskLevel: 0,
  maxTWL: 1.5,
  thresholds: [1.8, 2.2],
  island: 'Rarotonga',
};

// Regression test for the bug found in review: the header badge used to be
// driven by the live, unsaved threshold inputs (derivedRiskLevel) instead
// of the point's actual saved/effective risk level -- so typing a new
// threshold immediately repainted the badge as if that edit were already
// live, before Save was ever clicked. A screenshot or a glance mid-edit
// would then misrepresent the point's real current risk status.
test('header badge reflects saved risk level, not an in-progress unsaved edit', () => {
  render(<RiskDetailsPanel data={{ point: basePoint, details: null }} />);

  // Saved state (mocked getEffectiveRiskLevel -> 0) renders as "No Risk".
  expect(screen.getByText('No Risk')).toBeInTheDocument();
  expect(screen.queryByText(/would become/i)).not.toBeInTheDocument();

  // maxTWL (1.5) sits above this new minor threshold (0.5) but below the
  // unchanged moderate threshold (2.2) -- would compute to "Minor Risk" if
  // saved right now.
  fireEvent.change(screen.getByLabelText(/minor flood threshold/i), { target: { value: '0.5' } });

  // The badge must NOT have moved to reflect the unsaved edit.
  expect(screen.getByText('No Risk')).toBeInTheDocument();
  // A separate, clearly-labeled preview should appear instead.
  expect(screen.getByText(/would become/i)).toBeInTheDocument();
  expect(screen.getByText('Minor Risk')).toBeInTheDocument();
});
