// backendTime.js
// Parsing of timestamps that come from the backend.
//
// The zarr-api emits numpy datetime64 strings -- UTC, but with NO zone designator
// ("2026-09-28T06:00:00.000000000"). ECMAScript reads a date-time string without a
// designator as the VIEWER'S LOCAL time, so `new Date(thatString)` silently shifts
// every such timestamp by the viewer's own UTC offset: 12 h early for a viewer in NZ,
// 10 h late in Rarotonga, correct only in UTC. That shifted the suitability timeline
// labels (and from them the stale banner, PDF model-run times and default departure).
// Anything parsing a backend timestamp that may lack a designator goes through here.

const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// Returns a Date (Invalid Date for missing/unparseable input -- callers check isNaN,
// the same contract `new Date(x)` has). A zone-less date-time is taken as UTC; an
// explicit zone/offset is honoured; a bare date is UTC midnight (as the spec has it).
export function parseUtcTimestamp(value) {
  if (typeof value !== 'string') return new Date(NaN);
  const cleaned = value.trim().replace(/\.0+$/, '').replace(' ', 'T');
  if (!cleaned) return new Date(NaN);
  if (DATE_ONLY.test(cleaned)) return new Date(cleaned);
  return new Date(HAS_ZONE.test(cleaned) ? cleaned : `${cleaned}Z`);
}
