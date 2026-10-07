// Relative Niño3.4 outlook for the seasonal SST outlook card: the BOM
// ACCESS-S2 monthly forecast (ensemble mean and % of members past ±0.8 °C) and
// the NOAA CPC RONI outlook (percentiles per 3-month season). Neither site
// sends CORS headers, so this route fetches and parses them server side.
//
// Response:
// {
//   bom: { run: "2026-10-03", months: [{ month: "2026-10", mean: 3.4,
//          above: 100, neutral: 0, below: 0 }, ...] } | null,
//   roni: { issued: "September 2026", seasons: [{ season: "ASO",
//           month: "2026-09" (centre month), p5, p25, p50, p75, p95 }, ...] } | null
// }

const BOM_ARCHIVE = "https://www.bom.gov.au/climate/ocean/outlooks/archive/";
const RONI_PAGE =
  "https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/outlook/";

// Both update at most weekly; refetch at most every 6 hours.
const CACHE_MS = 6 * 60 * 60 * 1000;
let cached: { at: number; body: string } | null = null;

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
/** "Oct 2026" -> "2026-10" (null if not a month). */
function monthKey(label: string) {
  const [mon, year] = label.trim().split(/\s+/);
  const m = MONTHS.indexOf(mon);
  return m < 0 || !/^\d{4}$/.test(year)
    ? null
    : `${year}-${String(m + 1).padStart(2, "0")}`;
}

async function get(url: string) {
  const res = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res;
}

type BomMonth = {
  month: string;
  mean: number;
  above: number;
  neutral: number;
  below: number;
};

/** Latest ACCESS-S2 relative Niño3.4 forecast run. */
async function loadBom() {
  const index = await (await get(`${BOM_ARCHIVE}archive_index.json`)).json();
  const runs = [
    ...new Set(JSON.stringify(index).match(/\d{4}-\d{2}-\d{2}/g) ?? []),
  ].sort();
  // Newest run first; fall back to the one before if its file isn't up yet.
  for (const run of runs.slice(-2).reverse()) {
    try {
      const res = await get(
        `${BOM_ARCHIVE}${run.replace(/-/g, "")}/plumes/sstOutlooks.rnino34.json`,
      );
      const { data } = await res.json();
      const months: BomMonth[] = [];
      for (const [label, mean] of Object.entries(data.mean ?? {})) {
        const month = monthKey(label);
        if (!month || typeof mean !== "number") continue; // "NaN" = no forecast
        const f = data.frequency?.[label] ?? {};
        const pick = (re: RegExp) =>
          Number(Object.entries(f).find(([k]) => re.test(k))?.[1] ?? NaN);
        months.push({
          month,
          mean: Math.round(mean * 100) / 100,
          above: pick(/^above/),
          neutral: pick(/^neutral/),
          below: pick(/^below/),
        });
      }
      if (months.length) return { run: data.init_date ?? run, months };
    } catch {
      // try the previous run
    }
  }
  throw new Error("No BOM rnino34 forecast");
}

/** NOAA CPC RONI outlook table: percentiles per overlapping 3-month season. */
async function loadRoni() {
  const html = await (await get(RONI_PAGE)).text();
  const issued = html.match(/Issued\s+([A-Za-z]+\s+\d{4})/)?.[1] ?? null;
  const table = html.match(
    /<table id="outlook-table">([\s\S]*?)<\/table>/,
  )?.[1];
  if (!table) throw new Error("No RONI outlook table");

  const seasons = [];
  let centre: number | null = null; // month index (year * 12 + month)
  for (const row of table.split(/<tr[\s>]/).slice(1)) {
    const season = row.match(/<abbr>\s*([A-Z]{3})\b/)?.[1];
    const span = row.match(/role="tooltip">([^<]+)</)?.[1]; // "Aug Sep Oct"
    const values = [...row.matchAll(/<td>\s*(-?[\d.]+)\s*<\/td>/g)].map((m) =>
      Number(m[1]),
    );
    if (!season || values.length !== 7) continue;
    if (centre === null) {
      // First season's centre month, in the year nearest the issue date.
      const mid = MONTHS.indexOf(span?.trim().split(/\s+/)[1] ?? "");
      const ref = issued
        ? monthKey(issued.slice(0, 3) + issued.slice(-5))
        : null;
      if (mid < 0 || !ref) throw new Error("Can't date RONI seasons");
      const refIndex = Number(ref.slice(0, 4)) * 12 + Number(ref.slice(5)) - 1;
      const year = Number(ref.slice(0, 4));
      centre = [year - 1, year, year + 1]
        .map((y) => y * 12 + mid)
        .reduce((a, b) =>
          Math.abs(b - refIndex) < Math.abs(a - refIndex) ? b : a,
        );
    } else {
      centre += 1; // seasons step one month at a time
    }
    const [p5, , p25, p50, p75, , p95] = values;
    seasons.push({
      season,
      month: `${Math.floor(centre / 12)}-${String((centre % 12) + 1).padStart(2, "0")}`,
      p5,
      p25,
      p50,
      p75,
      p95,
    });
  }
  if (!seasons.length) throw new Error("Empty RONI outlook table");
  return { issued, seasons };
}

export async function GET() {
  if (!cached || Date.now() - cached.at > CACHE_MS) {
    const [bom, roni] = await Promise.allSettled([loadBom(), loadRoni()]);
    const body = {
      bom: bom.status === "fulfilled" ? bom.value : null,
      roni: roni.status === "fulfilled" ? roni.value : null,
    };
    if (body.bom || body.roni) {
      cached = { at: Date.now(), body: JSON.stringify(body) };
    } else if (!cached) {
      return new Response(null, { status: 502 });
    }
    // Both failed but an older copy exists: keep serving it.
  }
  return new Response(cached.body, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
