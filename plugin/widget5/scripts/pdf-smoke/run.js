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
const { buildCookIslandsLandingAreaComparisonPdfDoc } = require(`${SRC}utils/CookIslandsLandingAreaComparisonPdf`);
const { renderCookIslandsCommsPosterPdfDoc } = require(`${SRC}utils/CookIslandsCommsPosterPdf`);
const { buildCookIslandsHarbourAdvisoryPdfDoc } = require(`${SRC}utils/CookIslandsHarbourAdvisoryPdf`);
const { buildHarbourAdvisoryBundle } = require(`${SRC}reports/harbourAdvisoryBundle`);
const { COOK_ISLANDS_HARBOUR_POINTS } = require(`${SRC}config/cookIslandsHarbourPoints`);
const { findForbiddenPhrases } = require(`${SRC}reports/reportRules`);

// A real 640x480 map-like image, so the reports' map boxes are exercised with a meaningful picture.
const PNG = `data:image/png;base64,${fs.readFileSync(path.join(__dirname, 'map-fixture.png')).toString('base64')}`;
const H = 3600e3; const T0 = Date.UTC(2026, 8, 24, 0);
const iso = (h) => new Date(T0 + h * H).toISOString();
const B = { west: -160.05, south: -21.5, east: -159.5, north: -21.0 };

let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) { failures += 1; console.error(`  FAIL ${name} ${detail}`); } else console.log(`  ok   ${name}`); };

function inspect(name, doc, { pages, mustContain = [], mustNotContain = [], rawMustContain = [], rawMustNotContain = [], size = 'a4-landscape', minImage = 0 }) {
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
  // Rotated text (the watermark) is invisible to -layout extraction but present in -raw: check it there,
  // and require it on EVERY page, not just somewhere.
  if (rawMustContain.length || rawMustNotContain.length) {
    const raw = execFileSync('pdftotext', ['-raw', file, '-']).toString().replace(/\s+/g, ' ');
    rawMustContain.forEach((re) => check(`raw text contains ${re}`, re.test(raw)));
    rawMustNotContain.forEach((re) => check(`raw text omits ${re}`, !re.test(raw)));
  }
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
  // a bulk outlook that returns only the first few steps of the grid it was asked for
  const truncatedSeries = async (b, { startIndex }) => ({
    vessels: Object.fromEntries(['traditional_craft', 'very_small_motorised_craft', 'small_craft', 'larger_vessels'].map((v) => [v, [0, 6, 12].map((k) => ({ ...stepFor(startIndex + k, v, b), suitable: 100, caution: 0, warning: 0 }))])),
  });
  inspect('domain_truncated_outlook', await dom({ horizonHours: 72 }, { fetchSeries: truncatedSeries }), {
    pages: 6, minImage: 100,
    mustContain: [/Not assessed: only \d+% of outlook steps had a model value/, /could not be assessed and are shown as Unavailable/],
    mustNotContain: [/None: no run without Caution or Warning points/],
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
  // landing site with most steps missing: the operating window is withheld, never "none"
  const sparse = { ...site, steps: steps.map((st, i) => (i % 4 === 0 ? st : { ...st, hazard_class: null })) };
  const sparseBundle = buildLandingSiteReportBundle({ site: sparse, rows: [sparse], omittedSites: [], vesselCode: 'small_craft', vesselLabel: 'Small craft', validTime: iso(0), timeDisplayZone: 'Pacific/Rarotonga', meta, mapDataUrl: PNG, mapBounds: { west: -159.85, east: -159.74, south: -21.25, north: -21.15 }, now: () => new Date(T0 + 2 * H) });
  inspect('landing_site_low_coverage', (await renderCookIslandsLandingSiteAdvisoryPdfDoc(sparseBundle)).doc, {
    pages: 3, minImage: 100,
    // three cards sit side by side, so the extracted text interleaves their wrapped lines: assert short fragments
    mustContain: [/Not assessed: only \d+% of forecast steps had a model value, too few to/, /name an operating window/],
    mustNotContain: [/No period without Caution or Warning conditions in this forecast/],
  });
  inspect('landing_site', (await renderCookIslandsLandingSiteAdvisoryPdfDoc(siteBundle)).doc, {
    minImage: 100, pages: 3, mustContain: [/500 m radius around the site/, /best operating windows/i, /mixed methods|different aggregation methods/, /Not shown — no model data returned for: Oneroa Landing/, /Model run 2026-09-23 12:00 UTC/],
  });

  // landing area comparison (the matrix brief, distinct from the single-site advisory above)
  const compSteps = (basis) => Array.from({ length: 229 }, (_, i) => ({
    time_index: i, valid_time: iso(i), hazard_class: i % 3, point_count: 54, statistics_basis: basis,
  }));
  const compareRows = [
    { id: 'a', name: 'Avatiu Harbour', statistics_basis: 'area_500m', point_count: 54, steps: compSteps('area_500m') },
    { id: 'b', name: 'Aroa Passage', statistics_basis: 'nearest_point_fallback', point_count: 1, steps: compSteps('nearest_point_fallback') },
  ];
  const { doc: compareDoc } = await buildCookIslandsLandingAreaComparisonPdfDoc({
    rows: compareRows, omittedSites: ['Out of domain reef'], vesselLabel: 'Small craft', timeDisplayZone: 'UTC', now: () => new Date(T0),
  });
  inspect('landing_area_comparison', compareDoc, {
    pages: 1, mustContain: [/Landing Area Suitability Advisory Brief/, /Avatiu Harbour/, /Aroa Passage/, /mixed methods/, /Out of domain reef/, /2 sites compared/],
  });

  // A failed primary map with no on-screen fallback must block export outright --
  // a polished PDF with a blank map frame is worse than no PDF (see
  // domainReportBundle.js's ReportExportBlockedError). It must never be silently
  // dropped into a warning on an otherwise-normal report.
  let blockedError = null;
  try {
    await buildDomainReportBundle({ ...base, horizonHours: 0 }, deps({ fetchMap: async () => { throw new Error('HTTP 502'); } }));
  } catch (e) { blockedError = e; }
  check('domain map failure with no fallback blocks export', blockedError?.name === 'ReportExportBlockedError', String(blockedError));
  check('the block reports its reason', /HTTP 502/.test(blockedError?.message || ''), blockedError?.message);

  // The same failure with a verified on-screen screenshot fallback must still
  // produce a real report -- the map is present (flagged as a fallback), and the
  // PDF says so in its own words rather than passing it off as a service render.
  const mapFailureDoc = await dom({ horizonHours: 0, fallbackMapDataUrl: PNG }, { fetchMap: async () => { throw new Error('HTTP 502'); } });
  inspect('domain_map_failure_fallback', mapFailureDoc, {
    pages: 2, minImage: 100,
    mustContain: [/screenshot of the on-screen map/, /Model run 2026-09-23 12:00 UTC/],
  });

  // scenario
  const dec = (w, c, wn, un) => ({ worstHazardClass: w, primaryDriver: 'wind', suitablePercent: 100 - c - wn, cautionPercent: c, warningPercent: wn, unavailableSamples: un, totalSamples: 20, durationHours: 5 });
  const sc = (id, name, d, ins, run) => ({ id, name, vessel: 'small_craft', vesselLabel: 'Small craft', speedKt: 8, departureTime: iso(6), status: 'ready', decision: d, insufficientCoverage: ins, modelRunStartAtRun: run, timeline: [0, 1, 1, null, 0] });
  const scen = await buildCookIslandsScenarioComparisonPdfDoc({ scenarioComparison: { scenarios: [sc('a', 'Alpha', dec(1, 30, 0, 0), false, iso(-12)), sc('b', 'Thin', dec(0, 0, 0, 18), true, iso(-24))], recommendedId: 'a', consistency: { distinctModelRuns: [iso(-24), iso(-12)], modelRunsDiffer: true, unknownModelRunCount: 0, geometryConsistent: true }, generatedAt: iso(0) } }, { timeDisplayZone: 'UTC' });
  inspect('scenario', scen.doc, { pages: 1, mustContain: [/INSUFFICIENT COVERAGE/, /different forecast runs/, /Why Alpha is recommended/, /Model run:/] });

  // route
  const samples = Array.from({ length: 30 }, (_, i) => ({ sample_index: i, eta: iso(i * 0.25), distance_nm: i, lat: -21.2 + i * 0.01, lon: -159.8, hazard_class: i > 26 ? null : i % 10 > 6 ? 2 : i % 10 > 3 ? 1 : 0, available: i <= 26, wave_height_m: 1, wind_speed_kt: 12 }));
  const route = await buildCookIslandsRouteAdvisoryPdfDoc({ result: { departure_time: iso(0), samples, summary: { distance_nm: 15, duration_hours: 7, worst_hazard_class: 2 } }, vessel: 'small_craft', speedKt: 8, modelRunStart: iso(-14), superseded: true });
  inspect('route', route.doc, { pages: 2, mustContain: [/Coverage: (high|reduced|insufficient)/, /SUPERSEDED/, /Forecast age/] });

  // harbour conditions advisory (16 real harbours; fixture conditions)
  const hStep = (i, hs, wind, tp) => ({ valid_time: iso(i), wave_height_m: hs, wind_speed_kt: wind, tp_s: tp, dir_deg: 75 });
  const harbourRows = COOK_ISLANDS_HARBOUR_POINTS.map((p, n) => {
    const base = 0.6 + (n % 5) * 0.35;
    const steps = Array.from({ length: 72 }, (_, i) => hStep(i, base + 0.5 * Math.sin(i / 9), 10 + (n % 4) * 3, 9 + (n % 3)));
    return {
      ...p, available: n !== 7, validTime: iso(0), waveHeightM: steps[0].wave_height_m, peakPeriodS: steps[0].tp_s, peakDirectionDeg: 75,
      windSpeedKt: steps[0].wind_speed_kt, periodWithheld: false, waveRunStart: iso(-6),
      outlookSteps: n === 7 ? [] : steps.slice(0, 24), outlook72Steps: n === 7 ? [] : steps,
      // Every 4th harbour samples a wave-model node more than 2 km away.
      waveNode: n === 7 ? null : { lon: p.lon, lat: p.lat - 0.02, distanceKm: n % 4 === 0 ? 3.9 : 0.6 },
      unavailableReason: n === 7 ? 'Forecast has no step within 90 min of now (nearest is 3.1 days before now).' : null,
    };
  });
  const approvedMeta = { version: 2, approvedBy: 'Fixture Ports Authority', approvedOn: '2026-09-01T00:00:00Z', effectiveFrom: '2026-09-02T00:00:00Z' };
  const limitsCfg = { default: { caution: { hsM: 1.2, tpS: null, windKt: 20 }, stop: { hsM: 1.8, tpS: null, windKt: 28 } }, harbours: {} };
  const hb = (over) => buildHarbourAdvisoryBundle({ rows: harbourRows, suitabilityRunStart: iso(-6), timeDisplayZone: 'Pacific/Rarotonga', generatedAt: new Date(T0 + 2 * H), ...over });

  inspect('harbour_approved', (await buildCookIslandsHarbourAdvisoryPdfDoc(hb({ limits: { basis: 'approved', config: limitsCfg, meta: approvedMeta } }))).doc, {
    pages: 2,
    mustContain: [/Harbour Conditions Advisory/, /Avatiu Harbour/, /Takuua Passage/, /version 2, approved by Fixture Ports Authority/, /Exceeds (caution|stop) limit|Within limits/, /no step within 90 min of now/, /Next 72 hours/, /Sig\. wave/, /Max wind/, /Wave node/, /Wave height [0-9.]+ m, over (stop|caution) [0-9.]+ m/, /Hs = significant wave height/, /3\.9 km/, /wave-model point more than 2 km/, /Stop limit \(approved/, /Not navigation advice|not navigation advice/, /Harbour forecast run 2026-09-23/],
    mustNotContain: [/DRAFT/, /\(PROVISIONAL\)/],
    rawMustNotContain: [/LIMITS - NOT APPROVED/],
  });
  inspect('harbour_provisional', (await buildCookIslandsHarbourAdvisoryPdfDoc(hb({ limits: { basis: 'provisional', config: limitsCfg, meta: { version: 0 } } }))).doc, {
    pages: 2,
    mustContain: [/PROVISIONAL placeholder values, NOT confirmed by Cook Islands Government/, /indicative only/, /Exceeds (caution|stop) limit|Within limits/, /PROVISIONAL, not confirmed/, /Verdict now \(PROVISIONAL\)/, /Worst next 24 h \(PROVISIONAL\)/],
    // the watermark: once per page, so twice in a two-page report
    rawMustContain: [/(PROVISIONAL LIMITS - NOT APPROVED.*){2}/],
    mustNotContain: [/approved by/],
  });
  // forecast that ends early: the 24 h and 72 h windows are short
  const partialRows = harbourRows.map((r, n) => (r.available ? { ...r, outlookSteps: r.outlookSteps.slice(0, n % 2 ? 10 : 24), outlookMissingHours: n % 2 ? 14 : 0, outlook72Steps: r.outlook72Steps.slice(0, 30), outlook72MissingHours: 42 } : r));
  inspect('harbour_partial_windows', (await buildCookIslandsHarbourAdvisoryPdfDoc(hb({ rows: partialRows, limits: { basis: 'approved', config: limitsCfg, meta: approvedMeta } }))).doc, {
    pages: 2,
    mustContain: [/less than a full 24 h of forecast/, /Incomplete data/, /Only 30 of 72 h of forecast available/, /\* Less than a full 24 h of forecast is available/],
  });
  inspect('harbour_draft', (await buildCookIslandsHarbourAdvisoryPdfDoc(hb({ limits: { basis: 'draft', config: limitsCfg, meta: null } }))).doc, {
    pages: 2, mustContain: [/DRAFT, entered locally and NOT approved/, /DRAFT, not approved/, /Verdict now \(DRAFT\)/],
    rawMustContain: [/(DRAFT LIMITS - NOT APPROVED.*){2}/],
  });
  inspect('harbour_no_limits', (await buildCookIslandsHarbourAdvisoryPdfDoc(hb({}))).doc, {
    pages: 2, mustContain: [/No approved unloading limits have been set/, /No unloading limits applied/], mustNotContain: [/Within limits/, /Exceeds (caution|stop) limit/, /\(PROVISIONAL\)/],
    rawMustNotContain: [/LIMITS - NOT APPROVED/],
  });
  // As the live hook produces them: when the feeds are different cycles the period is
  // never joined onto the steps at all, so neither the current row nor any step has it.
  const stripWave = (steps) => steps.map((st) => ({ valid_time: st.valid_time, wave_height_m: st.wave_height_m, wind_speed_kt: st.wind_speed_kt }));
  const withheldRows = harbourRows.map((r) => ({
    ...r, periodWithheld: true, peakPeriodS: null, peakDirectionDeg: null,
    outlookSteps: stripWave(r.outlookSteps), outlook72Steps: stripWave(r.outlook72Steps),
  }));
  inspect('harbour_stale_withheld', (await buildCookIslandsHarbourAdvisoryPdfDoc(hb({
    rows: withheldRows, suitabilityRunStart: iso(-40),
    limits: { basis: 'approved', config: { ...limitsCfg, default: { ...limitsCfg.default, stop: { hsM: 9, tpS: 14, windKt: null } } }, meta: approvedMeta },
  }))).doc, {
    pages: 2, mustContain: [/Forecast may be outdated: the model run is 42 h old/, /Peak period and wave direction are withheld/, /withheld/, /Incomplete data/],
    mustNotContain: [/Within limits/],
  });

  // route shaped like the live Pukapuka -> Nassau forecast that exposed the critical-point bug:
  // every sample past the first is Warning, the departure sample only just (20.9 kt, 0.24 m),
  // and the real hazard is offshore (3.19 m against a 2.0 m line).
  const liveSamples = Array.from({ length: 26 }, (_, i) => {
    const offshore = i >= 8 && i <= 18;
    return {
      sample_index: i, eta: iso(i * 0.25), distance_nm: i * 2, lat: -10.85 - i * 0.028, lon: -165.85 + i * 0.017, available: true,
      wind_speed_kt: i === 0 ? 20.9 : offshore ? 22.4 : 20.6, wave_height_m: i === 0 ? 0.24 : offshore ? (i === 13 ? 3.19 : 2.6) : 1.1, hazard_class: 2,
    };
  });
  const midpointConditions = {
    lat: -11.176, lon: -165.634, headingDeg: 151, etaIso: iso(3.25), validTime: iso(3), waveRunStart: iso(-6),
    hsM: 3.0, tpS: 9.2, dirDeg: 125, dirPoint: 'SE', angleOffBowDeg: 26, angleText: 'Head seas',
    windSea: { hsM: 2.9, tpS: 9.1, dirDeg: 126, dirPoint: 'SE' }, primarySwell: { hsM: 0.9, tpS: 11.4, dirDeg: 184, dirPoint: 'S' },
  };
  const liveRoute = await buildCookIslandsRouteAdvisoryPdfDoc({
    result: { departure_time: iso(0), start_label: 'Pukapuka', destination_label: 'Nassau', samples: liveSamples, summary: { distance_nm: 52, duration_hours: 6.5, worst_hazard_class: 2, recommendation: 'Warning' } },
    vessel: 'small_craft', speedKt: 8, modelRunStart: iso(-6), midpointConditions,
  });
  inspect('route_live_like', liveRoute.doc, {
    pages: 2,
    mustContain: [/CRITICAL POINT/, /Wave 3\.19 m/, /26\.0 nm along route/, /MIDPOINT WAVE CONDITIONS/, /Head seas \(26° off the bow\)/, /Primary swell 0\.90 m/, /Wind sea 2\.90 m/, /Modelled guidance only/, /no approving authority/, /Caution \/ Warning: waves \(right axis\)/, /Destination/, /Critical point/, /Midpoint wave feed: run starts/],
    mustNotContain: [/0\.0 nm along route/],
  });
  const noMid = await buildCookIslandsRouteAdvisoryPdfDoc({
    result: { departure_time: iso(0), samples: liveSamples, summary: { distance_nm: 52, duration_hours: 6.5, worst_hazard_class: 2, recommendation: 'Warning' } },
    vessel: 'small_craft', speedKt: 8, modelRunStart: iso(-6), midpointConditions: null,
  });
  inspect('route_midpoint_unavailable', noMid.doc, { pages: 2, mustContain: [/Midpoint wave conditions \(period, direction, swell\) were unavailable/], mustNotContain: [/MIDPOINT WAVE CONDITIONS/] });

  console.log(failures ? `\npdf-smoke: ${failures} check(s) failed` : '\npdf-smoke: all checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('pdf-smoke crashed:', e); process.exit(1); });
