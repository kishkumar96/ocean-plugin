# Backend Prompt: Niue Suitability Raw Grid Endpoint

Implement backend support for the client-classified "dynamic suitability" overlay (`NiueSuitabilityDynamicOverlay.js`, already built on the frontend, currently unblocked-but-idle waiting on this endpoint).

## Why

Today's suitability map is served as pre-rendered PNG tiles, one per (vessel, time_index), classified server-side against four fixed vessel presets. The frontend now wants adjustable wind/wave thresholds (a "custom operating envelope" mode) rather than only the four presets. Rendering a fresh tile set per unique threshold combination would collapse the existing tile cache's hit rate to near zero and re-run the matplotlib render pipeline on every slider tick. Instead, the frontend fetches the raw wind/wave/valid raster once per timestep and reclassifies it itself on a canvas, so threshold changes are a local repaint with zero network calls. This endpoint is the only new backend surface that requires.

Required endpoint:

```http
GET /niue/suitability/grid/{time_index}
```

Contract — binary response, not JSON:

```
Content-Type: application/octet-stream

Body layout (row-major, (lat, lon), matching suit_raster_wind_kt's shape):
  bytes 0 .. count*4        wind speed, float32 little-endian, knots
  next count*4               wave height, float32 little-endian, metres
  next count                 valid mask, uint8 (1 = usable, 0 = transparent)

Headers:
  X-Grid-Width: <n_lon>
  X-Grid-Height: <n_lat>
  X-Lon-Min / X-Lon-Max / X-Lat-Min / X-Lat-Max: raster bounds (degrees)
  X-Valid-Time: ISO8601 UTC timestamp for this time_index
  X-Grid-Encoding: "wind:f32le,wave:f32le,valid:u8"
  Cache-Control: public, max-age=3600
```

A draft implementation already exists in this sandbox's `zarr-api/main.py` (inserted directly above the existing `/niue/suitability/point` route) — it's a reasonable starting point to copy from.

Backend requirements:

- Source the two bands from the same `suit_raster_wind_kt[time_index]` / `suit_raster_wave_m[time_index]` arrays the existing `render_suitability_map_png` / tile endpoints already use, so the raw grid and the existing PNG output are describing the same data.
- `valid` must be `suit_raster_valid` ANDed with the same 100km advisory buffer `render_suitability_map_png` applies via `apply_advisory_buffer_mask(..., buffer_km=100.0)` — otherwise this grid exposes more "valid" ocean than the tile overlay shows for the same timestep, and the two overlays would disagree at the domain edges. The draft implementation already does this (`apply_advisory_buffer_mask(suit_raster_valid.astype(np.int8), suit_raster_lons, suit_raster_lats, buffer_km=100.0)`, then `> 0`); keep it when porting.
- Reuse `validate_suitability_time_index` for the out-of-range check (400) and `suitability_valid_time_utc` for the timestamp — both already exist and are used by the neighboring `/niue/suitability/*` routes.
- Return a useful non-200 (503, matching `require_suit_dataset`'s existing convention) when the suitability raster isn't loaded; don't fabricate a grid.
- `suit_raster_valid` (post-buffer-mask) does not vary by `time_index`, but keep sending it on every response rather than making the client reconcile two fetch cadences — the payload cost is one byte per cell, negligible next to the two float32 bands.
- CORS/routing: none needed beyond what's already configured — same API base as every other `/niue/suitability/*` route.
- Cache hard (`max-age=3600` is a reasonable default, matching the existing `PNG_CACHE_HEADERS` cadence) — the whole point of this endpoint is that it's fetched once per timestep and never again for that timestep, no matter how many threshold combinations get tried against it client-side.
- Add a test or curl check confirming: correct byte length for `X-Grid-Width * X-Grid-Height * 9`, a 400 on out-of-range `time_index`, and a 503 when the suitability dataset isn't loaded.

Not backend work (already done, frontend-only):

- `NiueSuitabilityDynamicOverlay.js` — fetches this endpoint, caches per timestep, and reclassifies client-side into a MapLibre `canvas` source on every threshold change. Committed on branch `feature/niue-suitability-dynamic-overlay` in the widget1 repo, with unit tests covering the grid-decoding byte layout and classification parity against the existing `classifySuitability`.
- The existing `render_suitability_map_png` / tile / operational-map endpoints are unchanged and stay in place — they remain the path for the four fixed vessel presets and for PDF/report export, which still want matplotlib's cartographic decoration (coastline, legend, scale bar). This new endpoint only serves the interactive custom-threshold mode.
