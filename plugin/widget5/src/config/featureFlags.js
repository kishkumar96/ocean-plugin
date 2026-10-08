// Build-time feature switches (CRA inlines REACT_APP_* at build time, so a change needs a rebuild).

// RiskScape flood impact (damage figures, MHWS scenarios, impact map layers, impact PDF).
// Off unless REACT_APP_ENABLE_IMPACT=true. When off, the "Inundation" tab keeps the
// inundation layer and its controls; only the impact parts are hidden and not fetched.
export const IMPACT_ENABLED = process.env.REACT_APP_ENABLE_IMPACT === 'true';
