# widget5 — Cook Islands Wave & Inundation Forecast frontend

A create-react-app single-page app: MapLibre map, forecast/inundation/suitability
layers, RiskScape flood-impact assessment, and a set of PDF advisory reports. It
is one of several plugin apps in this monorepo (see `../widget1` for the sibling
this one's PDF theme and report structure were ported from).

## Commands

- `npm start` — dev server on :3000. If it's already running (another session's),
  use `PORT=3100 npm start` rather than fighting over the port.
- `npm test -- --watchAll=false` — CRA/Jest, `resetMocks: true`. Run this and
  `npx eslint <changed files>` before calling anything done.
- `npm run build` — production build to `build/`. Always run this before telling
  the user a change is ready; a passing test suite does not guarantee the build
  compiles (CRA's build has its own lint-as-error pass).
- `npm run test:pdf` — real-jsPDF smoke test for every PDF report (`scripts/pdf-smoke/run.js`,
  via sucrase, no jsdom). Requires poppler (`pdfinfo`/`pdftotext`/`pdfimages`) —
  skips itself if not installed. Run this whenever a PDF renderer or report bundle
  changes; the Jest suite mocks jsPDF and won't catch a real rendering bug.

## Architecture

- **Map layer stack**: `hooks/useZarrMap.js` (MapLibre instance + all Cook Islands
  overlays: risk points, MHWS contour/flood layers, impact assets/districts, route
  drawing) and `lib/*Overlay.js` (one class per data-driven layer: `SfincsRasterOverlay`
  for inundation depth, `UgridOverlay` for wave fields, `CookIslandsSuitabilityOverlay`/
  `CookIslandsSuitabilityDynamicOverlay`). A layer's config lives in
  `lib/mapLayersConfig.js` / `config/layerConfig.js` — bounds there must match the
  backend's actual raster/dataset extent, not be eyeballed (see the git-blame comment
  on `RAROTONGA_INUNDATION_BOUNDS` for what happens when they drift).
- **Backend**: a single FastAPI `main.py` (zarr-api, not in this repo — see the
  `reference_live_backend_host` memory) serving Zarr-backed rasters, RiskScape
  impact CSVs/GeoJSON, and Cook Islands suitability data. `services/*.js` are the
  fetch wrappers; `REACT_APP_SFINCS_API_BASE` (`.env.local`) points at it.
  Never assume a shape the backend hasn't confirmed — cross-check against the
  live host when in doubt.
- **Flood-impact assessment**: `components/impact/` (`ImpactTabPanel.jsx` compact
  sidebar view, `CookIslandsImpactPanel.jsx` full bottom-sheet/expanded view,
  shared formatting in `impactFormat.js`, MHWS-adjusted-area fetching in
  `useMhwsSummaries.js`). RiskScape numbers and the MHWS land-area figures measure
  different things (event-impact vs. land-above-tide-line) and can legitimately
  disagree — don't conflate them in UI copy.
- **PDF reports**: `src/reports/*Bundle.js` (data-fetching + validation) →
  `src/utils/CookIslands*Pdf.js` (pure rendering, jsPDF). All reports share one
  theme (`src/utils/pdfTheme.js`) and one editorial rulebook (`src/reports/reportRules.js`
  — e.g. "Warning" not "Avoid", missing data is never coerced to 0, no "safe/proceed"
  language). Read `reportRules.js` before adding report copy.
- **Suitability**: `components/suitability/` + `lib/CookIslandsSuitability*Overlay.js`.
  Land/off-mesh classification and vessel envelope thresholds are backend-driven;
  don't hardcode a threshold the API already returns.

## Working conventions

- **RiskScape is off-limits.** `/mnt/DATA/production/rs-projects/IBF` (owned by
  another team) is never edited from here. Impact/exposure issues get fixed in
  this frontend or in the zarr-api backend, not in the RiskScape project.
- **Backend changes are staged, not applied.** This app's backend is a single
  bind-mounted `main.py` on a remote host; a patch is prepared as a new
  `main.py.<tag>-staged` file and handed to the user to swap in (`mv` + Docker
  Compose recreate) — never edited or deployed directly from here. See the
  `reference_live_backend_host` and `project_hazard_block_serving` memories for
  the exact mechanics and version history.
- **Nothing here auto-deploys.** The running app is served by a `plugin-widget5`
  Docker container behind nginx; a build only takes effect once the user deploys
  `build/` into it and hard-refreshes. Don't report a UI fix as "live" — say the
  build is ready and deployment is the user's step.
- **Verify visually before claiming a UI fix works.** A temporary second dev
  server (`PORT=3100 npm start`) plus a Playwright screenshot is the standard way
  to check a change in a real browser without disturbing whatever the user has
  running on :3000. Stop the temporary server afterwards.
- **Cross-check geodata against a second source before trusting it.** Map/asset
  offsets in this codebase have repeatedly turned out to be real (registration
  between SFINCS's grid and the LiDAR DTM, RiskScape output CRS, tile bounds) —
  verify coordinates/CRS/bounds against source files or the live backend rather
  than reasoning from the code alone when a user reports something looks wrong.
- Commit messages / PR descriptions: this repo has no CLAUDE.md of its own, so
  the harness's standard attribution footer applies.
- Make sure all agent commits are renamed to me 

