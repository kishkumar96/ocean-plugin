// 850 hPa trade wind index anomalies (m/s) from NOAA CPC, for the ENSO status
// card. The files have no CORS headers, so the browser can't read them
// directly; this route fetches and parses them server side.
//
// Each file has three blocks (ORIGINAL DATA, ANOMALY, STANDARDIZED DATA) of
// fixed-width rows: a 4-digit year then 12 months of 6 characters each.
// Missing months are -999.9, and negative values can run together
// ("-2.2-999.9"), so values are read by column, not split on spaces.
//
// Response: { west: { "YYYY-MM": anomaly }, central: { ... }, source }.

const SOURCES = {
  // 135°E–180°, 5°N–5°S
  west: "https://www.cpc.ncep.noaa.gov/data/indices/wpac850",
  // 175°W–140°W, 5°N–5°S
  central: "https://www.cpc.ncep.noaa.gov/data/indices/cpac850",
};

// NOAA updates these monthly; refetch at most every 6 hours.
const CACHE_MS = 6 * 60 * 60 * 1000;
let cached: { at: number; body: string } | null = null;

/** "YYYY-MM" -> anomaly, from the ANOMALY block of a CPC index file. */
function parseAnomalies(text: string): Record<string, number> {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.includes("ANOMALY"));
  if (start < 0) throw new Error("No ANOMALY block");
  const months: Record<string, number> = {};
  for (const line of lines.slice(start + 1)) {
    if (/^\s*850 MB/.test(line)) break; // next block's title
    const row = line.match(/^(\d{4})(.*)$/);
    if (!row) continue;
    for (let m = 0; m < 12; m++) {
      const v = parseFloat(row[2].slice(m * 6, m * 6 + 6));
      if (Number.isFinite(v) && v > -999) {
        months[`${row[1]}-${String(m + 1).padStart(2, "0")}`] = v;
      }
    }
  }
  return months;
}

async function load(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return parseAnomalies(await res.text());
}

export async function GET() {
  if (!cached || Date.now() - cached.at > CACHE_MS) {
    try {
      const [west, central] = await Promise.all([
        load(SOURCES.west),
        load(SOURCES.central),
      ]);
      cached = {
        at: Date.now(),
        body: JSON.stringify({ west, central, source: SOURCES }),
      };
    } catch {
      // Keep serving the last good copy if NOAA is unreachable.
      if (!cached) return new Response(null, { status: 502 });
    }
  }
  return new Response(cached.body, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
