# Backend Prompt: Niue Suitability Raw Grid Endpoint

Implement backend support for the client-classified "dynamic suitability" overlay (`NiueSuitabilityDynamicOverlay.js`, already built on the frontend, currently unblocked-but-idle waiting on this endpoint).

## Status

The CORS incident described below (missing `expose_headers`) has been confirmed fixed in production — `curl` with a real `Origin` header now returns `access-control-expose-headers: *`. Left in place as a record of what happened and why curl-only verification missed it.

**Current priority: the endpoint is live in production but still serving the original float32 format.** Custom mode works when paused, but its grid fetch (~15MB, ~1.8-2s measured against the live endpoint) is too slow to keep up with timeline playback, which advances on a fixed ~350-700ms interval regardless of fetch speed. An initial fix fell back to showing the (fast, but wrong-thresholds) preset tiles during playback — correctly rejected as not good enough, since it silently substitutes different colors than what Custom mode's own controls say it's showing. The real fix is the int16 quantization + gzip change below, which shrinks the payload ~23x and makes it fit inside a single playback tick. See "Payload format" — this is now the important part of this doc, not the CORS section.

## ⚠ Original CORS incident (fixed, kept for context)

When `/niue/suitability/grid/{time_index}` first went live, it was missing `expose_headers` on the CORS middleware, and the frontend crashed on every attempt to use Custom mode (`Failed to execute 'createImageData' ... source width is zero`, cascading into further crashes). `curl` did not reveal this bug (CORS is a browser-enforced restriction, not a server-side response difference) — verifying with curl, as the original rollout did, is exactly how this shipped unnoticed.

## Why

Today's suitability map is served as pre-rendered PNG tiles, one per (vessel, time_index), classified server-side against four fixed vessel presets. The frontend now wants adjustable wind/wave thresholds (a "custom operating envelope" mode) rather than only the four presets. Rendering a fresh tile set per unique threshold combination would collapse the existing tile cache's hit rate to near zero and re-run the matplotlib render pipeline on every slider tick. Instead, the frontend fetches the raw wind/wave/valid raster once per timestep and reclassifies it itself on a canvas, so threshold changes are a local repaint with zero network calls. This endpoint is the only new backend surface that requires.

Required endpoint:

```http
GET /niue/suitability/grid/{time_index}
```

Contract — binary response, not JSON:

```
Content-Type: application/octet-stream
Content-Encoding: gzip   (added transparently by GZipMiddleware; browsers/fetch() decompress automatically)

Body layout (row-major, (lat, lon), matching suit_raster_wind_kt's shape):
  bytes 0 .. count*2        wind speed, int16 little-endian, wind_kt * X-Wind-Scale
  next count*2               wave height, int16 little-endian, wave_m * X-Wave-Scale
  next count                 valid mask, uint8 (1 = usable, 0 = transparent)

Headers:
  X-Grid-Width: <n_lon>
  X-Grid-Height: <n_lat>
  X-Lon-Min / X-Lon-Max / X-Lat-Min / X-Lat-Max: raster bounds (degrees)
  X-Valid-Time: ISO8601 UTC timestamp for this time_index
  X-Grid-Encoding: "wind:i16le,wave:i16le,valid:u8"
  X-Wind-Scale: "100"    (wind_kt = raw_int16 / 100)
  X-Wave-Scale: "1000"   (wave_m = raw_int16 / 1000)
  Cache-Control: public, max-age=3600
```

A full implementation already exists in this sandbox's `zarr-api/main.py` (`/niue/suitability/grid/{time_index}`, plus `GZipMiddleware` added at app setup) — copy both from there.

## Payload format — why this matters more than anything else in this doc

Measured directly against a real grid pulled from the live production endpoint:

| Format | Size | vs. original |
|---|---|---|
| float32 (original) | 15,035,238 bytes | 100% |
| float32 + gzip | ~10,272,968 bytes | 68% — mantissa noise barely compresses |
| int16 quantized (no gzip) | 8,352,910 bytes | 55.6% |
| **int16 quantized + gzip** | **637,175 bytes** | **4.2% — ~23.6x smaller** |

Quantization error: max 0.005 kt (wind), 0.0005 m (wave) — irrelevant against hazard cutoffs like "caution at 15 kt" or "danger at 2.0 m". `GZipMiddleware(minimum_size=1000)` was added globally, not scoped to this one route — it's transparent to every existing endpoint and client (`fetch()` already decompresses `Content-Encoding: gzip` before `resp.arrayBuffer()` sees it), so this is a safe, low-risk addition on top of the quantization change, not an extra thing to gate behind this rollout specifically.

Why quantize *before* gzipping rather than just adding gzip alone: float32's mantissa bits are effectively high-entropy noise from upstream interpolation/computation, so gzip barely touches the raw float32 bytes (68% — barely worth it). Rounding to a fixed decimal precision (int16, scaled) removes that noise and leaves genuinely repetitive byte patterns, which is what gzip actually compresses well. Quantizing without also gzipping only gets you the 55.6% from halving the type width — the real win is doing both.

At ~640KB, a fetch comfortably fits inside a single playback tick (~350-700ms) instead of taking ~2s — this is what makes real-time-classified Custom mode playback viable, versus needing to fall back to something else while playing.

Backend requirements:

- Source the two bands from the same `suit_raster_wind_kt[time_index]` / `suit_raster_wave_m[time_index]` arrays the existing `render_suitability_map_png` / tile endpoints already use, so the raw grid and the existing PNG output are describing the same data.
- Quantize with `np.clip(np.round(wind_kt * 100), -32768, 32767).astype('<i2')` (wave: `* 1000`) after `np.nan_to_num(..., nan=0.0, posinf=0.0, neginf=0.0)` — the client never reads wind/wave wherever `valid=0`, so a well-defined-but-meaningless value for invalid cells is fine; an undefined NaN→int16 cast is not (numpy's behavior there isn't guaranteed clean).
- `valid` must be `suit_raster_valid` ANDed with the same 100km advisory buffer `render_suitability_map_png` applies via `apply_advisory_buffer_mask(..., buffer_km=100.0)` — otherwise this grid exposes more "valid" ocean than the tile overlay shows for the same timestep, and the two overlays would disagree at the domain edges.
- Reuse `validate_suitability_time_index` for the out-of-range check (400) and `suitability_valid_time_utc` for the timestamp — both already exist and are used by the neighboring `/niue/suitability/*` routes.
- Return a useful non-200 (503, matching `require_suit_dataset`'s existing convention) when the suitability raster isn't loaded; don't fabricate a grid.
- `suit_raster_valid` (post-buffer-mask) does not vary by `time_index`, but keep sending it on every response rather than making the client reconcile two fetch cadences — one byte per cell is negligible next to the two bands either way.
- **CORS: `expose_headers` must include the `X-Grid-*`/`X-Wind-Scale`/`X-Wave-Scale` headers (or `expose_headers=["*"]`).** `allow_headers=["*"]` only controls which *request* headers the browser may send; it does nothing for *response* headers. Without `expose_headers`, custom response headers come back as `null` from `resp.headers.get()`, silently, with no network-level error — confirmed fixed in production already (see Status above), but worth restating since it's the kind of thing that's easy to accidentally regress.
- Cache hard (`max-age=3600` is a reasonable default, matching the existing `PNG_CACHE_HEADERS` cadence) — the whole point of this endpoint is that it's fetched once per timestep and never again for that timestep, no matter how many threshold combinations get tried against it client-side.
- **Frontend backward compatibility is already handled** — it checks `X-Grid-Encoding` and decodes either `f32le` (legacy) or `i16le` (new, with the scale headers) — so this backend change and its frontend consumer don't need to deploy in lockstep. Deploying the quantized format alone (without a matching frontend deploy) immediately benefits anyone already running the current frontend build.
- Add a test or curl check confirming: correct byte length for `X-Grid-Width * X-Grid-Height * 5` (2 bytes wind + 2 bytes wave + 1 byte valid, pre-gzip), a 400 on out-of-range `time_index`, and a 503 when the suitability dataset isn't loaded. Also confirm gzip is actually applying: `curl -H "Accept-Encoding: gzip" -D - -o /dev/null <url>` should show `content-encoding: gzip` and a `content-length` far below the uncompressed byte count above.

Not backend work (already done, frontend-only):

- `NiueSuitabilityDynamicOverlay.js` — fetches this endpoint, caches per timestep, prefetches the next 3 timesteps in the background after each successful load, and reclassifies client-side into a MapLibre `canvas` source on every threshold change (using MapLibre's `play()`/`pause()` for a one-shot texture refresh, since `animate: false` alone only uploads the canvas to the GPU once). Committed on branch `feature/niue-suitability-dynamic-overlay` in the widget1 repo, with unit tests covering both the legacy and quantized decode paths, classification parity against the existing `classifySuitability`, and the texture-refresh/prefetch behavior.
- The existing `render_suitability_map_png` / tile / operational-map endpoints are unchanged and stay in place — they remain the path for the four fixed vessel presets and for PDF/report export, which still want matplotlib's cartographic decoration (coastline, legend, scale bar). This new endpoint only serves the interactive custom-threshold mode.
