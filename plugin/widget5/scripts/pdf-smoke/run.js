/* eslint-disable no-console */
// Real-PDF smoke test: renders every report type with real jsPDF from FIXTURE data
// (no network), then checks the actual PDF bytes with poppler's pdfinfo / pdftotext:
// page counts, required provenance text, downgrade notices, forbidden phrases, and
// that no drawn word falls outside the page. Samples are written to pdf-samples/ with
// a FIXTURE_ prefix and are not live guidance.
//
//   npm run test:pdf        (needs poppler-utils; exits 0 with a notice if it is missing)
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const SRC = path.join(__dirname, '..', '..', 'src') + path.sep;
const OUT = path.join(__dirname, '..', '..', 'pdf-samples');
fs.mkdirSync(OUT, { recursive: true });

if (spawnSync('pdfinfo', ['-v']).error) { console.log('pdf-smoke: poppler-utils (pdfinfo/pdftotext) not found; skipping.'); process.exit(0); }

const { buildDomainReportBundle } = require(`${SRC}reports/domainReportBundle`);
const { renderCookIslandsDomainAdvisoryPdfDoc } = require(`${SRC}utils/CookIslandsDomainAdvisoryPdf`);
const { buildLandingSiteReportBundle } = require(`${SRC}reports/landingSiteReportBundle`);
const { renderCookIslandsLandingSiteAdvisoryPdfDoc } = require(`${SRC}utils/CookIslandsLandingSiteAdvisoryPdf`);
const { buildCookIslandsScenarioComparisonPdfDoc } = require(`${SRC}utils/CookIslandsScenarioComparisonPdf`);
const { buildCookIslandsRouteAdvisoryPdfDoc } = require(`${SRC}utils/CookIslandsRouteAdvisoryPdf`);
const { renderCookIslandsCommsPosterPdfDoc } = require(`${SRC}utils/CookIslandsCommsPosterPdf`);
const { findForbiddenPhrases } = require(`${SRC}reports/reportRules`);

// A real 640x480 map-like image, so the reports' map boxes are exercised with a meaningful picture.
const PNG = `data:image/png;base64,${fs.readFileSync(path.join(__dirname, 'map-fixture.png')).toString('base64')}`;
const H = 3600e3; const T0 = Date.UTC(2026, 8, 24, 0);
const iso = (h) => new Date(T0 + h * H).toISOString();
const B = { west: -160.05, south: -21.5, east: -159.5, north: -21.0 };

let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) { failures += 1; console.error(`  FAIL ${name} ${detail}`); } else console.log(`  ok   ${name}`); };

function inspect(name, doc, { pages, mustContain = [], mustNotContain = [], size = 'a4-landscape', minImage = 0 }) {
  const file = path.join(OUT, `FIXTURE_${name}.pdf`);
  fs.writeFileSync(file, Buffer.from(doc.output('arraybuffer')));
  console.log(name);
  const info = execFileSync('pdfinfo', [file]).toString();
  const got = Number(/Pages:\s+(\d+)/.exec(info)?.[1]);
  check('page count', got === pages, `(got ${got}, want ${pages})`);
  // One theme: every report is A4 landscape (the A3 poster is the only deliberate exception).
  const dims = /Page size:\s+([\d.]+) x ([\d.]+)/.exec(info);
  const [pw, ph] = dims ? [Number(dims[1]), Number(dims[2])] : [0, 0];
  const want = size === 'a3-portrait' ? [841.89, 1190.55] : [841.89, 595.28];
  check(`page size ${size}`, Math.abs(pw - want[0]) < 2 && Math.abs(ph - want[1]) < 2, `(got ${pw} x ${ph})`);
  const text = execFileSync('pdftotext', ['-layout', file, '-']).toString().replace(/\s+/g, ' ');
  mustContain.forEach((re) => check(`contains ${re}`, re.test(text)));
  mustNotContain.forEach((re) => check(`omits ${re}`, !re.test(text)));
  check('no forbidden phrases', findForbiddenPhrases(text).length === 0, findForbiddenPhrases(text).join(', '));
  // every drawn word inside its page
  const bbox = execFileSync('pdftotext', ['-bbox', file, '-']).toString();
  let bad = 0;
  bbox.split('<page ').slice(1).forEach((pg) => {
    const [, w, h] = /width="([\d.]+)" height="([\d.]+)"/.exec(pg);
    for (const m of pg.matchAll(/xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)"/g)) {
      if (+m[1] < 0 || +m[2] < 0 || +m[3] > +w + 0.5 || +m[4] > +h + 0.5) bad += 1;
    }
  });
  check('no text outside the page', bad === 0, `(${bad} words)`);
  if (minImage) {
    // Rows: page num type width height ...; a 1x1 placeholder must not pass as a map.
    const rows = execFileSync('pdfimages', ['-list', file]).toString().split('\n').slice(2).map((l) => l.trim().split(/\s+/)).filter((c) => c.length > 5);
    const big = rows.filter((c) => Number(c[3]) >= minImage && Number(c[4]) >= minImage);
    check(`embeds a map image >= ${minImage}px`, big.length > 0, `(images: ${rows.map((c) => `${c[3]}x${c[4]}`).join(', ') || 'none'})`);
  }
}

const meta = { runId: '2026092312', schemaVersion: '1.0.0', forecastStart: new Date(T0 - 60 * H), forecastEnd: new Date(T0 + 168 * H), timestepCount: 229, locations: [], vessels: {} };
const stepFor = (i, v, bounds, over = {}) => ({
  timeIndex: i, validTime: T0 + i * H, vessel: v, available: true,
  suitable: v === 'traditional_craft' ? 25 : 60, caution: 25, warning: v === 'traditional_craft' ? 50 : 15,
  counts: { suitable: 60, caution: 25, warning: 15 }, classifiedPoints: 100, eligiblePoints: 100, totalPoints: 100,
  statisticsBasis: bounds ? 'points_in_bounds' : 'full_domain', requestedBounds: bounds, appliedBounds: bounds,
  domainBounds: { west: -166, south: -22.5, east: -157, north: -8.5 }, ...over,
});
const deps = (o = {}) => ({
  fetchMeta: async () => meta,
  fetchStep: async (i, v, b) => stepFor(i, v, b, i % 40 > 30 ? { warning: 40, caution: 20, suitable: 40 } : {}),
  fetchContrast: async () => ({ timeIndex: 40, validTime: T0 + 40 * H, contrastScore: 80, suitableByVessel: {}, mostSuitableVessel: 'larger_vessels', leastSuitableVessel: 'traditional_craft' }),
  fetchMap: async (v, i, b) => ({ dataUrl: PNG, appliedBounds: b }),
  ...o,
});
const base = { vessel: 'small_craft', timeIndex: 60, bounds: B, scope: 'viewport', timeDisplayZone: 'Pacific/Rarotonga', now: () => new Date(T0 + 2 * H) };

(async () => {
  const dom = async (over, d) => renderCookIslandsDomainAdvisoryPdfDoc(await buildDomainReportBundle({ ...base, ...over }, deps(d))).then((r) => r.doc);

  inspect('domain_viewport_7d', await dom({ horizonHours: 168 }), {
    minImage: 100,
    pages: 6,
    mustContain: [/Model run 2026-09-23 12:00 UTC/, /Scope: Current map view/, /MULTI-VESSEL OUTLOOK/, /SAME CONDITIONS, DIFFERENT VESSELS/, /DAILY FORECAST EVOLUTION/, /FORECAST TREND/, /METHODOLOGY, SCOPE/, /Beyond forecast horizon|Matched:/, /100 of 100 eligible|100 classified of 100 eligible/],
  });
  inspect('domain_current_only', await dom({ horizonHours: 0 }), { pages: 2, mustNotContain: [/MULTI-VESSEL OUTLOOK/] });
  inspect('domain_scope_mismatch', await dom({ horizonHours: 0 }, { fetchStep: async (i, v) => stepFor(i, v, null) }), {
    pages: 2, mustContain: [/Notice: Statistics scope differs from the request/, /Scope: Whole forecast domain/],
  });
  inspect('domain_zero_points', await dom({ horizonHours: 72 }, { fetchStep: async (i, v, b) => stepFor(i, v, b, v === 'small_craft' ? { available: false, suitable: null, caution: null, warning: null, classifiedPoints: 0, eligiblePoints: 0, totalPoints: 0 } : {}) }), {
    pages: 6, mustContain: [/No model data for the selected vessel/, /Unavailable/], mustNotContain: [/No modelled threshold exceedances/],
  });

  // communications poster (A3, one page)
  const posterDoc = (await renderCookIslandsCommsPosterPdfDoc(await buildDomainReportBundle({ ...base, horizonHours: 72 }, deps()))).doc;
  inspect('comms_poster', posterDoc, {
    minImage: 100, pages: 1, size: 'a3-portrait',
    mustContain: [/SAME OCEAN, DIFFERENT VESSELS/, /COMMUNICATIONS PRODUCT/, /not an operational advisory/, /Valid: /, /Model run 2026-09-23 12:00 UTC/, /What the colours mean/, /Modelled guidance only/],
  });

  // landing site
  const steps = Array.from({ length: 200 }, (_, i) => ({ time_index: i, valid_time: iso(i), hazard_class: i < 30 ? 0 : i < 50 ? 1 : i < 60 ? 2 : (i % 50 === 0 ? null : 0), wind_speed_kt: 9, wave_height_m: 0.5 }));
  const site = { id: 'a', name: 'Avatiu Harbour', lon: -159.795, lat: -21.198, type: 'landing_site', statistics_basis: 'area_500m', point_count: 54, steps };
  const rows = [site, { ...site, id: 'b', name: 'Aroa Passage', statistics_basis: 'nearest_point_fallback', point_count: 1 }, { id: 'c', name: 'Oneroa Landing', steps: [] }];
  const siteBundle = buildLandingSiteReportBundle({ site, rows, omittedSites: [], vesselCode: 'small_craft', vesselLabel: 'Small craft', validTime: iso(0), timeDisplayZone: 'Pacific/Rarotonga', meta, mapDataUrl: PNG, mapBounds: { west: -159.85, east: -159.74, south: -21.25, north: -21.15 }, now: () => new Date(T0 + 2 * H) });
  inspect('landing_site', (await renderCookIslandsLandingSiteAdvisoryPdfDoc(siteBundle)).doc, {
    minImage: 100, pages: 3, mustContain: [/500 m radius around the site/, /best operating windows/i, /mixed methods|different aggregation methods/, /Not shown — no model data returned for: Oneroa Landing/, /Model run 2026-09-23 12:00 UTC/],
  });

  // a failed map request must be reported in the PDF, never silently dropped
  const failed = await buildDomainReportBundle({ ...base, horizonHours: 0 }, deps({ fetchMap: async () => { throw new Error('HTTP 502'); } }));
  check('domain map failure is reported with its reason', failed.warnings.some((w) => /map could not be produced \(HTTP 502\)/.test(w)), JSON.stringify(failed.warnings));

  // scenario
  const dec = (w, c, wn, un) => ({ worstHazardClass: w, primaryDriver: 'wind', suitablePercent: 100 - c - wn, cautionPercent: c, warningPercent: wn, unavailableSamples: un, totalSamples: 20, durationHours: 5 });
  const sc = (id, name, d, ins, run) => ({ id, name, vessel: 'small_craft', vesselLabel: 'Small craft', speedKt: 8, departureTime: iso(6), status: 'ready', decision: d, insufficientCoverage: ins, modelRunStartAtRun: run, timeline: [0, 1, 1, null, 0] });
  const scen = await buildCookIslandsScenarioComparisonPdfDoc({ scenarioComparison: { scenarios: [sc('a', 'Alpha', dec(1, 30, 0, 0), false, iso(-12)), sc('b', 'Thin', dec(0, 0, 0, 18), true, iso(-24))], recommendedId: 'a', consistency: { distinctModelRuns: [iso(-24), iso(-12)], modelRunsDiffer: true, unknownModelRunCount: 0, geometryConsistent: true }, generatedAt: iso(0) } }, { timeDisplayZone: 'UTC' });
  inspect('scenario', scen.doc, { pages: 1, mustContain: [/INSUFFICIENT COVERAGE/, /different forecast runs/, /Why Alpha is recommended/, /Model run:/] });

  // route
  const samples = Array.from({ length: 30 }, (_, i) => ({ sample_index: i, eta: iso(i * 0.25), distance_nm: i, lat: -21.2 + i * 0.01, lon: -159.8, hazard_class: i > 26 ? null : i % 10 > 6 ? 2 : i % 10 > 3 ? 1 : 0, available: i <= 26, wave_height_m: 1, wind_speed_kt: 12 }));
  const route = await buildCookIslandsRouteAdvisoryPdfDoc({ result: { departure_time: iso(0), samples, summary: { distance_nm: 15, duration_hours: 7, worst_hazard_class: 2 } }, vessel: 'small_craft', speedKt: 8, modelRunStart: iso(-14), superseded: true });
  inspect('route', route.doc, { pages: 2, mustContain: [/Coverage: (high|reduced|insufficient)/, /SUPERSEDED/, /Forecast age/] });

  console.log(failures ? `\npdf-smoke: ${failures} check(s) failed` : '\npdf-smoke: all checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('pdf-smoke crashed:', e); process.exit(1); });
