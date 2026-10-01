// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// Tests must never touch the real network. jsdom's default fetch/XHR otherwise attempts a
// real DNS lookup / TCP connection for any fetch() call a test doesn't explicitly mock --
// visible in CI logs as `getaddrinfo ENOTFOUND example.test` / `connect ECONNREFUSED
// 127.0.0.1:80` -- which is slow, flaky under real (non-sandboxed) network conditions, and
// not hermetic. This is only a safety-net default: test files that need specific responses
// already set their own `global.fetch = jest.fn(...)` (or spy on it) before use, and that
// assignment runs after this one and simply replaces it for that file.
beforeEach(() => {
  if (typeof global.fetch !== 'function' || !global.fetch._isMockFunction) {
    global.fetch = jest.fn(() => Promise.reject(new Error('Network access is disabled in tests -- mock fetch for this test.')));
  }
});

// A console.error is almost always a real bug (an unhandled React error, a prop-types
// violation, an act() warning) and a console.warn is either the same or app code logging an
// operational condition the test should know it's exercising -- both should fail the test
// that produced them, not scroll past in CI output unnoticed. A short allowlist covers the
// handful of console.warn calls this app makes *on purpose* in an expected-degraded-data
// test path (matched against just the first argument -- the template string identifying
// which warning it is, not the interpolated detail after it).
const EXPECTED_CONSOLE_WARN_PATTERNS = [
  /^Route has \d+ points; truncated to \d+, keeping the destination\.$/,
  /^Landing-area comparison: (timeseries|fallback timeseries) unavailable for .+:$/,
  /^Harbour wave conditions: timeseries unavailable for .+:$/,
];

let consoleErrorSpy;
let consoleWarnSpy;

beforeEach(() => {
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...args) => {
    process.stderr.write(`console.error: ${args.map(String).join(' ')}\n`);
  });
  consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation((...args) => {
    process.stderr.write(`console.warn: ${args.map(String).join(' ')}\n`);
  });
});

afterEach(() => {
  // A test that spies on console.error/warn itself (asserts on calls, restores it) has
  // already replaced these before this runs -- only enforce the check when nothing else
  // has touched it since, so this global safety net can't fight a test's own, deliberate
  // console spy (see errorReporting.test.js, SfincsRasterOverlay.hazardBlock.test.js).
  const errorOwnedByUs = console.error === consoleErrorSpy;
  const warnOwnedByUs = console.warn === consoleWarnSpy;
  const errors = errorOwnedByUs ? consoleErrorSpy.mock.calls : [];
  const warnings = warnOwnedByUs
    ? consoleWarnSpy.mock.calls.filter((args) => !EXPECTED_CONSOLE_WARN_PATTERNS.some((re) => re.test(String(args[0]))))
    : [];
  if (errorOwnedByUs) consoleErrorSpy.mockRestore();
  if (warnOwnedByUs) consoleWarnSpy.mockRestore();
  if (errors.length) {
    throw new Error(`Unexpected console.error call(s) in this test:\n${errors.map((a) => a.map(String).join(' ')).join('\n')}`);
  }
  if (warnings.length) {
    throw new Error(`Unexpected console.warn call(s) in this test:\n${warnings.map((a) => a.map(String).join(' ')).join('\n')}`);
  }
});
