// concurrency.js
// Shared rate-limit helpers for anything that fans out several backend
// requests in a short window: cookIslandsScenarioService.js's "run all
// scenarios" (several /cok/suitability/route calls at once) and, later,
// CookIslandsSuitabilityPdfExporter.js's per-timestep summary fetches.
//
// Ported from widget1's SuitabilityPDFExporter.js (sleep at line 794,
// mapWithConcurrency at line 818) into its own module rather than widget5
// re-deriving/duplicating it once a second caller needs it -- widget1 found
// by hard experience that capping concurrency alone isn't enough against a
// volume-based edge rate limit (Cloudflare or similar): a burst of ~85
// concurrent requests failed in near-lockstep (~8ms apart) with
// "blocked by CORS policy", even though isolated, spaced-out requests
// against the same endpoints returned a correct origin-specific
// Access-Control-Allow-Origin header every time. Only an actual pause
// between requests (delayMs), not just a concurrency ceiling, brings the
// request *rate* down enough to avoid tripping it.

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Runs `fn` over `items` with at most `limit` calls in flight at once, and
// (if delayMs is set) a real pause after each one before that worker starts
// its next item.
export async function mapWithConcurrency(items, limit, fn, delayMs = 0) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
      if (delayMs > 0 && nextIndex < items.length) await sleep(delayMs);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
