// Same-origin proxy for map raster tiles (the GeoNode reference overlays).
//
// MapLibre fetches tiles in bursts and does NOT retry failed tiles, so a
// transient upstream blip leaves a permanent gap until the user pans. Here we:
//  - retry the upstream on network error, 5xx and 429 (rate limiting)
//  - buffer the bytes (avoids re-streaming issues that yield empty/garbage tiles)
//  - pass through the real image content-type + cache for a day
//  - return an EMPTY body for non-image replies (e.g. GeoWebCache's
//    "Coverage ... is outside bounds" text) or on final failure, so MapLibre
//    draws a blank tile instead of trying to decode text/HTML (InvalidStateError)
//
// Only allowlisted hosts are proxied so this can't be used as an open proxy.

const ALLOWED_HOSTS = new Set([
  "geonode.pacificdata.org",
  "ocean-plotter.spc.int",
]);
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 150;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const empty = (status: number) =>
  new Response(null, {
    status,
    headers: { "Cache-Control": "public, max-age=300" },
  });

export async function GET(req: Request) {
  const target = new URL(req.url).searchParams.get("url");
  if (!target) return empty(400);

  let targetUrl: URL;
  try {
    targetUrl = new URL(target);
  } catch {
    return empty(400);
  }
  if (
    targetUrl.protocol !== "https:" ||
    !ALLOWED_HOSTS.has(targetUrl.hostname)
  ) {
    return empty(403);
  }

  let lastStatus = 502;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const retry = attempt < MAX_ATTEMPTS;
    try {
      const upstream = await fetch(targetUrl, { redirect: "follow" });
      if (!upstream.ok) {
        lastStatus = upstream.status || 502;
        // Retry transient failures; other 4xx won't get better.
        if ((upstream.status >= 500 || upstream.status === 429) && retry) {
          await sleep(RETRY_DELAY_MS * attempt);
          continue;
        }
        return empty(lastStatus);
      }

      const contentType = upstream.headers.get("Content-Type") ?? "";
      if (!contentType.startsWith("image/")) {
        // Outside the layer's coverage: no tile here.
        return empty(204);
      }

      const buf = await upstream.arrayBuffer();
      if (buf.byteLength === 0) {
        lastStatus = 502;
        if (retry) {
          await sleep(RETRY_DELAY_MS * attempt);
          continue;
        }
        return empty(502);
      }

      return new Response(buf, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=86400",
        },
      });
    } catch {
      // Network error (connection reset / timeout) — retry.
      lastStatus = 502;
      if (retry) await sleep(RETRY_DELAY_MS * attempt);
    }
  }
  return empty(lastStatus);
}
