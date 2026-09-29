from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from dataclasses import dataclass, field
from io import BytesIO
from datetime import datetime, timedelta, timezone
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import fcntl
import hashlib
import ipaddress
import json
import logging
import netCDF4
import os
import re
import socket
import shutil
from pathlib import Path
from PIL import Image
import matplotlib
matplotlib.use("Agg")
import matplotlib.cm as cm
import matplotlib.colors as mcolors
import matplotlib.patheffects as mpe
import matplotlib.pyplot as plt
import matplotlib.tri as mtri
import contourpy
import geopandas as gpd
from shapely import STRtree
import math
import numpy as np
import numcodecs
import pandas as pd
import threading
import time
import warnings
from typing import Optional
import xarray as xr
from scipy.interpolate import LinearNDInterpolator, splprep, splev
from scipy.spatial import cKDTree

logger = logging.getLogger(__name__)

TURBO_CMAP = cm.get_cmap("turbo")

ZARR_PATH = os.environ.get(
    "ZARR_PATH",
    "/data/sfincs_output/cookislands/2026042906/latest/sfincs_hmax_forecast.zarr",
)
DEFAULT_PRODUCT = os.environ.get("DEFAULT_ZARR_PRODUCT", "forecast")
HMAX_48H_ZARR_PATH = os.environ.get(
    "HMAX_48H_ZARR_PATH",
    str(Path(ZARR_PATH).with_name("sfincs_hmax_48h.zarr")),
)
UGRID_ZARR_PATH = os.environ.get(
    "UGRID_ZARR_PATH",
    str(Path(ZARR_PATH).with_name("SWAN_UGRID.zarr")),
)
UGRID_TIMESERIES_WORKERS = int(os.environ.get("UGRID_TIMESERIES_WORKERS", "32"))
# cKDTree.query(..., workers=N) fan-out for the Niue suitability/inundation
# rebuilds. Bounded to the host's allotted CPU share (rather than -1/"all
# cores") since this box is shared with other services and a rebuild
# shouldn't be able to monopolize every logical CPU on it.
KDTREE_QUERY_WORKERS = int(os.environ.get("KDTREE_QUERY_WORKERS", "16"))
UGRID_TIMESERIES_VARIABLES = tuple(
    variable.strip()
    for variable in os.environ.get("UGRID_TIMESERIES_VARIABLES", "").split(",")
    if variable.strip()
)
RANGE_MAX_CACHE_SIZE = int(os.environ.get("RANGE_MAX_CACHE_SIZE", "8"))
RANGE_MAX_USE_HMAX_48H = os.environ.get("RANGE_MAX_USE_HMAX_48H", "true").lower() not in {
    "0",
    "false",
    "no",
}
ZARR_STATIC_ROOT = Path(os.environ.get("ZARR_STATIC_ROOT", str(Path(ZARR_PATH).parent)))
STATIC_TILES_ROOT = Path(os.environ.get("STATIC_TILES_ROOT", "./sfincs-tiles"))
STATIC_TILES_ROOT.mkdir(parents=True, exist_ok=True)
RISK_THRESHOLDS_PATH = Path(os.environ.get("RISK_THRESHOLDS_PATH", "./risk-overrides/thresholds.json"))
RISK_THRESHOLDS_PATH.parent.mkdir(parents=True, exist_ok=True)

# Rendered PNG tile cache, shared on disk across every uvicorn worker process
# instead of held in a per-process dict. With multiple workers behind one
# listener, requests for the same tile round-robin across processes, so a
# per-process cache only ever sees a fraction of repeat hits; a shared disk
# cache means any worker's render is reusable by every other worker.
TILE_CACHE_ROOT = Path(os.environ.get("TILE_CACHE_ROOT", "./tile-cache"))
TILE_CACHE_ROOT.mkdir(parents=True, exist_ok=True)
TILE_CACHE_MAX_BYTES = int(os.environ.get("TILE_CACHE_MAX_BYTES", str(20 * 1024 ** 3)))
TILE_CACHE_SWEEP_INTERVAL_SECONDS = float(os.environ.get("TILE_CACHE_SWEEP_INTERVAL_SECONDS", "300"))

app = FastAPI(
    title="SFINCS Zarr API",
    description="FastAPI service for SFINCS multitemporal inundation Zarr data",
    version="0.1.0",
)
app.mount("/static", StaticFiles(directory=str(STATIC_TILES_ROOT)), name="static_tiles")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=86400,
)
app.add_middleware(GZipMiddleware, minimum_size=1000)

DatasetSignature = tuple[tuple[str, int, int, int, int], ...]

PRODUCT_PATHS: dict[str, Path] = {
    "forecast": Path(ZARR_PATH),
    "hmax_48h": Path(HMAX_48H_ZARR_PATH),
}

for product_config in os.environ.get("ZARR_PRODUCTS", "").split(","):
    if not product_config.strip():
        continue
    if "=" not in product_config:
        raise RuntimeError(
            "ZARR_PRODUCTS entries must use product_name=/path/to/product.zarr"
        )
    product_name, product_path = product_config.split("=", 1)
    PRODUCT_PATHS[product_name.strip()] = Path(product_path.strip())

if DEFAULT_PRODUCT not in PRODUCT_PATHS:
    PRODUCT_PATHS[DEFAULT_PRODUCT] = Path(ZARR_PATH)

# One immutable generation per product, same pattern as CookSuitabilityState/
# NiueSuitabilityState below: a rebuild builds a whole new SfincsProductState
# and publishes it with a single `dataset_cache[product] = new_state`
# reference assignment, so a concurrent reader can never observe a signature
# that doesn't match the dataset it's paired with (the previous dict-based
# cache's `_clear_product_cache` explicitly closed the old xr.Dataset the
# moment a new one loaded, which could break a request still reading from
# it; and several call sites re-read "the current" signature from the cache
# at points in time after they'd already fetched their own dataset/depth,
# risking a torn read across a concurrent reload -- e.g. compute_range_max
# caching a range-max value computed from a stale depth array under a
# freshly-reloaded generation's signature, poisoning that cache entry for
# every later request of the *new* generation).
@dataclass(frozen=True)
class SfincsProductState:
    dataset: xr.Dataset
    signature: DatasetSignature
    # Lazily computed on first access via get_wettable_mask() -- a plain
    # mutable dict (not a dataclass field reassignment) so this frozen
    # state's other fields stay immutable while still letting the mask fill
    # in after construction. Never shared across generations: each rebuild
    # publishes a fresh state with its own empty holder, so a mask computed
    # from a stale dataset can never leak into a newer generation's slot.
    wettable_mask_holder: dict = field(default_factory=dict)


dataset_cache: dict[str, SfincsProductState] = {}
range_max_cache: OrderedDict[tuple[DatasetSignature, int, int], xr.DataArray] = OrderedDict()
range_max_cache_lock = threading.Lock()


# Same immutable-generation pattern as SfincsProductState above: the
# previous version of this held a plain mutable dict that
# _load_ugrid_context_for() cleared and repopulated in place
# (cache.clear() + cache.update(...)) under its lock. That protects the
# rebuild itself from running twice concurrently, but /wave/ugrid/timeseries
# reads several fields off the *same* dict object one at a time, outside
# any lock, while doing real work in between (a KDTree query, then a
# ThreadPoolExecutor-based multi-chunk read) -- if a rebuild's clear()+
# update() landed on that same dict mid-request, a caller could see a
# KeyError or a mix of old- and new-generation fields. Publishing a whole
# new frozen UGridState object instead (never mutating an existing one)
# makes that impossible: a caller that already has its own reference always
# sees one complete, self-consistent generation for the life of its request.
@dataclass(frozen=True)
class UGridState:
    dataset: xr.Dataset
    signature: DatasetSignature
    zarr_path: Path
    lon_values: np.ndarray
    lat_values: np.ndarray
    node_indices: np.ndarray
    tree: cKDTree
    time_values: tuple[str, ...]
    variables: tuple[str, ...]


ugrid_state: Optional[UGridState] = None
ugrid_state_lock = threading.Lock()
niu_ugrid_state: Optional[UGridState] = None
niu_ugrid_state_lock = threading.Lock()

# Reused across requests instead of spinning up a fresh ThreadPoolExecutor
# per /wave/ugrid/timeseries (and /niue/wave/ugrid/timeseries) call.
UGRID_CHUNK_EXECUTOR = ThreadPoolExecutor(
    max_workers=UGRID_TIMESERIES_WORKERS,
    thread_name_prefix="ugrid-chunk",
)

# Decoded zarr chunk arrays, keyed on (zarr_path, variable, time_index,
# node_chunk_index) so repeat/nearby point queries against the same chunk
# don't re-read and re-decode raw bytes from disk every time.
UGRID_CHUNK_CACHE_SIZE = int(os.environ.get("UGRID_CHUNK_CACHE_SIZE", "4096"))
ugrid_chunk_cache: OrderedDict[tuple, np.ndarray] = OrderedDict()

# Bundled into one frozen dataclass for the same reason as
# CookSuitabilityState below: a lock-free reader must never observe a torn
# mix of two generations (e.g. a new face_tree paired with a
# not-yet-updated raster_hazard). A rebuild builds a whole new
# NiueSuitabilityState locally, publishes it with a single
# `niue_suit_state = new_state` reference assignment, and every request
# reads that reference exactly once into a local `state` at the top of the
# handler and works only from that snapshot for the rest of the request.
@dataclass(frozen=True)
class NiueSuitabilityState:
    dataset: xr.Dataset
    signature: tuple

    face_tree: cKDTree
    vessel_codes: tuple[str, ...]

    lon_min: float
    lon_max: float
    lat_min: float
    lat_max: float

    hazard: np.ndarray    # (time, face, vessel_class)
    overall: np.ndarray   # (time, face)
    wind_kt: np.ndarray   # (time, face)
    wave_m: np.ndarray    # (time, face)
    face_spacing: np.ndarray  # (face,) nearest-neighbor spacing, for land/off-mesh checks

    wind_caution_kt: np.ndarray
    wind_warning_kt: np.ndarray
    wave_caution_m: np.ndarray
    wave_warning_m: np.ndarray

    raster_lons: np.ndarray
    raster_lats: np.ndarray
    raster_valid: np.ndarray

    # xr.DataArray (lazy, zarr-backed) when raster_precomputed, else np.ndarray
    raster_wind_kt: object
    raster_wave_m: object
    raster_hazard: object
    raster_overall: object
    raster_precomputed: bool

    # matplotlib TriFinder over the source wave mesh's own face connectivity
    # (see _build_mesh_trifinder) -- the authoritative land/off-mesh test,
    # None if the UGRID mesh source wasn't available at rebuild time (in
    # which case _is_marine() falls back to the distance-only check).
    mesh_trifinder: object = None


niue_suit_state: Optional[NiueSuitabilityState] = None
suitability_point_timeseries_cache: OrderedDict[tuple, dict] = OrderedDict()
suitability_area_timeseries_cache: OrderedDict[tuple, dict] = OrderedDict()
transparent_tile_cache: dict[int, bytes] = {}

# Cook Islands vessel-suitability raster state (see COK_SUITABILITY_NC_PATH
# and the loader/tile route near the other Cook Islands suitability routes
# below). Mirrors the suit_* globals above, but kept separate rather than
# shared: Cook Islands' 460 points are scattered across ~10 islands spanning
# ~1,500km (vs. Niue's single dense ~14,000-point reef mesh), so the raster
# step/extent and land-mask tuning are genuinely different per country.
#
# Bundled into one frozen dataclass (rather than a dozen independent module
# globals, as niue's suit_* state above still is) so a request can never
# observe a torn mix of two generations -- e.g. a new face_tree paired with
# a not-yet-updated raster_hazard. A rebuild builds a whole new
# CookSuitabilityState locally, then publishes it with a single
# `cok_suit_state = new_state` reference assignment, and each request reads
# that reference exactly once into a local `state` variable at the top of
# the handler and works only from that snapshot for the rest of the request
# -- so a concurrent rebuild swapping the module global mid-request can
# never change what a request already in flight sees.
@dataclass(frozen=True)
class CookSuitabilityState:
    dataset: xr.Dataset
    signature: tuple

    face_tree: cKDTree
    vessel_codes: tuple[str, ...]

    lon_min: float
    lon_max: float
    lat_min: float
    lat_max: float

    point_wind_kt: np.ndarray    # (time, point) -- source point values, for cok_suitability_route
    point_wave_m: np.ndarray     # (time, point)
    face_spacing: np.ndarray     # (point,) nearest-neighbor spacing, for the route land-mask check

    wind_caution_kt: np.ndarray
    wind_warning_kt: np.ndarray
    wave_caution_m: np.ndarray
    wave_warning_m: np.ndarray

    raster_lons: np.ndarray
    raster_lats: np.ndarray
    raster_valid: np.ndarray

    # xr.DataArray (lazy, zarr-backed) when raster_precomputed, else np.ndarray
    raster_wind_kt: object
    raster_wave_m: object
    raster_hazard: object
    raster_overall: object
    raster_precomputed: bool

    # matplotlib TriFinder over the source wave mesh's own face connectivity
    # (see _build_mesh_trifinder) -- the authoritative land/off-mesh test,
    # None if the UGRID mesh source wasn't available at rebuild time (in
    # which case _is_marine() falls back to the distance-only check).
    mesh_trifinder: object = None


cok_suit_state: Optional[CookSuitabilityState] = None
# Kept separate from Niue's suitability_point_timeseries_cache/
# suitability_area_timeseries_cache above -- same cache shape (see
# cok_suitability_point_timeseries / cok_suitability_area_timeseries below),
# but a COK cache key would collide with nothing there anyway since it's
# keyed on this state's own signature; separate dicts just keep the two
# countries' entries from competing for the same LRU budget.
cok_suitability_point_timeseries_cache: OrderedDict[tuple, dict] = OrderedDict()
cok_suitability_area_timeseries_cache: OrderedDict[tuple, dict] = OrderedDict()

niu_inundation_ds: Optional[xr.Dataset] = None
niu_inundation_signature: Optional[tuple] = None
niu_inundation_tree: Optional[cKDTree] = None
niu_inundation_shape: Optional[tuple[int, int]] = None
niu_inundation_lon: Optional[np.ndarray] = None
niu_inundation_lat: Optional[np.ndarray] = None
niu_inundation_x: Optional[np.ndarray] = None
niu_inundation_y: Optional[np.ndarray] = None
niu_inundation_to_native: Optional[object] = None
niu_inundation_bounds_lonlat: Optional[tuple[float, float, float, float]] = None

TIME_DIM_CANDIDATES = ("time", "timemax")
DEPTH_VAR_CANDIDATES = ("hmax", "h", "zsmax")
UGRID_COORD_VARIABLES = {"mesh", "mesh_face_node", "mesh_node_lat", "mesh_node_lon", "time"}



# Niue datasets are separate from the default Cook Islands SFINCS products.
NIU_DATA_ROOT = os.environ.get("NIU_DATA_ROOT", "/data/sfincs_output/niue/latest")
NIU_SUITABILITY_NC_PATH = os.environ.get(
    "NIU_SUITABILITY_NC_PATH",
    f"{NIU_DATA_ROOT}/suitability_products/NIU_suitability_latest.nc",
)
NIU_SUITABILITY_ZARR_PATH = os.environ.get(
    "NIU_SUITABILITY_ZARR_PATH",
    f"{NIU_DATA_ROOT}/suitability_products/NIU_suitability_latest.zarr",
)
NIU_INUNDATION_NC_PATH = os.environ.get(
    "NIU_INUNDATION_NC_PATH",
    f"{NIU_DATA_ROOT}/InundationNiue_latest.nc",
)
NIU_INUNDATION_ZARR_PATH = os.environ.get(
    "NIU_INUNDATION_ZARR_PATH",
    f"{NIU_DATA_ROOT}/InundationNiue_latest.zarr",
)
NIU_INUNDATION_VARIABLE = os.environ.get("NIU_INUNDATION_VARIABLE", "inundation")
NIU_UGRID_ZARR_PATH = os.environ.get(
    "NIU_UGRID_ZARR_PATH",
    f"{NIU_DATA_ROOT}/ForecastNiue_latest.zarr",
)
NIU_SEA_LEVEL_NC_PATH = os.environ.get(
    "NIU_SEA_LEVEL_NC_PATH",
    f"{NIU_DATA_ROOT}/sea_level_components_latest.nc",
)
SUITABILITY_POINT_TS_CACHE_MAX_ITEMS = int(os.environ.get("SUITABILITY_POINT_TS_CACHE_MAX_ITEMS", "512"))
RASTER_STEP = float(os.environ.get("NIU_SUITABILITY_RASTER_STEP", "0.0009"))
# A raster cell is treated as land/no-data when its distance to the nearest
# mesh face exceeds this multiple of that face's own nearest-neighbor spacing
# — the wave mesh only has faces over water, so cells inside the island
# landmass would otherwise silently inherit the nearest offshore face's value.
NIU_SUITABILITY_LAND_MASK_K = float(os.environ.get("NIU_SUITABILITY_LAND_MASK_K", "2.0"))
# Absolute ceiling (km) on the K*spacing reach above, applied via
# _land_mask_is_marine(). The relative-only rule breaks down over a domain
# with uneven mesh density: a point whose own nearest neighbor happens to be
# far away (sparse mesh nearby) gets an oversized reach purely from that
# sparsity, with no regard for how close the *nearest* land actually is.
# Verified against the live Cook Islands product (see COK_SUITABILITY_LAND_MASK_K
# below): every one of 460 real coastal survey points came back "marine"
# under the relative rule alone, with K*spacing reaching 50+ km in places.
# This cap can only ever shrink the allowed reach, never grow it, so it's a
# strictly tighter version of the same check, not a behavior change for any
# cell the old rule already excluded correctly.
NIU_SUITABILITY_LAND_MASK_ABSOLUTE_CAP_KM = float(
    os.environ.get("NIU_SUITABILITY_LAND_MASK_ABSOLUTE_CAP_KM", "1.2")
)

# Cook Islands vessel suitability raster (see CookSuitabilityState above).
# Same directory step11_marine_suitability.py copies its GeoJSON/summary
# output into (COK_SUITABILITY_DIR, defined further down) -- kept as an
# independent default here rather than referencing that variable, since it
# isn't defined until later in the file.
COK_SUITABILITY_NC_PATH = os.environ.get(
    "COK_SUITABILITY_NC_PATH",
    "/data/cok_suitability/COK_suitability_latest.nc",
)
COK_SUITABILITY_RASTER_STEP = float(os.environ.get("COK_SUITABILITY_RASTER_STEP", "0.005"))
# Same land-mask technique as Niue's, but doing double duty here: it hides
# both land AND the open-ocean gaps between Cook Islands' ~10 separate
# island clusters (a cell far from every point relative to its nearest
# point's local spacing gets masked out either way, regardless of why it's
# far -- no separate "which island" logic needed).
COK_SUITABILITY_LAND_MASK_K = float(os.environ.get("COK_SUITABILITY_LAND_MASK_K", "2.0"))
# Absolute ceiling (km) on the K*spacing reach above -- see
# NIU_SUITABILITY_LAND_MASK_ABSOLUTE_CAP_KM for the full reasoning; the
# problem is worse here since Cook Islands' mesh spans ~1,500km at wildly
# uneven density (median point-to-point spacing ~1km, max ~38km), so the
# relative-only rule's reach varies from under a kilometer up to 50-70+ km
# depending purely on local mesh sparsity, with no absolute ceiling.
COK_SUITABILITY_LAND_MASK_ABSOLUTE_CAP_KM = float(
    os.environ.get("COK_SUITABILITY_LAND_MASK_ABSOLUTE_CAP_KM", "1.2")
)
# Zarr is preferred when present (matches the Niue suitability loader's
# pattern) -- pre-computed raster_wind_speed_kt/raster_hazard_class/etc, so
# the API can read chunks lazily instead of rebuilding the interpolation and
# per-vessel classification from the NetCDF on every worker's cold start.
COK_SUITABILITY_ZARR_PATH = os.environ.get(
    "COK_SUITABILITY_ZARR_PATH",
    "/data/cok_suitability/COK_suitability_latest.zarr",
)
COK_SUITABILITY_POLL_INTERVAL_SECONDS = float(os.environ.get("COK_SUITABILITY_POLL_INTERVAL_SECONDS", "30"))
# Cook Islands' full tile-rendering raster (2801 x 1902 at COK_SUITABILITY_RASTER_STEP)
# is ~180x more cells than Niue's own raw-grid endpoint ever has to serve --
# downsampled by this stride for /cok/suitability/grid so a single custom-
# envelope fetch stays in the same ~1-2MB range Niue's grid payload does,
# not the ~20MB+ a full-resolution dump would be.
COK_SUITABILITY_GRID_STRIDE = int(os.environ.get("COK_SUITABILITY_GRID_STRIDE", "4"))

NIUE_LON = -169.8672
NIUE_LAT = -19.0544
SUIT_COLORS: dict[int, tuple[int, int, int, int]] = {
    0: (42, 157, 143, 210),
    1: (251, 140, 0, 210),
    2: (229, 57, 53, 210),
}
# Cook Islands' own hazard palette -- deliberately separate from SUIT_COLORS
# above (Niue's), which doesn't match: widget5's CookIslandsSuitabilityOverlay.js
# circle markers and legend use these exact hex values (#2A9D8F/#F4A261/#E63946).
# Rendering the raster with Niue's SUIT_COLORS instead would make the smooth
# background and the discrete per-point circles show visibly different shades
# for the same hazard class wherever both are on screen together.
COK_SUIT_COLORS: dict[int, tuple[int, int, int, int]] = {
    0: (42, 157, 143, 210),   # #2A9D8F Suitable
    1: (244, 162, 97, 210),   # #F4A261 Caution
    2: (230, 57, 70, 210),    # #E63946 Warning / Not recommended
}
MAIN_DRIVER_LABELS: dict[int, str] = {
    0: "none",
    1: "wind",
    2: "waves",
    3: "wind_and_waves",
}
MAP_TEXT_COLOR = "#05070a"
MAP_TEXT_HALO = [mpe.withStroke(linewidth=2.2, foreground="#f8fafc", alpha=0.92)]
MAP_LINE_HALO = [mpe.withStroke(linewidth=5.0, foreground="#f8fafc", alpha=0.82)]

# Same flat-earth degrees<->km approximation already used throughout this
# file (niue_buffer_extent, apply_advisory_buffer_mask, _bbox_area_km2,
# etc.) -- kept uncorrected for latitude here (no cos(lat) term) to stay
# consistent with the KDTree distance/spacing values this is compared
# against, which are themselves raw lon/lat-degree Euclidean distances with
# no latitude correction applied.
KM_PER_DEG = 111.32


def _land_mask_is_marine(
    dist_deg: np.ndarray,
    spacing_deg: np.ndarray,
    land_mask_k: float,
    absolute_cap_km: float,
):
    """Distance-based land/off-mesh exclusion test: a point counts as marine
    only if its distance to the nearest mesh point is within BOTH:
      - land_mask_k times that point's own nearest-neighbor spacing (the
        original relative rule -- denser mesh nearby means a tighter reach),
        and
      - an absolute cap in km (converted to degrees via KM_PER_DEG above).

    This is a fallback/secondary check now -- see _is_marine() below for the
    primary, far more accurate test using the model's own mesh
    triangulation where available. This distance-only rule is kept as the
    baseline for when no triangulation is available, and because a point
    can be "close to some mesh point" yet still not be usefully near land
    (e.g. genuinely sparse offshore coverage), which the relative rule alone
    handles reasonably; what it can't do is tell "near the coast, in the
    water" apart from "near the coast, on the land side" when the mesh
    already runs close to shore on both sides of a distance this small --
    verified directly against 5,844 real Rarotonga building footprints,
    this distance check alone (even with the absolute cap) still marks 1,893
    of them (32%) as marine. The absolute cap can still only ever shrink the
    relative rule's reach, never grow it.

    Accepts scalars or arrays; returns whatever np.minimum/comparison gives
    for the input shapes (matches numpy broadcasting)."""
    reach_deg = np.minimum(land_mask_k * spacing_deg, absolute_cap_km / KM_PER_DEG)
    return dist_deg <= reach_deg


def _build_mesh_trifinder(ugrid_zarr_path: Path):
    """Build a matplotlib TriFinder over a UGRID wave mesh's own face
    connectivity, for authoritative point-in-model-domain membership
    testing -- "is this point inside any triangle the model actually
    simulates" rather than "is this point near some mesh point."

    This is the real fix for suitability color bleeding onto land/risk
    points: a KDTree distance check has no notion of coastline shape, but
    the SWAN mesh generator already cuts land out as holes in its own
    triangulation (mesh_face_node), so testing membership in that exact
    triangulation respects the real coastline for free, at whatever
    resolution the mesh itself has near that coast. Verified against 5,844
    real Rarotonga building footprints: only 3 (0.05%) fall inside the mesh
    triangulation, versus 1,893 (32%) for the distance-based check alone.

    Returns None (never raises) for any failure -- missing UGRID source,
    unexpected zarr store errors (a nonexistent path can raise KeyError
    from the underlying zarr store rather than FileNotFoundError, depending
    on the installed zarr/xarray version, so this deliberately doesn't
    narrow the exception type the way a hard-dependency load elsewhere in
    this file would), or missing mesh_face_node/mesh_node_lon/mesh_node_lat
    variables. Callers fall back to the distance-based _land_mask_is_marine
    check in every case -- this is an enhancement layered on top of that
    check (see _is_marine), not a hard dependency."""
    ds = None
    try:
        try:
            ds = xr.open_zarr(ugrid_zarr_path, consolidated=True)
        except ValueError:
            ds = xr.open_zarr(ugrid_zarr_path, consolidated=False)

        if not {"mesh_face_node", "mesh_node_lon", "mesh_node_lat"}.issubset(ds.variables):
            return None
        node_lon = ds.mesh_node_lon.compute().values.astype(np.float64)
        node_lat = ds.mesh_node_lat.compute().values.astype(np.float64)
        faces_raw = ds.mesh_face_node.compute().values
        if faces_raw.dtype.kind == "f":
            # Some UGRID->Zarr conversions store node indices as float64;
            # drop any row with a non-finite entry before casting to int
            # rather than let a stray NaN silently become garbage via
            # astype (NaN -> a huge/undefined int, not a valid node index).
            faces_raw = faces_raw[np.isfinite(faces_raw).all(axis=1)]
        faces = faces_raw.astype(np.int32)
        if len(faces) == 0 or faces.min() < 0 or faces.max() >= len(node_lon):
            return None
        triangulation = mtri.Triangulation(node_lon, node_lat, triangles=faces)
        return triangulation.get_trifinder()
    except Exception:
        logger.warning(
            "Could not build mesh trifinder from %s; falling back to the "
            "distance-only land mask check",
            ugrid_zarr_path, exc_info=True,
        )
        return None
    finally:
        if ds is not None:
            ds.close()


def _mesh_is_marine(trifinder, lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
    """True where (lon, lat) falls inside some triangle of a mesh trifinder
    built by _build_mesh_trifinder(). Accepts scalars or arrays."""
    lon_arr = np.atleast_1d(np.asarray(lon, dtype=np.float64))
    lat_arr = np.atleast_1d(np.asarray(lat, dtype=np.float64))
    result = trifinder(lon_arr, lat_arr) >= 0
    return result if np.ndim(lon) else bool(result[0])


def _is_marine(
    mesh_trifinder,
    dist_deg: np.ndarray,
    spacing_deg: np.ndarray,
    lon: np.ndarray,
    lat: np.ndarray,
    land_mask_k: float,
    absolute_cap_km: float,
):
    """Authoritative land/off-mesh test used by every suitability endpoint
    (Cook Islands and Niue alike).

    mesh_trifinder is a per-generation state field (state.mesh_trifinder)
    that's None when the UGRID mesh source wasn't available at rebuild
    time -- the distance-based check (_land_mask_is_marine) is the fallback
    in that case, and is the whole test when it's the only one available.

    When a trifinder IS available, it is used ALONE, not AND-ed with the
    distance+absolute-cap check. That AND used to seem like a pure safety
    improvement ("can only ever be stricter, never marks something marine
    either check alone would have excluded") but it silently broke whole-
    domain coverage: the trifinder correctly recognizes any point inside
    the model's real triangulated mesh as marine, open ocean included --
    exactly the domain Wave Height/Period already render continuously from
    the same mesh -- but SWAN meshes are deliberately coarse far from
    shore, so almost any open-ocean point sits farther than absolute_cap_km
    from its nearest *suitability* point. ANDing the two together let that
    unrelated, near-shore-tuned distance cap veto correct trifinder
    results everywhere the mesh is intentionally sparse, i.e. most of the
    open ocean -- collapsing what should be continuous domain-wide
    coverage down to small circles immediately around individual points.
    Confirmed directly against the live Cook Islands product: a point
    25km off Rarotonga, verified inside the real mesh triangulation
    (_mesh_is_marine -> True, matching Wave Height's own coverage there),
    was still coming back not-marine solely because it was 2.13km from its
    nearest suitability point -- nowhere near land, just where the mesh is
    normally coarse. The distance+cap check remains valuable on its own
    merits as the fallback for when no trifinder exists; it just isn't a
    valid additional gate on top of an already-authoritative trifinder
    result."""
    if mesh_trifinder is not None:
        return _mesh_is_marine(mesh_trifinder, lon, lat)
    return _land_mask_is_marine(dist_deg, spacing_deg, land_mask_k, absolute_cap_km)

def product_names() -> list[str]:
    return sorted(PRODUCT_PATHS)


def resolve_product_path(product: str) -> Path:
    try:
        return PRODUCT_PATHS[product]
    except KeyError:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown product '{product}'. Supported products: {', '.join(product_names())}",
        )


def resolve_product_zarr_url(product: str) -> Optional[str]:
    """Relative /zarr/... URL for a product's raw Zarr store, if it lives under
    ZARR_STATIC_ROOT and is therefore reachable via the generic static-file
    route below. Lets clients read the depth grid directly (e.g. with
    zarr.js) instead of requesting pre-rendered PNGs."""
    root = ZARR_STATIC_ROOT.resolve()
    try:
        relative = resolve_product_path(product).resolve().relative_to(root)
    except ValueError:
        return None
    return f"/zarr/{relative.as_posix()}"


def parse_threshold_list(raw: Optional[str]) -> list[float]:
    if not raw:
        return []
    values = []
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        values.append(float(chunk))
    return values


def parse_color_list(raw: Optional[str]) -> list[tuple[int, int, int]]:
    if not raw:
        return []
    colors = []
    for chunk in raw.split(","):
        token = chunk.strip().lstrip("#")
        if len(token) != 6:
            raise HTTPException(status_code=400, detail=f"Invalid color: {chunk}")
        colors.append(tuple(int(token[i:i + 2], 16) for i in (0, 2, 4)))
    return colors


def resample_color_list(color_values: list[tuple[int, int, int]], target_count: int) -> list[tuple[int, int, int]]:
    if target_count < 1:
        return []
    if len(color_values) == target_count:
        return color_values
    if len(color_values) < 2:
        raise HTTPException(
            status_code=400,
            detail="color palette requires at least two colors when resampling",
        )
    if target_count == 1:
        return [color_values[-1]]

    source = np.array(color_values, dtype=np.float32)
    source_positions = np.linspace(0.0, 1.0, len(color_values))
    target_positions = np.linspace(0.0, 1.0, target_count)

    channels = [
        np.interp(target_positions, source_positions, source[:, channel])
        for channel in range(3)
    ]
    resampled = np.stack(channels, axis=1)

    return [tuple(int(round(value)) for value in color) for color in resampled]


def render_threshold_rgba(masked: np.ndarray, thresholds: list[float], color_values: list[tuple[int, int, int]]) -> np.ndarray:
    if len(thresholds) < 2 or len(thresholds) != len(color_values):
        raise HTTPException(
            status_code=400,
            detail="threshold rendering requires matching threshold/color arrays with at least two entries",
        )

    rgba = np.zeros(masked.shape + (4,), dtype=np.uint8)
    valid = np.isfinite(masked)

    for threshold, color in zip(thresholds, color_values):
        band_mask = valid & (masked >= threshold)
        rgba[band_mask, 0] = color[0]
        rgba[band_mask, 1] = color[1]
        rgba[band_mask, 2] = color[2]
        rgba[band_mask, 3] = 255

    return rgba


def _zarr_metadata_signature(zarr_path: Path) -> Optional[DatasetSignature]:
    signature_paths = (
        ".",
        ".zmetadata",
        ".zgroup",
        ".zattrs",
        "time/.zarray",
        "time/.zattrs",
        "timemax/.zarray",
        "timemax/.zattrs",
        "h/.zarray",
        "h/.zattrs",
        "hmax/.zarray",
        "hmax/.zattrs",
        "zsmax/.zarray",
        "zsmax/.zattrs",
        "zarr.json",
    )

    signature = []
    for metadata_name in signature_paths:
        metadata_path = zarr_path if metadata_name == "." else zarr_path / metadata_name
        try:
            stat = metadata_path.stat()
        except FileNotFoundError:
            continue

        signature.append((
            metadata_name,
            stat.st_ino,
            stat.st_mtime_ns,
            stat.st_ctime_ns,
            stat.st_size,
        ))

    return tuple(signature) if signature else None


def _ugrid_metadata_signature(zarr_path: Path) -> Optional[DatasetSignature]:
    signature_paths = (
        ".",
        ".zmetadata",
        ".zgroup",
        ".zattrs",
        "time/.zarray",
        "time/.zattrs",
        "mesh_node_lon/.zarray",
        "mesh_node_lon/.zattrs",
        "mesh_node_lat/.zarray",
        "mesh_node_lat/.zattrs",
    )

    signature = []
    for metadata_name in signature_paths:
        metadata_path = zarr_path if metadata_name == "." else zarr_path / metadata_name
        try:
            stat = metadata_path.stat()
        except FileNotFoundError:
            continue

        signature.append((
            metadata_name,
            stat.st_ino,
            stat.st_mtime_ns,
            stat.st_ctime_ns,
            stat.st_size,
        ))

    return tuple(signature) if signature else None


# Every request handler that touches a dataset (`/depth`, `/metadata`,
# `/timesteps`, `/range-max/*`, `/wave/ugrid/timeseries`, ...) re-stats up to
# ~15 metadata paths just to detect whether the in-memory cache is stale.
# Under load this becomes a stat-storm regardless of endpoint, so the
# computed signature is reused for a short TTL window per zarr path instead
# of being recomputed on every single request.
METADATA_SIGNATURE_TTL_SECONDS = float(
    os.environ.get("METADATA_SIGNATURE_TTL_SECONDS", "1.0")
)
_signature_cache: dict[tuple, tuple[float, Optional[DatasetSignature]]] = {}
_signature_cache_lock = threading.Lock()


def _cached_metadata_signature(zarr_path: Path, compute_fn) -> Optional[DatasetSignature]:
    cache_key = (compute_fn, zarr_path)
    now = time.monotonic()

    with _signature_cache_lock:
        cached = _signature_cache.get(cache_key)
        if cached is not None and (now - cached[0]) < METADATA_SIGNATURE_TTL_SECONDS:
            return cached[1]

    signature = compute_fn(zarr_path)

    with _signature_cache_lock:
        _signature_cache[cache_key] = (now, signature)

    return signature


def _load_ugrid_context() -> UGridState:
    global ugrid_state
    with ugrid_state_lock:
        ugrid_state = _load_ugrid_state_for(Path(UGRID_ZARR_PATH), ugrid_state)
        return ugrid_state


def _load_niu_ugrid_context() -> UGridState:
    global niu_ugrid_state
    with niu_ugrid_state_lock:
        niu_ugrid_state = _load_ugrid_state_for(Path(NIU_UGRID_ZARR_PATH), niu_ugrid_state)
        return niu_ugrid_state


def _load_ugrid_state_for(
    zarr_path: Path,
    cached: Optional[UGridState],
) -> UGridState:
    """Caller holds the appropriate lock (ugrid_state_lock / niu_ugrid_state_lock)
    for this whole call, so at most one rebuild for that grid runs at a time
    -- this dataset only needs mesh_node_lon/lat metadata plus a cKDTree over
    a modest number of nodes, not the tens-of-seconds KDTree/Delaunay work
    the suitability loaders do, so lock-free reads aren't needed here the
    way they are there."""
    current_signature = _cached_metadata_signature(zarr_path, _ugrid_metadata_signature)

    # Source missing (dangling "latest" symlink, mid-republish, etc.) --
    # keep serving whatever generation is already cached instead of tearing
    # it down. Only a true cold start (nothing loaded yet) still 503s here.
    if current_signature is None:
        if cached is not None:
            return cached
        raise HTTPException(
            status_code=503,
            detail=f"UGRID Zarr dataset not found or unavailable: {zarr_path}",
        )

    if cached is not None and cached.signature == current_signature:
        return cached

    # Build the new generation into locals first; the live state is only
    # published once a full, validated replacement exists, so a failure
    # anywhere below leaves the previous good generation being served
    # untouched instead of degrading to an error.
    try:
        dataset = xr.open_zarr(zarr_path, consolidated=True)
    except (FileNotFoundError, OSError, ValueError) as exc:
        if cached is not None:
            return cached
        raise HTTPException(
            status_code=503,
            detail=f"UGRID Zarr dataset not found or unavailable: {zarr_path}",
        ) from exc

    if "mesh_node_lon" not in dataset or "mesh_node_lat" not in dataset:
        dataset.close()
        raise HTTPException(
            status_code=500,
            detail="UGRID dataset is missing mesh_node_lon or mesh_node_lat",
        )

    lon_values = dataset.mesh_node_lon.compute().values.astype(np.float64)
    lat_values = dataset.mesh_node_lat.compute().values.astype(np.float64)
    valid_nodes = np.isfinite(lon_values) & np.isfinite(lat_values)
    if not bool(valid_nodes.any()):
        dataset.close()
        raise HTTPException(
            status_code=500,
            detail="UGRID dataset has no finite mesh node coordinates",
        )

    node_indices = np.flatnonzero(valid_nodes)
    points = np.column_stack((lon_values[valid_nodes], lat_values[valid_nodes]))
    tree = cKDTree(points)

    if "time" in dataset.coords:
        time_values = tuple(
            pd.Timestamp(value).isoformat() + "Z"
            for value in dataset.time.values
        )
    else:
        time_values = ()

    variables = [
        name
        for name, data_array in dataset.data_vars.items()
        if name not in UGRID_COORD_VARIABLES
        and data_array.dims == ("time", "mesh_node")
    ]
    if UGRID_TIMESERIES_VARIABLES:
        missing = sorted(set(UGRID_TIMESERIES_VARIABLES) - set(variables))
        if missing:
            dataset.close()
            raise HTTPException(
                status_code=500,
                detail=f"UGRID_TIMESERIES_VARIABLES contains unsupported variables: {', '.join(missing)}",
            )
        variables = list(UGRID_TIMESERIES_VARIABLES)

    # Decoded chunks are keyed on zarr_path, so a reload of this dataset can
    # leave stale entries for it sitting in the shared chunk cache.
    _lru_clear(ugrid_chunk_cache)

    # Publish by returning a whole new state for the caller to assign in one
    # reference swap -- see UGridState's docstring for why this (rather than
    # the old cache.clear()+cache.update() on a dict a caller might already
    # be mid-read on) is what makes concurrent reads safe. The previous
    # generation's xr.Dataset is deliberately never explicitly closed here,
    # same reasoning as SfincsProductState/CookSuitabilityState/
    # NiueSuitabilityState: a request already holding the old UGridState
    # (e.g. mid-way through /wave/ugrid/timeseries's multi-chunk read) may
    # still be reading from it, outside this function's lock.
    return UGridState(
        dataset=dataset,
        signature=current_signature,
        zarr_path=zarr_path,
        lon_values=lon_values,
        lat_values=lat_values,
        node_indices=node_indices,
        tree=tree,
        time_values=time_values,
        variables=tuple(variables),
    )


def _read_zarray_metadata(zarr_path: Path, variable: str) -> dict:
    try:
        return json.loads((zarr_path / variable / ".zarray").read_text())
    except (FileNotFoundError, OSError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Unable to read Zarr metadata for UGRID variable '{variable}'",
        ) from exc


def _decode_zarr_chunk(raw: bytes, zarray: dict) -> np.ndarray:
    data = raw
    compressor_config = zarray.get("compressor")
    if compressor_config is not None:
        data = numcodecs.get_codec(compressor_config).decode(data)

    for filter_config in reversed(zarray.get("filters") or ()):
        data = numcodecs.get_codec(filter_config).decode(data)

    return np.frombuffer(data, dtype=np.dtype(zarray["dtype"]))


def _json_ready_float(value) -> Optional[float]:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None

    if not np.isfinite(numeric):
        return None

    return numeric


def _read_ugrid_chunk(
    zarr_path: Path,
    variable: str,
    zarray: dict,
    time_index: int,
    node_chunk_index: int,
) -> Optional[np.ndarray]:
    cache_key = (str(zarr_path), variable, time_index, node_chunk_index)
    chunk = _lru_get(ugrid_chunk_cache, cache_key)
    if chunk is not None:
        return chunk

    chunk_path = zarr_path / variable / f"{time_index}.{node_chunk_index}"
    try:
        chunk = _decode_zarr_chunk(chunk_path.read_bytes(), zarray)
    except Exception:
        return None

    _lru_put(ugrid_chunk_cache, cache_key, chunk, UGRID_CHUNK_CACHE_SIZE)
    return chunk


def _read_ugrid_chunk_value(
    zarr_path: Path,
    variable: str,
    zarray: dict,
    time_index: int,
    node_chunk_index: int,
    node_chunk_offset: int,
) -> Optional[float]:
    chunk = _read_ugrid_chunk(zarr_path, variable, zarray, time_index, node_chunk_index)
    if chunk is None:
        return None

    try:
        return _json_ready_float(chunk[node_chunk_offset])
    except Exception:
        return None


def _read_ugrid_variable_timeseries(
    zarr_path: Path,
    variable: str,
    node_index: int,
    time_count: int,
) -> list[Optional[float]]:
    zarray = _read_zarray_metadata(zarr_path, variable)
    chunks = zarray.get("chunks")
    if (
        not isinstance(chunks, list)
        or len(chunks) != 2
        or int(chunks[0]) != 1
        or int(chunks[1]) < 1
    ):
        raise HTTPException(
            status_code=500,
            detail=f"UGRID variable '{variable}' must be chunked as [1, node_chunk_size]",
        )

    node_chunk_size = int(chunks[1])
    node_chunk_index = node_index // node_chunk_size
    node_chunk_offset = node_index % node_chunk_size
    values: list[Optional[float]] = [None] * time_count

    # Reuses the shared module-level executor rather than spinning up a new
    # ThreadPoolExecutor per request.
    future_to_time = {
        UGRID_CHUNK_EXECUTOR.submit(
            _read_ugrid_chunk_value,
            zarr_path,
            variable,
            zarray,
            time_index,
            node_chunk_index,
            node_chunk_offset,
        ): time_index
        for time_index in range(time_count)
    }
    for future in as_completed(future_to_time):
        values[future_to_time[future]] = future.result()

    return values


def _load_dataset(product: str = DEFAULT_PRODUCT) -> Optional[SfincsProductState]:
    """Request-path entry point. Reads are lock-free (no separate background
    poll thread here -- unlike the suitability loaders, xr.open_zarr on a
    SFINCS product is cheap/lazy, so doing it synchronously in the request
    path when the signature changes is fine).

    Keeps serving whatever generation is already cached if the source is
    momentarily missing (e.g. a "latest" symlink caught mid-republish) or
    fails to open -- same graceful-degradation reasoning used by every other
    dataset loader in this file. Only a true cold start (nothing cached yet)
    returns None."""
    zarr_path = resolve_product_path(product)
    cached = dataset_cache.get(product)

    current_signature = _cached_metadata_signature(zarr_path, _zarr_metadata_signature)
    if current_signature is None:
        return cached

    if cached is not None and cached.signature == current_signature:
        return cached

    try:
        dataset = xr.open_zarr(zarr_path, consolidated=True)
    except (FileNotFoundError, OSError, ValueError):
        return cached

    # Publish as a single reference swap -- see SfincsProductState's
    # docstring for why this (rather than the old dict-mutate-in-place plus
    # explicit .close() of the previous dataset) is what makes concurrent
    # reads safe. The previous generation's xr.Dataset is deliberately never
    # explicitly closed: a request that already fetched it may still be
    # reading from it, and closing out from under that read could break it.
    # It's simply dropped and left for GC once nothing references it any
    # more. range_max_cache entries are already namespaced by signature (see
    # range_max_cache_key), so a stale-signature entry just ages out via the
    # existing LRU eviction rather than needing an explicit clear here.
    new_state = SfincsProductState(dataset=dataset, signature=current_signature)
    dataset_cache[product] = new_state
    return new_state


def require_dataset(product: str = DEFAULT_PRODUCT) -> SfincsProductState:
    zarr_path = resolve_product_path(product)
    state = _load_dataset(product)
    if state is None:
        raise HTTPException(
            status_code=503,
            detail=f"Zarr dataset not found or unavailable for product '{product}': {zarr_path}",
        )
    return state


def transparent_png_response(tile_size: int = 256):
    png_bytes = transparent_tile_cache.get(tile_size)
    if png_bytes is None:
        empty = Image.new("RGBA", (tile_size, tile_size), (0, 0, 0, 0))
        png_bytes = png_bytes_from_image(empty)
        transparent_tile_cache[tile_size] = png_bytes
    return png_bytes_response(
        png_bytes,
        headers={
            "Cache-Control": "public, max-age=3600",
            "X-Tile-Cache": "TRANSPARENT",
        },
    )


def depth_or_none(value):
    if not np.isfinite(value):
        return None

    return float(value)


def get_depth_dataarray(dataset: xr.Dataset) -> xr.DataArray:
    for variable_name in DEPTH_VAR_CANDIDATES:
        if variable_name in dataset:
            return dataset[variable_name]

    raise HTTPException(
        status_code=500,
        detail=f"Zarr dataset is missing a supported depth variable: {', '.join(DEPTH_VAR_CANDIDATES)}",
    )


def get_time_dim(data_array: xr.DataArray) -> Optional[str]:
    for dim in TIME_DIM_CANDIDATES:
        if dim in data_array.dims:
            return dim

    return None


def validate_time_index(data_array: xr.DataArray, time_index: int) -> Optional[str]:
    time_dim = get_time_dim(data_array)
    if time_dim is None:
        return None

    if time_index < 0 or time_index >= data_array.sizes[time_dim]:
        raise HTTPException(status_code=400, detail="Invalid time_index")

    return time_dim


def depth_time_values(data_array: xr.DataArray) -> list[str]:
    time_dim = get_time_dim(data_array)
    if time_dim is None:
        return []

    if time_dim in data_array.coords:
        values = data_array.coords[time_dim].values
    else:
        values = np.arange(data_array.sizes[time_dim])

    return [pd.Timestamp(value).isoformat() + "Z" for value in values]


def depth_time_value(data_array: xr.DataArray, time_index: int) -> Optional[str]:
    values = depth_time_values(data_array)
    if not values:
        return None

    return values[time_index]


def depth_time_slice(data_array: xr.DataArray, time_index: int) -> xr.DataArray:
    time_dim = validate_time_index(data_array, time_index)
    if time_dim is None:
        return data_array

    return data_array.isel({time_dim: time_index})


def compute_depth_time_slice(data_array: xr.DataArray, time_index: int) -> xr.DataArray:
    with warnings.catch_warnings():
        warnings.filterwarnings(
            "ignore",
            message="All-NaN slice encountered",
            category=RuntimeWarning,
        )
        return depth_time_slice(data_array, time_index).compute()


def _lru_get(cache: OrderedDict, key):
    with range_max_cache_lock:
        value = cache.get(key)
        if value is None:
            return None
        cache.move_to_end(key)
        return value


def _lru_put(cache: OrderedDict, key, value, max_size: int):
    if max_size < 1:
        return

    with range_max_cache_lock:
        cache[key] = value
        cache.move_to_end(key)
        while len(cache) > max_size:
            cache.popitem(last=False)


def _lru_clear(cache: OrderedDict):
    with range_max_cache_lock:
        cache.clear()


def _tile_cache_path(namespace: str, cache_key: tuple) -> Path:
    digest = hashlib.sha256(repr(cache_key).encode("utf-8")).hexdigest()
    # Two-level fan-out (256 subdirectories) so no single directory ends up
    # holding hundreds of thousands of tile files.
    return TILE_CACHE_ROOT / namespace / digest[:2] / f"{digest}.png"


def disk_tile_cache_get(namespace: str, cache_key: tuple) -> Optional[bytes]:
    path = _tile_cache_path(namespace, cache_key)
    try:
        data = path.read_bytes()
    except OSError:
        return None

    try:
        # Bump mtime on a hit so the sweep loop's oldest-first eviction
        # approximates LRU rather than pure insertion order.
        os.utime(path, None)
    except OSError:
        pass

    return data


def disk_tile_cache_put(namespace: str, cache_key: tuple, png_bytes: bytes) -> None:
    path = _tile_cache_path(namespace, cache_key)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Write-then-rename so concurrent workers never observe a partially
    # written file; os.replace is atomic within the same filesystem.
    tmp_path = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        tmp_path.write_bytes(png_bytes)
        os.replace(tmp_path, path)
    except OSError:
        tmp_path.unlink(missing_ok=True)


def clear_disk_tile_cache_namespace(namespace: str) -> None:
    shutil.rmtree(TILE_CACHE_ROOT / namespace, ignore_errors=True)


@contextmanager
def cross_process_lock(lock_path: Path):
    """Blocking flock shared by every uvicorn worker process (they all share
    this container's filesystem). Used to serialize expensive per-process
    dataset rebuilds -- e.g. the Niue suitability rebuild's KDTree/Delaunay
    work -- so at most one worker's CPU-heavy rebuild runs at a time.

    Without this, N worker processes each running their own background poll
    thread all kick off the same expensive rebuild simultaneously, saturating
    the CPU quota badly enough that uvicorn's own lightweight inter-process
    health-check thread (a ping/pong over a pipe, 5s timeout by default)
    can't get scheduled in time inside any of them -- uvicorn concludes every
    worker is hung, kills and respawns them, and the new processes
    immediately repeat the same simultaneous rebuild. Serializing instead of
    parallelizing the heavy section fixes the contention (each worker still
    redundantly rebuilds its own in-memory copy -- there's no cross-process
    shared memory here -- just not all 8 at once)."""
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with open(lock_path, "w") as lock_file:
        fcntl.flock(lock_file, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock_file, fcntl.LOCK_UN)


def _tile_cache_sweep_once(lock_file) -> None:
    try:
        fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return  # another worker process already owns this round's sweep

    try:
        entries = []
        total_bytes = 0
        for path in TILE_CACHE_ROOT.rglob("*.png"):
            try:
                stat = path.stat()
            except OSError:
                continue
            entries.append((stat.st_mtime_ns, stat.st_size, path))
            total_bytes += stat.st_size

        if total_bytes > TILE_CACHE_MAX_BYTES:
            entries.sort(key=lambda entry: entry[0])
            for _, size, path in entries:
                if total_bytes <= TILE_CACHE_MAX_BYTES:
                    break
                try:
                    path.unlink()
                    total_bytes -= size
                except OSError:
                    pass
    finally:
        fcntl.flock(lock_file, fcntl.LOCK_UN)


def _tile_cache_sweep_loop() -> None:
    """Background daemon: bounds the shared on-disk tile cache to
    TILE_CACHE_MAX_BYTES by deleting the oldest (by mtime) files first. A
    plain file write has no built-in item-count eviction the way the old
    per-process OrderedDicts did, so this does the equivalent job on a
    timer instead of on every request -- walking the whole cache tree on
    every tile write would erase the point of caching.

    With multiple uvicorn worker processes each running this loop, an flock
    on a shared lock file lets only one worker actually perform a given
    round's directory walk; the rest see the lock held and skip that tick
    instead of redundantly re-walking the same shared cache tree."""
    lock_path = TILE_CACHE_ROOT / ".sweep.lock"
    while True:
        try:
            with open(lock_path, "w") as lock_file:
                _tile_cache_sweep_once(lock_file)
        except Exception:
            # Keep sweeping even if a transient error hits the walk, but log
            # it -- a silent `pass` here means a persistent failure (e.g. a
            # permissions problem) never surfaces anywhere, and the cache
            # just quietly grows unbounded.
            logger.exception("Tile cache sweep failed")

        time.sleep(TILE_CACHE_SWEEP_INTERVAL_SECONDS)


@app.on_event("startup")
def _start_tile_cache_sweep_thread() -> None:
    threading.Thread(target=_tile_cache_sweep_loop, daemon=True, name="tile-cache-sweep").start()


def _datetime_ns_values(values: np.ndarray) -> np.ndarray:
    timestamps = pd.to_datetime(values)
    if getattr(timestamps, "tz", None) is not None:
        timestamps = timestamps.tz_convert(None)

    return timestamps.astype("datetime64[ns]").astype(np.int64)


def _datetime_ns_value(value: str, field_name: str) -> int:
    try:
        timestamp = pd.Timestamp(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"Invalid {field_name}")

    if pd.isna(timestamp):
        raise HTTPException(status_code=400, detail=f"Invalid {field_name}")

    if timestamp.tzinfo is not None:
        timestamp = timestamp.tz_convert(None)

    return timestamp.to_datetime64().astype("datetime64[ns]").astype(np.int64)


def resolve_range_window(
    depth: xr.DataArray,
    start_time: Optional[str],
    end_time: Optional[str],
    start_index: Optional[int],
    end_index: Optional[int],
) -> tuple[str, int, int, list[str]]:
    time_dim = get_time_dim(depth)
    if time_dim is None:
        raise HTTPException(
            status_code=400,
            detail="Range max requires a forecast product with a time dimension",
        )

    timestep_count = depth.sizes[time_dim]
    if timestep_count < 1:
        raise HTTPException(status_code=400, detail="Forecast product has no timesteps")

    time_values = depth_time_values(depth)

    if start_index is not None:
        resolved_start = start_index
    elif start_time:
        if time_dim in depth.coords:
            coord_ns = _datetime_ns_values(depth.coords[time_dim].values)
            target_ns = _datetime_ns_value(start_time, "start_time")
            resolved_start = int(np.searchsorted(coord_ns, target_ns, side="left"))
        else:
            raise HTTPException(
                status_code=400,
                detail="start_time requires a time coordinate; use start_index instead",
            )
    else:
        resolved_start = 0

    if end_index is not None:
        resolved_end = end_index
    elif end_time:
        if time_dim in depth.coords:
            coord_ns = _datetime_ns_values(depth.coords[time_dim].values)
            target_ns = _datetime_ns_value(end_time, "end_time")
            resolved_end = int(np.searchsorted(coord_ns, target_ns, side="right") - 1)
        else:
            raise HTTPException(
                status_code=400,
                detail="end_time requires a time coordinate; use end_index instead",
            )
    else:
        resolved_end = timestep_count - 1

    resolved_start = max(0, min(timestep_count - 1, resolved_start))
    resolved_end = max(0, min(timestep_count - 1, resolved_end))

    if resolved_start > resolved_end:
        raise HTTPException(
            status_code=400,
            detail="Range window is empty or reversed",
        )

    return time_dim, resolved_start, resolved_end, time_values


def range_window_metadata(
    dataset: xr.Dataset,
    depth: xr.DataArray,
    start_index: int,
    end_index: int,
    time_values: list[str],
) -> dict:
    return {
        "product": "range_max",
        "source_product": "forecast",
        "start_index": start_index,
        "end_index": end_index,
        "start_time": time_values[start_index] if time_values else None,
        "end_time": time_values[end_index] if time_values else None,
        "timestep_count": end_index - start_index + 1,
        "variable": depth.name,
        "long_name": depth.attrs.get("long_name"),
        "units": depth.attrs.get("units"),
        "lat_min": float(dataset.lat.min()),
        "lat_max": float(dataset.lat.max()),
        "lon_min": float(dataset.lon.min()),
        "lon_max": float(dataset.lon.max()),
    }


def compute_range_max(
    dataset: xr.Dataset,
    depth: xr.DataArray,
    time_dim: str,
    start_index: int,
    end_index: int,
    forecast_signature: DatasetSignature,
) -> xr.DataArray:
    # forecast_signature is passed in by the caller (paired with the exact
    # dataset/depth it already resolved via require_dataset("forecast"))
    # rather than re-read from dataset_cache["forecast"] here -- reading it
    # fresh at this point risks a torn read if a concurrent rebuild swapped
    # in a new generation in between: this would then cache a range-max
    # value computed from the *old* depth array under the *new*
    # generation's signature, poisoning that cache entry for every
    # subsequent request of the new generation until it happens to be
    # evicted or overwritten.
    cache_key = (forecast_signature, start_index, end_index)
    cached = _lru_get(range_max_cache, cache_key)
    if cached is not None:
        return cached

    if RANGE_MAX_USE_HMAX_48H and start_index == 0 and end_index == 47:
        hmax_48h_state = _load_dataset("hmax_48h")
        if hmax_48h_state is not None:
            try:
                range_max = get_depth_dataarray(hmax_48h_state.dataset).compute()
                range_max.attrs.update(depth.attrs)
                range_max.attrs["long_name"] = (
                    depth.attrs.get("long_name") or depth.name or "depth"
                ) + " range maximum"
                range_max.attrs["product"] = "range_max"
                range_max.attrs["source_product"] = "forecast"
                range_max.attrs["source_cache"] = "hmax_48h"
                range_max.attrs["start_index"] = start_index
                range_max.attrs["end_index"] = end_index
                _lru_put(range_max_cache, cache_key, range_max, RANGE_MAX_CACHE_SIZE)
                return range_max
            except HTTPException:
                pass

    with warnings.catch_warnings():
        warnings.filterwarnings(
            "ignore",
            message="All-NaN slice encountered",
            category=RuntimeWarning,
        )
        ranged = depth.isel({time_dim: slice(start_index, end_index + 1)})
        range_max = ranged.max(dim=time_dim, skipna=True).compute()

    range_max.attrs.update(depth.attrs)
    range_max.attrs["long_name"] = (
        depth.attrs.get("long_name") or depth.name or "depth"
    ) + " range maximum"
    range_max.attrs["product"] = "range_max"
    range_max.attrs["source_product"] = "forecast"
    range_max.attrs["start_index"] = start_index
    range_max.attrs["end_index"] = end_index

    _lru_put(range_max_cache, cache_key, range_max, RANGE_MAX_CACHE_SIZE)
    return range_max


def range_max_cache_key(
    forecast_signature: DatasetSignature, start_index: int, end_index: int
) -> tuple[DatasetSignature, int, int]:
    return (forecast_signature, start_index, end_index)


def compute_range_max_point(
    depth: xr.DataArray,
    time_dim: str,
    start_index: int,
    end_index: int,
    lon: float,
    lat: float,
    forecast_signature: DatasetSignature,
):
    # See compute_range_max's comment: forecast_signature comes from the
    # caller's own already-resolved generation, not re-read here.
    cached = _lru_get(range_max_cache, range_max_cache_key(forecast_signature, start_index, end_index))
    if cached is not None:
        return cached.sel(lon=lon, lat=lat, method="nearest").item()

    with warnings.catch_warnings():
        warnings.filterwarnings(
            "ignore",
            message="All-NaN slice encountered",
            category=RuntimeWarning,
        )
        value = (
            depth
            .sel(lon=lon, lat=lat, method="nearest")
            .isel({time_dim: slice(start_index, end_index + 1)})
            .max(dim=time_dim, skipna=True)
            .compute()
            .item()
        )

    return value


def render_depth_rgba(
    arr: np.ndarray,
    vmin: float,
    vmax: float,
    render_mode: str,
    thresholds: Optional[str],
    colors: Optional[str],
    resample_colors: bool,
) -> np.ndarray:
    if vmax <= vmin:
        raise HTTPException(
            status_code=400,
            detail="vmax must be greater than the effective minimum visible depth",
        )

    masked = np.where((arr >= vmin) & np.isfinite(arr), arr, np.nan)

    if render_mode == "thresholds":
        threshold_values = parse_threshold_list(thresholds)
        color_values = parse_color_list(colors)
        if resample_colors:
            color_values = resample_color_list(color_values, len(threshold_values))
        return render_threshold_rgba(masked, threshold_values, color_values)

    norm = mcolors.Normalize(vmin=vmin, vmax=vmax, clip=True)
    cmap = TURBO_CMAP
    rgba = (cmap(norm(masked)) * 255).astype(np.uint8)
    rgba[np.isnan(masked)] = [0, 0, 0, 0]
    return rgba


def png_response_from_rgba(rgba: np.ndarray) -> StreamingResponse:
    img = Image.fromarray(rgba, mode="RGBA")
    buffer = BytesIO()
    img.save(buffer, format="PNG")
    buffer.seek(0)
    return StreamingResponse(buffer, media_type="image/png")


def png_bytes_from_image(img: Image.Image) -> bytes:
    buffer = BytesIO()
    img.save(buffer, format="PNG")
    return buffer.getvalue()


def png_bytes_response(
    png_bytes: bytes,
    headers: Optional[dict[str, str]] = None,
) -> StreamingResponse:
    return StreamingResponse(
        BytesIO(png_bytes),
        media_type="image/png",
        headers=headers,
    )


def get_wettable_mask(state: SfincsProductState) -> np.ndarray:
    """Currently unused (every caller is commented out -- inundation depths
    are no longer masked by the static msk variable), kept for that
    possible future re-use. Takes the whole SfincsProductState (rather than
    a bare xr.Dataset) so the computed mask is cached on the *same*
    generation's holder it was computed from -- caching it back into
    whatever the module-level dataset_cache[product] happens to hold at
    write time (the old behavior) could attribute a mask computed from a
    stale dataset to a newer generation's cache slot if a reload raced in
    between."""
    wettable_mask = state.wettable_mask_holder.get("mask")

    if wettable_mask is None:
        if "msk" not in state.dataset:
            raise HTTPException(
                status_code=500,
                detail="Zarr dataset is missing required mask variable: msk",
            )

        wettable_mask = state.dataset.msk.compute().values > 0
        state.wettable_mask_holder["mask"] = wettable_mask

    return wettable_mask


def masked_depth_at_point(dataset: xr.Dataset, lon: float, lat: float, time_index: int):
    value = (
        depth_time_slice(get_depth_dataarray(dataset), time_index)
        .sel(lon=lon, lat=lat, method="nearest")
        .compute()
        .item()
    )

    # Inundation depths are no longer masked by the static msk variable.
    # if "msk" not in dataset:
    #     raise HTTPException(
    #         status_code=500,
    #         detail="Zarr dataset is missing required mask variable: msk",
    #     )
    #
    # mask_value = (
    #     dataset.msk
    #     .sel(lon=lon, lat=lat, method="nearest")
    #     .compute()
    #     .item()
    # )
    #
    # if mask_value <= 0:
    #     return None

    return depth_or_none(value)


@app.get("/")
def root():
    state = _load_dataset(DEFAULT_PRODUCT)
    variable = get_depth_dataarray(state.dataset).name if state is not None else None
    return {
        "message": "SFINCS Zarr API is running",
        "default_product": DEFAULT_PRODUCT,
        "dataset": str(resolve_product_path(DEFAULT_PRODUCT)),
        "products": {
            name: {
                "path": str(path),
                "zarr_static_url": f"/zarr/{path.name}",
            }
            for name, path in PRODUCT_PATHS.items()
        },
        "zarr_static_root": str(ZARR_STATIC_ROOT),
        "zarr_static_url": f"/zarr/{resolve_product_path(DEFAULT_PRODUCT).name}",
        "variable": variable,
    }


def _ugrid_timeseries_response(
    context: UGridState,
    lon: float,
    lat: float,
    variables: Optional[str],
    product_label: str,
) -> dict:
    dataset = context.dataset

    available_variables = list(context.variables)
    if isinstance(variables, str) and variables:
        requested_variables = [
            variable.strip()
            for variable in variables.split(",")
            if variable.strip()
        ]
        unknown = sorted(set(requested_variables) - set(available_variables))
        if unknown:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown UGRID variable(s): {', '.join(unknown)}",
            )
        selected_variables = requested_variables
    else:
        selected_variables = available_variables

    if not selected_variables:
        raise HTTPException(
            status_code=500,
            detail="UGRID dataset has no time-varying mesh_node variables",
        )

    tree = context.tree
    node_indices = context.node_indices
    lon_values = context.lon_values
    lat_values = context.lat_values
    zarr_path = context.zarr_path
    time_values = list(context.time_values)

    distance, nearest_position = tree.query([lon, lat])
    node_index = int(node_indices[int(nearest_position)])
    time_count = int(dataset.sizes["time"])
    if not time_values:
        time_values = [str(index) for index in range(time_count)]

    series_by_variable = {
        variable: _read_ugrid_variable_timeseries(
            zarr_path,
            variable,
            node_index,
            time_count,
        )
        for variable in selected_variables
    }

    values = []
    for time_index in range(time_count):
        row = {
            "time_index": time_index,
            "time": time_values[time_index],
        }
        for variable in selected_variables:
            row[variable] = series_by_variable[variable][time_index]
        values.append(row)

    return {
        "product": product_label,
        "dataset": str(zarr_path),
        "lon_requested": lon,
        "lat_requested": lat,
        "node_index": node_index,
        "node_lon": _json_ready_float(lon_values[node_index]),
        "node_lat": _json_ready_float(lat_values[node_index]),
        "distance_degrees": _json_ready_float(distance),
        "count": time_count,
        "times": time_values,
        "variables": series_by_variable,
        "units": {
            variable: dataset[variable].attrs.get("units")
            for variable in selected_variables
        },
        "long_names": {
            variable: dataset[variable].attrs.get("long_name")
            for variable in selected_variables
        },
        "values": values,
    }


@app.get("/wave/ugrid/timeseries")
def wave_ugrid_timeseries(
    lon: float = Query(..., description="Longitude"),
    lat: float = Query(..., description="Latitude"),
    variables: Optional[str] = Query(
        None,
        description="Optional comma-separated UGRID variable names",
    ),
):
    context = _load_ugrid_context()
    return _ugrid_timeseries_response(context, lon, lat, variables, "wave_ugrid")


@app.get("/niue/wave/ugrid/timeseries")
def niue_wave_ugrid_timeseries(
    lon: float = Query(..., description="Longitude"),
    lat: float = Query(..., description="Latitude"),
    variables: Optional[str] = Query(
        None,
        description="Optional comma-separated UGRID variable names",
    ),
):
    context = _load_niu_ugrid_context()
    return _ugrid_timeseries_response(context, lon, lat, variables, "niue_wave_ugrid")


def resolve_zarr_static_path(file_path: str) -> Path:
    root = ZARR_STATIC_ROOT.resolve()
    requested = (root / file_path).resolve()

    try:
        requested.relative_to(root)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid Zarr file path")

    if not requested.is_file():
        raise HTTPException(status_code=404, detail="Zarr file not found")

    return requested


@app.get("/zarr/{file_path:path}")
def zarr_static_file(file_path: str):
    requested = resolve_zarr_static_path(file_path)

    return FileResponse(
        requested,
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )


@app.head("/zarr/{file_path:path}")
def zarr_static_file_head(file_path: str):
    requested = resolve_zarr_static_path(file_path)
    stat = requested.stat()

    return Response(
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
            "Content-Length": str(stat.st_size),
        },
    )


@app.get("/metadata")
def metadata(
    product: str = Query(DEFAULT_PRODUCT, description="Dataset product name"),
):
    ds = require_dataset(product).dataset
    depth = get_depth_dataarray(ds)
    time_dim = get_time_dim(depth)
    time_values = depth_time_values(depth)
    return {
        "product": product,
        "dataset": str(resolve_product_path(product)),
        "zarr_url": resolve_product_zarr_url(product),
        "variable": depth.name,
        "long_name": depth.attrs.get("long_name"),
        "units": depth.attrs.get("units"),
        "fill_value": "NaN",
        "dimensions": {
            "time": depth.sizes[time_dim] if time_dim else 1,
            "lat": ds.sizes["lat"],
            "lon": ds.sizes["lon"],
        },
        "time_dimension": time_dim,
        "time_start": time_values[0] if time_values else None,
        "time_end": time_values[-1] if time_values else None,
        "lat_min": float(ds.lat.min()),
        "lat_max": float(ds.lat.max()),
        "lon_min": float(ds.lon.min()),
        "lon_max": float(ds.lon.max()),
    }


@app.get("/timesteps")
def timesteps(
    product: str = Query(DEFAULT_PRODUCT, description="Dataset product name"),
):
    ds = require_dataset(product).dataset
    depth = get_depth_dataarray(ds)
    time_values = depth_time_values(depth)
    return {
        "product": product,
        "count": len(time_values),
        "timesteps": time_values,
    }


@app.get("/static-tiles/{tile_path:path}")
def static_tile(tile_path: str):
    # Containment check (same pattern as resolve_zarr_static_path /
    # resolve_niu_zarr_static_path below): without resolving and verifying
    # the result stays under the root, a path like "../../etc/passwd" would
    # otherwise be served back as if it were a tile.
    root = STATIC_TILES_ROOT.resolve()
    tile_file = (root / tile_path).resolve()
    try:
        tile_file.relative_to(root)
    except ValueError:
        raise HTTPException(status_code=404, detail="Tile not found")

    if tile_file.is_file():
        return FileResponse(tile_file, media_type="image/png")

    if tile_file.suffix.lower() == ".png":
        return transparent_png_response()

    raise HTTPException(status_code=404, detail="Tile not found")


@app.get("/depth")
def depth_at_point(
    lon: float = Query(..., description="Longitude"),
    lat: float = Query(..., description="Latitude"),
    time_index: int = Query(0, description="Time index"),
    product: str = Query(DEFAULT_PRODUCT, description="Dataset product name"),
):
    ds = require_dataset(product).dataset
    depth = get_depth_dataarray(ds)
    validate_time_index(depth, time_index)

    try:
        return {
            "product": product,
            "lon_requested": lon,
            "lat_requested": lat,
            "time_index": time_index,
            "time": depth_time_value(depth, time_index),
            "depth_m": masked_depth_at_point(ds, lon, lat, time_index),
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/point-value")
def point_value(
    lon: float = Query(..., description="Longitude"),
    lat: float = Query(..., description="Latitude"),
    time_index: int = Query(0, description="Time index"),
    product: str = Query(DEFAULT_PRODUCT, description="Dataset product name"),
):
    ds = require_dataset(product).dataset
    depth = get_depth_dataarray(ds)
    result = depth_at_point(lon=lon, lat=lat, time_index=time_index, product=product)
    return {
        "product": product,
        "value": result["depth_m"],
        "units": depth.attrs.get("units", "m"),
        "lat": lat,
        "lon": lon,
        "time_index": time_index,
        "time": result["time"],
    }


@app.get("/depth-timeseries")
def depth_timeseries(
    lon: float = Query(..., description="Longitude"),
    lat: float = Query(..., description="Latitude"),
):
    product = "forecast"
    ds = require_dataset(product).dataset
    try:
        depth = get_depth_dataarray(ds)
        time_dim = validate_time_index(depth, 0)
        series = (
            depth
            .sel(lon=lon, lat=lat, method="nearest")
            .compute()
        )

        # Inundation depths are no longer masked by the static msk variable.
        # if "msk" not in ds:
        #     raise HTTPException(
        #         status_code=500,
        #         detail="Zarr dataset is missing required mask variable: msk",
        #     )
        #
        # mask_value = (
        #     ds.msk
        #     .sel(lon=lon, lat=lat, method="nearest")
        #     .compute()
        #     .item()
        # )

        values = []
        time_values = depth_time_values(depth)
        for index, v in enumerate(np.ravel(series.values)):
            values.append({
                "time": time_values[index] if time_dim else None,
                "depth_m": depth_or_none(v),
            })

        return {
            "product": product,
            "lon_requested": lon,
            "lat_requested": lat,
            "count": len(values),
            "values": values,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
@app.get("/max-depth-location")
def max_depth_location(
    time_index: int = Query(0, description="Time index"),
    product: str = Query(DEFAULT_PRODUCT, description="Dataset product name"),
):
    ds = require_dataset(product).dataset
    depth = get_depth_dataarray(ds)
    validate_time_index(depth, time_index)

    try:
        # Inundation depths are no longer masked by the static msk variable.
        # arr = ds.h.isel(time=time_index).where(get_wettable_mask(ds))
        arr = depth_time_slice(depth, time_index)
        flat = arr.stack(points=("lat", "lon"))

        has_valid_values = bool(flat.notnull().any().compute().item())
        if not has_valid_values:
            return {
                "product": product,
                "time_index": time_index,
                "time": depth_time_value(depth, time_index),
                "max_depth_m": None,
                "lat": None,
                "lon": None,
            }

        max_index = int(flat.argmax(dim="points", skipna=True).compute().item())
        max_point = flat.isel(points=max_index).compute()
        max_value = max_point.item()

        lat_value = float(max_point["lat"].item())
        lon_value = float(max_point["lon"].item())

        return {
            "product": product,
            "time_index": time_index,
            "time": depth_time_value(depth, time_index),
            "max_depth_m": float(max_value),
            "lat": lat_value,
            "lon": lon_value,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def range_max_context(
    start_time: Optional[str],
    end_time: Optional[str],
    start_index: Optional[int],
    end_index: Optional[int],
) -> tuple[xr.Dataset, xr.DataArray, xr.DataArray, int, int, list[str]]:
    dataset, depth, time_dim, resolved_start, resolved_end, time_values, forecast_signature = range_window_context(
        start_time,
        end_time,
        start_index,
        end_index,
    )
    range_max = compute_range_max(
        dataset,
        depth,
        time_dim,
        resolved_start,
        resolved_end,
        forecast_signature,
    )

    return dataset, depth, range_max, resolved_start, resolved_end, time_values


def range_window_context(
    start_time: Optional[str],
    end_time: Optional[str],
    start_index: Optional[int],
    end_index: Optional[int],
) -> tuple[xr.Dataset, xr.DataArray, str, int, int, list[str], DatasetSignature]:
    state = require_dataset("forecast")
    dataset = state.dataset
    depth = get_depth_dataarray(dataset)
    time_dim, resolved_start, resolved_end, time_values = resolve_range_window(
        depth,
        start_time,
        end_time,
        start_index,
        end_index,
    )

    return dataset, depth, time_dim, resolved_start, resolved_end, time_values, state.signature


@app.get("/range-max/metadata")
def range_max_metadata(
    start_time: Optional[str] = Query(None, description="Inclusive start timestamp"),
    end_time: Optional[str] = Query(None, description="Inclusive end timestamp"),
    start_index: Optional[int] = Query(None, description="Inclusive start time index"),
    end_index: Optional[int] = Query(None, description="Inclusive end time index"),
):
    dataset, depth, _, resolved_start, resolved_end, time_values, _ = range_window_context(
        start_time,
        end_time,
        start_index,
        end_index,
    )

    return range_window_metadata(
        dataset,
        depth,
        resolved_start,
        resolved_end,
        time_values,
    )


@app.get("/range-max/raster-png")
def range_max_raster_png(
    start_time: Optional[str] = Query(None, description="Inclusive start timestamp"),
    end_time: Optional[str] = Query(None, description="Inclusive end timestamp"),
    start_index: Optional[int] = Query(None, description="Inclusive start time index"),
    end_index: Optional[int] = Query(None, description="Inclusive end time index"),
    vmin: float = Query(0.05, description="Minimum visible depth"),
    vmax: float = Query(3.0, description="Maximum colour scale depth"),
    render_mode: str = Query("continuous", description="continuous or thresholds"),
    thresholds: Optional[str] = Query(None, description="Comma-separated threshold list"),
    colors: Optional[str] = Query(None, description="Comma-separated hex colors"),
    resample_colors: bool = Query(False, description="Resample colors as palette stops across threshold bands"),
):
    dataset, depth, time_dim, resolved_start, resolved_end, _, forecast_signature = range_window_context(
        start_time,
        end_time,
        start_index,
        end_index,
    )
    png_key = (
        "raster",
        range_max_cache_key(forecast_signature, resolved_start, resolved_end),
        vmin,
        vmax,
        render_mode,
        thresholds,
        colors,
        resample_colors,
    )
    cached_png = disk_tile_cache_get("range_max_png", png_key)
    if cached_png is not None:
        return png_bytes_response(cached_png)

    range_max = compute_range_max(
        dataset,
        depth,
        time_dim,
        resolved_start,
        resolved_end,
        forecast_signature,
    )
    rgba = render_depth_rgba(
        range_max.values,
        vmin,
        vmax,
        render_mode,
        thresholds,
        colors,
        resample_colors,
    )
    img = Image.fromarray(rgba, mode="RGBA")

    # Flip vertically if latitude is ascending
    if float(dataset.lat.values[0]) < float(dataset.lat.values[-1]):
        img = img.transpose(Image.FLIP_TOP_BOTTOM)

    png_bytes = png_bytes_from_image(img)
    disk_tile_cache_put("range_max_png", png_key, png_bytes)
    return png_bytes_response(png_bytes)


@app.get("/range-max/point-value")
def range_max_point_value(
    lon: float = Query(..., description="Longitude"),
    lat: float = Query(..., description="Latitude"),
    start_time: Optional[str] = Query(None, description="Inclusive start timestamp"),
    end_time: Optional[str] = Query(None, description="Inclusive end timestamp"),
    start_index: Optional[int] = Query(None, description="Inclusive start time index"),
    end_index: Optional[int] = Query(None, description="Inclusive end time index"),
):
    _, depth, time_dim, resolved_start, resolved_end, time_values, forecast_signature = range_window_context(
        start_time,
        end_time,
        start_index,
        end_index,
    )
    value = compute_range_max_point(
        depth,
        time_dim,
        resolved_start,
        resolved_end,
        lon,
        lat,
        forecast_signature,
    )

    return {
        "product": "range_max",
        "source_product": "forecast",
        "value": depth_or_none(value),
        "units": depth.attrs.get("units", "m"),
        "lat": lat,
        "lon": lon,
        "start_index": resolved_start,
        "end_index": resolved_end,
        "start_time": time_values[resolved_start] if time_values else None,
        "end_time": time_values[resolved_end] if time_values else None,
        "timestep_count": resolved_end - resolved_start + 1,
    }


@app.get("/range-max/tile/{z}/{x}/{y}.png")
def range_max_tile_png(
    z: int,
    x: int,
    y: int,
    start_time: Optional[str] = Query(None, description="Inclusive start timestamp"),
    end_time: Optional[str] = Query(None, description="Inclusive end timestamp"),
    start_index: Optional[int] = Query(None, description="Inclusive start time index"),
    end_index: Optional[int] = Query(None, description="Inclusive end time index"),
    vmin: float = Query(0.05),
    vmax: float = Query(3.0),
    render_mode: str = Query("continuous", description="continuous or thresholds"),
    thresholds: Optional[str] = Query(None, description="Comma-separated threshold list"),
    colors: Optional[str] = Query(None, description="Comma-separated hex colors"),
    resample_colors: bool = Query(False, description="Resample colors as palette stops across threshold bands"),
):
    dataset, depth, time_dim, resolved_start, resolved_end, _, forecast_signature = range_window_context(
        start_time,
        end_time,
        start_index,
        end_index,
    )
    png_key = (
        "tile",
        z,
        x,
        y,
        range_max_cache_key(forecast_signature, resolved_start, resolved_end),
        vmin,
        vmax,
        render_mode,
        thresholds,
        colors,
        resample_colors,
    )
    cached_png = disk_tile_cache_get("range_max_png", png_key)
    if cached_png is not None:
        return png_bytes_response(cached_png)

    range_max = compute_range_max(
        dataset,
        depth,
        time_dim,
        resolved_start,
        resolved_end,
        forecast_signature,
    )
    tile_size = 256

    dataset_lon_min = float(dataset.lon.min())
    dataset_lon_max = float(dataset.lon.max())
    dataset_lat_min = float(dataset.lat.min())
    dataset_lat_max = float(dataset.lat.max())

    lon_min, lat_min, lon_max, lat_max = tile_to_lonlat_bounds(x, y, z)

    if (
        lon_max < dataset_lon_min
        or lon_min > dataset_lon_max
        or lat_max < dataset_lat_min
        or lat_min > dataset_lat_max
    ):
        return transparent_png_response(tile_size)

    px = np.arange(tile_size)
    py = np.arange(tile_size)

    n = 2.0 ** z

    lon_vals = (x + (px + 0.5) / tile_size) / n * 360.0 - 180.0
    y_world = y + (py + 0.5) / tile_size
    lat_vals = np.degrees(
        np.arctan(np.sinh(np.pi * (1 - 2 * y_world / n)))
    )

    arr = range_max.values.astype(np.float32, copy=True)
    src_lon = range_max.lon.values
    src_lat = range_max.lat.values

    def nearest_indices(coords, targets):
        ascending = coords[0] < coords[-1]
        coords_asc = coords if ascending else coords[::-1]

        idx = np.searchsorted(coords_asc, targets)
        idx = np.clip(idx, 1, len(coords_asc) - 1)

        left = coords_asc[idx - 1]
        right = coords_asc[idx]
        idx_asc = np.where(
            np.abs(targets - left) <= np.abs(targets - right),
            idx - 1,
            idx,
        )

        if ascending:
            return idx_asc

        return (len(coords) - 1) - idx_asc

    lon_idx = nearest_indices(src_lon, lon_vals)
    lat_idx = nearest_indices(src_lat, lat_vals)

    arr = arr[np.ix_(lat_idx, lon_idx)]

    lon_in_bounds = (lon_vals >= dataset_lon_min) & (lon_vals <= dataset_lon_max)
    lat_in_bounds = (lat_vals >= dataset_lat_min) & (lat_vals <= dataset_lat_max)

    arr[~lat_in_bounds, :] = np.nan
    arr[:, ~lon_in_bounds] = np.nan

    rgba = render_depth_rgba(
        arr,
        vmin,
        vmax,
        render_mode,
        thresholds,
        colors,
        resample_colors,
    )
    img = Image.fromarray(rgba, mode="RGBA")
    png_bytes = png_bytes_from_image(img)
    disk_tile_cache_put("range_max_png", png_key, png_bytes)
    return png_bytes_response(png_bytes)
@app.get("/raster-png")
def raster_png(
    time_index: int = Query(0, description="Time index"),
    vmin: float = Query(0.05, description="Minimum visible depth"),
    vmax: float = Query(3.0, description="Maximum colour scale depth"),
    render_mode: str = Query("continuous", description="continuous or thresholds"),
    thresholds: Optional[str] = Query(None, description="Comma-separated threshold list"),
    colors: Optional[str] = Query(None, description="Comma-separated hex colors"),
    resample_colors: bool = Query(False, description="Resample colors as palette stops across threshold bands"),
    product: str = Query(DEFAULT_PRODUCT, description="Dataset product name"),
):
    ds = require_dataset(product).dataset
    depth = get_depth_dataarray(ds)
    validate_time_index(depth, time_index)

    try:
        if vmax <= vmin:
            raise HTTPException(
                status_code=400,
                detail="vmax must be greater than the effective minimum visible depth",
            )

        arr = compute_depth_time_slice(depth, time_index).values

        # Mask dry / invalid values only. Do not apply static msk filtering.
        masked = np.where((arr >= vmin) & np.isfinite(arr), arr, np.nan)

        if render_mode == "thresholds":
            threshold_values = parse_threshold_list(thresholds)
            color_values = parse_color_list(colors)
            if resample_colors:
                color_values = resample_color_list(color_values, len(threshold_values))
            rgba = render_threshold_rgba(masked, threshold_values, color_values)
        else:
            norm = mcolors.Normalize(vmin=vmin, vmax=vmax, clip=True)
            cmap = TURBO_CMAP
            rgba = (cmap(norm(masked)) * 255).astype(np.uint8)
            rgba[np.isnan(masked)] = [0, 0, 0, 0]

        img = Image.fromarray(rgba, mode="RGBA")

        # Flip vertically if latitude is ascending
        if float(ds.lat.values[0]) < float(ds.lat.values[-1]):
            img = img.transpose(Image.FLIP_TOP_BOTTOM)

        buffer = BytesIO()
        img.save(buffer, format="PNG")
        buffer.seek(0)

        return StreamingResponse(buffer, media_type="image/png")

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
@app.get("/grid")
def grid(
    time_index: int = Query(0, description="Time index"),
    stride: int = Query(8, description="Downsampling stride"),
    min_depth: float = Query(0.05, description="Minimum water depth to return"),
    product: str = Query(DEFAULT_PRODUCT, description="Dataset product name"),
):
    ds = require_dataset(product).dataset
    depth = get_depth_dataarray(ds)
    validate_time_index(depth, time_index)

    if stride < 1:
        raise HTTPException(status_code=400, detail="stride must be >= 1")

    try:
        h = depth_time_slice(depth, time_index)
        # Inundation depths are no longer masked by the static msk variable.
        # domain_mask = get_wettable_mask(ds)

        # Downsample first, then compute
        h_small = h.isel(
            lat=slice(0, None, stride),
            lon=slice(0, None, stride),
        ).compute()
        # mask_small = domain_mask[::stride, ::stride]

        lat_vals = h_small.lat.values
        lon_vals = h_small.lon.values
        data = h_small.values

        points = []

        for i, lat_value in enumerate(lat_vals):
            for j, lon_value in enumerate(lon_vals):
                depth_value = data[i, j]

                if (
                    np.isfinite(depth_value)
                    and depth_value >= min_depth
                ):
                    points.append({
                        "position": [float(lon_value), float(lat_value)],
                        "depth": float(depth_value),
                    })

        return {
            "product": product,
            "time_index": time_index,
            "time": depth_time_value(depth, time_index),
            "stride": stride,
            "min_depth": min_depth,
            "count": len(points),
            "points": points,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
def tile_to_lonlat_bounds(x, y, z):
    n = 2.0 ** z

    lon_min = x / n * 360.0 - 180.0
    lon_max = (x + 1) / n * 360.0 - 180.0

    lat_rad_max = math.atan(math.sinh(math.pi * (1 - 2 * y / n)))
    lat_rad_min = math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n)))

    lat_max = math.degrees(lat_rad_max)
    lat_min = math.degrees(lat_rad_min)

    return lon_min, lat_min, lon_max, lat_max

@app.get("/tiles/{time_index}/{z}/{x}/{y}.png")
def tile_png(
    time_index: int,
    z: int,
    x: int,
    y: int,
    vmin: float = Query(0.05),
    vmax: float = Query(3.0),
    render_mode: str = Query("continuous", description="continuous or thresholds"),
    thresholds: Optional[str] = Query(None, description="Comma-separated threshold list"),
    colors: Optional[str] = Query(None, description="Comma-separated hex colors"),
    resample_colors: bool = Query(False, description="Resample colors as palette stops across threshold bands"),
    product: str = Query(DEFAULT_PRODUCT, description="Dataset product name"),
):
    state = require_dataset(product)
    ds = state.dataset
    depth = get_depth_dataarray(ds)
    validate_time_index(depth, time_index)

    try:
        if vmax <= vmin:
            raise HTTPException(
                status_code=400,
                detail="vmax must be greater than the effective minimum visible depth",
            )

        tile_size = 256

        # MapLibre requests these tiles continuously while panning/zooming;
        # cache the rendered PNG per (product signature, time, tile, style)
        # so repeat requests for the same tile don't re-render from scratch.
        # state.signature is the exact generation `ds`/`depth` above came
        # from -- reading dataset_cache[product] fresh here instead could
        # grab a *newer* signature than the data actually being rendered if
        # a reload raced in between, poisoning that tile's cache entry for
        # every later request of the new generation.
        product_signature = state.signature
        png_key = (
            product,
            product_signature,
            time_index,
            z,
            x,
            y,
            vmin,
            vmax,
            render_mode,
            thresholds,
            colors,
            resample_colors,
        )
        cached_png = disk_tile_cache_get("sfincs_tile", png_key)
        if cached_png is not None:
            return png_bytes_response(cached_png)

        dataset_lon_min = float(ds.lon.min())
        dataset_lon_max = float(ds.lon.max())
        dataset_lat_min = float(ds.lat.min())
        dataset_lat_max = float(ds.lat.max())

        lon_min, lat_min, lon_max, lat_max = tile_to_lonlat_bounds(x, y, z)

        # Empty tile if no overlap
        if (
            lon_max < dataset_lon_min
            or lon_min > dataset_lon_max
            or lat_max < dataset_lat_min
            or lat_min > dataset_lat_max
        ):
            return transparent_png_response(tile_size)

        # Build exact lon/lat grid for every pixel in this Web Mercator tile
        px = np.arange(tile_size)
        py = np.arange(tile_size)

        n = 2.0 ** z

        lon_vals = (x + (px + 0.5) / tile_size) / n * 360.0 - 180.0

        y_world = y + (py + 0.5) / tile_size
        lat_vals = np.degrees(
            np.arctan(np.sinh(np.pi * (1 - 2 * y_world / n)))
        )

        # Sample the computed grid with NumPy so the tile route does not depend
        # on SciPy-backed xarray interpolation at runtime.
        grid = compute_depth_time_slice(depth, time_index)
        arr = grid.values.astype(np.float32, copy=True)
        # Inundation depths are no longer masked by the static msk variable.
        # domain_mask = get_wettable_mask(ds)
        src_lon = grid.lon.values
        src_lat = grid.lat.values

        def nearest_indices(coords, targets):
            ascending = coords[0] < coords[-1]
            coords_asc = coords if ascending else coords[::-1]

            idx = np.searchsorted(coords_asc, targets)
            idx = np.clip(idx, 1, len(coords_asc) - 1)

            left = coords_asc[idx - 1]
            right = coords_asc[idx]
            idx_asc = np.where(
                np.abs(targets - left) <= np.abs(targets - right),
                idx - 1,
                idx,
            )

            if ascending:
                return idx_asc

            return (len(coords) - 1) - idx_asc

        lon_idx = nearest_indices(src_lon, lon_vals)
        lat_idx = nearest_indices(src_lat, lat_vals)

        arr = arr[np.ix_(lat_idx, lon_idx)]

        lon_in_bounds = (lon_vals >= dataset_lon_min) & (lon_vals <= dataset_lon_max)
        lat_in_bounds = (lat_vals >= dataset_lat_min) & (lat_vals <= dataset_lat_max)

        arr[~lat_in_bounds, :] = np.nan
        arr[:, ~lon_in_bounds] = np.nan

        # Mask dry / invalid values only. Do not apply static msk filtering.
        masked = np.where((arr >= vmin) & np.isfinite(arr), arr, np.nan)

        if render_mode == "thresholds":
            threshold_values = parse_threshold_list(thresholds)
            color_values = parse_color_list(colors)
            if resample_colors:
                color_values = resample_color_list(color_values, len(threshold_values))
            rgba = render_threshold_rgba(masked, threshold_values, color_values)
        else:
            norm = mcolors.Normalize(vmin=vmin, vmax=vmax, clip=True)
            cmap = TURBO_CMAP
            rgba = (cmap(norm(masked)) * 255).astype(np.uint8)
            rgba[np.isnan(masked)] = [0, 0, 0, 0]

        img = Image.fromarray(rgba, mode="RGBA")
        png_bytes = png_bytes_from_image(img)
        disk_tile_cache_put("sfincs_tile", png_key, png_bytes)

        return png_bytes_response(png_bytes)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
@app.get("/animation-frame")
def animation_frame(
    time_index: int = Query(0),
    stride: int = Query(8),
    min_depth: float = Query(0.05),
    product: str = Query(DEFAULT_PRODUCT, description="Dataset product name"),
):
    ds = require_dataset(product).dataset
    depth = get_depth_dataarray(ds)
    validate_time_index(depth, time_index)

    h = depth_time_slice(depth, time_index)
    # Inundation depths are no longer masked by the static msk variable.
    # domain_mask = get_wettable_mask(ds)

    h_small = h.isel(
        lat=slice(0, None, stride),
        lon=slice(0, None, stride),
    ).compute()
    # mask_small = domain_mask[::stride, ::stride]

    lat_vals = h_small.lat.values
    lon_vals = h_small.lon.values
    data = h_small.values

    points = []

    for i, lat_value in enumerate(lat_vals):
        for j, lon_value in enumerate(lon_vals):
            depth_value = data[i, j]

            if (
                np.isfinite(depth_value)
                and depth_value >= min_depth
            ):
                points.append([
                    float(lon_value),
                    float(lat_value),
                    float(depth_value),
                ])

    return {
        "product": product,
        "time_index": time_index,
        "time": depth_time_value(depth, time_index),
        "stride": stride,
        "count": len(points),
        "points": points,
    }

# ===========================================================================
# Niue data loaders and endpoints
# ===========================================================================

# Niue suitability loader
# ---------------------------------------------------------------------------

def _suit_source() -> tuple[Optional[str], Optional[Path]]:
    """Zarr is preferred when present (matches the Niue inundation loader's
    pattern); falls back to the original NetCDF product otherwise."""
    zarr_path = Path(NIU_SUITABILITY_ZARR_PATH)
    if zarr_path.is_dir():
        return "zarr", zarr_path

    nc_path = Path(NIU_SUITABILITY_NC_PATH)
    if nc_path.is_file():
        return "netcdf", nc_path

    return None, None


def _suit_signature() -> Optional[tuple]:
    source_type, source_path = _suit_source()
    if source_type is None or source_path is None:
        return None

    if source_type == "zarr":
        for metadata_name in ("zarr.json", ".zmetadata", ".zgroup"):
            metadata_path = source_path / metadata_name
            try:
                stat = metadata_path.stat()
            except FileNotFoundError:
                continue
            return (source_type, stat.st_ino, stat.st_mtime_ns, stat.st_size)
        try:
            stat = source_path.stat()
            return (source_type, stat.st_ino, stat.st_mtime_ns, stat.st_size)
        except FileNotFoundError:
            return None

    try:
        stat = source_path.stat()
        return (source_type, stat.st_ino, stat.st_mtime_ns, stat.st_size)
    except FileNotFoundError:
        return None


# Guards the rebuild itself (see _rebuild_niue_suit_state_locked()), not
# reads. Its only job is to stop two rebuild triggers -- the startup/poll
# background thread and a request-path staleness check -- from redoing the
# same expensive rebuild concurrently. Request-path reads of niue_suit_state
# are deliberately lock-free (see _load_niue_suit_state()): the rebuild takes
# tens of seconds at fine RASTER_STEP values, and blocking every request
# behind that on every forecast-cycle refresh is the actual slowness this is
# fixing. The one exception is a true first-ever cold start (niue_suit_state
# is still None): there's no stale generation to serve, so that path still
# blocks.
suit_load_lock = threading.Lock()

# Cross-process counterpart to suit_load_lock (see cross_process_lock()):
# guards the actual rebuild computation so worker processes take turns
# instead of all doing it simultaneously.
SUIT_REBUILD_CROSS_PROCESS_LOCK_PATH = TILE_CACHE_ROOT / ".suit-rebuild.lock"

# How often the background poller checks whether the source file changed.
SUIT_POLL_INTERVAL_SECONDS = float(os.environ.get("NIU_SUITABILITY_POLL_INTERVAL_SECONDS", "30"))


def _load_niue_suit_state() -> Optional[NiueSuitabilityState]:
    """Request-path entry point.

    - True cold start (niue_suit_state is still None, nothing stale to fall
      back on): block until the first rebuild completes, same as before this
      file had a background path.
    - Otherwise: a cheap signature check. If the source changed, kick a
      rebuild on a background thread (no-op if one is already in flight) and
      return whatever is currently loaded immediately -- callers get the
      previous, stale-but-valid generation while the rebuild runs. In steady
      state the startup/poll thread (see _suit_poll_loop()) usually wins this
      race before any request even notices the file changed; this is just the
      safety net for the gap between polls.
    """
    if niue_suit_state is None:
        with suit_load_lock:
            with cross_process_lock(SUIT_REBUILD_CROSS_PROCESS_LOCK_PATH):
                return _rebuild_niue_suit_state_locked()

    current_sig = _suit_signature()
    if current_sig is None or current_sig != niue_suit_state.signature:
        _kick_background_suit_rebuild()

    return niue_suit_state


def _kick_background_suit_rebuild() -> None:
    """Try to acquire suit_load_lock without blocking; if acquired, run the
    rebuild on a new daemon thread (releasing the lock when it finishes) so
    the calling thread never waits on it. If the lock is already held --
    another rebuild already in flight, triggered by the poller or a different
    request -- this is a no-op."""
    if not suit_load_lock.acquire(blocking=False):
        return

    def _run() -> None:
        try:
            with cross_process_lock(SUIT_REBUILD_CROSS_PROCESS_LOCK_PATH):
                _rebuild_niue_suit_state_locked()
        finally:
            suit_load_lock.release()

    threading.Thread(target=_run, daemon=True, name="suit-rebuild").start()


def _suit_poll_loop() -> None:
    """Background daemon thread: proactively rebuilds as soon as the source
    file changes, so in steady state a rebuild is usually already finished
    (or in flight) before real traffic hits a stale generation. Runs once
    immediately (warms the cube at startup before waiting for the first
    interval) and then every SUIT_POLL_INTERVAL_SECONDS thereafter."""
    while True:
        try:
            _kick_background_suit_rebuild()
        except Exception:
            # Keep polling even if the source is transiently unreadable, but
            # log it -- a persistent failure should be visible somewhere
            # rather than silently leaving the generation stale forever.
            logger.exception("Niue suitability background poll failed")
        time.sleep(SUIT_POLL_INTERVAL_SECONDS)


@app.on_event("startup")
def _start_suit_poll_thread() -> None:
    threading.Thread(target=_suit_poll_loop, daemon=True, name="suit-poll").start()


def _rebuild_niue_suit_state_locked() -> Optional[NiueSuitabilityState]:
    """Do the actual (expensive) rebuild. Caller must hold suit_load_lock.

    All new state is computed into local variables first and assembled into
    a NiueSuitabilityState only at the very end; reads are lock-free (see
    _load_niue_suit_state()), so publishing via a single
    `niue_suit_state = new_state` reference assignment is what keeps a
    concurrent reader from ever observing a mix of an old and a new
    generation -- e.g. a new face_tree paired with a not-yet-updated
    raster_hazard.

    The previous generation's xr.Dataset is deliberately never explicitly
    closed here: a request that started against it before this rebuild
    published may still be reading from it (that's the point of serving
    stale data during a rebuild), and closing out from under an in-flight
    read could break it. It's simply dropped and left for GC once nothing
    references it any more.
    """
    global niue_suit_state

    rebuild_started = time.perf_counter()
    current_sig = _suit_signature()
    if current_sig is None:
        # Source is missing (e.g. a "latest" symlink caught mid-republish, or
        # dangling). Keep serving whatever generation is already loaded --
        # never wipe it out just because the source is momentarily gone --
        # and only report "no data" if nothing has ever loaded successfully.
        return niue_suit_state

    if niue_suit_state is not None and niue_suit_state.signature == current_sig:
        return niue_suit_state

    source_type, source_path = _suit_source()
    try:
        if source_type == "zarr":
            try:
                new_ds = xr.open_zarr(source_path, consolidated=True)
            except ValueError:
                new_ds = xr.open_zarr(source_path, consolidated=False)
        else:
            new_ds = xr.open_dataset(source_path)
    except (FileNotFoundError, OSError):
        # Same reasoning as the current_sig is None branch above: a read
        # failure on the source we just stat'd successfully (e.g. it vanished
        # between _suit_signature() and here) shouldn't nuke a good cache.
        return niue_suit_state

    lon = new_ds.lon.values
    lat = new_ds.lat.values
    face_coords = np.column_stack([lon, lat])
    new_tree = cKDTree(face_coords)

    # Authoritative land/off-mesh test -- see _build_mesh_trifinder(). Built
    # here (rather than later, alongside the final state publish) so it's
    # also available to the legacy-fallback raster construction below, not
    # just the final state object. Reuses the same wave UGRID Zarr this API
    # already loads for /niue/wave/ugrid/timeseries (NIU_UGRID_ZARR_PATH),
    # so this needs no new data source; if that mesh isn't available,
    # _is_marine() falls back to the distance-only check everywhere.
    new_mesh_trifinder = _build_mesh_trifinder(Path(NIU_UGRID_ZARR_PATH))

    new_vessel_codes = tuple(str(v) for v in new_ds.vessel_class_code.values)
    new_lon_min = float(lon.min())
    new_lon_max = float(lon.max())
    new_lat_min = float(lat.min())
    new_lat_max = float(lat.max())

    # Pre-load per-face arrays for point queries.
    new_hazard  = new_ds.hazard_class.values.astype(np.int8)
    new_overall = new_ds.overall_hazard_class.values.astype(np.int8)
    new_wind_kt = new_ds.wind_speed_kt.values.astype(np.float32)
    new_wave_m  = new_ds.wave_height_m.values.astype(np.float32)
    new_wind_caution_kt = new_ds.vessel_wind_caution_kt.values.astype(np.float32)
    new_wind_warning_kt = new_ds.vessel_wind_warning_kt.values.astype(np.float32)
    new_wave_caution_m = new_ds.vessel_wave_caution_m.values.astype(np.float32)
    new_wave_warning_m = new_ds.vessel_wave_warning_m.values.astype(np.float32)

    raster_variables = {
        "raster_lon",
        "raster_lat",
        "raster_valid",
        "raster_wind_speed_kt",
        "raster_wave_height_m",
        "raster_hazard_class",
        "raster_overall_hazard_class",
    }
    new_raster_precomputed = raster_variables.issubset(new_ds.variables)

    if new_raster_precomputed:
        # New pipeline products contain the exact rasterization formerly built
        # below in every API worker. Keep large arrays as lazy, chunk-backed
        # DataArrays: eagerly materializing all 205 timesteps takes ~90 seconds
        # and ~5 GiB per worker, defeating the purpose of pipeline rasterization.
        # Callers slice one timestep before np.asarray(), so Zarr only decodes
        # the chunks needed by the current request.
        raster_lons_1d = new_ds.raster_lon.values.astype(np.float32)
        raster_lats_1d = new_ds.raster_lat.values.astype(np.float32)
        new_raster_valid = new_ds.raster_valid.values.astype(bool)
        new_raster_wind_kt = new_ds.raster_wind_speed_kt
        new_raster_wave_m = new_ds.raster_wave_height_m
        new_raster_hazard = new_ds.raster_hazard_class
        new_raster_overall = new_ds.raster_overall_hazard_class

        product_step = new_ds.attrs.get("raster_grid_step_deg")
        product_mask_k = new_ds.attrs.get("raster_land_mask_k")
        if product_step is not None and not np.isclose(float(product_step), RASTER_STEP):
            logger.warning(
                "Suitability product raster_grid_step_deg=%s differs from "
                "NIU_SUITABILITY_RASTER_STEP=%s; using the product grid",
                product_step, RASTER_STEP,
            )
        if product_mask_k is not None and not np.isclose(float(product_mask_k), NIU_SUITABILITY_LAND_MASK_K):
            logger.warning(
                "Suitability product raster_land_mask_k=%s differs from "
                "NIU_SUITABILITY_LAND_MASK_K=%s; using the product mask",
                product_mask_k, NIU_SUITABILITY_LAND_MASK_K,
            )
    else:
        logger.warning(
            "Suitability product has no precomputed raster schema; using the "
            "legacy runtime interpolation fallback"
        )

    # Legacy fallback: build a pre-rasterized regular grid so tile rendering
    # never calls KDTree. Retained for old Zarr/NetCDF products during rollout.
    if not new_raster_precomputed:
        # One KDTree query over the full grid (once at load), then each tile
        # uses two 1D searchsorted calls, as in the SFINCS tile endpoint.
        raster_lons_1d = np.arange(float(lon.min()), float(lon.max()) + RASTER_STEP, RASTER_STEP, dtype=np.float32)
        raster_lats_1d = np.arange(float(lat.min()), float(lat.max()) + RASTER_STEP, RASTER_STEP, dtype=np.float32)
        rlon_grid, rlat_grid = np.meshgrid(raster_lons_1d, raster_lats_1d)
        grid_coords = np.column_stack([rlon_grid.ravel(), rlat_grid.ravel()])
        grid_face_dist, grid_face_idx = new_tree.query(grid_coords, workers=KDTREE_QUERY_WORKERS)
        grid_face_dist = grid_face_dist.reshape(len(raster_lats_1d), len(raster_lons_1d))
        grid_face_idx = grid_face_idx.reshape(len(raster_lats_1d), len(raster_lons_1d))

    # The wave mesh only has faces over water, so a plain nearest-face lookup
    # bleeds ocean values straight through the island landmass. Flag a raster
    # cell as land/no-data when it sits much farther from its nearest face
    # than that face's own neighbors typically are — an adaptive threshold
    # since mesh density varies a lot between the reef/lagoon and open ocean.
    face_nn_dist, _ = new_tree.query(face_coords, k=2)
    new_face_spacing = face_nn_dist[:, 1]
    if not new_raster_precomputed:
        new_raster_valid = _is_marine(
            new_mesh_trifinder,
            grid_face_dist, new_face_spacing[grid_face_idx],
            rlon_grid, rlat_grid,
            NIU_SUITABILITY_LAND_MASK_K, NIU_SUITABILITY_LAND_MASK_ABSOLUTE_CAP_KM,
        )

    # Interpolate the continuous wind/wave fields from mesh face centroids onto
    # the raster grid via scattered-data linear interpolation, instead of
    # nearest-neighbor copying one face's value across every raster cell it's
    # closest to. LinearNDInterpolator is built once per field with `values`
    # holding all timesteps as trailing columns, so the expensive Delaunay
    # triangulation + per-grid-point simplex search happens once (not once per
    # timestep) — evaluating all 205 timesteps together in a single call.
    # Cells outside the mesh's convex hull come back NaN and are filled from
    # the nearest-face fallback so tile coverage never shrinks.
    if not new_raster_precomputed:
        fallback_wind = new_wind_kt[:, grid_face_idx]   # (time, lat, lon)
        fallback_wave = new_wave_m[:, grid_face_idx]    # (time, lat, lon)
        n_time = new_wind_kt.shape[0]
        n_lat = len(raster_lats_1d)
        n_lon = len(raster_lons_1d)
        try:
            wind_interp = LinearNDInterpolator(face_coords, new_wind_kt.T.astype(np.float64))
            wave_interp = LinearNDInterpolator(face_coords, new_wave_m.T.astype(np.float64))
            grid_wind = wind_interp(grid_coords).T.reshape(n_time, n_lat, n_lon)
            grid_wave = wave_interp(grid_coords).T.reshape(n_time, n_lat, n_lon)
            outside_hull = np.isnan(grid_wind)
            new_raster_wind_kt = np.where(outside_hull, fallback_wind, grid_wind).astype(np.float32)
            new_raster_wave_m = np.where(outside_hull, fallback_wave, grid_wave).astype(np.float32)
        except Exception:
            new_raster_wind_kt = fallback_wind.astype(np.float32)
            new_raster_wave_m = fallback_wave.astype(np.float32)

    # Reclassify hazard from the interpolated wind/wave rasters using the same
    # per-vessel threshold rule verified against hazard_class in the source
    # NetCDF, rather than nearest-neighbor copying the discrete class — this
    # makes hazard boundaries follow the physical gradient instead of the raw
    # Voronoi mesh-cell edges. Shapes match the previous nearest-neighbor
    # construction: (time, vessel, lat, lon) and (time, lat, lon).
    #
    # Thresholds are passed explicitly (the new generation's, not yet
    # published) -- classify_suitability_arrays takes them as required
    # arguments precisely so this can never accidentally read a stale
    # niue_suit_state's thresholds mid-rebuild, before the publish below.
    if not new_raster_precomputed:
        new_raster_hazard = np.stack(
            [
                classify_suitability_arrays(
                    new_raster_wind_kt, new_raster_wave_m, vessel_idx,
                    wind_caution_kt=new_wind_caution_kt, wind_warning_kt=new_wind_warning_kt,
                    wave_caution_m=new_wave_caution_m, wave_warning_m=new_wave_warning_m,
                )
                for vessel_idx in range(len(new_vessel_codes))
            ],
            axis=1,
        ).astype(np.int8)
        new_raster_overall = new_raster_hazard.max(axis=1).astype(np.int8)

    # Publish the new generation as a single reference swap -- see
    # NiueSuitabilityState's docstring for why this (rather than the ~20
    # separate global writes this replaced) is what makes lock-free reads safe.
    niue_suit_state = NiueSuitabilityState(
        dataset=new_ds,
        signature=current_sig,
        face_tree=new_tree,
        vessel_codes=new_vessel_codes,
        lon_min=new_lon_min,
        lon_max=new_lon_max,
        lat_min=new_lat_min,
        lat_max=new_lat_max,
        hazard=new_hazard,
        overall=new_overall,
        wind_kt=new_wind_kt,
        wave_m=new_wave_m,
        face_spacing=new_face_spacing,
        wind_caution_kt=new_wind_caution_kt,
        wind_warning_kt=new_wind_warning_kt,
        wave_caution_m=new_wave_caution_m,
        wave_warning_m=new_wave_warning_m,
        raster_lons=raster_lons_1d,
        raster_lats=raster_lats_1d,
        raster_valid=new_raster_valid,
        raster_wind_kt=new_raster_wind_kt,
        raster_wave_m=new_raster_wave_m,
        raster_hazard=new_raster_hazard,
        raster_overall=new_raster_overall,
        raster_precomputed=new_raster_precomputed,
        mesh_trifinder=new_mesh_trifinder,
    )

    logger.info(
        "Loaded suitability generation source=%s raster=%s elapsed=%.3fs grid=%dx%d",
        source_type,
        "precomputed" if new_raster_precomputed else "legacy-fallback",
        time.perf_counter() - rebuild_started,
        len(raster_lats_1d),
        len(raster_lons_1d),
    )

    return niue_suit_state


def niue_buffer_extent(buffer_km: float = 100.0) -> tuple[float, float, float, float]:
    """Return lon/lat extent centered on Niue for an advisory buffer radius."""
    km_per_deg_lat = 111.32
    km_per_deg_lon = 111.32 * np.cos(np.deg2rad(NIUE_LAT))
    dlat = buffer_km / km_per_deg_lat
    dlon = buffer_km / km_per_deg_lon
    return (
        NIUE_LON - dlon,
        NIUE_LON + dlon,
        NIUE_LAT - dlat,
        NIUE_LAT + dlat,
    )


def apply_advisory_buffer_mask(
    arr: np.ndarray,
    lon_1d: np.ndarray,
    lat_1d: np.ndarray,
    buffer_km: float = 100.0,
) -> np.ndarray:
    """Return a copy of arr with cells outside buffer_km of Niue set to -1 (transparent)."""
    lon_grid, lat_grid = np.meshgrid(lon_1d, lat_1d)
    km_per_deg_lat = 111.32
    km_per_deg_lon = 111.32 * np.cos(np.deg2rad(NIUE_LAT))
    dist_km = np.sqrt(
        ((lon_grid - NIUE_LON) * km_per_deg_lon) ** 2 +
        ((lat_grid - NIUE_LAT) * km_per_deg_lat) ** 2
    )
    result = arr.copy()
    result[dist_km > buffer_km] = -1
    return result


def _parse_suit_bounds(
    west: Optional[float],
    south: Optional[float],
    east: Optional[float],
    north: Optional[float],
) -> Optional[dict]:
    """Validate a west/south/east/north query into a bounds dict, or None if
    the caller didn't request bounds at all. All four must be given together
    -- a partial set is a caller error, not an implicit default, since a
    silently-ignored partial bbox is exactly the kind of mismatch this is
    meant to prevent."""
    provided = [v is not None for v in (west, south, east, north)]
    if not any(provided):
        return None
    if not all(provided):
        raise HTTPException(
            status_code=422,
            detail="'west', 'south', 'east', and 'north' must all be provided together",
        )
    if not (-180.0 <= west <= 180.0) or not (-180.0 <= east <= 180.0):
        raise HTTPException(status_code=422, detail="'west'/'east' must be within -180..180")
    if not (-90.0 <= south <= 90.0) or not (-90.0 <= north <= 90.0):
        raise HTTPException(status_code=422, detail="'south'/'north' must be within -90..90")
    if west >= east:
        raise HTTPException(status_code=422, detail="'west' must be < 'east'")
    if south >= north:
        raise HTTPException(status_code=422, detail="'south' must be < 'north'")
    return {"west": west, "south": south, "east": east, "north": north}


def _applied_suit_bounds(requested_bounds: dict, state: NiueSuitabilityState) -> dict:
    """Intersect requested bounds with the dataset's actual mesh domain, so
    face/raster filtering never operates outside real coverage. Reported back
    to the caller separately from requested_bounds so a viewport that extends
    past the model domain is visible rather than silently clipped."""
    west = max(requested_bounds["west"], state.lon_min)
    east = min(requested_bounds["east"], state.lon_max)
    south = max(requested_bounds["south"], state.lat_min)
    north = min(requested_bounds["north"], state.lat_max)
    if west > east or south > north:
        # Requested viewport doesn't overlap the model domain at all -- the
        # independent per-edge clamps above can otherwise cross and produce
        # an inverted (west > east) rectangle. Collapse to a zero-area point
        # instead of reporting a nonsensical negative-area bbox.
        west = east = requested_bounds["west"]
        south = north = requested_bounds["south"]
    return {"west": west, "south": south, "east": east, "north": north}


def _faces_in_bounds(sds: xr.Dataset, bounds: dict) -> np.ndarray:
    """Face indices whose centroid falls inside bounds (inclusive). Centroid
    filtering only -- the suitability product has no face-polygon geometry
    (see statistics_basis="centroid_filtered_faces"), so this is a count of
    faces, not a geographic area."""
    lon = sds.lon.values
    lat = sds.lat.values
    mask = (
        (lon >= bounds["west"]) & (lon <= bounds["east"]) &
        (lat >= bounds["south"]) & (lat <= bounds["north"])
    )
    return np.flatnonzero(mask)


def _bbox_area_km2(bounds: dict) -> float:
    """Flat-earth bbox area in km^2 -- adequate at Niue's ~10km domain scale
    (same approximation used by niue_buffer_extent/apply_advisory_buffer_mask
    above)."""
    mean_lat = (bounds["south"] + bounds["north"]) / 2.0
    km_per_deg_lat = 111.32
    km_per_deg_lon = 111.32 * np.cos(np.deg2rad(mean_lat))
    return (bounds["north"] - bounds["south"]) * km_per_deg_lat * (bounds["east"] - bounds["west"]) * km_per_deg_lon


def _spatial_scope_coverage_percent(requested_bounds: dict, state: NiueSuitabilityState) -> Optional[float]:
    """Renderable raster coverage: how much of the caller's requested viewport
    falls inside cells where the regular suitability raster (state.raster_valid)
    can render valid data. This is a rendering-coverage proxy, not proof of
    polygonal mesh coverage -- the suitability product has no face polygons at
    all (see statistics_basis="centroid_filtered_faces").

    Returns 0.0 -- a real, confirmed measurement -- whenever the requested
    viewport doesn't intersect the raster, including a degenerate (zero-area)
    bbox, since that trivially has zero overlap with anything."""
    requested_area = _bbox_area_km2(requested_bounds)
    if requested_area <= 0:
        return 0.0

    lon_in = (state.raster_lons >= requested_bounds["west"]) & (state.raster_lons <= requested_bounds["east"])
    lat_in = (state.raster_lats >= requested_bounds["south"]) & (state.raster_lats <= requested_bounds["north"])
    if not lon_in.any() or not lat_in.any():
        return 0.0

    sub_valid = state.raster_valid[np.ix_(lat_in, lon_in)]
    # Single midpoint-latitude cosine correction for the requested bbox --
    # adequate at Niue's domain scale (same approximation used for
    # _bbox_area_km2/niue_buffer_extent above); raw pixel counts alone would
    # not be a real km^2 figure since a degree of longitude narrows with
    # latitude.
    mean_lat = (requested_bounds["south"] + requested_bounds["north"]) / 2.0
    km_per_deg_lat = 111.32
    km_per_deg_lon = 111.32 * np.cos(np.deg2rad(mean_lat))
    cell_area_km2 = RASTER_STEP * km_per_deg_lat * RASTER_STEP * km_per_deg_lon
    marine_area_km2 = float(sub_valid.sum()) * cell_area_km2

    return round(min(100.0, (marine_area_km2 / requested_area) * 100.0), 2)


def _classified_face_count_by_vessel(
    time_index: int,
    face_indices: Optional[np.ndarray],
    state: NiueSuitabilityState,
) -> dict:
    """Per-vessel classified-face counts so a single shared figure never hides
    a vessel-specific gap in valid classifications (e.g. one vessel class
    having no valid hazard_class at faces where another does)."""
    vessel_hazard = np.asarray(state.hazard[time_index], dtype=np.int8)  # (face, vessel_class)
    if face_indices is not None:
        vessel_hazard = vessel_hazard[face_indices]
    return {
        code: int(np.isin(vessel_hazard[:, i], [0, 1, 2]).sum())
        for i, code in enumerate(state.vessel_codes)
    }


def _suit_bounds_metadata(
    bounds: Optional[dict],
    applied_bounds: Optional[dict],
    eligible_face_count: int,
    hazard_for_classified: np.ndarray,
    time_index: int,
    vessel_idx: Optional[int],
    face_indices: Optional[np.ndarray],
    state: NiueSuitabilityState,
) -> dict:
    """Shared response-metadata block for /summary and /best-comparison-timestep
    so both endpoints report identical statistics_basis/bounds/coverage shape.

    classification_coverage_percent = classified in-bounds faces / all
    in-bounds suitability faces (both numerator and denominator are returned
    alongside it as classified_face_count/eligible_face_count). Both
    percentage fields are None -- not 0.0 -- when there is nothing to measure
    (zero eligible faces, or zero raster overlap), so a valid bbox with no
    intersection reads as "unavailable", never as a silent full-domain
    fallback."""
    classified = int(np.isin(hazard_for_classified, [0, 1, 2]).sum())
    classified_by_vessel = (
        _classified_face_count_by_vessel(time_index, face_indices, state) if vessel_idx is None else None
    )
    return {
        "statistics_basis": "centroid_filtered_faces" if bounds is not None else "full_domain",
        "requested_bounds": bounds,
        "applied_bounds": applied_bounds,
        "eligible_face_count": eligible_face_count,
        "classified_face_count": classified,
        "classified_face_count_by_vessel": classified_by_vessel,
        "classification_coverage_percent": (
            round(100.0 * classified / eligible_face_count, 2) if eligible_face_count else None
        ),
        "spatial_scope_coverage_percent": (
            _spatial_scope_coverage_percent(bounds, state) if bounds is not None else None
        ),
        "spatial_scope_coverage_basis": "suit_raster_valid" if bounds is not None else None,
    }


def _resolve_suit_time_range(
    sds: xr.Dataset,
    start_time_index: Optional[int],
    end_time_index: Optional[int],
) -> tuple[int, int]:
    """Resolve an optional [start_time_index, end_time_index] search window
    for the best-*-timestep ranking endpoints, defaulting to the full series.
    Without this, a caller scoped to e.g. a 72-hour/current-window view could
    get back a "best" timestep from well outside that window."""
    n = int(sds.sizes["time"])
    start = 0 if start_time_index is None else start_time_index
    end = n - 1 if end_time_index is None else end_time_index
    if start < 0 or start >= n:
        raise HTTPException(status_code=400, detail=f"start_time_index {start} out of range 0-{n - 1}")
    if end < 0 or end >= n:
        raise HTTPException(status_code=400, detail=f"end_time_index {end} out of range 0-{n - 1}")
    if start > end:
        raise HTTPException(status_code=400, detail="'start_time_index' must be <= 'end_time_index'")
    return start, end


def require_niue_suit_state() -> NiueSuitabilityState:
    state = _load_niue_suit_state()
    if state is None:
        raise HTTPException(
            status_code=503,
            detail=(
                "Niue suitability dataset not found: "
                f"{NIU_SUITABILITY_ZARR_PATH} or {NIU_SUITABILITY_NC_PATH}"
            ),
        )
    return state


# ---------------------------------------------------------------------------
# Niue inundation loader — projected NetCDF with 2D geographic coords
# ---------------------------------------------------------------------------

def _niu_inundation_source() -> tuple[Optional[str], Optional[Path]]:
    zarr_path = Path(NIU_INUNDATION_ZARR_PATH)
    if zarr_path.is_dir():
        return "zarr", zarr_path

    nc_path = Path(NIU_INUNDATION_NC_PATH)
    if nc_path.is_file():
        return "netcdf", nc_path

    return None, None


niu_inundation_load_lock = threading.Lock()
# Cross-process counterpart (see cross_process_lock()): guards the actual
# inundation rebuild so worker processes take turns instead of all
# reloading/reindexing simultaneously under concurrent first-hit traffic.
NIU_INUNDATION_REBUILD_CROSS_PROCESS_LOCK_PATH = TILE_CACHE_ROOT / ".niu-inundation-rebuild.lock"


def _niu_inundation_signature() -> Optional[tuple[str, int, int, int]]:
    source_type, source_path = _niu_inundation_source()
    if source_type is None or source_path is None:
        return None

    if source_type == "zarr":
        for metadata_name in ("zarr.json", ".zmetadata", ".zgroup"):
            metadata_path = source_path / metadata_name
            try:
                stat = metadata_path.stat()
            except FileNotFoundError:
                continue
            return (source_type, stat.st_ino, stat.st_mtime_ns, stat.st_size)
        try:
            stat = source_path.stat()
            return (source_type, stat.st_ino, stat.st_mtime_ns, stat.st_size)
        except FileNotFoundError:
            return None

    try:
        stat = source_path.stat()
        return (source_type, stat.st_ino, stat.st_mtime_ns, stat.st_size)
    except FileNotFoundError:
        return None


def _load_niu_inundation_dataset() -> Optional[xr.Dataset]:
    global niu_inundation_ds, niu_inundation_signature, niu_inundation_tree
    global niu_inundation_shape, niu_inundation_lon, niu_inundation_lat
    global niu_inundation_x, niu_inundation_y, niu_inundation_to_native
    global niu_inundation_bounds_lonlat

    current_sig = _niu_inundation_signature()
    if current_sig is None:
        # Source missing (dangling "latest" symlink, mid-republish, etc.) --
        # keep serving whatever generation is already cached rather than
        # dropping to "no data"; only a true cold start returns None here.
        return niu_inundation_ds

    if niu_inundation_ds is not None and niu_inundation_signature == current_sig:
        return niu_inundation_ds

    source_type, source_path = _niu_inundation_source()
    try:
        if source_type == "zarr":
            try:
                new_ds = xr.open_zarr(source_path, consolidated=True)
            except ValueError:
                new_ds = xr.open_zarr(source_path, consolidated=False)
        else:
            new_ds = xr.open_dataset(source_path)
    except (FileNotFoundError, OSError):
        # Read failed on a source we just stat'd successfully (e.g. it
        # vanished between the signature check and here) -- preserve the
        # existing cache instead of wiping it, same reasoning as above.
        return niu_inundation_ds

    if NIU_INUNDATION_VARIABLE not in new_ds:
        new_ds.close()
        raise HTTPException(
            status_code=500,
            detail=f"Niue inundation dataset missing variable: {NIU_INUNDATION_VARIABLE}",
        )
    arr = new_ds[NIU_INUNDATION_VARIABLE]
    if "time" in arr.dims:
        grid_dims = arr.dims[-2:]
    else:
        grid_dims = arr.dims

    niu_inundation_tree = None
    niu_inundation_lon = None
    niu_inundation_lat = None
    niu_inundation_x = None
    niu_inundation_y = None
    niu_inundation_to_native = None
    niu_inundation_bounds_lonlat = None

    if "lon" in new_ds and "lat" in new_ds:
        lon = np.asarray(new_ds.lon.values, dtype=np.float64)
        lat = np.asarray(new_ds.lat.values, dtype=np.float64)
        if lon.shape != lat.shape:
            new_ds.close()
            raise HTTPException(status_code=500, detail="Niue inundation lon/lat shape mismatch")

        coords = np.column_stack([lon.ravel(), lat.ravel()])
        valid = np.isfinite(coords).all(axis=1)
        if not valid.any():
            new_ds.close()
            raise HTTPException(status_code=500, detail="Niue inundation lon/lat coordinates are empty")

        coords[~valid] = [999.0, 999.0]
        niu_inundation_tree = cKDTree(coords)
        niu_inundation_shape = lon.shape
        niu_inundation_lon = lon
        niu_inundation_lat = lat
        niu_inundation_bounds_lonlat = (
            float(np.nanmin(lon)),
            float(np.nanmin(lat)),
            float(np.nanmax(lon)),
            float(np.nanmax(lat)),
        )
    elif len(grid_dims) == 2 and all(dim in new_ds.coords for dim in grid_dims):
        y_dim, x_dim = grid_dims
        x_axis = np.asarray(new_ds[x_dim].values, dtype=np.float64)
        y_axis = np.asarray(new_ds[y_dim].values, dtype=np.float64)
        crs = new_ds.attrs.get("crs") or "EPSG:32702"
        try:
            from pyproj import Transformer

            to_wgs84 = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
            niu_inundation_to_native = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
        except Exception as exc:
            new_ds.close()
            raise HTTPException(status_code=500, detail=f"Invalid Niue inundation CRS: {crs}") from exc

        x_edges = [x_axis[0], x_axis[-1]]
        y_edges = [y_axis[0], y_axis[-1]]
        corner_x = np.array([x_edges[0], x_edges[0], x_edges[1], x_edges[1]], dtype=np.float64)
        corner_y = np.array([y_edges[0], y_edges[1], y_edges[0], y_edges[1]], dtype=np.float64)
        corner_lon, corner_lat = to_wgs84.transform(corner_x, corner_y)

        niu_inundation_x = x_axis
        niu_inundation_y = y_axis
        niu_inundation_shape = (len(y_axis), len(x_axis))
        niu_inundation_bounds_lonlat = (
            float(np.nanmin(corner_lon)),
            float(np.nanmin(corner_lat)),
            float(np.nanmax(corner_lon)),
            float(np.nanmax(corner_lat)),
        )
    else:
        new_ds.close()
        raise HTTPException(
            status_code=500,
            detail="Niue inundation dataset missing 2D lon/lat or projected x/y coordinates",
        )

    if niu_inundation_ds is not None and niu_inundation_ds is not new_ds:
        niu_inundation_ds.close()

    niu_inundation_ds = new_ds
    niu_inundation_signature = current_sig
    clear_disk_tile_cache_namespace("inundation")
    return niu_inundation_ds


def require_niu_inundation_dataset() -> xr.Dataset:
    dataset = niu_inundation_ds
    if dataset is None or _niu_inundation_signature() != niu_inundation_signature:
        with niu_inundation_load_lock:
            with cross_process_lock(NIU_INUNDATION_REBUILD_CROSS_PROCESS_LOCK_PATH):
                dataset = _load_niu_inundation_dataset()
    if dataset is None:
        raise HTTPException(
            status_code=503,
            detail=f"Niue inundation dataset not found: {NIU_INUNDATION_ZARR_PATH} or {NIU_INUNDATION_NC_PATH}",
        )
    return dataset


def niu_inundation_depth_or_none(value, min_depth: float = 0.05):
    if not np.isfinite(value) or value < min_depth:
        return None
    return float(value)


def niu_inundation_lonlat_bounds() -> tuple[float, float, float, float]:
    if niu_inundation_bounds_lonlat is not None:
        return niu_inundation_bounds_lonlat
    if niu_inundation_lon is not None and niu_inundation_lat is not None:
        return (
            float(np.nanmin(niu_inundation_lon)),
            float(np.nanmin(niu_inundation_lat)),
            float(np.nanmax(niu_inundation_lon)),
            float(np.nanmax(niu_inundation_lat)),
        )
    raise HTTPException(status_code=503, detail="Niue inundation geographic bounds are unavailable")


def nearest_axis_indices(axis: np.ndarray, values: np.ndarray) -> np.ndarray:
    if axis[0] > axis[-1]:
        idx_reversed = nearest_axis_indices(axis[::-1], values)
        return len(axis) - 1 - idx_reversed

    idx = np.searchsorted(axis, values)
    idx = np.clip(idx, 0, len(axis) - 1)
    prev_idx = np.clip(idx - 1, 0, len(axis) - 1)
    use_prev = np.abs(values - axis[prev_idx]) <= np.abs(values - axis[idx])
    return np.where(use_prev, prev_idx, idx)


def resolve_niu_inundation_indices(lon_values: np.ndarray, lat_values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    if niu_inundation_shape is None:
        raise HTTPException(status_code=503, detail="Niue inundation spatial index is unavailable")

    lon_grid, lat_grid = np.meshgrid(lon_values, lat_values)
    if niu_inundation_tree is not None:
        query_points = np.column_stack([lon_grid.ravel(), lat_grid.ravel()])
        _, flat_idx = niu_inundation_tree.query(query_points, workers=KDTREE_QUERY_WORKERS)
        return np.unravel_index(flat_idx, niu_inundation_shape)

    if niu_inundation_x is None or niu_inundation_y is None or niu_inundation_to_native is None:
        raise HTTPException(status_code=503, detail="Niue inundation projected grid is unavailable")

    x_grid, y_grid = niu_inundation_to_native.transform(lon_grid, lat_grid)
    xi = nearest_axis_indices(niu_inundation_x, x_grid.ravel())
    yi = nearest_axis_indices(niu_inundation_y, y_grid.ravel())
    return yi, xi


def cache_niu_inundation_tile(cache_key: tuple, png_bytes: bytes) -> None:
    disk_tile_cache_put("inundation", cache_key, png_bytes)


def resolve_vessel_index(vessel: str, vessel_codes: tuple[str, ...]) -> Optional[int]:
    """
    Resolve a vessel name or integer string to a vessel_class axis index.
    Returns None when vessel == 'all' or 'overall' (use overall_hazard_class).
    Raises HTTP 400 for unrecognised inputs.
    """
    if vessel in ("all", "overall"):
        return None
    if vessel.isdigit():
        idx = int(vessel)
        if idx < 0 or idx >= len(vessel_codes):
            raise HTTPException(
                status_code=400,
                detail=f"vessel index {idx} out of range; "
                       f"valid indices are 0–{len(vessel_codes) - 1}",
            )
        return idx
    if vessel in vessel_codes:
        return vessel_codes.index(vessel)
    raise HTTPException(
        status_code=400,
        detail=f"Unknown vessel '{vessel}'. Valid values: {list(vessel_codes)} or 'all'.",
    )


HAZARD_LABELS: dict[int, str] = {
    0: "Suitable",
    1: "Caution",
    2: "Warning",
}
HAZARD_COLORS_RGB: dict[int, tuple[float, float, float]] = {
    0: (42 / 255.0, 157 / 255.0, 143 / 255.0),
    1: (251 / 255.0, 140 / 255.0, 0 / 255.0),
    2: (229 / 255.0, 57 / 255.0, 53 / 255.0),
}
# Matches the frontend's "No Data" legend swatch for land/off-mesh cells
# (see NiueSuitabilityState.raster_valid).
NO_DATA_COLOR_RGB: tuple[float, float, float] = (189 / 255.0, 189 / 255.0, 189 / 255.0)
NIUE_SETTLEMENTS: tuple[tuple[str, float, float], ...] = (
    ("Alofi", -169.9210, -19.0558),
    ("Makefu", -169.9050, -18.9975),
    ("Tuapa", -169.9043, -18.9671),
    ("Hikutavake", -169.8850, -18.9402),
    ("Mutalau", -169.8335, -18.9634),
    ("Lakepa", -169.8100, -19.0095),
    ("Liku", -169.7920, -19.0550),
    ("Hakupu", -169.8265, -19.1240),
    ("Avatele", -169.9227, -19.1200),
)
NIUE_SETTLEMENT_LABEL_OFFSETS: dict[str, tuple[float, float, str, str]] = {
    "Alofi": (-0.036, -0.006, "right", "center"),
    "Makefu": (-0.038, 0.030, "right", "bottom"),
    "Tuapa": (-0.040, -0.020, "right", "top"),
    "Hikutavake": (0.014, 0.022, "left", "bottom"),
    "Mutalau": (0.024, 0.012, "left", "center"),
    "Lakepa": (0.026, -0.006, "left", "center"),
    "Liku": (0.030, -0.020, "left", "top"),
    "Hakupu": (0.024, -0.024, "left", "top"),
    "Avatele": (-0.026, -0.028, "right", "top"),
}


_niue_outline_cache: dict = {"signature": None, "lon": None, "lat": None}


def _ring_area(pts: np.ndarray) -> float:
    x, y = pts[:, 0], pts[:, 1]
    return 0.5 * abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))


def _trace_niue_outline_from_raster(state: NiueSuitabilityState) -> Optional[tuple[np.ndarray, np.ndarray]]:
    """Trace Niue's coastline from the suitability raster's land/no-data mask
    (see state.raster_valid) instead of a hand-drawn approximation, so the
    drawn coastline matches the actual island extent used to mask hazard
    tiles. Returns None if no ring is found."""
    lon_win = (state.raster_lons > NIUE_LON - 0.15) & (state.raster_lons < NIUE_LON + 0.15)
    lat_win = (state.raster_lats > NIUE_LAT - 0.2) & (state.raster_lats < NIUE_LAT + 0.2)
    if not lon_win.any() or not lat_win.any():
        return None

    sub_valid = state.raster_valid[np.ix_(lat_win, lon_win)]
    sub_lons = state.raster_lons[lon_win].astype(np.float64)
    sub_lats = state.raster_lats[lat_win].astype(np.float64)

    land_mask = (~sub_valid).astype(np.float64)
    gen = contourpy.contour_generator(x=sub_lons, y=sub_lats, z=land_mask)
    rings = [r for r in gen.lines(0.5) if len(r) >= 4]
    if not rings:
        return None

    ring = max(rings, key=_ring_area)
    x, y = ring[:, 0], ring[:, 1]
    if (x[0], y[0]) != (x[-1], y[-1]):
        x = np.append(x, x[0])
        y = np.append(y, y[0])

    # Smooth the raster staircase with a periodic spline through the traced
    # ring rather than the raw grid-aligned steps.
    try:
        tck, _ = splprep([x, y], per=True, s=0.0006, k=3)
        xs, ys = splev(np.linspace(0.0, 1.0, 240), tck)
        return np.asarray(xs), np.asarray(ys)
    except Exception:
        return x, y


def _niue_land_outline_fallback() -> tuple[np.ndarray, np.ndarray]:
    """Rough hand-tuned approximation, used only when the suitability raster
    isn't loaded (so a real coastline trace isn't available)."""
    theta = np.linspace(0.0, 2.0 * np.pi, 240)
    lon_radius = 0.055 * (1.0 + 0.10 * np.sin(3.0 * theta) - 0.06 * np.cos(5.0 * theta))
    lat_radius = 0.082 * (1.0 + 0.08 * np.cos(2.0 * theta) + 0.05 * np.sin(4.0 * theta))
    lon = NIUE_LON + lon_radius * np.cos(theta) + 0.004 * np.sin(theta)
    lat = NIUE_LAT + lat_radius * np.sin(theta) - 0.003 * np.cos(2.0 * theta)
    return lon, lat


def niue_land_outline(state: NiueSuitabilityState) -> tuple[np.ndarray, np.ndarray]:
    """Niue's coastline for static operational map context."""
    if _niue_outline_cache["signature"] == state.signature:
        return _niue_outline_cache["lon"], _niue_outline_cache["lat"]

    traced = _trace_niue_outline_from_raster(state)
    if traced is not None:
        _niue_outline_cache["signature"] = state.signature
        _niue_outline_cache["lon"] = traced[0]
        _niue_outline_cache["lat"] = traced[1]
        return traced

    return _niue_land_outline_fallback()


def add_niue_cartography(
    ax,
    lon_min: float,
    lon_max: float,
    lat_min: float,
    lat_max: float,
    state: NiueSuitabilityState,
    show_labels: bool = True,
) -> None:
    """Add fixed operational map context without requiring external map tiles.
    The island fill/outline is geographic context (doubles as the No Data
    visualization), so it always draws; show_labels only gates the settlement
    markers/names and the "Niue" text, which is what becomes illegible at the
    reduced sizes these images get embedded at in PDFs."""
    land_lon, land_lat = niue_land_outline(state)
    ax.fill(
        land_lon,
        land_lat,
        facecolor="#f4f1e8",
        edgecolor="#25323a",
        linewidth=1.1,
        zorder=7,
    )
    ax.plot(land_lon, land_lat, color="white", linewidth=2.6, alpha=0.65, zorder=6)

    if not show_labels:
        return

    for name, lon, lat in NIUE_SETTLEMENTS:
        if lon_min <= lon <= lon_max and lat_min <= lat <= lat_max:
            ax.scatter(
                [lon],
                [lat],
                s=12,
                marker="o",
                facecolor="#111827",
                edgecolor="white",
                linewidth=0.45,
                zorder=8,
            )
            dx, dy, ha, va = NIUE_SETTLEMENT_LABEL_OFFSETS.get(name, (0.010, 0.004, "left", "center"))
            ax.text(
                lon + dx,
                lat + dy,
                name,
                fontsize=6.1,
                color="#111827",
                ha=ha,
                va=va,
                path_effects=[],
                zorder=9,
            )

    ax.text(
        NIUE_LON - 0.004,
        NIUE_LAT - 0.026,
        "Niue",
        fontsize=8.4,
        weight="bold",
        color="#111827",
        ha="center",
        va="top",
        zorder=9,
    )


def add_north_arrow(ax, lon_min: float, lon_max: float, lat_min: float, lat_max: float) -> None:
    x = lon_max - 0.085 * (lon_max - lon_min)
    y = lat_max - 0.135 * (lat_max - lat_min)
    dy = 0.065 * (lat_max - lat_min)
    north_arrow = ax.annotate(
        "",
        xy=(x, y + dy),
        xytext=(x, y),
        arrowprops=dict(arrowstyle="-|>", color=MAP_TEXT_COLOR, linewidth=1.6, shrinkA=0, shrinkB=0),
        zorder=10,
    )
    if north_arrow.arrow_patch is not None:
        north_arrow.arrow_patch.set_path_effects(MAP_LINE_HALO)
    ax.text(
        x,
        y + dy + 0.012 * (lat_max - lat_min),
        "N",
        ha="center",
        va="bottom",
        fontsize=9,
        weight="bold",
        color=MAP_TEXT_COLOR,
        path_effects=MAP_TEXT_HALO,
    )


_SCALE_BAR_NICE_LENGTHS_KM = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]


def pick_scale_bar_length_km(lon_min: float, lon_max: float, lat_min: float, lat_max: float) -> float:
    """Pick a round scale-bar length sized to the current viewport, so a
    bounded/cropped map doesn't render a bar wider than the crop itself (a
    fixed 50km bar overflows any viewport narrower than ~65km wide given the
    bar's 7.5% left margin)."""
    km_per_deg_lon = 111.32 * np.cos(np.deg2rad((lat_min + lat_max) / 2.0))
    viewport_width_km = (lon_max - lon_min) * km_per_deg_lon
    target_km = viewport_width_km * 0.3
    for step in _SCALE_BAR_NICE_LENGTHS_KM:
        if step >= target_km:
            return float(step)
    return float(_SCALE_BAR_NICE_LENGTHS_KM[-1])


def add_scale_bar(ax, lon_min: float, lon_max: float, lat_min: float, lat_max: float, length_km: float = 50.0) -> None:
    km_per_deg_lon = 111.32 * np.cos(np.deg2rad((lat_min + lat_max) / 2.0))
    length_deg = length_km / km_per_deg_lon
    x0 = lon_min + 0.075 * (lon_max - lon_min)
    y0 = lat_min + 0.075 * (lat_max - lat_min)
    scale_lines = [
        ax.plot([x0, x0 + length_deg], [y0, y0], color=MAP_TEXT_COLOR, linewidth=3.2, solid_capstyle="butt", zorder=10)[0],
        ax.plot([x0, x0], [y0 - 0.006, y0 + 0.006], color=MAP_TEXT_COLOR, linewidth=1.3, zorder=10)[0],
        ax.plot([x0 + length_deg, x0 + length_deg], [y0 - 0.006, y0 + 0.006], color=MAP_TEXT_COLOR, linewidth=1.3, zorder=10)[0],
    ]
    for line in scale_lines:
        line.set_path_effects(MAP_LINE_HALO)
    ax.text(
        x0 + length_deg / 2.0,
        y0 + 0.018 * (lat_max - lat_min),
        f"{int(length_km)} km",
        ha="center",
        fontsize=8,
        color=MAP_TEXT_COLOR,
        path_effects=MAP_TEXT_HALO,
    )


def validate_suitability_time_index(sds: xr.Dataset, time_index: int) -> None:
    if time_index < 0 or time_index >= sds.sizes["time"]:
        raise HTTPException(
            status_code=400,
            detail=f"time_index {time_index} out of range 0-{sds.sizes['time'] - 1}",
        )


def suitability_valid_time_utc(sds: xr.Dataset, time_index: int) -> str:
    return pd.Timestamp(sds.time.values[time_index]).isoformat() + "Z"


def suitability_face_hazard(time_index: int, vessel_idx: Optional[int], state: NiueSuitabilityState) -> np.ndarray:
    if vessel_idx is None:
        return np.asarray(state.overall[time_index], dtype=np.int8)
    return np.asarray(state.hazard[time_index, :, vessel_idx], dtype=np.int8)


def suitability_raster_hazard(time_index: int, vessel_idx: Optional[int], state: NiueSuitabilityState) -> np.ndarray:
    if vessel_idx is None:
        return np.asarray(state.raster_overall[time_index], dtype=np.int8)
    return np.asarray(state.raster_hazard[time_index, vessel_idx], dtype=np.int8)


def suitability_hazard_counts(hazard: np.ndarray) -> dict:
    finite = np.isfinite(hazard)
    valid = finite & np.isin(hazard, [0, 1, 2])
    total = int(valid.sum())
    counts = {}
    percentages = {}
    for code, label in HAZARD_LABELS.items():
        count = int((valid & (hazard == code)).sum())
        counts[label.lower()] = count
        percentages[label.lower()] = round((count / total) * 100.0, 2) if total else 0.0
    return {
        "total_points": total,
        "counts": counts,
        "percentages": percentages,
        "dominant_hazard_class": int(max(HAZARD_LABELS, key=lambda code: counts[HAZARD_LABELS[code].lower()])) if total else None,
        "dominant_hazard_label": HAZARD_LABELS.get(int(max(HAZARD_LABELS, key=lambda code: counts[HAZARD_LABELS[code].lower()]))) if total else None,
    }


def suitability_vessel_name(vessel_idx: Optional[int], vessel_codes: tuple[str, ...]) -> str:
    return "all" if vessel_idx is None else vessel_codes[vessel_idx]


def suitability_summary_payload(
    time_index: int,
    vessel: str = "all",
    bounds: Optional[dict] = None,
) -> dict:
    state = require_niue_suit_state()
    sds = state.dataset
    validate_suitability_time_index(sds, time_index)
    vessel_idx = resolve_vessel_index(vessel, state.vessel_codes)
    face_hazard_full = suitability_face_hazard(time_index, vessel_idx, state)

    if bounds is None:
        applied_bounds = None
        face_indices = None
        hazard_slice = face_hazard_full
        wind_slice = state.wind_kt[time_index]
        wave_slice = state.wave_m[time_index]
        eligible_face_count = int(face_hazard_full.shape[0])
    else:
        applied_bounds = _applied_suit_bounds(bounds, state)
        face_indices = _faces_in_bounds(sds, applied_bounds)
        hazard_slice = face_hazard_full[face_indices]
        wind_slice = state.wind_kt[time_index][face_indices]
        wave_slice = state.wave_m[time_index][face_indices]
        eligible_face_count = int(len(face_indices))

    bounds_meta = _suit_bounds_metadata(
        bounds, applied_bounds, eligible_face_count, hazard_slice,
        time_index=time_index, vessel_idx=vessel_idx, face_indices=face_indices,
        state=state,
    )
    summary = suitability_hazard_counts(hazard_slice)
    if bounds is not None and eligible_face_count == 0:
        # Explicit "unavailable", never a silent full-domain fallback.
        summary["percentages"] = {label.lower(): None for label in HAZARD_LABELS.values()}

    # Guard against a non-empty but entirely-NaN slice: np.nanmin/nanmean/
    # nanmax on all-NaN input return nan, and json.dumps(nan) emits a bare
    # `NaN` token that isn't valid JSON (fails strict parsers, e.g.
    # JSON.parse in a browser).
    if wind_slice.size and np.isfinite(wind_slice).any():
        wind_stats = {
            "min": round(float(np.nanmin(wind_slice)), 2),
            "mean": round(float(np.nanmean(wind_slice)), 2),
            "max": round(float(np.nanmax(wind_slice)), 2),
        }
    else:
        wind_stats = {"min": None, "mean": None, "max": None}

    if wave_slice.size and np.isfinite(wave_slice).any():
        wave_stats = {
            "min": round(float(np.nanmin(wave_slice)), 2),
            "mean": round(float(np.nanmean(wave_slice)), 2),
            "max": round(float(np.nanmax(wave_slice)), 2),
        }
    else:
        wave_stats = {"min": None, "mean": None, "max": None}

    payload = {
        "source": NIU_SUITABILITY_NC_PATH,
        "time_index": int(time_index),
        "valid_time": suitability_valid_time_utc(sds, time_index),
        "valid_time_utc": suitability_valid_time_utc(sds, time_index),
        "vessel": suitability_vessel_name(vessel_idx, state.vessel_codes),
        "vessel_classes": list(state.vessel_codes),
        "hazard_labels": HAZARD_LABELS,
        "bounds": {
            "lon_min": state.lon_min,
            "lon_max": state.lon_max,
            "lat_min": state.lat_min,
            "lat_max": state.lat_max,
        },
        "wind_speed_kt": wind_stats,
        "wave_height_m": wave_stats,
        **bounds_meta,
        **summary,
    }

    if vessel_idx is not None and "main_driver" in sds:
        driver_values = np.asarray(sds.main_driver.values[time_index, :, vessel_idx], dtype=np.int16)
        if face_indices is not None:
            driver_values = driver_values[face_indices]
        payload["main_driver_counts"] = {
            MAIN_DRIVER_LABELS.get(int(code), str(int(code))): int((driver_values == code).sum())
            for code in np.unique(driver_values)
        }

    return payload


def render_suitability_map_png(
    vessel: str,
    time_index: int,
    map_kind: str,
    width: float,
    height: float,
    dpi: int,
    show_stats: bool = True,
    show_labels: bool = True,
    show_legend: bool = True,
    view_radius_km: Optional[float] = None,
    bounds: Optional[dict] = None,
) -> bytes:
    state = require_niue_suit_state()
    sds = state.dataset
    validate_suitability_time_index(sds, time_index)
    vessel_idx = resolve_vessel_index(vessel, state.vessel_codes)
    applied_bounds = _applied_suit_bounds(bounds, state) if bounds is not None else None

    hazard = suitability_raster_hazard(time_index, vessel_idx, state)
    hazard = apply_advisory_buffer_mask(hazard, state.raster_lons, state.raster_lats, buffer_km=100.0)
    hazard = np.where(state.raster_valid, hazard, -1)
    masked_hazard = np.ma.masked_where(hazard < 0, hazard)
    wind = np.asarray(state.raster_wind_kt[time_index], dtype=np.float32)
    masked_wind = np.ma.masked_where(hazard < 0, wind)

    cmap = mcolors.ListedColormap([
        HAZARD_COLORS_RGB[0],
        HAZARD_COLORS_RGB[1],
        HAZARD_COLORS_RGB[2],
    ])
    norm = mcolors.BoundaryNorm([-0.5, 0.5, 1.5, 2.5], cmap.N)
    extent = (
        float(state.raster_lons[0]),
        float(state.raster_lons[-1]),
        float(state.raster_lats[0]),
        float(state.raster_lats[-1]),
    )

    fig, ax = plt.subplots(figsize=(width, height), dpi=dpi)
    fig.patch.set_facecolor("white")
    ax.set_facecolor("#dce9ee")

    lon_min, lon_max, lat_min, lat_max = niue_buffer_extent(100.0)
    draw_cartography = map_kind in {"operational-map", "presentation-map"}
    if draw_cartography:
        if applied_bounds is not None:
            # Caller-supplied west/south/east/north (clamped to the dataset
            # domain) -- takes priority so the rendered crop matches exactly
            # what statistics_basis="centroid_filtered_faces" is scoped to on
            # the /summary and /best-comparison-timestep endpoints.
            lon_min = applied_bounds["west"]
            lon_max = applied_bounds["east"]
            lat_min = applied_bounds["south"]
            lat_max = applied_bounds["north"]
        elif view_radius_km is not None:
            # Caller wants a fixed, predictable crop radius (e.g. consistent
            # framing across PDF pages/timesteps) instead of the tight
            # auto-fit-to-valid-data box below, which can shift zoom level
            # between requests depending on how much hazard data happens to
            # be masked out.
            lon_min, lon_max, lat_min, lat_max = niue_buffer_extent(view_radius_km)
        else:
            valid_map = ~np.ma.getmaskarray(masked_hazard)
            if valid_map.any():
                valid_rows, valid_cols = np.where(valid_map)
                lon_min = float(state.raster_lons[int(valid_cols.min())])
                lon_max = float(state.raster_lons[int(valid_cols.max())])
                lat_min = float(state.raster_lats[int(valid_rows.min())])
                lat_max = float(state.raster_lats[int(valid_rows.max())])
                lon_pad = max((lon_max - lon_min) * 0.035, 0.015)
                lat_pad = max((lat_max - lat_min) * 0.045, 0.015)
                lon_min -= lon_pad
                lon_max += lon_pad
                lat_min -= lat_pad
                lat_max += lat_pad
        fig.subplots_adjust(left=0, right=1, bottom=0, top=1)

    if draw_cartography and masked_wind.count() > 0:
        wind_min = float(np.nanpercentile(masked_wind.compressed(), 10))
        wind_max = float(np.nanpercentile(masked_wind.compressed(), 95))
        if wind_max <= wind_min:
            wind_max = wind_min + 1.0
        ax.imshow(
            masked_wind,
            origin="lower",
            extent=extent,
            cmap="Greys",
            vmin=wind_min,
            vmax=wind_max,
            interpolation="bilinear",
            alpha=0.28,
            zorder=1,
        )

    no_data_mask = np.ma.masked_where(~np.ma.getmaskarray(masked_hazard), np.zeros(hazard.shape, dtype=np.float32))
    if no_data_mask.count() > 0:
        ax.imshow(
            no_data_mask,
            origin="lower",
            extent=extent,
            cmap=mcolors.ListedColormap([NO_DATA_COLOR_RGB]),
            interpolation="nearest",
            alpha=0.9 if draw_cartography else 1.0,
            zorder=1.5,
        )

    for hazard_code in (0, 1, 2):
        class_mask = np.ma.masked_where(masked_hazard != hazard_code, masked_hazard)
        if class_mask.count() == 0:
            continue
        ax.imshow(
            class_mask,
            origin="lower",
            extent=extent,
            cmap=mcolors.ListedColormap([HAZARD_COLORS_RGB[hazard_code]]),
            interpolation="nearest",
            alpha=0.84 if draw_cartography else 0.86,
            zorder=2 + hazard_code,
        )

    if masked_hazard.count() > 0:
        ax.contour(
            state.raster_lons,
            state.raster_lats,
            masked_hazard,
            levels=[0.5, 1.5],
            colors=["#f8fafc", "#263238"],
            linewidths=[1.25, 1.05],
            alpha=0.86,
            zorder=6,
        )

    ax.set_xlim(lon_min, lon_max)
    ax.set_ylim(lat_min, lat_max)

    if draw_cartography:
        add_niue_cartography(ax, lon_min, lon_max, lat_min, lat_max, state, show_labels=show_labels)
        if show_legend:
            add_north_arrow(ax, lon_min, lon_max, lat_min, lat_max)
            add_scale_bar(
                ax, lon_min, lon_max, lat_min, lat_max,
                length_km=pick_scale_bar_length_km(lon_min, lon_max, lat_min, lat_max),
            )
    else:
        ax.scatter([NIUE_LON], [NIUE_LAT], marker="*", s=72, c="#111827", edgecolors="white", linewidths=0.9, zorder=5)
        ax.text(NIUE_LON + 0.03, NIUE_LAT + 0.03, "Niue", fontsize=9, weight="bold", color="#111827")

    ax.set_aspect("equal", adjustable="box")
    if draw_cartography:
        ax.set_xticks([])
        ax.set_yticks([])
        ax.set_xlabel("")
        ax.set_ylabel("")
        ax.grid(False)
        for spine in ax.spines.values():
            spine.set_visible(False)
    else:
        ax.set_xlabel("Longitude")
        ax.set_ylabel("Latitude")
        ax.grid(color="white", linewidth=0.7, alpha=0.72)
        ax.tick_params(labelsize=8)

        legend_mappable = cm.ScalarMappable(norm=norm, cmap=cmap)
        legend_mappable.set_array([])
        cbar = fig.colorbar(legend_mappable, ax=ax, ticks=[0, 1, 2], fraction=0.046, pad=0.035)
        cbar.ax.set_yticklabels([HAZARD_LABELS[0], HAZARD_LABELS[1], HAZARD_LABELS[2]])
        cbar.ax.tick_params(labelsize=8)
        cbar.set_label("Marine suitability", fontsize=8)

    if draw_cartography and show_stats:
        # Always render this box when show_stats is true -- either with real
        # numbers or an explicit "no data" message. A silently-omitted box
        # (the previous "and masked_wind.count() > 0" gate) is indistinguishable
        # from a forgotten overlay; an explicit message is not.
        hazard_for_stats = suitability_face_hazard(time_index, vessel_idx, state)
        wind_for_stats = masked_wind
        bounds_empty = False
        if applied_bounds is not None:
            face_indices = _faces_in_bounds(sds, applied_bounds)
            hazard_for_stats = hazard_for_stats[face_indices]
            bounds_empty = len(face_indices) == 0
            lon_in = (state.raster_lons >= applied_bounds["west"]) & (state.raster_lons <= applied_bounds["east"])
            lat_in = (state.raster_lats >= applied_bounds["south"]) & (state.raster_lats <= applied_bounds["north"])
            wind_for_stats = masked_wind[np.ix_(lat_in, lon_in)]

        wind_for_stats_finite = wind_for_stats.count() > 0 and np.isfinite(wind_for_stats.compressed()).any()
        if bounds_empty or not wind_for_stats_finite:
            text = "No data in requested bounds" if applied_bounds is not None else "No data available"
        else:
            summary = suitability_hazard_counts(hazard_for_stats)
            text = (
                f"Warning {summary['percentages']['warning']:.1f}% | "
                f"Caution {summary['percentages']['caution']:.1f}% | "
                f"Wind max {float(np.nanmax(wind_for_stats)):.1f} kt"
            )
        ax.text(
            0.012,
            0.985,
            text,
            transform=ax.transAxes,
            va="top",
            ha="left",
            fontsize=8,
            color="#111827",
            bbox=dict(facecolor="white", edgecolor="#cbd5e1", boxstyle="round,pad=0.28", alpha=0.88),
            zorder=11,
        )

    if not draw_cartography:
        fig.tight_layout()
    buffer = BytesIO()
    savefig_kwargs = {"bbox_inches": "tight", "pad_inches": 0} if draw_cartography else {}
    fig.savefig(buffer, format="png", dpi=dpi, **savefig_kwargs)
    plt.close(fig)
    return buffer.getvalue()


NIU_ZARR_STATIC_ROOT = Path(NIU_DATA_ROOT)


def resolve_niu_zarr_static_path(file_path: str) -> Path:
    root = NIU_ZARR_STATIC_ROOT.resolve()
    requested = (root / file_path).resolve()

    try:
        requested.relative_to(root)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid Zarr file path")

    if not requested.is_file():
        raise HTTPException(status_code=404, detail="Zarr file not found")

    return requested


@app.get("/niue/zarr/{file_path:path}")
def niue_zarr_static_file(file_path: str):
    requested = resolve_niu_zarr_static_path(file_path)

    return FileResponse(
        requested,
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )


@app.head("/niue/zarr/{file_path:path}")
def niue_zarr_static_file_head(file_path: str):
    requested = resolve_niu_zarr_static_path(file_path)
    stat = requested.stat()

    return Response(
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
            "Content-Length": str(stat.st_size),
        },
    )


@app.get("/niue/status")
def niue_status():
    """Report whether Niue data files are present without loading full datasets."""
    inundation_source, inundation_path = _niu_inundation_source()
    suitability_source, suitability_path = _suit_source()
    return {
        "niue_center": {"lon": NIUE_LON, "lat": NIUE_LAT},
        "paths": {
            "data_root": NIU_DATA_ROOT,
            "suitability_zarr": NIU_SUITABILITY_ZARR_PATH,
            "suitability_nc": NIU_SUITABILITY_NC_PATH,
            "inundation_zarr": NIU_INUNDATION_ZARR_PATH,
            "inundation_nc": NIU_INUNDATION_NC_PATH,
            "sea_level_nc": NIU_SEA_LEVEL_NC_PATH,
        },
        "exists": {
            "data_root": Path(NIU_DATA_ROOT).exists(),
            "suitability_zarr": Path(NIU_SUITABILITY_ZARR_PATH).is_dir(),
            "suitability_nc": Path(NIU_SUITABILITY_NC_PATH).is_file(),
            "inundation_zarr": Path(NIU_INUNDATION_ZARR_PATH).is_dir(),
            "inundation_nc": Path(NIU_INUNDATION_NC_PATH).is_file(),
            "sea_level_nc": Path(NIU_SEA_LEVEL_NC_PATH).is_file(),
        },
        "selected_inundation_source": inundation_source,
        "selected_inundation_path": str(inundation_path) if inundation_path else None,
        "selected_suitability_source": suitability_source,
        "selected_suitability_path": str(suitability_path) if suitability_path else None,
        "cook_islands_default_dataset": str(resolve_product_path(DEFAULT_PRODUCT)),
    }

@app.get("/niue/inundation/metadata")
def niue_inundation_metadata():
    ids = require_niu_inundation_dataset()
    arr = ids[NIU_INUNDATION_VARIABLE]
    lon_min, lat_min, lon_max, lat_max = niu_inundation_lonlat_bounds()
    return {
        "variable": NIU_INUNDATION_VARIABLE,
        "long_name": arr.attrs.get("long_name", "Predicted inundation height"),
        "units": arr.attrs.get("units", "m"),
        "dimensions": dict(ids.sizes),
        "time_start": pd.Timestamp(ids.time.values[0]).isoformat() + "Z" if "time" in ids else None,
        "time_end": pd.Timestamp(ids.time.values[-1]).isoformat() + "Z" if "time" in ids else None,
        "lat_min": lat_min,
        "lat_max": lat_max,
        "lon_min": lon_min,
        "lon_max": lon_max,
    }


@app.get("/niue/inundation/timesteps")
def niue_inundation_timesteps():
    ids = require_niu_inundation_dataset()
    if "time" not in ids:
        return {"count": 1, "timesteps": []}
    return {
        "count": int(ids.sizes["time"]),
        "timesteps": [pd.Timestamp(t).isoformat() + "Z" for t in ids.time.values],
    }


@app.get("/niue/inundation/point-value")
def niue_inundation_point_value(
    lon: float = Query(..., description="Longitude"),
    lat: float = Query(..., description="Latitude"),
    time_index: int = Query(0, description="Time index"),
    min_depth: float = Query(0.05, description="Minimum visible depth"),
):
    ids = require_niu_inundation_dataset()
    if "time" in ids and (time_index < 0 or time_index >= ids.sizes["time"]):
        raise HTTPException(status_code=400, detail="Invalid time_index")

    yi, xi = resolve_niu_inundation_indices(np.array([lon]), np.array([lat]))
    if "time" in ids:
        value = ids[NIU_INUNDATION_VARIABLE].isel(time=time_index).values[yi[0], xi[0]]
        valid_time = pd.Timestamp(ids.time.values[time_index]).isoformat() + "Z"
    else:
        value = ids[NIU_INUNDATION_VARIABLE].values[yi[0], xi[0]]
        valid_time = None

    return {
        "value": niu_inundation_depth_or_none(value, min_depth),
        "units": ids[NIU_INUNDATION_VARIABLE].attrs.get("units", "m"),
        "lat": lat,
        "lon": lon,
        "time_index": time_index,
        "time": valid_time,
    }


@app.get("/niue/inundation/point-timeseries")
def niue_inundation_point_timeseries(
    lon: float = Query(..., description="Longitude"),
    lat: float = Query(..., description="Latitude"),
    min_depth: float = Query(0.05, description="Minimum visible depth"),
):
    ids = require_niu_inundation_dataset()
    arr = ids[NIU_INUNDATION_VARIABLE]

    yi, xi = resolve_niu_inundation_indices(np.array([lon]), np.array([lat]))
    y_index = int(yi[0])
    x_index = int(xi[0])

    if "time" in arr.dims:
        series = arr.isel({arr.dims[-2]: y_index, arr.dims[-1]: x_index}).compute()
        time_values = [
            pd.Timestamp(t).isoformat() + "Z"
            for t in ids.time.values
        ] if "time" in ids else [None] * int(series.size)
        values = [
            {
                "time": time_values[index],
                "depth_m": niu_inundation_depth_or_none(value, min_depth),
            }
            for index, value in enumerate(np.ravel(series.values))
        ]
    else:
        value = arr.values[y_index, x_index]
        values = [{
            "time": None,
            "depth_m": niu_inundation_depth_or_none(value, min_depth),
        }]

    return {
        "product": "niue_inundation",
        "lon_requested": lon,
        "lat_requested": lat,
        "grid_y_index": y_index,
        "grid_x_index": x_index,
        "count": len(values),
        "units": arr.attrs.get("units", "m"),
        "values": values,
    }


@app.get("/niue/inundation/tiles/{time_index}/{z}/{x}/{y}.png")
def niue_inundation_tile_png(
    time_index: int,
    z: int,
    x: int,
    y: int,
    vmin: float = Query(0.05),
    vmax: float = Query(3.0),
    render_mode: str = Query("continuous", description="continuous or thresholds"),
    thresholds: Optional[str] = Query(None, description="Comma-separated threshold list"),
    colors: Optional[str] = Query(None, description="Comma-separated hex colors"),
    resample_colors: bool = Query(False, description="Resample colors as palette stops across threshold bands"),
):
    ids = require_niu_inundation_dataset()
    if "time" in ids and (time_index < 0 or time_index >= ids.sizes["time"]):
        raise HTTPException(status_code=400, detail="Invalid time_index")

    if vmax <= vmin:
        raise HTTPException(
            status_code=400,
            detail="vmax must be greater than the effective minimum visible depth",
        )

    cache_key = (time_index, z, x, y, round(vmin, 4), round(vmax, 4), render_mode, thresholds, colors, resample_colors)
    cached = disk_tile_cache_get("inundation", cache_key)
    if cached is not None:
        return png_bytes_response(cached, headers={"Cache-Control": "public, max-age=600", "X-Tile-Cache": "HIT"})

    tile_size = 256
    lon_min, lat_min, lon_max, lat_max = tile_to_lonlat_bounds(x, y, z)
    data_lon_min, data_lat_min, data_lon_max, data_lat_max = niu_inundation_lonlat_bounds()

    if lon_max < data_lon_min or lon_min > data_lon_max or lat_max < data_lat_min or lat_min > data_lat_max:
        return transparent_png_response(tile_size)

    px = np.arange(tile_size)
    py = np.arange(tile_size)
    n_tiles = 2.0 ** z
    lon_vals = (x + (px + 0.5) / tile_size) / n_tiles * 360.0 - 180.0
    y_world = y + (py + 0.5) / tile_size
    lat_vals = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * y_world / n_tiles))))

    yi, xi = resolve_niu_inundation_indices(lon_vals, lat_vals)
    if "time" in ids:
        source = ids[NIU_INUNDATION_VARIABLE].isel(time=time_index).values
    else:
        source = ids[NIU_INUNDATION_VARIABLE].values
    arr = np.asarray(source[yi, xi], dtype=np.float32).reshape(tile_size, tile_size)

    lon_in_bounds = (lon_vals >= data_lon_min) & (lon_vals <= data_lon_max)
    lat_in_bounds = (lat_vals >= data_lat_min) & (lat_vals <= data_lat_max)
    arr[~lat_in_bounds, :] = np.nan
    arr[:, ~lon_in_bounds] = np.nan
    masked = np.where((arr >= vmin) & np.isfinite(arr), arr, np.nan)

    if render_mode == "thresholds":
        threshold_values = parse_threshold_list(thresholds)
        color_values = parse_color_list(colors)
        if resample_colors:
            color_values = resample_color_list(color_values, len(threshold_values))
        rgba = render_threshold_rgba(masked, threshold_values, color_values)
    else:
        norm = mcolors.Normalize(vmin=vmin, vmax=vmax, clip=True)
        cmap = TURBO_CMAP
        rgba = (cmap(norm(masked)) * 255).astype(np.uint8)
        rgba[np.isnan(masked)] = [0, 0, 0, 0]

    image = Image.fromarray(rgba, mode="RGBA")
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    png_bytes = buffer.getvalue()
    cache_niu_inundation_tile(cache_key, png_bytes)
    return png_bytes_response(png_bytes, headers={"Cache-Control": "public, max-age=600", "X-Tile-Cache": "MISS"})

@app.get("/niue/suitability/timesteps")
def niue_suitability_timesteps():
    """Return available timestep count and valid times from the suitability NetCDF."""
    state = require_niue_suit_state()
    sds = state.dataset
    return {
        "count": int(sds.sizes["time"]),
        "vessel_classes": list(state.vessel_codes),
        "timesteps": [pd.Timestamp(t).isoformat() + "Z" for t in sds.time.values],
        "lon_min": state.lon_min,
        "lon_max": state.lon_max,
        "lat_min": state.lat_min,
        "lat_max": state.lat_max,
        "source": NIU_SUITABILITY_NC_PATH,
    }


@app.get("/niue/suitability/grid/{time_index}")
def niue_suitability_grid(time_index: int):
    """Raw wind/wave/valid raster for a single timestep, quantized int16 +
    uint8 -- same wire format as cok_suitability_grid.
    """
    state = require_niue_suit_state()
    sds = state.dataset
    validate_suitability_time_index(sds, time_index)

    wind = np.asarray(state.raster_wind_kt[time_index], dtype=np.float32)
    wave = np.asarray(state.raster_wave_m[time_index], dtype=np.float32)

    # Live per-cell land/off-mesh check against the actual mesh faces,
    # rather than the precomputed state.raster_valid -- see
    # niue_suitability_tile / cok_suitability_tile for why the precomputed
    # mask (baked at RASTER_STEP resolution) isn't reused here either.
    lon_grid, lat_grid = np.meshgrid(state.raster_lons, state.raster_lats)
    grid_points = np.column_stack([lon_grid.ravel(), lat_grid.ravel()])
    grid_point_dist, grid_point_idx = state.face_tree.query(grid_points, workers=KDTREE_QUERY_WORKERS)
    land_mask_valid = _is_marine(
        state.mesh_trifinder,
        grid_point_dist, state.face_spacing[grid_point_idx],
        lon_grid.ravel(), lat_grid.ravel(),
        NIU_SUITABILITY_LAND_MASK_K, NIU_SUITABILITY_LAND_MASK_ABSOLUTE_CAP_KM,
    ).reshape(lon_grid.shape)

    valid = apply_advisory_buffer_mask(
        land_mask_valid.astype(np.int8), state.raster_lons, state.raster_lats, buffer_km=100.0
    ) > 0

    height, width = wind.shape

    wind_scale = 100.0
    wave_scale = 1000.0
    wind_i16 = np.clip(np.nan_to_num(wind, nan=0.0) * wind_scale, -32768, 32767).astype("<i2")
    wave_i16 = np.clip(np.nan_to_num(wave, nan=0.0) * wave_scale, -32768, 32767).astype("<i2")
    valid_u8 = valid.astype(np.uint8)

    body = wind_i16.tobytes() + wave_i16.tobytes() + valid_u8.tobytes()

    headers = {
        "X-Grid-Width": str(width),
        "X-Grid-Height": str(height),
        "X-Lon-Min": str(float(state.raster_lons[0])),
        "X-Lon-Max": str(float(state.raster_lons[-1])),
        "X-Lat-Min": str(float(state.raster_lats[0])),
        "X-Lat-Max": str(float(state.raster_lats[-1])),
        "X-Wind-Scale": str(wind_scale),
        "X-Wave-Scale": str(wave_scale),
        "X-Valid-Time": suitability_valid_time_utc(sds, time_index),
        "X-Grid-Encoding": "wind:i16le,wave:i16le,valid:u8",
        "Cache-Control": "public, max-age=3600",
    }
    return Response(content=body, media_type="application/octet-stream", headers=headers)


@app.get("/niue/suitability/point")
def niue_suitability_point(
    lon: float = Query(..., description="Longitude"),
    lat: float = Query(..., description="Latitude"),
    time_index: int = Query(0, description="Time index"),
    vessel: str = Query("all", description="Vessel class name, integer index, or 'all'"),
):
    """
    Return suitability values at the nearest mesh face to the requested point.
    All values are read from pre-classified hazard_class in the suitability NetCDF.
    No suitability scoring is performed here.
    """
    state = require_niue_suit_state()
    sds = state.dataset

    if time_index < 0 or time_index >= sds.sizes["time"]:
        raise HTTPException(
            status_code=400,
            detail=f"time_index {time_index} out of range 0–{sds.sizes['time'] - 1}",
        )

    vessel_idx = resolve_vessel_index(vessel, state.vessel_codes)

    _, face_idx = state.face_tree.query([[lon, lat]])
    face_idx = int(face_idx[0])

    face_lon = float(sds.lon.values[face_idx])
    face_lat = float(sds.lat.values[face_idx])
    dist_deg = float(np.hypot(lon - face_lon, lat - face_lat))
    # See NIU_SUITABILITY_LAND_MASK_K: the wave mesh only has faces over
    # water, so a plain nearest-face lookup bleeds ocean values onto land.
    # Same adaptive-distance + mesh-triangulation check (see _is_marine) the
    # raster/tile code uses -- tested at the *requested* (lon, lat), not the
    # nearest face's own centroid, since that's the point being classified.
    land_or_off_mesh = not bool(_is_marine(
        state.mesh_trifinder,
        dist_deg, float(state.face_spacing[face_idx]),
        lon, lat,
        NIU_SUITABILITY_LAND_MASK_K, NIU_SUITABILITY_LAND_MASK_ABSOLUTE_CAP_KM,
    ))

    valid_time = pd.Timestamp(sds.time.values[time_index]).isoformat() + "Z"

    if land_or_off_mesh:
        wind_kt = None
        wave_m = None
        result = {
            "vessel": "all" if vessel_idx is None else state.vessel_codes[vessel_idx],
            "hazard_class": None,
            "hazard_label": "Unavailable",
        }
    elif vessel_idx is None:
        wind_kt = round(float(state.wind_kt[time_index, face_idx]), 2)
        wave_m = round(float(state.wave_m[time_index, face_idx]), 2)
        hazard = int(state.overall[time_index, face_idx])
        result = {
            "vessel": "all",
            "hazard_class": hazard,
            "hazard_label": {0: "Suitable", 1: "Caution", 2: "Warning"}.get(hazard, "Unknown"),
        }
    else:
        wind_kt = round(float(state.wind_kt[time_index, face_idx]), 2)
        wave_m = round(float(state.wave_m[time_index, face_idx]), 2)
        hazard = int(state.hazard[time_index, face_idx, vessel_idx])
        score = int(sds.suitability_score.values[time_index, face_idx, vessel_idx])
        driver_code = int(sds.main_driver.values[time_index, face_idx, vessel_idx])
        result = {
            "vessel": state.vessel_codes[vessel_idx],
            "hazard_class": hazard,
            "hazard_label": {0: "Suitable", 1: "Caution", 2: "Warning"}.get(hazard, "Unknown"),
            "suitability_score": score,
            "main_driver": MAIN_DRIVER_LABELS.get(driver_code, "unknown"),
        }

    return {
        "lon_requested": lon,
        "lat_requested": lat,
        "time_index": time_index,
        "valid_time": valid_time,
        "nearest_face_index": face_idx,
        "nearest_face_lon": face_lon,
        "nearest_face_lat": face_lat,
        "distance_deg": round(dist_deg, 6),
        "wind_speed_kt": wind_kt,
        "wave_height_m": wave_m,
        "available": not land_or_off_mesh,
        "unavailable_reason": "nearest mesh face too far (land or off-mesh point)" if land_or_off_mesh else None,
        "land_or_off_mesh": land_or_off_mesh,
        **result,
    }


@app.get("/niue/suitability/point/timeseries")
def niue_suitability_point_timeseries(
    lon: float = Query(..., description="Longitude"),
    lat: float = Query(..., description="Latitude"),
    vessel: str = Query("all", description="Vessel class name, integer index, or 'all'"),
):
    """
    Return suitability at the nearest mesh face to the requested point across
    ALL timesteps, for a "suitability over time at this point" chart/report.
    The nearest-face lookup is timestep-independent, so this does a single
    cKDTree query and slices the already-loaded full-time arrays — unlike
    /niue/suitability/point, which is single-timestep only.
    """
    state = require_niue_suit_state()
    sds = state.dataset
    vessel_idx = resolve_vessel_index(vessel, state.vessel_codes)

    cache_key = (state.signature, round(lon, 4), round(lat, 4), vessel)
    cached = suitability_point_timeseries_cache.get(cache_key)
    if cached is not None:
        suitability_point_timeseries_cache.move_to_end(cache_key)
        return cached

    _, face_idx = state.face_tree.query([[lon, lat]])
    face_idx = int(face_idx[0])

    face_lon = float(sds.lon.values[face_idx])
    face_lat = float(sds.lat.values[face_idx])
    dist_deg = float(np.hypot(lon - face_lon, lat - face_lat))
    # Same adaptive-distance + mesh-triangulation land/off-mesh check as
    # niue_suitability_point and the raster/tile rendering (see
    # _is_marine). The nearest-face lookup is timestep-independent, so this
    # check applies to every step in the series at once.
    land_or_off_mesh = not bool(_is_marine(
        state.mesh_trifinder,
        dist_deg, float(state.face_spacing[face_idx]),
        lon, lat,
        NIU_SUITABILITY_LAND_MASK_K, NIU_SUITABILITY_LAND_MASK_ABSOLUTE_CAP_KM,
    ))
    times = [pd.Timestamp(t).isoformat() + "Z" for t in sds.time.values]

    if land_or_off_mesh:
        steps = [
            {
                "time_index": i,
                "valid_time": times[i],
                "hazard_class": None,
                "hazard_label": "Unavailable",
                "wind_speed_kt": None,
                "wave_height_m": None,
            }
            for i in range(len(times))
        ]
    else:
        if vessel_idx is None:
            hazard_series = state.overall[:, face_idx].astype(int).tolist()
        else:
            hazard_series = state.hazard[:, face_idx, vessel_idx].astype(int).tolist()
        wind_series = state.wind_kt[:, face_idx].astype(float).round(2).tolist()
        wave_series = state.wave_m[:, face_idx].astype(float).round(2).tolist()

        steps = [
            {
                "time_index": i,
                "valid_time": times[i],
                "hazard_class": hazard_series[i],
                "hazard_label": {0: "Suitable", 1: "Caution", 2: "Warning"}.get(hazard_series[i], "Unknown"),
                "wind_speed_kt": wind_series[i],
                "wave_height_m": wave_series[i],
            }
            for i in range(len(times))
        ]

    result = {
        "lon_requested": lon,
        "lat_requested": lat,
        "vessel": "all" if vessel_idx is None else state.vessel_codes[vessel_idx],
        "nearest_face_index": face_idx,
        "nearest_face_lon": face_lon,
        "nearest_face_lat": face_lat,
        "distance_deg": round(dist_deg, 6),
        "available": not land_or_off_mesh,
        "unavailable_reason": "nearest mesh face too far (land or off-mesh point)" if land_or_off_mesh else None,
        "land_or_off_mesh": land_or_off_mesh,
        "steps": steps,
    }

    suitability_point_timeseries_cache[cache_key] = result
    suitability_point_timeseries_cache.move_to_end(cache_key)
    while len(suitability_point_timeseries_cache) > SUITABILITY_POINT_TS_CACHE_MAX_ITEMS:
        suitability_point_timeseries_cache.popitem(last=False)

    return result


@app.get("/niue/suitability/area/timeseries")
def niue_suitability_area_timeseries(
    lon: float = Query(..., description="Longitude"),
    lat: float = Query(..., description="Latitude"),
    radius_m: float = Query(500.0, description="Aggregation radius in meters around the point"),
    vessel: str = Query("all", description="Vessel class name, integer index, or 'all'"),
):
    """
    Like /niue/suitability/point/timeseries, but aggregates every mesh face
    within radius_m of the requested point instead of reading only the
    single nearest one -- a "landing area" reading rather than a
    single-pixel reading. hazard_class is the worst case across the area
    (a landing area is unsafe if any part of it is hazardous, same logic
    as the route endpoint's worst_hazard_class); wind/wave are the area mean.

    Falls back to the single nearest face (subject to the same
    NIU_SUITABILITY_LAND_MASK_K land-mask check /niue/suitability/point
    uses) when no face falls within the radius, so small radii near sparse
    mesh regions degrade gracefully instead of going straight to
    "unavailable".
    """
    state = require_niue_suit_state()
    sds = state.dataset
    vessel_idx = resolve_vessel_index(vessel, state.vessel_codes)

    if radius_m <= 0:
        raise HTTPException(status_code=400, detail="'radius_m' must be > 0")

    cache_key = (state.signature, round(lon, 4), round(lat, 4), round(radius_m, 1), vessel)
    cached = suitability_area_timeseries_cache.get(cache_key)
    if cached is not None:
        suitability_area_timeseries_cache.move_to_end(cache_key)
        return cached

    # Elliptical degree-space membership test approximating a circular
    # radius_m test in metre-space -- same flat-earth trick used by
    # apply_advisory_buffer_mask/niue_buffer_extent elsewhere in this file.
    # Niue's extent is small enough (~10 km across) for this to be accurate
    # to well under a meter.
    km_per_deg_lat = 111.32
    km_per_deg_lon = 111.32 * np.cos(np.deg2rad(lat))
    radius_km = radius_m / 1000.0
    lat_radius_deg = radius_km / km_per_deg_lat
    lon_radius_deg = radius_km / km_per_deg_lon if km_per_deg_lon > 1e-9 else lat_radius_deg

    face_lons = sds.lon.values
    face_lats = sds.lat.values
    dist_ratio = np.hypot((face_lons - lon) / lon_radius_deg, (face_lats - lat) / lat_radius_deg)
    face_indices = np.flatnonzero(dist_ratio <= 1.0)

    land_or_off_mesh = False
    used_nearest_face_fallback = False
    if len(face_indices) == 0:
        dist_deg, nearest_idx = state.face_tree.query([[lon, lat]])
        nearest_idx = int(nearest_idx[0])
        dist_deg = float(dist_deg[0])
        land_or_off_mesh = not bool(_is_marine(
            state.mesh_trifinder,
            dist_deg, float(state.face_spacing[nearest_idx]),
            lon, lat,
            NIU_SUITABILITY_LAND_MASK_K, NIU_SUITABILITY_LAND_MASK_ABSOLUTE_CAP_KM,
        ))
        face_indices = np.array([nearest_idx])
        used_nearest_face_fallback = True

    face_count = int(len(face_indices))
    times = [pd.Timestamp(t).isoformat() + "Z" for t in sds.time.values]

    if land_or_off_mesh:
        steps = [
            {
                "time_index": i,
                "valid_time": times[i],
                "hazard_class": None,
                "hazard_label": "Unavailable",
                "wind_speed_kt": None,
                "wave_height_m": None,
            }
            for i in range(len(times))
        ]
    else:
        if vessel_idx is None:
            hazard_slice = state.overall[:, face_indices]
        else:
            hazard_slice = state.hazard[:, face_indices, vessel_idx]
        hazard_series = hazard_slice.max(axis=1).astype(int).tolist()
        wind_series = state.wind_kt[:, face_indices].mean(axis=1).astype(float).round(2).tolist()
        wave_series = state.wave_m[:, face_indices].mean(axis=1).astype(float).round(2).tolist()

        steps = [
            {
                "time_index": i,
                "valid_time": times[i],
                "hazard_class": hazard_series[i],
                "hazard_label": {0: "Suitable", 1: "Caution", 2: "Warning"}.get(hazard_series[i], "Unknown"),
                "wind_speed_kt": wind_series[i],
                "wave_height_m": wave_series[i],
            }
            for i in range(len(times))
        ]

    result = {
        "lon_requested": lon,
        "lat_requested": lat,
        "radius_m": radius_m,
        "vessel": "all" if vessel_idx is None else state.vessel_codes[vessel_idx],
        "face_count": face_count,
        "used_nearest_face_fallback": used_nearest_face_fallback,
        "available": not land_or_off_mesh,
        "unavailable_reason": "nearest mesh face too far (land or off-mesh point)" if land_or_off_mesh else None,
        "land_or_off_mesh": land_or_off_mesh,
        "steps": steps,
    }

    suitability_area_timeseries_cache[cache_key] = result
    suitability_area_timeseries_cache.move_to_end(cache_key)
    while len(suitability_area_timeseries_cache) > SUITABILITY_POINT_TS_CACHE_MAX_ITEMS:
        suitability_area_timeseries_cache.popitem(last=False)

    return result


_EARTH_RADIUS_NM = 3440.065
_ROUTE_MAX_SAMPLES = 2000
# Raw route-vertex cap, checked before densification. _ROUTE_MAX_SAMPLES
# alone doesn't bound this: a route with many very short legs (e.g. 5000
# waypoints a meter apart) can pass the pre-densify samples estimate below
# (each leg contributes at least 1 sample regardless of spacing) while still
# doing O(waypoints) work just to parse and validate the request body.
_ROUTE_MAX_WAYPOINTS = 500


def _haversine_nm(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    lon1_r, lat1_r, lon2_r, lat2_r = (math.radians(v) for v in (lon1, lat1, lon2, lat2))
    dlon = lon2_r - lon1_r
    dlat = lat2_r - lat1_r
    a = math.sin(dlat / 2.0) ** 2 + math.cos(lat1_r) * math.cos(lat2_r) * math.sin(dlon / 2.0) ** 2
    return _EARTH_RADIUS_NM * 2.0 * math.asin(math.sqrt(a))


def _densify_route(
    route: list[tuple[float, float]],
    spacing_nm: float,
) -> tuple[list[tuple[float, float]], list[float]]:
    """Linearly interpolate points along each route leg roughly every
    spacing_nm, always keeping the original vertices. Route legs here are
    short (on the order of nautical miles around a single reef), so linear
    lon/lat interpolation is an adequate stand-in for a true great-circle
    interpolation.
    """
    coords: list[tuple[float, float]] = [route[0]]
    cum_dist: list[float] = [0.0]
    total = 0.0
    for i in range(len(route) - 1):
        lon1, lat1 = route[i]
        lon2, lat2 = route[i + 1]
        seg_len = _haversine_nm(lon1, lat1, lon2, lat2)
        n_steps = max(math.ceil(seg_len / spacing_nm), 1) if seg_len > 0 else 1
        for step in range(1, n_steps + 1):
            t = step / n_steps
            coords.append((lon1 + (lon2 - lon1) * t, lat1 + (lat2 - lat1) * t))
            cum_dist.append(total + seg_len * t)
        total += seg_len
    return coords, cum_dist


def _check_route_sample_count(sample_count: int) -> None:
    """Authoritative post-densification sample-count guard. The pre-densify
    estimate (route_len_nm / sample_spacing_nm) undercounts whenever a route
    has multiple legs: _densify_route's per-leg math.ceil() rounds each leg's
    step count up independently, so the summed actual count can exceed the
    single whole-route estimate -- most a route with many short legs, where
    per-leg rounding adds up. Callers should keep the cheap pre-check as a
    fast rejection for obviously-too-long routes, but this is what actually
    bounds the work done below."""
    if sample_count > _ROUTE_MAX_SAMPLES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"route densifies to too many samples ({sample_count} > "
                f"{_ROUTE_MAX_SAMPLES}); shorten the route or increase sample_spacing_nm"
            ),
        )


def _resolve_route_time_indices(
    sds: xr.Dataset,
    eta_dts: list[datetime],
) -> tuple[np.ndarray, np.ndarray]:
    """Map each route sample's ETA to the nearest forecast timestep index.

    Also flags ETAs that fall outside [times.min(), times.max()]: outside
    that window there is no real forecast timestep to be "nearest" to, so
    silently clamping to the first/last timestep would misrepresent
    conditions at a time the forecast simply doesn't cover (e.g. a slow
    vessel whose ETA at the route's far end is beyond the forecast horizon).

    Returns (nearest_time_idx, out_of_horizon), both shape (len(eta_dts),).
    """
    times_ns = sds.time.values.astype("datetime64[ns]").astype("int64")
    eta_ns = np.array([
        np.datetime64(eta.astimezone(timezone.utc).replace(tzinfo=None), "ns").astype("int64")
        for eta in eta_dts
    ])
    nearest_time_idx = np.abs(times_ns[None, :] - eta_ns[:, None]).argmin(axis=1)
    out_of_horizon = (eta_ns < times_ns.min()) | (eta_ns > times_ns.max())
    return nearest_time_idx, out_of_horizon


@app.post("/niue/suitability/route")
def niue_suitability_route(payload: dict = Body(...)):
    """
    Route-based vessel suitability forecast: densify a route into samples
    spaced roughly sample_spacing_nm apart, estimate an ETA per sample from
    departure_time and speed_kt, and score each sample against the nearest
    forecast timestep using the same pre-classified hazard_class lookup as
    /niue/suitability/point (no scoring is inferred from rendered tile
    colors — this reads the same state.hazard/state.wind_kt/state.wave_m
    arrays that endpoint uses).
    """
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Request body must be a JSON object")

    raw_route = payload.get("route")
    if not isinstance(raw_route, list) or len(raw_route) < 2:
        raise HTTPException(status_code=400, detail="'route' must contain at least two [lon, lat] coordinates")
    if len(raw_route) > _ROUTE_MAX_WAYPOINTS:
        raise HTTPException(
            status_code=400,
            detail=f"'route' has too many waypoints ({len(raw_route)} > {_ROUTE_MAX_WAYPOINTS})",
        )

    route_coords: list[tuple[float, float]] = []
    for i, pt in enumerate(raw_route):
        if not isinstance(pt, (list, tuple)) or len(pt) != 2:
            raise HTTPException(status_code=400, detail=f"route[{i}] must be a [lon, lat] pair")
        try:
            lon_pt, lat_pt = float(pt[0]), float(pt[1])
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail=f"route[{i}] must contain numeric [lon, lat] values")
        if not (-180.0 <= lon_pt <= 180.0) or not (-90.0 <= lat_pt <= 90.0):
            raise HTTPException(status_code=400, detail=f"route[{i}] coordinates out of valid lon/lat range")
        route_coords.append((lon_pt, lat_pt))

    departure_dt = _parse_utc(payload.get("departure_time"), "departure_time", status_code=400)

    speed_kt_raw = payload.get("speed_kt")
    try:
        speed_kt = float(speed_kt_raw)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="'speed_kt' must be a positive number")
    if speed_kt <= 0:
        raise HTTPException(status_code=400, detail="'speed_kt' must be > 0")

    spacing_raw = payload.get("sample_spacing_nm", 1)
    try:
        sample_spacing_nm = float(spacing_raw)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="'sample_spacing_nm' must be a positive number")
    if sample_spacing_nm <= 0:
        raise HTTPException(status_code=400, detail="'sample_spacing_nm' must be > 0")

    route_len_nm = sum(
        _haversine_nm(route_coords[i][0], route_coords[i][1], route_coords[i + 1][0], route_coords[i + 1][1])
        for i in range(len(route_coords) - 1)
    )
    # Cheap fast-fail on the whole-route estimate; _check_route_sample_count
    # below re-checks the real count after densification, since per-leg
    # rounding in _densify_route can push the actual total above this
    # estimate for a multi-leg route.
    if route_len_nm / sample_spacing_nm > _ROUTE_MAX_SAMPLES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"route densifies to too many samples ({route_len_nm / sample_spacing_nm:.0f} > "
                f"{_ROUTE_MAX_SAMPLES}); shorten the route or increase sample_spacing_nm"
            ),
        )

    # State must be loaded before vessel validation, since vessel_codes is
    # populated by _load_niue_suit_state().
    state = require_niue_suit_state()
    sds = state.dataset

    vessel_raw = payload.get("vessel")
    if not isinstance(vessel_raw, str) or not vessel_raw:
        raise HTTPException(status_code=400, detail="'vessel' is required")
    vessel_idx = resolve_vessel_index(vessel_raw, state.vessel_codes)
    if vessel_idx is None:
        raise HTTPException(
            status_code=400,
            detail=f"'vessel' must be one of {list(state.vessel_codes)} (got {vessel_raw!r}, and 'all' isn't valid for route scoring)",
        )

    sample_coords, cum_dist_nm = _densify_route(route_coords, sample_spacing_nm)
    _check_route_sample_count(len(sample_coords))

    eta_dts = [departure_dt + timedelta(hours=d / speed_kt) for d in cum_dist_nm]
    nearest_time_idx, out_of_horizon = _resolve_route_time_indices(sds, eta_dts)

    coords_arr = np.array(sample_coords)
    face_dists, face_idxs = state.face_tree.query(coords_arr)

    samples: list[dict] = []
    hazard_counts = {0: 0, 1: 0, 2: 0}
    worst_hazard: Optional[int] = None
    available_count = 0

    for i, (lon_s, lat_s) in enumerate(sample_coords):
        dist_nm = round(cum_dist_nm[i], 3)
        eta_str = eta_dts[i].strftime("%Y-%m-%dT%H:%M:%SZ")
        face_idx = int(face_idxs[i])
        dist_deg_to_face = float(face_dists[i])

        in_domain = (state.lon_min <= lon_s <= state.lon_max) and (state.lat_min <= lat_s <= state.lat_max)
        if not in_domain:
            samples.append({
                "sample_index": i,
                "lon": round(lon_s, 6),
                "lat": round(lat_s, 6),
                "distance_nm": dist_nm,
                "eta": eta_str,
                "time_index": None,
                "hazard_class": None,
                "hazard_label": None,
                "wave_height_m": None,
                "wind_speed_kt": None,
                "nearest_face_lon": None,
                "nearest_face_lat": None,
                "distance_deg_to_face": None,
                "available": False,
                "unavailable_reason": "outside suitability model domain",
            })
            continue

        # Same adaptive-distance + mesh-triangulation land/off-mesh check as
        # the raster/tile rendering and the point endpoints (see
        # _is_marine). A bounding-box check alone isn't enough since Niue's
        # landmass sits inside that box.
        land_or_off_mesh = not bool(_is_marine(
            state.mesh_trifinder,
            dist_deg_to_face, float(state.face_spacing[face_idx]),
            lon_s, lat_s,
            NIU_SUITABILITY_LAND_MASK_K, NIU_SUITABILITY_LAND_MASK_ABSOLUTE_CAP_KM,
        ))
        if land_or_off_mesh:
            samples.append({
                "sample_index": i,
                "lon": round(lon_s, 6),
                "lat": round(lat_s, 6),
                "distance_nm": dist_nm,
                "eta": eta_str,
                "time_index": None,
                "hazard_class": None,
                "hazard_label": None,
                "wave_height_m": None,
                "wind_speed_kt": None,
                "nearest_face_lon": None,
                "nearest_face_lat": None,
                "distance_deg_to_face": round(dist_deg_to_face, 6),
                "available": False,
                "unavailable_reason": "nearest mesh face too far (land or off-mesh point)",
            })
            continue

        # ETA falls outside the forecast's own time coverage -- there is no
        # real timestep to score against (see _resolve_route_time_indices).
        if out_of_horizon[i]:
            samples.append({
                "sample_index": i,
                "lon": round(lon_s, 6),
                "lat": round(lat_s, 6),
                "distance_nm": dist_nm,
                "eta": eta_str,
                "time_index": None,
                "hazard_class": None,
                "hazard_label": None,
                "wave_height_m": None,
                "wind_speed_kt": None,
                "nearest_face_lon": round(float(sds.lon.values[face_idx]), 4),
                "nearest_face_lat": round(float(sds.lat.values[face_idx]), 4),
                "distance_deg_to_face": round(dist_deg_to_face, 6),
                "available": False,
                "unavailable_reason": "eta outside forecast time horizon",
            })
            continue

        time_index = int(nearest_time_idx[i])
        hazard = int(state.hazard[time_index, face_idx, vessel_idx])
        wind_kt = float(state.wind_kt[time_index, face_idx])
        wave_m = float(state.wave_m[time_index, face_idx])

        samples.append({
            "sample_index": i,
            "lon": round(lon_s, 6),
            "lat": round(lat_s, 6),
            "distance_nm": dist_nm,
            "eta": eta_str,
            "time_index": time_index,
            "hazard_class": hazard,
            "hazard_label": HAZARD_LABELS.get(hazard, "Unknown"),
            "wave_height_m": round(wave_m, 2),
            "wind_speed_kt": round(wind_kt, 2),
            "nearest_face_lon": round(float(sds.lon.values[face_idx]), 4),
            "nearest_face_lat": round(float(sds.lat.values[face_idx]), 4),
            "distance_deg_to_face": round(dist_deg_to_face, 6),
            "available": True,
            "unavailable_reason": None,
        })
        hazard_counts[hazard] += 1
        available_count += 1
        worst_hazard = hazard if worst_hazard is None else max(worst_hazard, hazard)

    segments: list[dict] = []
    for i in range(len(samples) - 1):
        a, b = samples[i], samples[i + 1]
        both_available = a["available"] and b["available"]
        segments.append({
            "from_sample_index": a["sample_index"],
            "to_sample_index": b["sample_index"],
            "hazard_class": max(a["hazard_class"], b["hazard_class"]) if both_available else None,
            "available": both_available,
        })

    distance_nm_total = round(cum_dist_nm[-1], 3)
    duration_hours = round(distance_nm_total / speed_kt, 3)

    if available_count > 0:
        suitable_percent = round(100.0 * hazard_counts[0] / available_count)
        caution_percent = round(100.0 * hazard_counts[1] / available_count)
        warning_percent = round(100.0 * hazard_counts[2] / available_count)
        recommendation = HAZARD_LABELS.get(worst_hazard, "Unknown")
    else:
        suitable_percent = caution_percent = warning_percent = 0
        recommendation = "Unavailable"

    return {
        "route_id": payload.get("route_id"),
        "vessel": state.vessel_codes[vessel_idx],
        "departure_time": departure_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "speed_kt": speed_kt,
        "summary": {
            "distance_nm": distance_nm_total,
            "duration_hours": duration_hours,
            "worst_hazard_class": worst_hazard,
            "recommendation": recommendation,
            "suitable_percent": suitable_percent,
            "caution_percent": caution_percent,
            "warning_percent": warning_percent,
        },
        "samples": samples,
        "segments": segments,
    }


@app.get("/niue/suitability/summary/{time_index}")
def niue_suitability_summary(
    time_index: int,
    vessel: str = Query("all", description="Vessel class name, integer index, or 'all'"),
    west: Optional[float] = Query(None, description="Bounding box west longitude; all of west/south/east/north are required together"),
    south: Optional[float] = Query(None, description="Bounding box south latitude"),
    east: Optional[float] = Query(None, description="Bounding box east longitude"),
    north: Optional[float] = Query(None, description="Bounding box north latitude"),
):
    """
    Return advisory summary statistics for a Niue suitability timestep.

    Values are read from pre-classified hazard arrays. The optional vessel query
    selects a vessel-specific hazard class; by default the overall worst-case
    class is summarized.

    When west/south/east/north are provided, all statistics are recomputed
    over the mesh faces whose centroid falls inside that box instead of the
    full domain -- see statistics_basis/applied_bounds in the response for
    exactly what was used. Centroid filtering only: the suitability product
    has no face-polygon geometry, so classification_coverage_percent is a
    percentage of classified faces, not geographic area. Malformed bounds
    (partial set, out of range, west>=east, south>=north) return 422. A
    bbox with zero faces inside it returns eligible_face_count=0 and null
    percentages rather than falling back to the full domain.
    """
    bounds = _parse_suit_bounds(west, south, east, north)
    return suitability_summary_payload(time_index, vessel=vessel, bounds=bounds)


@app.get("/niue/suitability/best-comparison-timestep")
def niue_suitability_best_comparison_timestep(
    vessel: str = Query("all", description="Vessel class name, integer index, or 'all'"),
    west: Optional[float] = Query(None, description="Bounding box west longitude; all of west/south/east/north are required together"),
    south: Optional[float] = Query(None, description="Bounding box south latitude"),
    east: Optional[float] = Query(None, description="Bounding box east longitude"),
    north: Optional[float] = Query(None, description="Bounding box north latitude"),
    start_time_index: Optional[int] = Query(None, description="Inclusive lower time index bound for the search window; defaults to the first timestep"),
    end_time_index: Optional[int] = Query(None, description="Inclusive upper time index bound for the search window; defaults to the last timestep"),
):
    """
    Return the timestep with the lowest warning/caution burden.

    This is intended as a stable fallback for report comparison panels when the
    frontend needs one representative "best" timestep.

    When west/south/east/north are provided, ranking is computed only over
    mesh faces whose centroid falls inside that box (see
    statistics_basis/applied_bounds in the response). Face membership is
    time-invariant, so a bbox with zero faces inside it has zero faces at
    every timestep -- rather than let tied all-zero counts silently pick
    timestep 0, that case returns time_index=null with an explicit
    eligible_face_count=0 instead of a ranking result.

    When start_time_index/end_time_index are provided, the search is
    restricted to that inclusive index range instead of the full forecast --
    e.g. so a "best timestep in the current 72-hour window" UI can't get back
    a timestep outside the window it's actually showing.
    """
    state = require_niue_suit_state()
    sds = state.dataset
    vessel_idx = resolve_vessel_index(vessel, state.vessel_codes)
    bounds = _parse_suit_bounds(west, south, east, north)
    start_idx, end_idx = _resolve_suit_time_range(sds, start_time_index, end_time_index)

    if bounds is None:
        applied_bounds = None
        face_indices = None
    else:
        applied_bounds = _applied_suit_bounds(bounds, state)
        face_indices = _faces_in_bounds(sds, applied_bounds)

    if face_indices is not None and len(face_indices) == 0:
        bounds_meta = _suit_bounds_metadata(
            bounds, applied_bounds, 0, np.asarray([], dtype=np.int8),
            time_index=0, vessel_idx=vessel_idx, face_indices=face_indices,
            state=state,
        )
        return {
            "time_index": None,
            "best_time_index": None,
            "valid_time": None,
            "valid_time_utc": None,
            "vessel": suitability_vessel_name(vessel_idx, state.vessel_codes),
            "ranking": None,
            **bounds_meta,
        }

    ranked = []
    for idx in range(start_idx, end_idx + 1):
        hazard = suitability_face_hazard(idx, vessel_idx, state)
        if face_indices is not None:
            hazard = hazard[face_indices]
        counts = suitability_hazard_counts(hazard)["counts"]
        ranked.append((
            counts["warning"],
            counts["caution"],
            -counts["suitable"],
            idx,
        ))

    best = min(ranked)
    best_index = int(best[3])
    best_hazard = suitability_face_hazard(best_index, vessel_idx, state)
    if face_indices is not None:
        best_hazard = best_hazard[face_indices]
    eligible_face_count = int(len(face_indices)) if face_indices is not None else int(best_hazard.shape[0])
    bounds_meta = _suit_bounds_metadata(
        bounds, applied_bounds, eligible_face_count, best_hazard,
        time_index=best_index, vessel_idx=vessel_idx, face_indices=face_indices,
        state=state,
    )
    return {
        "time_index": best_index,
        "best_time_index": best_index,
        "valid_time": suitability_valid_time_utc(sds, best_index),
        "valid_time_utc": suitability_valid_time_utc(sds, best_index),
        "vessel": suitability_vessel_name(vessel_idx, state.vessel_codes),
        "ranking": {
            "warning_count": int(best[0]),
            "caution_count": int(best[1]),
            "suitable_count": int(-best[2]),
        },
        **bounds_meta,
    }


@app.get("/niue/suitability/best-contrast-timestep")
def niue_suitability_best_contrast_timestep(
    west: Optional[float] = Query(None, description="Bounding box west longitude; all of west/south/east/north are required together"),
    south: Optional[float] = Query(None, description="Bounding box south latitude"),
    east: Optional[float] = Query(None, description="Bounding box east longitude"),
    north: Optional[float] = Query(None, description="Bounding box north latitude"),
    start_time_index: Optional[int] = Query(None, description="Inclusive lower time index bound for the search window; defaults to the first timestep"),
    end_time_index: Optional[int] = Query(None, description="Inclusive upper time index bound for the search window; defaults to the last timestep"),
):
    """
    Return the timestep where vessel classes disagree most about suitability
    -- the timestep maximizing the spread in suitable_percent across the 4
    vessel classes (e.g. small craft comfortably suitable while larger
    vessels are in warning). This answers a different question from
    /best-comparison-timestep, which picks the lowest overall hazard burden
    regardless of whether vessels agree with each other -- the two are
    intentionally separate endpoints rather than one conflated metric.

    When west/south/east/north are provided, per-vessel percentages are
    computed only over mesh faces whose centroid falls inside that box (see
    statistics_basis/applied_bounds in the response). Face membership is
    time-invariant, so a bbox with zero faces inside it returns
    time_index=null rather than a ranking result.

    When start_time_index/end_time_index are provided, the search is
    restricted to that inclusive index range instead of the full forecast --
    e.g. so a "max contrast in the current 72-hour window" UI can't get back
    a timestep outside the window it's actually showing.
    """
    state = require_niue_suit_state()
    sds = state.dataset
    bounds = _parse_suit_bounds(west, south, east, north)
    start_idx, end_idx = _resolve_suit_time_range(sds, start_time_index, end_time_index)

    if bounds is None:
        applied_bounds = None
        face_indices = None
    else:
        applied_bounds = _applied_suit_bounds(bounds, state)
        face_indices = _faces_in_bounds(sds, applied_bounds)

    if face_indices is not None and len(face_indices) == 0:
        bounds_meta = _suit_bounds_metadata(
            bounds, applied_bounds, 0, np.asarray([], dtype=np.int8),
            time_index=0, vessel_idx=None, face_indices=face_indices,
            state=state,
        )
        return {
            "time_index": None,
            "best_time_index": None,
            "valid_time": None,
            "valid_time_utc": None,
            "contrast": None,
            **bounds_meta,
        }

    ranked = []
    for idx in range(start_idx, end_idx + 1):
        suitable_percents = {}
        for i, code in enumerate(state.vessel_codes):
            hazard = np.asarray(state.hazard[idx, :, i], dtype=np.int8)
            if face_indices is not None:
                hazard = hazard[face_indices]
            pct = suitability_hazard_counts(hazard)["percentages"]["suitable"]
            # In the current dataset every vessel has identical classified-face
            # validity per face (confirmed empirically), so pct is never None
            # here in practice; substitute 0.0 defensively rather than crash
            # if a future dataset ever has per-vessel validity gaps.
            suitable_percents[code] = pct if pct is not None else 0.0
        spread = max(suitable_percents.values()) - min(suitable_percents.values())
        ranked.append((-spread, idx, suitable_percents))

    ranked.sort(key=lambda item: (item[0], item[1]))
    best_neg_spread, best_index, best_suitable_percents = ranked[0]
    contrast_score = round(-best_neg_spread, 2)

    hazard_for_meta = suitability_face_hazard(best_index, None, state)
    if face_indices is not None:
        hazard_for_meta = hazard_for_meta[face_indices]
    eligible_face_count = int(len(face_indices)) if face_indices is not None else int(hazard_for_meta.shape[0])
    bounds_meta = _suit_bounds_metadata(
        bounds, applied_bounds, eligible_face_count, hazard_for_meta,
        time_index=best_index, vessel_idx=None, face_indices=face_indices,
        state=state,
    )

    most_suitable_vessel = max(best_suitable_percents, key=best_suitable_percents.get)
    least_suitable_vessel = min(best_suitable_percents, key=best_suitable_percents.get)

    return {
        "time_index": best_index,
        "best_time_index": best_index,
        "valid_time": suitability_valid_time_utc(sds, best_index),
        "valid_time_utc": suitability_valid_time_utc(sds, best_index),
        "contrast": {
            "suitable_percent_by_vessel": best_suitable_percents,
            "contrast_score": contrast_score,
            "most_suitable_vessel": most_suitable_vessel,
            "least_suitable_vessel": least_suitable_vessel,
        },
        **bounds_meta,
    }


@app.get("/niue/suitability/map-image/{vessel}/{time_index}")
def niue_suitability_map_image(vessel: str, time_index: int):
    png_bytes = render_suitability_map_png(
        vessel=vessel,
        time_index=time_index,
        map_kind="map-image",
        width=7.0,
        height=6.0,
        dpi=150,
    )
    return png_bytes_response(png_bytes, headers={"Cache-Control": "public, max-age=300"})


@app.get("/niue/suitability/presentation-map/{vessel}/{time_index}")
def niue_suitability_presentation_map(vessel: str, time_index: int):
    png_bytes = render_suitability_map_png(
        vessel=vessel,
        time_index=time_index,
        map_kind="presentation-map",
        width=10.0,
        height=7.0,
        dpi=160,
    )
    return png_bytes_response(png_bytes, headers={"Cache-Control": "public, max-age=300"})


@app.get("/niue/suitability/operational-map/{vessel}/{time_index}")
def niue_suitability_operational_map(
    vessel: str,
    time_index: int,
    show_stats: bool = Query(True, description="Set false to suppress the diagnostic stats overlay (for PDF capture)"),
    show_labels: bool = Query(True, description="Set false to suppress settlement names and the 'Niue' text label (for PDF capture)"),
    show_legend: bool = Query(True, description="Set false to suppress the north arrow and scale bar (for PDF capture)"),
    view_radius_km: Optional[float] = Query(
        None,
        description=(
            "Crop the map to a fixed radius (km) around Niue's center instead of "
            "auto-fitting to whatever hazard data happens to be valid this timestep "
            "-- gives consistent framing across requests (e.g. PDF pages). Mutually "
            "exclusive with west/south/east/north."
        ),
    ),
    west: Optional[float] = Query(None, description="Bounding box west longitude; all of west/south/east/north are required together. Crops the map and scopes the stats overlay to this box -- mutually exclusive with view_radius_km."),
    south: Optional[float] = Query(None, description="Bounding box south latitude"),
    east: Optional[float] = Query(None, description="Bounding box east longitude"),
    north: Optional[float] = Query(None, description="Bounding box north latitude"),
):
    if view_radius_km is not None and view_radius_km <= 0:
        raise HTTPException(status_code=400, detail="'view_radius_km' must be > 0")

    bounds = _parse_suit_bounds(west, south, east, north)
    if bounds is not None and view_radius_km is not None:
        raise HTTPException(status_code=422, detail="'view_radius_km' and west/south/east/north are mutually exclusive")

    if bounds is not None:
        # Must run before checking applied_bounds below: without loading the
        # state first there's no domain to clamp against, and
        # render_suitability_map_png() (below) is otherwise the first thing
        # in this endpoint that would trigger that load -- too late, since
        # the viewport guard needs the real domain.
        state = require_niue_suit_state()
        applied_bounds = _applied_suit_bounds(bounds, state)
        # Below this, either the requested box doesn't overlap the domain at
        # all (applied bounds collapse to a point) or it's a sliver too thin
        # to be a meaningful crop. Both are rejected here rather than handed
        # to matplotlib: an axes viewport this small next to Niue's real
        # (unclipped) cartography content -- settlement labels, island
        # outline -- makes bbox_inches="tight" blow the canvas up to a
        # pathological size (observed: a "no overlap" request produced a
        # 6.7-billion-pixel PNG).
        MIN_SUIT_MAP_VIEWPORT_DEG = 0.02  # ~2km at Niue's latitude, well above the ~100m raster cell size
        if (
            applied_bounds["east"] - applied_bounds["west"] < MIN_SUIT_MAP_VIEWPORT_DEG
            or applied_bounds["north"] - applied_bounds["south"] < MIN_SUIT_MAP_VIEWPORT_DEG
        ):
            raise HTTPException(
                status_code=422,
                detail="requested bounds do not overlap a renderable area of the suitability domain",
            )

    png_bytes = render_suitability_map_png(
        vessel=vessel,
        time_index=time_index,
        map_kind="operational-map",
        width=8.5,
        height=7.0,
        dpi=160,
        show_stats=show_stats,
        show_labels=show_labels,
        show_legend=show_legend,
        view_radius_km=view_radius_km,
        bounds=bounds,
    )
    headers = {"Cache-Control": "public, max-age=300"}
    if bounds is not None:
        applied = _applied_suit_bounds(bounds, state)
        headers["X-Statistics-Basis"] = "centroid_filtered_faces"
        headers["X-Applied-Bounds"] = (
            f"west={applied['west']},south={applied['south']},"
            f"east={applied['east']},north={applied['north']}"
        )
    return png_bytes_response(png_bytes, headers=headers)



def bilinear_sample_raster(
    raster: np.ndarray,
    lons_1d: np.ndarray,
    lats_1d: np.ndarray,
    query_lon: np.ndarray,
    query_lat: np.ndarray,
) -> np.ndarray:
    """Bilinearly sample a regular-grid (lat, lon) raster at arbitrary query
    points, using fractional grid-index blending — no per-request KDTree or
    Delaunay lookup, matching this file's existing tile-rendering pattern of
    doing spatial search once at load and cheap sampling per request."""
    lon_step = float(lons_1d[1] - lons_1d[0])
    lat_step = float(lats_1d[1] - lats_1d[0])
    n_lon = len(lons_1d)
    n_lat = len(lats_1d)

    fx = (query_lon - float(lons_1d[0])) / lon_step
    fy = (query_lat - float(lats_1d[0])) / lat_step
    x0 = np.clip(np.floor(fx).astype(np.int64), 0, n_lon - 1)
    y0 = np.clip(np.floor(fy).astype(np.int64), 0, n_lat - 1)
    x1 = np.clip(x0 + 1, 0, n_lon - 1)
    y1 = np.clip(y0 + 1, 0, n_lat - 1)
    wx = np.clip(fx - x0, 0.0, 1.0)
    wy = np.clip(fy - y0, 0.0, 1.0)

    return (
        raster[y0, x0] * (1 - wx) * (1 - wy)
        + raster[y0, x1] * wx * (1 - wy)
        + raster[y1, x0] * (1 - wx) * wy
        + raster[y1, x1] * wx * wy
    ).astype(np.float32)


def classify_suitability_arrays(
    wind_kt: np.ndarray,
    wave_m: np.ndarray,
    vessel_idx: int,
    wind_caution_kt: np.ndarray,
    wind_warning_kt: np.ndarray,
    wave_caution_m: np.ndarray,
    wave_warning_m: np.ndarray,
) -> np.ndarray:
    """Reproduce hazard_class from wind/wave using the dataset's own per-vessel
    caution/warning thresholds — verified to exactly match hazard_class for
    every (time, face, vessel) triple in the source NetCDF.

    Threshold arrays are always passed explicitly by the caller (a published
    NiueSuitabilityState's thresholds, for the normal per-request call
    pattern in niue_suitability_tile's legacy fallback; or the suitability
    rebuild's new-generation thresholds) rather than defaulted from a module
    global, so this never risks reading a stale generation's thresholds
    mid-rebuild."""
    wind_hazard = np.zeros(wind_kt.shape, dtype=np.int8)
    wind_hazard[wind_kt >= wind_caution_kt[vessel_idx]] = 1
    wind_hazard[wind_kt >= wind_warning_kt[vessel_idx]] = 2

    wave_hazard = np.zeros(wave_m.shape, dtype=np.int8)
    wave_hazard[wave_m >= wave_caution_m[vessel_idx]] = 1
    wave_hazard[wave_m >= wave_warning_m[vessel_idx]] = 2

    return np.maximum(wind_hazard, wave_hazard).astype(np.int8)


def classify_overall_suitability_arrays(
    wind_kt: np.ndarray,
    wave_m: np.ndarray,
    vessel_codes: tuple[str, ...],
    wind_caution_kt: np.ndarray,
    wind_warning_kt: np.ndarray,
    wave_caution_m: np.ndarray,
    wave_warning_m: np.ndarray,
) -> np.ndarray:
    """Reproduce overall_hazard_class — verified to equal max(hazard_class) across vessels."""
    overall = np.zeros(wind_kt.shape, dtype=np.int8)
    for vessel_idx in range(len(vessel_codes)):
        overall = np.maximum(overall, classify_suitability_arrays(
            wind_kt, wave_m, vessel_idx,
            wind_caution_kt, wind_warning_kt, wave_caution_m, wave_warning_m,
        ))
    return overall.astype(np.int8)


@app.get("/niue/suitability/tiles/{vessel}/{time_index}/{z}/{x}/{y}.png")
def niue_suitability_tile(
    vessel: str,
    time_index: int,
    z: int,
    x: int,
    y: int,
):
    """
    Render a 256×256 PNG map tile for the Niue vessel suitability layer.

    New pipeline products are rendered directly from their preclassified
    hazard raster. Legacy products retain the prior wind/wave bilinear
    sampling and per-pixel classification fallback.

    vessel: vessel class name, integer index, or 'all' for overall worst-case.
    """
    state = require_niue_suit_state()
    sds = state.dataset

    if time_index < 0 or time_index >= sds.sizes["time"]:
        raise HTTPException(
            status_code=400,
            detail=f"time_index {time_index} out of range 0–{sds.sizes['time'] - 1}",
        )

    vessel_idx = resolve_vessel_index(vessel, state.vessel_codes)  # None → use overall_hazard_class

    tile_size = 256
    cache_key = (state.signature, vessel, time_index, z, x, y)
    cached_tile = disk_tile_cache_get("suitability", cache_key)
    if cached_tile is not None:
        return png_bytes_response(
            cached_tile,
            headers={
                "Cache-Control": "public, max-age=300",
                "X-Tile-Cache": "HIT",
            },
        )

    lon_min_tile, lat_min_tile, lon_max_tile, lat_max_tile = tile_to_lonlat_bounds(x, y, z)

    # Return transparent tile immediately if there is no overlap with the dataset domain.
    if (
        lon_max_tile < state.lon_min
        or lon_min_tile > state.lon_max
        or lat_max_tile < state.lat_min
        or lat_min_tile > state.lat_max
    ):
        return transparent_png_response(tile_size)

    # Build per-pixel lon/lat grid (Web Mercator → geographic).
    n = 2.0 ** z
    px = np.arange(tile_size)
    py = np.arange(tile_size)
    lon_vals = (x + (px + 0.5) / tile_size) / n * 360.0 - 180.0
    y_world = y + (py + 0.5) / tile_size
    lat_vals = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * y_world / n))))

    # Map pixels to raster grid indices using 1D searchsorted — no KDTree per tile.
    def nearest_raster(coords_asc, targets):
        idx = np.searchsorted(coords_asc, targets)
        idx = np.clip(idx, 1, len(coords_asc) - 1)
        left = coords_asc[idx - 1]
        right = coords_asc[idx]
        return np.where(np.abs(targets - left) <= np.abs(targets - right), idx - 1, idx)

    lon_idx = nearest_raster(state.raster_lons, lon_vals)   # (tile_size,)
    lat_idx = nearest_raster(state.raster_lats, lat_vals)   # (tile_size,)

    lon_grid_tile, lat_grid_tile = np.meshgrid(lon_vals, lat_vals)

    if state.raster_precomputed:
        # Classification is part of the versioned pipeline product. Avoid
        # repeating threshold work for every pixel of every cache-miss tile.
        source_hazard = (
            state.raster_overall[time_index]
            if vessel_idx is None
            else state.raster_hazard[time_index, vessel_idx]
        )
        # source_hazard is a lazy, chunk-backed DataArray -- np.asarray() on
        # the full plane decodes every spatial chunk regardless of how few a
        # 256x256 tile actually touches. A contiguous bounding-box slice is
        # still a valid lazy index, so crop to it before materializing; the
        # fancy (non-contiguous) np.ix_ index then applies to the now-small
        # local array instead of the full raster.
        lat_lo, lat_hi = int(lat_idx.min()), int(lat_idx.max()) + 1
        lon_lo, lon_hi = int(lon_idx.min()), int(lon_idx.max()) + 1
        cropped_hazard = np.asarray(source_hazard[lat_lo:lat_hi, lon_lo:lon_hi], dtype=np.int8)
        tile_hazard = cropped_hazard[np.ix_(lat_idx - lat_lo, lon_idx - lon_lo)]
    else:
        # Backward-compatible rendering for old products whose raster is
        # generated by this process.
        tile_wind_kt = bilinear_sample_raster(
            state.raster_wind_kt[time_index], state.raster_lons, state.raster_lats,
            lon_grid_tile, lat_grid_tile,
        )
        tile_wave_m = bilinear_sample_raster(
            state.raster_wave_m[time_index], state.raster_lons, state.raster_lats,
            lon_grid_tile, lat_grid_tile,
        )
        if vessel_idx is None:
            tile_hazard = classify_overall_suitability_arrays(
                tile_wind_kt, tile_wave_m, state.vessel_codes,
                state.wind_caution_kt, state.wind_warning_kt, state.wave_caution_m, state.wave_warning_m,
            )
        else:
            tile_hazard = classify_suitability_arrays(
                tile_wind_kt, tile_wave_m, vessel_idx,
                state.wind_caution_kt, state.wind_warning_kt, state.wave_caution_m, state.wave_warning_m,
            )

    # Mask pixels outside the raster domain using per-axis bounds checks.
    lon_in = (lon_grid_tile >= float(state.raster_lons[0])) & (lon_grid_tile <= float(state.raster_lons[-1]))
    lat_in = (lat_grid_tile >= float(state.raster_lats[0])) & (lat_grid_tile <= float(state.raster_lats[-1]))
    in_domain = lon_in & lat_in

    # Live per-pixel land/off-mesh check against the actual mesh faces,
    # rather than reusing the precomputed state.raster_valid: that mask is
    # baked at RASTER_STEP resolution, which can be coarser than the mask's
    # own intended reach in densely-meshed areas (see Cook Islands'
    # cok_suitability_tile for the confirmed case), so a single precomputed
    # cell touching the coast could get marked valid wholesale even where
    # most of it is dry land. Querying state.face_tree directly at each
    # tile pixel's real coordinate avoids that quantization and applies the
    # same _is_marine check used everywhere else (route, point lookups).
    tile_lon_flat = lon_grid_tile.ravel()
    tile_lat_flat = lat_grid_tile.ravel()
    tile_points = np.column_stack([tile_lon_flat, tile_lat_flat])
    tile_point_dist, tile_point_idx = state.face_tree.query(tile_points, workers=KDTREE_QUERY_WORKERS)
    tile_valid = _is_marine(
        state.mesh_trifinder,
        tile_point_dist, state.face_spacing[tile_point_idx],
        tile_lon_flat, tile_lat_flat,
        NIU_SUITABILITY_LAND_MASK_K, NIU_SUITABILITY_LAND_MASK_ABSOLUTE_CAP_KM,
    ).reshape(tile_size, tile_size)
    in_domain = in_domain & tile_valid

    # Build RGBA image.
    rgba = np.zeros((tile_size, tile_size, 4), dtype=np.uint8)
    for hazard_val, color in SUIT_COLORS.items():
        mask = in_domain & (tile_hazard == hazard_val)
        rgba[mask] = color

    img = Image.fromarray(rgba, mode="RGBA")
    buffer = BytesIO()
    img.save(buffer, format="PNG")
    png_bytes = buffer.getvalue()

    disk_tile_cache_put("suitability", cache_key, png_bytes)

    return png_bytes_response(
        png_bytes,
        headers={
            "Cache-Control": "public, max-age=300",
            "X-Tile-Cache": "MISS",
        },
    )


# ===========================================================================
# Cook Islands vessel suitability endpoints
# Source: pre-classified per-timestep GeoJSON + summary JSON written by the
# forecast pipeline's step11_marine_suitability.py (one hazard/action/driver
# classification per forereef point per vessel class per timestep -- this API
# just serves those files as-is, unlike the Niue suitability routes above
# which classify on the fly from raw wind/wave fields).
# ===========================================================================

COK_SUITABILITY_DIR = Path(os.environ.get(
    "COK_SUITABILITY_DIR",
    "/data/cok_suitability",
))


def _iso_z(value) -> Optional[str]:
    """Best-effort ISO-8601 'Z' string for the pipeline's naive-UTC timestamps; None if unparseable."""
    try:
        ts = pd.Timestamp(value)
    except (ValueError, TypeError):
        return None
    if pd.isna(ts):
        return None
    if ts.tzinfo is not None:
        ts = ts.tz_convert("UTC").tz_localize(None)
    return ts.strftime("%Y-%m-%dT%H:%M:%SZ")


@app.get("/cok/suitability/summary")
def cok_suitability_summary():
    path = COK_SUITABILITY_DIR / "cok_suitability_summary.json"
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail="Suitability summary not yet available -- run the forecast pipeline first",
        )
    with open(path) as fh:
        payload = json.load(fh)
    # Additive, explicit time semantics (existing keys are untouched). forecast_start is when
    # the first time step is VALID, which can precede the model run (it includes a hindcast
    # section); model_run_time is the run cycle the data came from (issue time = the cycle,
    # the pipeline does not record a separate publication time).
    prov = _cok_suit_run_provenance()
    first = _iso_z(payload.get("forecast_start"))
    last = _iso_z(payload.get("forecast_end"))
    payload.update({
        "model_run_time": prov["model_run_time"],
        "methodology_version": prov["methodology_version"],
        "first_forecast_time": first,
        "last_forecast_time": last,
    })
    try:
        run_dt = datetime.fromisoformat(prov["model_run_time"].replace("Z", "+00:00")) if prov["model_run_time"] else None
        first_dt = datetime.fromisoformat(first.replace("Z", "+00:00")) if first else None
        last_dt = datetime.fromisoformat(last.replace("Z", "+00:00")) if last else None
        payload["hindcast_hours_before_run"] = round(max(0.0, (run_dt - first_dt).total_seconds() / 3600.0), 2) if run_dt and first_dt else None
        payload["forecast_hours_after_run"] = round(max(0.0, (last_dt - run_dt).total_seconds() / 3600.0), 2) if run_dt and last_dt else None
    except (ValueError, AttributeError):
        payload["hindcast_hours_before_run"] = payload["forecast_hours_after_run"] = None
    return payload


@app.get("/cok/suitability/points/{time_index}")
def cok_suitability_points(time_index: int):
    path = COK_SUITABILITY_DIR / f"cok_suitability_t{time_index:03d}.geojson"
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"No suitability data for time index {time_index}",
        )
    return FileResponse(path, media_type="application/geo+json")


@app.get("/cok/suitability/advice/{time_index}")
def cok_suitability_advice(time_index: int):
    path = COK_SUITABILITY_DIR / f"cok_vessel_advice_t{time_index:03d}.geojson"
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"No advisory data for time index {time_index}",
        )
    return FileResponse(path, media_type="application/geo+json")


# ===========================================================================
# Cook Islands forecast flood-impact estimates (RiskScape / IBF)
# ---------------------------------------------------------------------------
# Read-only views over the per-cycle CSVs that the forecast system's
# publish_riskscape_results.sh rsyncs to COK_IMPACT_DIR (default
# /data/cok_impact/latest) after each successful RiskScape run against the
# live forecast. This API just parses those CSVs -- the source of truth is
# IBF's own output/<cycle_id>/ on the forecast host.
#
# The CSVs carry a UTF-8 BOM (they come out of RiskScape on Windows), so
# every read uses encoding="utf-8-sig" -- without it the first column name
# is read as "﻿event.scenario" and every lookup on it misses.
# ===========================================================================

COK_IMPACT_DIR = Path(os.environ.get("COK_IMPACT_DIR", "/data/cok_impact/latest"))
COK_IMPACT_CYCLE_FILE = Path(os.environ.get(
    "COK_IMPACT_CYCLE_FILE", "/data/cok_impact/latest_cycle_id.txt"
))
# Matches step12_export_riskscape_hazards.py's own block_hours (see that
# script's manifest.json output, "three_day_max" hazard block naming) --
# needed to reconstruct each block's real hour-precise window, since the
# event-impact.csv/region-impact.csv scenario column only carries date-only
# granularity ("block01_2026-09-15_to_2026-09-18"), not the actual
# window_start/window_end ("2026-09-15T06:00:00" to "2026-09-18T05:00:00")
# manifest.json has. That file lives only in the pipeline's own
# riskscape_hazards/ export dir, never copied to COK_IMPACT_DIR -- so this
# API can't just read it. It doesn't need to: block N's true window is
# fully recoverable from cycle_id (the forecast's own issue time) + block
# index + this fixed block size, with no extra file required.
COK_IMPACT_BLOCK_HOURS = float(os.environ.get("COK_IMPACT_BLOCK_HOURS", "72"))

# Per-sector column families in event-impact.csv / region-impact.csv:
# "{sector}_Loss", "{sector}_Exposed_Value", "{sector}_Exposed_Buildings"
# each exist once per sector alongside the "Total_*" columns.
#
# The frontend (IMPACT_SECTOR_ORDER in cookIslandsImpactService.js) only
# knows six buckets -- education/infrastructure/productive/public/
# residential/other -- and its sector-reconciliation check sums exactly
# those six keys against the row's own reported total. "Emergency
# management", "Health", and "Unknown" have no bucket of their own there,
# so if they were kept as separate keys they'd be silently dropped from
# that sum (normalizeSectorMap only reads the six keys it knows), and any
# cycle where those categories are nonzero would fail sectorReconciles even
# though the underlying data is complete. Fold them into "other" instead so
# every dollar of loss/exposure lands in a bucket the frontend actually sums.
COK_IMPACT_SECTOR_BUCKET = {
    "Other": "other",
    "Residential": "residential",
    "Productive": "productive",
    "Infrastructure": "infrastructure",
    "Education": "education",
    "Emergency management": "other",
    "Health": "other",
    "Public": "public",
    "Unknown": "other",
}

# block01_2026-09-08_to_2026-09-11 -> ("01", "2026-09-08", "2026-09-11")
_COK_IMPACT_BLOCK_RE = re.compile(r"^block(\d+)_(\d{4}-\d{2}-\d{2})_to_(\d{4}-\d{2}-\d{2})$")


def _parse_cok_cycle_id(cycle_id: Optional[str]) -> Optional[datetime]:
    """'2026091506' -> 2026-09-15 06:00 UTC, the forecast's own issue time
    (matches run_cook_islands_forecast_gpu.sh-1.sh's RUN_ID format:
    %Y%m%d%H). Returns None rather than raising on anything unexpected --
    this only ever gates an enhancement (precise block windows), never the
    date-only fallback the API already served before this existed."""
    if not cycle_id or len(cycle_id) != 10 or not cycle_id.isdigit():
        return None
    try:
        return datetime.strptime(cycle_id, "%Y%m%d%H").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _read_cok_impact_csv(filename: str) -> "pd.DataFrame":
    path = COK_IMPACT_DIR / filename
    if not path.exists():
        raise HTTPException(
            status_code=503,
            detail=f"Cook Islands impact data not available yet: {path} "
                   "(no successful RiskScape cycle has been published)",
        )
    return pd.read_csv(path, encoding="utf-8-sig")


def _cok_impact_cycle_id() -> Optional[str]:
    try:
        return COK_IMPACT_CYCLE_FILE.read_text().strip() or None
    except OSError:
        return None


def _cok_num(row: "pd.Series", col: str) -> float:
    """CSV cell -> float, tolerating blanks/NaN (RiskScape leaves empties) and
    scientific notation (e.g. "1.0750456E7")."""
    val = row.get(col)
    try:
        f = float(val)
    except (TypeError, ValueError):
        return 0.0
    return f if math.isfinite(f) else 0.0


def _cok_sector_breakdown(row: "pd.Series", suffix: str) -> dict:
    totals = {bucket: 0.0 for bucket in set(COK_IMPACT_SECTOR_BUCKET.values())}
    for sector, bucket in COK_IMPACT_SECTOR_BUCKET.items():
        totals[bucket] += _cok_num(row, f"{sector}_{suffix}")
    return totals


def _cok_impact_block_dates(scenario: str, cycle_id: Optional[str] = None) -> Optional[dict]:
    """`start`/`end` stay the plain calendar-date strings the scenario name
    itself carries (block01_2026-09-15_to_2026-09-18 -> "2026-09-15"/
    "2026-09-18") -- fine for a chip label, but NOT precise enough to drive
    a map time-window: real blocks start/end at the forecast's own issue
    hour, not midnight (block01 here is actually 2026-09-15T06:00 to
    2026-09-18T05:00 -- see COK_IMPACT_BLOCK_HOURS above). A frontend
    reconstructing "Sep 15 - Sep 18" as 00:00-23:59:59 UTC was confirmed
    pulling in 19 extra hours that actually belong to block02's own window,
    showing more flood extent on the map than the $ impact figures next to
    it were ever computed from.

    window_start/window_end (added here) give the frontend the real
    boundary directly, computed from cycle_id + the block's own index +
    COK_IMPACT_BLOCK_HOURS -- no per-block file needed, since a RiskScape
    hazard block's window is fully determined by those three things. Both
    are None when cycle_id is missing/unparseable (e.g. no cycle published
    yet) or the scenario doesn't match the expected block-N naming; callers
    already treat a null dates field as "label only" today, so this
    degrades the same way the date-only version always has, rather than
    failing the whole response."""
    m = _COK_IMPACT_BLOCK_RE.search(str(scenario))
    if not m:
        return None
    block_index, start_date, end_date = m.groups()
    dates = {"start": start_date, "end": end_date, "window_start": None, "window_end": None}

    cycle_dt = _parse_cok_cycle_id(cycle_id)
    if cycle_dt is not None:
        block_delta = timedelta(hours=COK_IMPACT_BLOCK_HOURS)
        window_start = cycle_dt + (int(block_index) - 1) * block_delta
        # -1 native timestep (this forecast's resolution is hourly): the
        # next block's own window_start is window_start + block_delta, so
        # that instant itself belongs to block N+1, not block N. Confirmed
        # against step12's own manifest.json for a real cycle: it reports
        # block01's window_end as 05:00, one hour before block02's own
        # window_start of 06:00 -- not the exclusive boundary a naive
        # start+block_delta would give here. Using the exclusive boundary
        # as window_end would make findNearestIndex land on block N+1's
        # first timestep as the "end" of block N -- reintroducing a
        # smaller version of the exact off-by-one bleed this whole fix
        # exists to remove.
        #
        # The pipeline's own final block is a leftover partial block (the
        # remaining <72h at the end of the forecast horizon, per that same
        # manifest -- e.g. a 13-hour block04 alongside three full 72h
        # blocks), so this still overshoots the true end for exactly that
        # last block. Left as-is rather than tracking the forecast's own
        # last timestamp here just to cap it: the only consumer
        # (findNearestIndex against the real timestamp array) already
        # clamps an overshot target to the last available index, which is
        # the correct answer regardless -- there is no later data for it
        # to wrongly select.
        window_end = window_start + block_delta - timedelta(hours=1)
        # A block whose own scenario name ends on a LATER calendar date than the 72 h window
        # implies is a collapsed "everything remaining" block, e.g. block02_2026-09-26_to_2026-10-03
        # (the current step12 makes the final block the whole rest of the forecast, not another 72 h).
        # Cutting it at start+71 h made clients (the map's Custom Max range) show only its first
        # three days while the impact figures cover the whole block. Extend to the end of the
        # named end date; consumers clamp an overshot end to their last available timestep.
        try:
            end_day = datetime.strptime(end_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            if end_day.date() > window_end.date():
                window_end = end_day + timedelta(hours=23, minutes=59, seconds=59)
        except ValueError:
            pass
        dates["window_start"] = window_start.isoformat().replace("+00:00", "Z")
        dates["window_end"] = window_end.isoformat().replace("+00:00", "Z")

    return dates


@app.get("/cok/impact/latest")
def cok_impact_latest():
    """National flood-impact estimates from the most recent RiskScape run
    against the live forecast, one row per forecast time-block.

    `exposed_population` / `exposed_census_total` come from a coarse
    census-block overlay and currently round to single-digit counts, so
    treat them as indicative only rather than headline numbers. The two
    figures are cross-checked here (event-impact.csv's Exposed_Population
    vs demographics-total.csv's Exposed_Total) and agree for this cycle.
    The `label` field is deliberately "forecast impact estimate", not an
    observed-impact wording.
    """
    df = _read_cok_impact_csv("event-impact.csv")
    cycle_id = _cok_impact_cycle_id()

    demo = {}
    try:
        demo_df = _read_cok_impact_csv("demographics-total.csv")
        demo = {
            str(r["scenario"]): _cok_num(r, "Exposed_Total")
            for _, r in demo_df.iterrows()
        }
    except HTTPException:
        pass  # demographics file is optional; national impact still returns

    blocks = []
    for _, row in df.iterrows():
        scenario = str(row["event.scenario"])
        blocks.append({
            "scenario": scenario,
            "dates": _cok_impact_block_dates(scenario, cycle_id),
            "return_period": _cok_num(row, "event.return_period"),
            "sea_level_rise": _cok_num(row, "event.Sea level rise"),
            "total_loss": _cok_num(row, "Total_Loss"),
            "total_exposed_value": _cok_num(row, "Total_Exposed_Value"),
            "total_exposed_buildings": _cok_num(row, "Total_Exposed_Buildings"),
            "exposed_road_km": _cok_num(row, "Exposed_Road_km"),
            "exposed_population": _cok_num(row, "Exposed_Population"),
            "exposed_census_total": demo.get(scenario),
            "losses_by_sector": _cok_sector_breakdown(row, "Loss"),
            "exposed_value_by_sector": _cok_sector_breakdown(row, "Exposed_Value"),
            "exposed_buildings_by_sector": _cok_sector_breakdown(row, "Exposed_Buildings"),
        })

    return {
        "cycle_id": cycle_id,
        "source": "RiskScape Flood-Multiple-Events",
        "label": "forecast impact estimate",
        "notes": {
            "exposed_population": "Coarse census-block overlay; single-digit "
                                 "counts are indicative only. Cross-checked "
                                 "against demographics-total.csv.",
        },
        "blocks": blocks,
    }


@app.get("/cok/impact/latest/regions")
def cok_impact_latest_regions():
    """Same time-block rows as /cok/impact/latest, broken out per region
    (island) instead of nationally."""
    df = _read_cok_impact_csv("region-impact.csv")
    cycle_id = _cok_impact_cycle_id()
    rows = []
    for _, row in df.iterrows():
        scenario = str(row["event.scenario"])
        rows.append({
            "scenario": scenario,
            "dates": _cok_impact_block_dates(scenario, cycle_id),
            "region": row.get("region.Region"),
            "region_id": int(_cok_num(row, "region.ID")),
            "total_loss": _cok_num(row, "Total_Loss"),
            "total_exposed_value": _cok_num(row, "Total_Exposed_Value"),
            "total_exposed_buildings": _cok_num(row, "Total_Exposed_Buildings"),
            "exposed_road_km": _cok_num(row, "Exposed_Road_km"),
            "losses_by_sector": _cok_sector_breakdown(row, "Loss"),
            "exposed_value_by_sector": _cok_sector_breakdown(row, "Exposed_Value"),
        })
    return {
        "cycle_id": cycle_id,
        "label": "forecast impact estimate",
        "regions": rows,
    }


# ---------------------------------------------------------------------------
# Cook Islands RiskScape flood-impact assets (per-building/per-road detail)
# ---------------------------------------------------------------------------
# raw-results.gpkg (published alongside the CSVs above) carries RiskScape's
# per-asset results -- building polygons, road-segment linestrings, a few
# point assets like bridges -- one row per asset per forecast window
# (scenario), in projected UTM zone 4S (EPSG:32704) coordinates. Reprojected
# to WGS84 here since that's what every map layer in this app expects.
#
# Cached as a GeoDataFrame keyed on the file's (mtime, size) -- same
# signature-based approach the suitability loaders above use -- rather than
# re-reading + reprojecting on every request. The file is small (~1,000
# features across all 4 windows) but read_file + to_crs is real work worth
# skipping when nothing has changed between requests.
# ---------------------------------------------------------------------------

COK_IMPACT_ASSETS_FILENAME = "raw-results.gpkg"

_cok_impact_assets_cache = {"sig": None, "gdf": None}
_cok_impact_assets_lock = threading.Lock()


def _cok_impact_assets_signature():
    try:
        stat = (COK_IMPACT_DIR / COK_IMPACT_ASSETS_FILENAME).stat()
    except OSError:
        return None
    return (stat.st_mtime_ns, stat.st_size)


def _load_cok_impact_assets_gdf():
    """WGS84 GeoDataFrame of every per-asset RiskScape feature across all
    forecast windows, or None if the file isn't published yet."""
    sig = _cok_impact_assets_signature()
    if sig is None:
        return None

    with _cok_impact_assets_lock:
        if _cok_impact_assets_cache["sig"] == sig:
            return _cok_impact_assets_cache["gdf"]

        gdf = gpd.read_file(COK_IMPACT_DIR / COK_IMPACT_ASSETS_FILENAME)
        if gdf.crs is not None and gdf.crs.to_epsg() != 4326:
            gdf = gdf.to_crs(4326)

        _cok_impact_assets_cache["sig"] = sig
        _cok_impact_assets_cache["gdf"] = gdf
        return gdf


def _cok_num_or_none(row, col: str) -> Optional[float]:
    """Like _cok_num, but preserves "not present in the source" as null
    instead of coercing it to 0 -- used for fields (like size_m2) where a
    real zero and a missing measurement mean different things, unlike a
    loss/value column where blank genuinely means no loss."""
    val = row.get(col)
    try:
        f = float(val)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _cok_str_or_none(row, col: str) -> Optional[str]:
    """Missing-string-cell-safe alternative to the tempting `row.get(col) or
    None` -- geopandas represents a missing string cell as float('nan'),
    and NaN is truthy in Python (`nan or None` evaluates to nan, not None),
    so that pattern quietly let a raw NaN float through into a "string"
    property. It rendered fine locally (plain json.dumps allows NaN by
    default) but 500'd for real once deployed, because Starlette's
    JSONResponse serializes with allow_nan=False -- a stricter, spec-correct
    check with no equivalent in an ad hoc json.dumps(feature) test. Found via
    a live 983-feature request that hit real SubUse nulls (~1/3 of rows,
    e.g. every "Bridge" asset); confirmed by re-running that same repro with
    allow_nan=False, which plain json.dumps had been masking."""
    val = row.get(col)
    if val is None or (isinstance(val, float) and math.isnan(val)):
        return None
    text = str(val).strip()
    return text or None


def _cok_impact_asset_feature(row: "pd.Series") -> dict:
    original_value = _cok_num(row, "Original_Value")
    total_loss = _cok_num(row, "Total_Loss")
    loss_ratio = round(min(total_loss / original_value, 1.0), 4) if original_value > 0 else 0.0

    geometry = row.get("geometry")
    sector = _cok_str_or_none(row, "Sector")
    sector = sector.lower() if sector else "unknown"

    return {
        "type": "Feature",
        "geometry": geometry.__geo_interface__ if geometry is not None else None,
        "properties": {
            "use_type": _cok_str_or_none(row, "UseType"),
            "sub_use": _cok_str_or_none(row, "SubUse"),
            "asset": _cok_str_or_none(row, "Asset"),
            # Lowercased to match IMPACT_SECTOR_COLORS/IMPACT_SECTOR_LABELS
            # in cookIslandsImpactService.js -- unlike the national/regional
            # summary endpoints above, "unknown" is kept as its own value
            # here rather than folded into "other": those endpoints have to
            # fold it to satisfy the frontend's sector-sum-vs-total
            # reconciliation check, but a per-asset map layer has no such
            # sum to reconcile, and showing "unknown" honestly is more
            # useful on a map than mislabeling it "other".
            "sector": sector,
            "damage_class": _cok_str_or_none(row, "Damage_Class"),
            "original_value": original_value,
            "total_loss": total_loss,
            "loss_ratio": loss_ratio,
            "size_m2": _cok_num_or_none(row, "size_m2"),
            "scenario": row.get("scenario"),
            # RiskScape's "Details" column is the closest thing to a real
            # name (e.g. "Avatiu Harbour", "Turangi Bridge") -- populated
            # reliably for named infrastructure, but blank or garbled for
            # most residential/commercial rows (checked live against
            # raw-results.gpkg: ~2% of rows have a usable value). Exposed
            # as-is, null when empty, rather than papering over the gap --
            # callers needing a always-present label should fall back to
            # use_type + a stable per-feature index themselves rather than
            # this endpoint fabricating a fake name.
            "details": _cok_str_or_none(row, "Details"),
            # Flood depth (m) at this asset, independent of $ loss -- lets a
            # caller flag "affected" from physical exposure even when
            # original_value is 0 (so loss_ratio is forced to 0 above) or
            # the damage curve returns ~0 loss for a shallow depth.
            "hazard": _cok_num_or_none(row, "hazard"),
        },
    }


@app.get("/cok/impact/latest/assets")
def cok_impact_latest_assets(scenario: Optional[str] = Query(default=None)):
    """Per-building/per-road RiskScape results as GeoJSON, for a map layer.

    Filter to a single forecast window with
    ?scenario=block01_2026-09-14_to_2026-09-17 (the same `scenario` string
    each block in /cok/impact/latest already carries) -- omit it to get
    every window's features in one response.
    """
    gdf = _load_cok_impact_assets_gdf()
    if gdf is None:
        raise HTTPException(
            status_code=503,
            detail=f"Cook Islands impact asset data not available yet: "
                   f"{COK_IMPACT_DIR / COK_IMPACT_ASSETS_FILENAME} "
                   "(no successful RiskScape cycle has been published)",
        )

    if scenario is not None:
        gdf = gdf[gdf["scenario"] == scenario]
        if gdf.empty:
            raise HTTPException(
                status_code=404,
                detail=f"No impact assets for scenario '{scenario}'",
            )

    features = [_cok_impact_asset_feature(row) for _, row in gdf.iterrows()]
    return {
        "type": "FeatureCollection",
        "cycle_id": _cok_impact_cycle_id(),
        "scenario": scenario,
        "features": features,
    }


# ---------------------------------------------------------------------------
# Cook Islands RiskScape flood-impact, by census district
# ---------------------------------------------------------------------------
# report_regional_impact (RiskScape's own regional-aggregation subpipeline)
# only ever aggregates against the table_summary/map_summary bookmarks --
# 'Islands' (~10 island groups) or a Kontur-derived admin4 layer mislabeled
# 'Exclusive_Economic_Zones' -- neither of which is real census-district
# geography, and the operational multi-event pipeline
# (multi-event-pipeline-wo-aal.txt) calls report_regional_impact with
# geospatial_output: false, so there's no district-level breakdown to just
# read off a RiskScape output file the way /latest/regions reads
# region-impact.csv. Rather than changing that pipeline (which would mean
# re-validating the model), this spatially joins the same per-asset
# GeoDataFrame /cok/impact/latest/assets already reads and caches against
# COK_DISTRICTS_PATH -- 44 census districts dissolved from the 2011 PHC
# enumeration-area boundaries by `cdid` (see
# scripts/dissolve_cok_districts.py). Cheap at this data size (~1,000
# features across all windows against 44 polygons), so this runs per-request
# rather than needing its own cycle-keyed cache -- only the boundary file
# itself is cached, the same signature-based way _load_cok_impact_assets_gdf
# caches raw-results.gpkg above.
# ---------------------------------------------------------------------------

COK_DISTRICTS_PATH = Path(os.environ.get(
    "COK_DISTRICTS_PATH", "./cok-regions/cok_districts_4326.geojson",
))
# Mirrors the RiskScape model's own partner_sample_region region_buffer_km
# default (10km) -- assets that don't fall inside any district polygon
# (wharves, offshore points, etc.) still get matched to the nearest one
# within this distance, rather than silently dropping out of every total.
COK_DISTRICTS_BUFFER_M = 10_000.0

_cok_districts_cache = {"sig": None, "gdf": None}
_cok_districts_lock = threading.Lock()


def _cok_districts_signature():
    try:
        stat = COK_DISTRICTS_PATH.stat()
    except OSError:
        return None
    return (stat.st_mtime_ns, stat.st_size)


def _load_cok_districts_gdf():
    """Districts GeoDataFrame in its native WGS84 CRS, or None if the
    boundary file isn't deployed on this host. Cached as WGS84 (not
    reprojected to UTM here) so /districts/geojson can serve this exact
    geometry back as-is -- _cok_district_impact_rows below reprojects its
    own local copy to UTM for the nearest-join instead, since that's cheap
    at only 44 polygons and keeps this cache reusable by both callers."""
    sig = _cok_districts_signature()
    if sig is None:
        return None

    with _cok_districts_lock:
        if _cok_districts_cache["sig"] == sig:
            return _cok_districts_cache["gdf"]

        gdf = gpd.read_file(COK_DISTRICTS_PATH)

        _cok_districts_cache["sig"] = sig
        _cok_districts_cache["gdf"] = gdf
        return gdf


def _cok_district_sector_breakdown(group: "pd.DataFrame") -> dict:
    """Same six-bucket folding as _cok_sector_breakdown above, but summed
    from raw-results.gpkg's per-asset Sector + Total_Loss columns instead of
    region-impact.csv's already-split "{sector}_Loss" columns -- raw-results
    only has one Sector value per asset, not one column per sector."""
    totals = {bucket: 0.0 for bucket in set(COK_IMPACT_SECTOR_BUCKET.values())}
    sector = group["Sector"]
    for sector_raw, bucket in COK_IMPACT_SECTOR_BUCKET.items():
        totals[bucket] += float(group.loc[sector == sector_raw, "Total_Loss"].sum())
    # anything with a Sector value this map doesn't recognize still counts
    # towards 'other', rather than silently dropping out of the district total
    known = set(COK_IMPACT_SECTOR_BUCKET)
    totals["other"] += float(group.loc[~sector.isin(known), "Total_Loss"].sum())
    return totals


def _cok_district_impact_rows(
    assets: "gpd.GeoDataFrame", districts: "gpd.GeoDataFrame"
) -> tuple[list[dict], Optional[str]]:
    """Spatial-join RiskScape assets to their nearest census district (within
    COK_DISTRICTS_BUFFER_M) and aggregate loss/exposure per (district,
    scenario). Shared by cok_impact_latest_districts (numbers only) and
    cok_impact_latest_districts_geojson (numbers + polygon geometry) so the
    join and the totals it produces can never drift apart between the two
    endpoints.

    districts is expected in its native WGS84 CRS (see
    _load_cok_districts_gdf) -- reprojected to its own best-fit UTM zone
    here, in a local copy, so the nearest-join runs in metres rather than
    degrees; cheap at only 44 polygons, so this happens per call rather than
    needing its own cache.
    """
    # gpd.sjoin_nearest requires either PyGEOS or a geopandas new enough to
    # detect Shapely >=2.0's native GEOS bindings on its own -- this host's
    # geopandas (0.10.2, predating that detection) has neither and raises
    # NotImplementedError. Shapely itself is already >=2.0 here, so querying
    # its STRtree directly sidesteps geopandas' sjoin_nearest wrapper
    # entirely rather than adding a pygeos dependency to a production
    # service for one endpoint.
    districts_m = districts.to_crs(districts.estimate_utm_crs())
    assets_m = assets.to_crs(districts_m.crs).reset_index(drop=True)
    tree = STRtree(districts_m.geometry.values)
    # all_matches=False keeps exactly one match per input geometry (ties
    # broken arbitrarily but consistently), so there's no equidistant-match
    # duplication to filter afterward the way sjoin_nearest needed.
    query_result = tree.query_nearest(
        assets_m.geometry.values, max_distance=COK_DISTRICTS_BUFFER_M, all_matches=False,
    )
    # query_nearest silently omits any input geometry with no tree geometry
    # within max_distance -- rebuild a full one-slot-per-asset index array so
    # an out-of-buffer asset still gets an explicit "unmatched" bucket below
    # instead of vanishing from every district total.
    district_idx = np.full(len(assets_m), -1, dtype=np.int64)
    if query_result.size:
        asset_positions, tree_positions = query_result
        district_idx[asset_positions] = tree_positions

    matched = district_idx >= 0
    safe_idx = np.where(matched, district_idx, 0)
    assets_m["cdid"] = np.where(matched, districts_m["cdid"].values[safe_idx], None)
    assets_m["district_name"] = np.where(matched, districts_m["district_name"].values[safe_idx], None)
    assets_m["gid"] = np.where(matched, districts_m["gid"].values[safe_idx], None)

    cycle_id = _cok_impact_cycle_id()
    rows = []
    for (cdid, scenario), group in assets_m.groupby(["cdid", "scenario"], dropna=False):
        unmatched = pd.isna(cdid)
        row0 = group.iloc[0]
        rows.append({
            "scenario": scenario,
            "dates": _cok_impact_block_dates(str(scenario), cycle_id),
            "district_id": "unmatched" if unmatched else str(cdid),
            "district_name": "Unmatched (outside buffer)" if unmatched else row0.get("district_name"),
            "island_group": None if unmatched else row0.get("gid"),
            "total_loss": float(group["Total_Loss"].sum()),
            # Original_Value, not the conversion_rate-scaled Value column --
            # matches what /cok/impact/latest/assets already reports as
            # "original_value" per feature, so a district total here is
            # literally the sum of that same per-asset field.
            "total_exposed_value": float(group["Original_Value"].sum()),
            "total_exposed_buildings": int((group["Asset"] == "Building").sum()),
            "losses_by_sector": _cok_district_sector_breakdown(group),
        })

    return rows, cycle_id


def _cok_district_impact_context() -> tuple["gpd.GeoDataFrame", "gpd.GeoDataFrame"]:
    """Shared 503 guards for both district endpoints below -- raises the same
    detail message either one would raise on its own if either input isn't
    available yet."""
    assets = _load_cok_impact_assets_gdf()
    if assets is None:
        raise HTTPException(
            status_code=503,
            detail=f"Cook Islands impact asset data not available yet: "
                   f"{COK_IMPACT_DIR / COK_IMPACT_ASSETS_FILENAME} "
                   "(no successful RiskScape cycle has been published)",
        )

    districts = _load_cok_districts_gdf()
    if districts is None:
        raise HTTPException(
            status_code=503,
            detail=f"District boundary layer not deployed on this host: {COK_DISTRICTS_PATH}",
        )

    return assets, districts


@app.get("/cok/impact/latest/districts")
def cok_impact_latest_districts():
    """Same per-window RiskScape results as /cok/impact/latest/assets,
    aggregated by census district instead of served as individual features.
    See the module comment above for why this is a spatial join done here
    rather than a RiskScape-native regional breakdown.

    Numbers only -- see /cok/impact/latest/districts/geojson for the same
    aggregation with each district's polygon geometry attached, for a map
    choropleth layer.
    """
    assets, districts = _cok_district_impact_context()
    rows, cycle_id = _cok_district_impact_rows(assets, districts)

    return {
        "cycle_id": cycle_id,
        "label": "forecast impact estimate",
        "districts": rows,
    }


@app.get("/cok/impact/latest/districts/geojson")
def cok_impact_latest_districts_geojson(scenario: Optional[str] = Query(default=None)):
    """Same per-district aggregation as /cok/impact/latest/districts, but
    with each district's polygon geometry attached as a GeoJSON Feature --
    for a choropleth map layer (shade each district by loss/damage
    severity), the one consumer that actually uses the boundaries dissolved
    into cok_districts_4326.geojson rather than leaving them sitting unused
    behind the numbers-only /districts endpoint above. Same technique
    /cok/impact/latest/assets already uses for per-building features, applied
    to district polygons instead.

    Optional ?scenario=block01_2026-09-14_to_2026-09-17 filters to one
    forecast window (the same `scenario` string /districts and /assets
    already carry) -- a choropleth shades one point in time at once, so the
    typical caller wants exactly one window's totals, not all of them
    stacked in a single response. Omit it to get every window's features in
    one FeatureCollection, each carrying its own `scenario` property, same
    pattern as /cok/impact/latest/assets.

    The synthetic "unmatched" bucket /districts reports for assets outside
    every district's buffer has no polygon of its own and is never included
    here -- it's a bookkeeping bucket, not a real place to shade.
    """
    assets, districts = _cok_district_impact_context()
    rows, cycle_id = _cok_district_impact_rows(assets, districts)

    if scenario is not None:
        rows = [row for row in rows if row["scenario"] == scenario]
        if not rows:
            raise HTTPException(
                status_code=404,
                detail=f"No district impact data for scenario '{scenario}'",
            )

    geometry_by_district_id = dict(zip(districts["cdid"].astype(str), districts.geometry))

    features = []
    for row in rows:
        if row["district_id"] == "unmatched":
            continue
        geometry = geometry_by_district_id.get(row["district_id"])
        if geometry is None:
            continue
        features.append({
            "type": "Feature",
            "geometry": geometry.__geo_interface__,
            "properties": dict(row),
        })

    return {
        "type": "FeatureCollection",
        "cycle_id": cycle_id,
        "scenario": scenario,
        "features": features,
    }


# ===========================================================================
# Cook Islands "area inundated above MHWS" -- district-level statistic
# ---------------------------------------------------------------------------
# RiskScape's Total_Exposed_Area_Or_Length isn't a trustworthy "area
# inundated" figure -- it reports whatever exposure layer was sampled
# (buildings, for Cook Islands), not land extent, so it can't answer "how
# much land is this event actually flooding beyond what's routinely wet at
# Mean High Water Springs". This computes that directly from the same 3-day-
# max hazard GeoTIFF blocks the forecast pipeline already publishes every
# cycle to COK_HAZARD_DIR (no pipeline change needed), by subtracting a
# static, pre-built land-above-MHWS polygon.
#
# Methodology (v4 -- v2's LiDAR land mask, with the scientists' extra margin
# selectable and comparable across several water marks;
# v1 used the census-district outlines as the land mask, which does not
# follow the real shoreline and let sea water inside the district outlines
# count as flooded land: ~35% of v1's block-1 area was over sea):
#   event_mask = valid(hmax) AND hmax >= min_depth_m
#   filter level    = MHWS (0.328 m above MSL) + a margin, default 17.5 cm = 0.503 m.
#                     MHWS on its own filtered some, not all, of the routine
#                     wetting; the scientists advised adding "15-20 cm or so"
#                     (0.478-0.528 m gives block 1 within about +/-6% of this).
#   land_above_mhws = LiDAR ground cells that are NOT the ocean-connected
#                     tidal zone (DTM <= the filter level and touching the sea)
#                     [static polygon, precomputed offline, ~67.6 km2]
#   inundated_above_mhws = event_mask AND land_above_mhws
# The sea and lagoon have no LiDAR ground return, and the beach fringe below
# MHWS is the tidal zone, so both are excluded by construction. Districts are
# used only to aggregate the result, not to define land.
#
# `hmax` (SFINCS's own depth diagnostic, = water level minus bed elevation)
# is used rather than water-surface elevation, so no elevation lookup is
# needed on the SFINCS side. The event and land masks are independent boolean
# footprints combined only via a horizontal geometric intersection -- their
# Z-values are never arithmetically combined -- so SFINCS's own bed-elevation
# datum (undocumented anywhere in that pipeline) never enters this
# calculation. The LiDAR DTM's zero was confirmed as the same MSL the
# scientists' MHWS = 0.328 m refers to.
#
# DEPLOYMENT PREREQUISITE: this needs `rasterio` on this host to read the
# hazard block GeoTIFFs -- add rasterio==1.4.4 to requirements.txt (matches
# what this was developed/tested against), or every request here 500s on
# import.
#
# COK_HAZARD_DIR (default /data/cok_hazard/latest) is a FLAT "latest"
# folder -- overwritten each cycle, same convention as COK_IMPACT_DIR, NOT
# per-cycle subdirectories -- confirmed against the real host. It holds
# manifest.json (cycle_id + blocks[] with index/scenario/filepath/
# window_start/window_end/timestep_count), events.csv, a READY marker, and
# the block GeoTIFFs themselves (EPSG:4326, float32, nodata -9999).
# manifest.json's own `filepath` values still carry the path from the
# forecast pipeline's own separate host, which does not resolve here --
# only each entry's basename is used, resolved under COK_HAZARD_DIR, where
# the tifs actually live on this host. Because this is a flat "latest"
# folder, there is no historical cycle_id to request (unlike
# /cok/impact/latest/districts's own cycle-agnostic "latest" framing, this
# route has no non-latest mode at all) -- the response's own `cycle_id`
# field always reports whichever cycle manifest.json currently names.
# ===========================================================================

# rasterio is imported defensively: it is a new dependency (add rasterio to
# requirements.txt and rebuild the image). Until then only this route
# degrades -- to a 503 -- instead of an ImportError taking down every route.
try:
    import rasterio
    import rasterio.features
except ImportError:  # pragma: no cover
    rasterio = None
import shapely.geometry
import shapely.ops

COK_HAZARD_DIR = Path(os.environ.get("COK_HAZARD_DIR", "/data/cok_hazard/latest"))
COK_HAZARD_MANIFEST_FILENAME = "manifest.json"

# One static land-above-level polygon per water mark, named by level in mm
# (cok_land_above_mhws_503.geojson = 0.503 m above MSL). Built offline from
# the LiDAR DTM by the same script for every level, so they are comparable.
COK_LAND_LAYER_DIR = Path(os.environ.get("COK_LAND_LAYER_DIR", "./cok-regions"))
COK_MHWS_ELEVATION_M_MSL = 0.328
# Water marks offered, as a margin above MHWS in cm. The scientists said MHWS alone
# filters some but not all routine wetting: "add 15-20 cm or so". 17.5 is the
# midpoint and the default; 0 (plain MHWS), 15 and 20 are served so they can be
# compared side by side.
COK_MHWS_MARGINS_CM = (0.0, 15.0, 17.5, 20.0)
COK_MHWS_DEFAULT_MARGIN_CM = 17.5
COK_MHWS_DEFAULT_MIN_DEPTH_M = 0.05  # still an open product decision (0.05 vs 0.10) -- kept
                                      # as a query param default, not hardcoded, so it can
                                      # move without a redeploy-and-repatch cycle.
COK_MHWS_METHODOLOGY_VERSION = "mhws-adjusted-v4"
COK_MHWS_LAND_MASK_SOURCE = (
    "LiDAR DTM ground above the selected water mark (MHWS + margin): excludes "
    "the sea, lagoon and the intertidal beach; Rarotonga only"
)
# Below this, a polygon fragment is a polygonize/overlay artifact (sub-pixel
# self-intersection slivers at diagonal pixel junctions), not real
# inundated area -- not resolution-dependent, just small enough to be noise
# at any of this project's raster resolutions (SFINCS 5m, LiDAR DTM ~1m).
COK_MHWS_SLIVER_AREA_M2 = 1.0

_cok_land_layers_cache = {}  # margin_cm -> {"sig": ..., "gdf": ...}
_cok_land_layers_lock = threading.Lock()


def _cok_margin_key(margin_cm: float) -> float:
    """Snap a requested margin to one of the served marks, or 422."""
    for allowed in COK_MHWS_MARGINS_CM:
        if abs(float(margin_cm) - allowed) < 1e-6:
            return allowed
    raise HTTPException(
        status_code=422,
        detail=f"margin_cm must be one of {list(COK_MHWS_MARGINS_CM)} (cm above MHWS).",
    )


def _cok_filter_elevation_m(margin_cm: float) -> float:
    return round(COK_MHWS_ELEVATION_M_MSL + margin_cm / 100.0, 3)


def _cok_land_layer_path(margin_cm: float) -> Path:
    return COK_LAND_LAYER_DIR / f"cok_land_above_mhws_{int(round(_cok_filter_elevation_m(margin_cm) * 1000))}.geojson"


def _load_cok_land_layer(margin_cm: float):
    """Static land-above-level polygon for one water mark (built once, offline,
    from the LiDAR DTM). WGS84 on disk, cached per file by (mtime, size). None
    if that level's file is not deployed on this host."""
    path = _cok_land_layer_path(margin_cm)
    try:
        stat = path.stat()
    except OSError:
        return None
    sig = (stat.st_mtime_ns, stat.st_size)
    with _cok_land_layers_lock:
        cached = _cok_land_layers_cache.get(margin_cm)
        if cached is not None and cached["sig"] == sig:
            return cached["gdf"]
        gdf = gpd.read_file(path)
        _cok_land_layers_cache[margin_cm] = {"sig": sig, "gdf": gdf}
        return gdf


def _cok_hazard_manifest_path() -> Path:
    return COK_HAZARD_DIR / COK_HAZARD_MANIFEST_FILENAME


def _load_cok_hazard_manifest() -> Optional[dict]:
    try:
        return json.loads(_cok_hazard_manifest_path().read_text())
    except (OSError, json.JSONDecodeError):
        return None


def _cok_hazard_blocks_signature():
    """Signature covering manifest.json AND every block tif it references
    (by basename, resolved under COK_HAZARD_DIR -- see this section's own
    module docstring on why the manifest's own filepath values aren't used
    directly). Published files never change after being written (this
    pipeline's own write-then-rename READY-marker discipline), so this only
    re-reads when a new cycle actually lands. Returns (None, None) if no
    cycle has published yet, or a referenced block tif is missing."""
    manifest = _load_cok_hazard_manifest()
    if manifest is None:
        return None, None
    try:
        manifest_stat = _cok_hazard_manifest_path().stat()
        block_stats = []
        for block_meta in manifest.get("blocks", []):
            tif_path = COK_HAZARD_DIR / Path(block_meta["filepath"]).name
            stat = tif_path.stat()
            block_stats.append((str(tif_path), stat.st_mtime_ns, stat.st_size))
    except (OSError, KeyError):
        return None, None
    sig = (manifest_stat.st_mtime_ns, manifest_stat.st_size, tuple(block_stats))
    return sig, manifest


_cok_hazard_blocks_cache = {"sig": None, "cycle_id": None, "blocks": None}
_cok_hazard_blocks_lock = threading.Lock()


def _load_cok_hazard_blocks() -> Optional[dict]:
    """Reads the currently-published hazard block GeoTIFFs (hmax array,
    nodata, transform, crs) plus the cycle_id manifest.json currently
    names. COK_HAZARD_DIR is a flat "latest" folder -- there is only ever
    one published cycle available on this host at a time, unlike the
    per-cycle-path design this was originally (wrongly) written against --
    so there is no cycle_id parameter here; callers always get whichever
    cycle is currently published. Returns None if nothing has published
    yet (no manifest.json / READY, or a referenced tif is missing)."""
    if rasterio is None:
        raise HTTPException(
            status_code=503,
            detail="rasterio is not installed in this image -- add rasterio to "
                   "requirements.txt and rebuild to enable /cok/inundation/*.",
        )
    sig, manifest = _cok_hazard_blocks_signature()
    if sig is None:
        return None

    with _cok_hazard_blocks_lock:
        if _cok_hazard_blocks_cache["sig"] == sig:
            return _cok_hazard_blocks_cache

        blocks = []
        for block_meta in sorted(manifest.get("blocks", []), key=lambda b: b["index"]):
            tif_path = COK_HAZARD_DIR / Path(block_meta["filepath"]).name
            with rasterio.open(tif_path) as src:
                blocks.append({
                    "index": int(block_meta["index"]),
                    "hmax": src.read(1),
                    "nodata": src.nodata,
                    "transform": src.transform,
                    "crs": src.crs.to_wkt() if src.crs is not None else "EPSG:4326",
                })

        result = {"sig": sig, "cycle_id": manifest.get("cycle_id"), "blocks": blocks}
        _cok_hazard_blocks_cache.clear()
        _cok_hazard_blocks_cache.update(result)
        return result


def _cok_mhws_polygonize_mask(mask: np.ndarray, transform, crs):
    """Boolean raster mask -> single (Multi)Polygon in the raster's own
    CRS. Empty (not None) if the mask has no True cells, so callers can
    always check `.is_empty` uniformly instead of branching on None."""
    if not mask.any():
        return shapely.geometry.Polygon()

    shapes_iter = rasterio.features.shapes(
        mask.astype(np.uint8), mask=mask, transform=transform
    )
    polygons = [shapely.geometry.shape(geom) for geom, _value in shapes_iter]
    merged = shapely.ops.unary_union(polygons)
    # polygonize can leave self-touching rings at diagonal pixel junctions;
    # buffer(0) is the standard shapely repair for that.
    return merged.buffer(0)


def _cok_mhws_drop_area_slivers(geom, min_area_m2: float = COK_MHWS_SLIVER_AREA_M2):
    if geom.is_empty:
        return geom
    if geom.geom_type == "Polygon":
        return geom if geom.area >= min_area_m2 else shapely.geometry.Polygon()
    if geom.geom_type == "MultiPolygon":
        kept = [g for g in geom.geoms if g.area >= min_area_m2]
        return shapely.ops.unary_union(kept) if kept else shapely.geometry.Polygon()
    return geom


def _cok_mhws_result(prep: dict, margin_cm: float, with_geometry: bool) -> dict:
    """Area result for ONE water mark, given the already-prepared event polygon."""
    cycle_id, block, min_depth_m = prep["cycle_id"], prep["block"], prep["min_depth_m"]
    districts, work_crs, event_m = prep["districts"], prep["work_crs"], prep["event_m"]
    filter_m = _cok_filter_elevation_m(margin_cm)
    base = {
        "cycle_id": cycle_id,
        "block": block,
        "depth_threshold_m": min_depth_m,
        "mhws_elevation_m_msl": COK_MHWS_ELEVATION_M_MSL,
        "margin_above_mhws_cm": margin_cm,
        "margin_above_mhws_m": round(margin_cm / 100.0, 4),
        "filter_elevation_m_msl": filter_m,
        "methodology_version": COK_MHWS_METHODOLOGY_VERSION,
        "land_mask_source": COK_MHWS_LAND_MASK_SOURCE,
    }

    def zero():
        return {**base,
                "area_inundated_m2": 0.0, "area_inundated_ha": 0.0, "area_inundated_km2": 0.0,
                "districts": [
                    {"cdid": row["cdid"], "district_name": row["district_name"], "area_inundated_m2": 0.0,
                     "area_inundated_ha": 0.0, "percentage_of_total": 0.0}
                    for _, row in districts.iterrows()
                ],
                "outside_districts_m2": 0.0, "outside_districts_ha": 0.0,
                "geometry": None}

    if event_m is None:
        return zero()
    land_gdf = _load_cok_land_layer(margin_cm)
    if land_gdf is None:
        raise HTTPException(
            status_code=503,
            detail=f"Land-above-level layer not deployed on this host: {_cok_land_layer_path(margin_cm)}",
        )
    land_m = shapely.ops.unary_union(list(land_gdf.to_crs(work_crs).geometry))
    inundated = _cok_mhws_drop_area_slivers(event_m.intersection(land_m))
    if inundated.is_empty:
        return zero()

    total_area_m2 = float(inundated.area)
    district_rows, in_districts = [], 0.0
    for _, row in districts.iterrows():
        overlap = inundated.intersection(row.geometry)
        area_m2 = 0.0 if overlap.is_empty else float(overlap.area)
        in_districts += area_m2
        district_rows.append({
            "cdid": row["cdid"],
            "district_name": row["district_name"],
            "area_inundated_m2": round(area_m2, 1),
            "area_inundated_ha": round(area_m2 / 10_000.0, 4),
            "percentage_of_total": round(100.0 * area_m2 / total_area_m2, 2) if total_area_m2 > 0 else 0.0,
        })
    outside_m2 = max(total_area_m2 - in_districts, 0.0)
    geometry = None
    if with_geometry:
        geometry = shapely.geometry.mapping(gpd.GeoSeries([inundated], crs=work_crs).to_crs(4326).iloc[0])
    return {**base,
            "area_inundated_m2": round(total_area_m2, 1),
            "area_inundated_ha": round(total_area_m2 / 10_000.0, 4),
            "area_inundated_km2": round(total_area_m2 / 1_000_000.0, 6),
            "districts": district_rows,
            "outside_districts_m2": round(outside_m2, 1),
            "outside_districts_ha": round(outside_m2 / 10_000.0, 4),
            "geometry": geometry}


def _cok_mhws_prepare(block: int, min_depth_m: float) -> dict:
    """Everything that does not depend on the water mark: the published hazard
    block, the districts (projected once) and the event polygon (built once, so
    comparing several marks does not re-polygonize the raster each time)."""
    loaded = _load_cok_hazard_blocks()
    if loaded is None:
        raise HTTPException(
            status_code=503,
            detail=f"No published hazard cycle at {COK_HAZARD_DIR} "
                   "(manifest.json/READY not found, or a block tif it "
                   "references is missing).",
        )
    cycle_id = loaded["cycle_id"]
    raster = next((b for b in loaded["blocks"] if b["index"] == block), None)
    if raster is None:
        raise HTTPException(
            status_code=404,
            detail=f"Cycle {cycle_id} has no block {block}; available blocks: "
                   f"{sorted(b['index'] for b in loaded['blocks'])}.",
        )
    districts = _load_cok_districts_gdf()
    if districts is None:
        raise HTTPException(
            status_code=503,
            detail=f"District boundary layer not deployed on this host: {COK_DISTRICTS_PATH}",
        )
    work_crs = districts.estimate_utm_crs()
    districts = districts.to_crs(work_crs)
    hmax, nodata = raster["hmax"], raster["nodata"]
    valid = (hmax != nodata) if nodata is not None else np.isfinite(hmax)
    event_polygon = _cok_mhws_polygonize_mask(valid & (hmax >= min_depth_m), raster["transform"], raster["crs"])
    event_m = None
    if not event_polygon.is_empty:
        event_m = gpd.GeoDataFrame(geometry=[event_polygon], crs=raster["crs"]).to_crs(work_crs).geometry.iloc[0]
    return {"cycle_id": cycle_id, "block": block, "min_depth_m": min_depth_m,
            "districts": districts, "work_crs": work_crs, "event_m": event_m}


def compute_cok_mhws_adjusted_inundation(block: int, min_depth_m: float, margin_cm: float = COK_MHWS_DEFAULT_MARGIN_CM) -> dict:
    """Area (with geometry) for one block at one water mark."""
    margin = _cok_margin_key(margin_cm)
    return _cok_mhws_result(_cok_mhws_prepare(block, min_depth_m), margin, with_geometry=True)


def compute_cok_mhws_summary(block: int, min_depth_m: float) -> dict:
    """Area at EVERY served water mark for one block, without geometry, so the
    marks can be compared side by side cheaply (the event polygon is built once)."""
    prep = _cok_mhws_prepare(block, min_depth_m)
    return {
        "cycle_id": prep["cycle_id"], "block": block, "depth_threshold_m": min_depth_m,
        "mhws_elevation_m_msl": COK_MHWS_ELEVATION_M_MSL,
        "default_margin_cm": COK_MHWS_DEFAULT_MARGIN_CM,
        "methodology_version": COK_MHWS_METHODOLOGY_VERSION,
        "levels": [_cok_mhws_result(prep, m, with_geometry=False) for m in COK_MHWS_MARGINS_CM],
    }


@app.get("/cok/inundation/latest/mhws-adjusted")
def cok_inundation_latest_mhws_adjusted(
    block: int = Query(1, ge=1, le=2, description=(
        "3-day-max hazard block: 1 = current time -> +3 days (the window "
        "impact is actually computed against), 2 = remainder of the "
        "forecast horizon collapsed into a single peak-inundation summary."
    )),
    min_depth_m: float = Query(COK_MHWS_DEFAULT_MIN_DEPTH_M, gt=0, description=(
        "Minimum hmax depth (m) to count as event inundation -- suppresses "
        "model numerical noise near the wet/dry front. Still an open "
        "product decision (0.05 vs 0.10); left as a query param rather "
        "than hardcoded for exactly that reason."
    )),
    margin_cm: float = Query(COK_MHWS_DEFAULT_MARGIN_CM, description=(
        "Water mark as a margin above MHWS (0.328 m above MSL), in cm. One of "
        "0, 15, 17.5, 20. The scientists advised adding 15-20 cm; 17.5 is the default."
    )),
):
    """Land flooded above the chosen water mark, aggregated by district, with the
    flooded geometry. `cycle_id` always reports the single latest published cycle
    (COK_HAZARD_DIR only holds that one)."""
    return compute_cok_mhws_adjusted_inundation(block, min_depth_m, margin_cm)


@app.get("/cok/inundation/latest/mhws-adjusted/summary")
def cok_inundation_latest_mhws_summary(
    block: int = Query(1, ge=1, le=2, description="3-day-max hazard block (1 or 2)."),
    min_depth_m: float = Query(COK_MHWS_DEFAULT_MIN_DEPTH_M, gt=0, description="Minimum hmax depth (m)."),
):
    """Area at every served water mark (MHWS, +15, +17.5, +20 cm) for one block,
    without geometry -- for comparing the marks in a table."""
    return compute_cok_mhws_summary(block, min_depth_m)


# ---------------------------------------------------------------------------
# Cook Islands vessel-suitability raster (continuous surface, not just
# points). Same technique as Niue's suit_raster_*/niue_suitability_tile
# above -- KDTree land-mask + LinearNDInterpolator built once at load,
# bilinear-sampled per tile at request time -- but kept as separate
# functions/globals (cok_suit_* / _cok_* prefix) rather than sharing Niue's,
# since COK_suitability_latest.nc has a different schema (no hazard_class;
# raw fields + thresholds only, see step11_marine_suitability.py) and the
# raster covers ~10 scattered islands over ~1,500km rather than one dense
# reef mesh.
# ---------------------------------------------------------------------------

def _cok_suit_source() -> tuple[Optional[str], Optional[Path]]:
    """Zarr is preferred when present (matches the Niue suitability loader's
    pattern); falls back to the original NetCDF product otherwise."""
    zarr_path = Path(COK_SUITABILITY_ZARR_PATH)
    if zarr_path.is_dir():
        return "zarr", zarr_path

    nc_path = Path(COK_SUITABILITY_NC_PATH)
    if nc_path.is_file():
        return "netcdf", nc_path

    return None, None


def _cok_suit_signature() -> Optional[tuple]:
    source_type, source_path = _cok_suit_source()
    if source_type is None or source_path is None:
        return None

    if source_type == "zarr":
        for metadata_name in ("zarr.json", ".zmetadata", ".zgroup"):
            metadata_path = source_path / metadata_name
            try:
                stat = metadata_path.stat()
            except FileNotFoundError:
                continue
            return (source_type, stat.st_ino, stat.st_mtime_ns, stat.st_size)
        try:
            stat = source_path.stat()
            return (source_type, stat.st_ino, stat.st_mtime_ns, stat.st_size)
        except FileNotFoundError:
            return None

    try:
        stat = source_path.stat()
        return (source_type, stat.st_ino, stat.st_mtime_ns, stat.st_size)
    except FileNotFoundError:
        return None


# Guards the rebuild itself, not reads -- see Niue's suit_load_lock for the
# full reasoning (request-path reads of cok_suit_state are deliberately
# lock-free; only a true first-ever cold start blocks).
cok_suit_load_lock = threading.Lock()
COK_SUIT_REBUILD_CROSS_PROCESS_LOCK_PATH = TILE_CACHE_ROOT / ".cok-suit-rebuild.lock"


def _load_cok_suit_state() -> Optional[CookSuitabilityState]:
    """Request-path entry point -- same lock-free-read / background-rebuild
    pattern as Niue's _load_niue_suit_state(). See that function's docstring."""
    if cok_suit_state is None:
        with cok_suit_load_lock:
            with cross_process_lock(COK_SUIT_REBUILD_CROSS_PROCESS_LOCK_PATH):
                return _rebuild_cok_suit_state_locked()

    current_sig = _cok_suit_signature()
    if current_sig is None or current_sig != cok_suit_state.signature:
        _kick_background_cok_suit_rebuild()

    return cok_suit_state


def _kick_background_cok_suit_rebuild() -> None:
    if not cok_suit_load_lock.acquire(blocking=False):
        return

    def _run() -> None:
        try:
            with cross_process_lock(COK_SUIT_REBUILD_CROSS_PROCESS_LOCK_PATH):
                _rebuild_cok_suit_state_locked()
        finally:
            cok_suit_load_lock.release()

    threading.Thread(target=_run, daemon=True, name="cok-suit-rebuild").start()


def _cok_suit_poll_loop() -> None:
    while True:
        try:
            _kick_background_cok_suit_rebuild()
        except Exception:
            # Keep polling even if the source is transiently unreadable, but
            # log it -- a persistent failure should be visible somewhere
            # rather than silently leaving the generation stale forever.
            logger.exception("Cook Islands suitability background poll failed")
        time.sleep(COK_SUITABILITY_POLL_INTERVAL_SECONDS)


@app.on_event("startup")
def _start_cok_suit_poll_thread() -> None:
    threading.Thread(target=_cok_suit_poll_loop, daemon=True, name="cok-suit-poll").start()


def _rebuild_cok_suit_state_locked() -> Optional[CookSuitabilityState]:
    """Do the actual (expensive, only for legacy NetCDF products -- Zarr
    products with precomputed raster_* variables are lazy and cheap) rebuild.
    Caller must hold cok_suit_load_lock. See Niue's _rebuild_niue_suit_state_locked
    for the full reasoning behind the lock-free-read / uninterrupted-publish
    structure this mirrors -- here, the whole new generation is assembled into
    a CookSuitabilityState instance first, and `cok_suit_state = new_state` at
    the very end is the entire publish: one reference swap, so a lock-free
    reader in between always sees either the whole old state or the whole new
    one, never a mix."""
    global cok_suit_state

    current_sig = _cok_suit_signature()
    if current_sig is None:
        return cok_suit_state

    if cok_suit_state is not None and cok_suit_state.signature == current_sig:
        return cok_suit_state

    source_type, source_path = _cok_suit_source()
    try:
        if source_type == "zarr":
            try:
                new_ds = xr.open_zarr(source_path, consolidated=True)
            except ValueError:
                new_ds = xr.open_zarr(source_path, consolidated=False)
        else:
            new_ds = xr.open_dataset(source_path)
    except (FileNotFoundError, OSError):
        return cok_suit_state

    lon = new_ds.lon.values
    lat = new_ds.lat.values
    point_coords = np.column_stack([lon, lat])
    new_tree = cKDTree(point_coords)

    # Authoritative land/off-mesh test -- see _build_mesh_trifinder(). Built
    # here (rather than later, alongside the final state publish) so it's
    # also available to the legacy-fallback raster construction below, not
    # just the final state object. Reuses the same SWAN UGRID Zarr this API
    # already loads for /wave/ugrid/timeseries (UGRID_ZARR_PATH), so this
    # needs no new data source; if that mesh isn't available, _is_marine()
    # falls back to the distance-only check everywhere.
    new_mesh_trifinder = _build_mesh_trifinder(Path(UGRID_ZARR_PATH))

    # Source-point arrays for cok_suitability_route (it scores against the
    # nearest source point, same as every other COK suitability read here
    # apart from tiles -- not against the rendering raster).
    new_point_wind_kt = new_ds.wind_speed_kt.values.astype(np.float32)   # (time, point)
    new_point_wave_m = new_ds.wave_height_m.values.astype(np.float32)    # (time, point)
    point_nn_dist, _ = new_tree.query(point_coords, k=2, workers=KDTREE_QUERY_WORKERS)
    new_point_face_spacing = point_nn_dist[:, 1]

    new_vessel_codes = tuple(str(v) for v in new_ds.vessel_class_code.values)
    new_lon_min = float(lon.min())
    new_lon_max = float(lon.max())
    new_lat_min = float(lat.min())
    new_lat_max = float(lat.max())
    new_wind_caution_kt = new_ds.vessel_wind_caution_kt.values.astype(np.float32)
    new_wind_warning_kt = new_ds.vessel_wind_warning_kt.values.astype(np.float32)
    new_wave_caution_m = new_ds.vessel_wave_caution_m.values.astype(np.float32)
    new_wave_warning_m = new_ds.vessel_wave_warning_m.values.astype(np.float32)

    raster_variables = {
        "raster_lon", "raster_lat", "raster_valid",
        "raster_wind_speed_kt", "raster_wave_height_m",
        "raster_hazard_class", "raster_overall_hazard_class",
    }
    new_raster_precomputed = raster_variables.issubset(new_ds.variables)

    if new_raster_precomputed:
        # Pipeline product already carries the exact rasterization this
        # function used to build at runtime. Keep the big arrays as lazy,
        # chunk-backed DataArrays -- eagerly materializing all 229 timesteps
        # over Cook Islands' full-mesh grid is exactly the multi-minute /
        # multi-GB-per-worker cost this Zarr path exists to avoid. Callers
        # slice one timestep before np.asarray(), so Zarr only decodes the
        # chunks a given tile request actually needs.
        raster_lons_1d = new_ds.raster_lon.values.astype(np.float32)
        raster_lats_1d = new_ds.raster_lat.values.astype(np.float32)
        new_raster_valid = new_ds.raster_valid.values.astype(bool)
        new_raster_wind_kt = new_ds.raster_wind_speed_kt
        new_raster_wave_m = new_ds.raster_wave_height_m
        new_raster_hazard = new_ds.raster_hazard_class
        new_raster_overall = new_ds.raster_overall_hazard_class

        product_step = new_ds.attrs.get("raster_grid_step_deg")
        product_mask_k = new_ds.attrs.get("raster_land_mask_k")
        if product_step is not None and not np.isclose(float(product_step), COK_SUITABILITY_RASTER_STEP):
            logger.warning(
                "COK suitability product raster_grid_step_deg=%s differs from "
                "COK_SUITABILITY_RASTER_STEP=%s; using the product grid",
                product_step, COK_SUITABILITY_RASTER_STEP,
            )
        if product_mask_k is not None and not np.isclose(float(product_mask_k), COK_SUITABILITY_LAND_MASK_K):
            logger.warning(
                "COK suitability product raster_land_mask_k=%s differs from "
                "COK_SUITABILITY_LAND_MASK_K=%s; using the product mask",
                product_mask_k, COK_SUITABILITY_LAND_MASK_K,
            )
    else:
        logger.warning(
            "COK suitability product has no precomputed raster schema; using "
            "the legacy runtime interpolation fallback"
        )

        wind_kt = new_point_wind_kt
        wave_m = new_point_wave_m

        raster_lons_1d = np.arange(
            float(lon.min()), float(lon.max()) + COK_SUITABILITY_RASTER_STEP,
            COK_SUITABILITY_RASTER_STEP, dtype=np.float32,
        )
        raster_lats_1d = np.arange(
            float(lat.min()), float(lat.max()) + COK_SUITABILITY_RASTER_STEP,
            COK_SUITABILITY_RASTER_STEP, dtype=np.float32,
        )
        rlon_grid, rlat_grid = np.meshgrid(raster_lons_1d, raster_lats_1d)
        grid_coords = np.column_stack([rlon_grid.ravel(), rlat_grid.ravel()])
        grid_point_dist, grid_point_idx = new_tree.query(grid_coords, workers=KDTREE_QUERY_WORKERS)
        grid_point_dist = grid_point_dist.reshape(len(raster_lats_1d), len(raster_lons_1d))
        grid_point_idx = grid_point_idx.reshape(len(raster_lats_1d), len(raster_lons_1d))

        point_spacing = new_point_face_spacing
        new_raster_valid = _is_marine(
            new_mesh_trifinder,
            grid_point_dist, point_spacing[grid_point_idx],
            rlon_grid, rlat_grid,
            COK_SUITABILITY_LAND_MASK_K, COK_SUITABILITY_LAND_MASK_ABSOLUTE_CAP_KM,
        )

        n_time = wind_kt.shape[0]
        n_lat = len(raster_lats_1d)
        n_lon = len(raster_lons_1d)
        try:
            wind_interp = LinearNDInterpolator(point_coords, wind_kt.T.astype(np.float64))
            wave_interp = LinearNDInterpolator(point_coords, wave_m.T.astype(np.float64))
            grid_wind = wind_interp(grid_coords).T.reshape(n_time, n_lat, n_lon).astype(np.float32)
            grid_wave = wave_interp(grid_coords).T.reshape(n_time, n_lat, n_lon).astype(np.float32)

            outside_hull_2d = np.isnan(grid_wind[0])
            if outside_hull_2d.any():
                out_lat_idx, out_lon_idx = np.where(outside_hull_2d)
                out_point_idx = grid_point_idx[out_lat_idx, out_lon_idx]
                grid_wind[:, out_lat_idx, out_lon_idx] = wind_kt[:, out_point_idx]
                grid_wave[:, out_lat_idx, out_lon_idx] = wave_m[:, out_point_idx]

            new_raster_wind_kt = grid_wind
            new_raster_wave_m = grid_wave
        except Exception:
            new_raster_wind_kt = wind_kt[:, grid_point_idx].astype(np.float32)
            new_raster_wave_m = wave_m[:, grid_point_idx].astype(np.float32)

        new_raster_hazard = None
        new_raster_overall = None

    # Publish the new generation as a single reference swap -- see
    # CookSuitabilityState's docstring for why this (rather than the ~20
    # separate global writes this replaced) is what makes lock-free reads safe.
    cok_suit_state = CookSuitabilityState(
        dataset=new_ds,
        signature=current_sig,
        face_tree=new_tree,
        vessel_codes=new_vessel_codes,
        lon_min=new_lon_min,
        lon_max=new_lon_max,
        lat_min=new_lat_min,
        lat_max=new_lat_max,
        point_wind_kt=new_point_wind_kt,
        point_wave_m=new_point_wave_m,
        face_spacing=new_point_face_spacing,
        wind_caution_kt=new_wind_caution_kt,
        wind_warning_kt=new_wind_warning_kt,
        wave_caution_m=new_wave_caution_m,
        wave_warning_m=new_wave_warning_m,
        raster_lons=raster_lons_1d,
        raster_lats=raster_lats_1d,
        raster_valid=new_raster_valid,
        raster_wind_kt=new_raster_wind_kt,
        raster_wave_m=new_raster_wave_m,
        raster_hazard=new_raster_hazard,
        raster_overall=new_raster_overall,
        raster_precomputed=new_raster_precomputed,
        mesh_trifinder=new_mesh_trifinder,
    )

    return cok_suit_state


def require_cok_suit_state() -> CookSuitabilityState:
    state = _load_cok_suit_state()
    if state is None:
        raise HTTPException(
            status_code=503,
            detail=f"Cook Islands suitability raster dataset not found: {COK_SUITABILITY_NC_PATH}",
        )
    return state


def _cok_resolve_vessel_index(vessel: str, vessel_codes: tuple[str, ...]) -> Optional[int]:
    if vessel in ("all", "overall"):
        return None
    if vessel.isdigit():
        idx = int(vessel)
        if idx < 0 or idx >= len(vessel_codes):
            raise HTTPException(
                status_code=400,
                detail=f"vessel index {idx} out of range; "
                       f"valid indices are 0-{len(vessel_codes) - 1}",
            )
        return idx
    if vessel in vessel_codes:
        return vessel_codes.index(vessel)
    raise HTTPException(
        status_code=400,
        detail=f"Unknown vessel '{vessel}'. Valid values: {list(vessel_codes)} or 'all'.",
    )


def _cok_classify_suitability_arrays(
    wind_kt: np.ndarray,
    wave_m: np.ndarray,
    vessel_idx: int,
    state: CookSuitabilityState,
) -> np.ndarray:
    wind_hazard = np.zeros(wind_kt.shape, dtype=np.int8)
    wind_hazard[wind_kt >= state.wind_caution_kt[vessel_idx]] = 1
    wind_hazard[wind_kt >= state.wind_warning_kt[vessel_idx]] = 2

    wave_hazard = np.zeros(wave_m.shape, dtype=np.int8)
    wave_hazard[wave_m >= state.wave_caution_m[vessel_idx]] = 1
    wave_hazard[wave_m >= state.wave_warning_m[vessel_idx]] = 2

    return np.maximum(wind_hazard, wave_hazard).astype(np.int8)


def _cok_classify_overall_suitability_arrays(
    wind_kt: np.ndarray,
    wave_m: np.ndarray,
    state: CookSuitabilityState,
) -> np.ndarray:
    overall = np.zeros(wind_kt.shape, dtype=np.int8)
    for vessel_idx in range(len(state.vessel_codes)):
        overall = np.maximum(overall, _cok_classify_suitability_arrays(wind_kt, wave_m, vessel_idx, state))
    return overall.astype(np.int8)


@app.get("/cok/suitability/tiles/{vessel}/{time_index}/{z}/{x}/{y}.png")
def cok_suitability_tile(vessel: str, time_index: int, z: int, x: int, y: int):
    """Render a 256x256 PNG map tile for the Cook Islands vessel suitability
    raster. Both precomputed (Zarr) and legacy NetCDF-only products render
    the same way: bilinear-sample the continuous wind/wave rasters, then
    classify per pixel -- rather than nearest-neighboring a pre-classified
    raster, which paints coarse offshore SWAN-mesh triangles as flat,
    hard-edged blocks (see the raster_precomputed branch below for why).
    vessel: vessel class name, integer index, or 'all' for overall worst-case."""
    state = require_cok_suit_state()
    sds = state.dataset

    if time_index < 0 or time_index >= sds.sizes["time"]:
        raise HTTPException(
            status_code=400,
            detail=f"time_index {time_index} out of range 0–{sds.sizes['time'] - 1}",
        )

    vessel_idx = _cok_resolve_vessel_index(vessel, state.vessel_codes)

    tile_size = 256
    # "bilinear_v1" versions the rendering algorithm into the cache key --
    # without it, tiles already cached under this signature from before the
    # precomputed branch switched from nearest-neighbor raster_hazard_class
    # to bilinear-sampled wind/wave + per-pixel classification would keep
    # being served as stale HITs until the next forecast cycle rotates
    # state.signature.
    cache_key = ("bilinear_v1", state.signature, vessel, time_index, z, x, y)
    cached_tile = disk_tile_cache_get("cok_suitability", cache_key)
    if cached_tile is not None:
        return png_bytes_response(
            cached_tile,
            headers={"Cache-Control": "public, max-age=300", "X-Tile-Cache": "HIT"},
        )

    lon_min_tile, lat_min_tile, lon_max_tile, lat_max_tile = tile_to_lonlat_bounds(x, y, z)

    if (
        lon_max_tile < state.lon_min
        or lon_min_tile > state.lon_max
        or lat_max_tile < state.lat_min
        or lat_min_tile > state.lat_max
    ):
        return transparent_png_response(tile_size)

    n = 2.0 ** z
    px = np.arange(tile_size)
    py = np.arange(tile_size)
    lon_vals = (x + (px + 0.5) / tile_size) / n * 360.0 - 180.0
    y_world = y + (py + 0.5) / tile_size
    lat_vals = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * y_world / n))))

    def nearest_raster(coords_asc, targets):
        idx = np.searchsorted(coords_asc, targets)
        idx = np.clip(idx, 1, len(coords_asc) - 1)
        left = coords_asc[idx - 1]
        right = coords_asc[idx]
        return np.where(np.abs(targets - left) <= np.abs(targets - right), idx - 1, idx)

    lon_idx = nearest_raster(state.raster_lons, lon_vals)
    lat_idx = nearest_raster(state.raster_lats, lat_vals)

    lon_grid_tile, lat_grid_tile = np.meshgrid(lon_vals, lat_vals)

    if state.raster_precomputed:
        # Bilinear-sample the precomputed product's own continuous
        # wind/wave rasters and classify per pixel, instead of
        # nearest-neighboring its precomputed (pre-classified)
        # raster_hazard_class -- see cok_suitability_tile's module-level
        # neighbors (bilinear_sample_raster, _cok_classify_suitability_arrays)
        # for the same technique already used by the legacy branch below.
        # The source raster is built directly from the SWAN UGRID mesh
        # (coarse far offshore), and a discrete 3-class field has no
        # interpolation to hide that coarseness the way a continuous field
        # (Wave Height/Period) does -- nearest-neighboring the pre-classified
        # raster paints whole offshore mesh triangles as flat, hard-edged
        # blocks. Sampling the still-continuous wind/wave fields first (then
        # classifying) follows the physical gradient instead of the raw
        # triangle edges, matching how Wave Height/Period already render.
        # Thresholds are unchanged -- this only changes how the two
        # continuous inputs are sampled before classification, never what
        # counts as Suitable/Caution/Warning.
        #
        # Precomputed rasters are lazy, chunk-backed DataArrays --
        # bilinear_sample_raster needs a real in-memory ndarray (it indexes
        # with raster[y0, x0] fancy-index arrays), so crop to a small
        # bounding box before materializing, same reasoning as the previous
        # raster_hazard_class crop below. Bilinear needs one extra cell of
        # margin beyond the nearest-neighbor index range (x0+1/y0+1 can
        # land one cell past the nearest index), hence the +/-1 padding
        # here vs. the tight crop the old nearest-neighbor code used.
        lat_lo = max(0, int(lat_idx.min()) - 1)
        lat_hi = min(len(state.raster_lats), int(lat_idx.max()) + 2)
        lon_lo = max(0, int(lon_idx.min()) - 1)
        lon_hi = min(len(state.raster_lons), int(lon_idx.max()) + 2)

        cropped_wind_kt = np.asarray(
            state.raster_wind_kt[time_index, lat_lo:lat_hi, lon_lo:lon_hi], dtype=np.float32
        )
        cropped_wave_m = np.asarray(
            state.raster_wave_m[time_index, lat_lo:lat_hi, lon_lo:lon_hi], dtype=np.float32
        )
        tile_wind_kt = bilinear_sample_raster(
            cropped_wind_kt, state.raster_lons[lon_lo:lon_hi], state.raster_lats[lat_lo:lat_hi],
            lon_grid_tile, lat_grid_tile,
        )
        tile_wave_m = bilinear_sample_raster(
            cropped_wave_m, state.raster_lons[lon_lo:lon_hi], state.raster_lats[lat_lo:lat_hi],
            lon_grid_tile, lat_grid_tile,
        )
        if vessel_idx is None:
            tile_hazard = _cok_classify_overall_suitability_arrays(tile_wind_kt, tile_wave_m, state)
        else:
            tile_hazard = _cok_classify_suitability_arrays(tile_wind_kt, tile_wave_m, vessel_idx, state)
    else:
        tile_wind_kt = bilinear_sample_raster(
            state.raster_wind_kt[time_index], state.raster_lons, state.raster_lats,
            lon_grid_tile, lat_grid_tile,
        )
        tile_wave_m = bilinear_sample_raster(
            state.raster_wave_m[time_index], state.raster_lons, state.raster_lats,
            lon_grid_tile, lat_grid_tile,
        )
        if vessel_idx is None:
            tile_hazard = _cok_classify_overall_suitability_arrays(tile_wind_kt, tile_wave_m, state)
        else:
            tile_hazard = _cok_classify_suitability_arrays(tile_wind_kt, tile_wave_m, vessel_idx, state)

    lon_in = (lon_grid_tile >= float(state.raster_lons[0])) & (lon_grid_tile <= float(state.raster_lons[-1]))
    lat_in = (lat_grid_tile >= float(state.raster_lats[0])) & (lat_grid_tile <= float(state.raster_lats[-1]))
    in_domain = lon_in & lat_in

    # Live per-pixel land/off-mesh check against the actual mesh points,
    # rather than reusing the precomputed state.raster_valid: that mask is
    # baked at COK_SUITABILITY_RASTER_STEP resolution (~556m cells), which
    # is coarser than the mask's own intended reach near densely-meshed
    # islands (confirmed against the live product: Rarotonga/Aitutaki's own
    # K*spacing reach is only ~200-300m, well under one raster cell), so a
    # single precomputed cell touching the coast gets marked valid wholesale
    # even where most of that cell is dry land. Querying state.face_tree
    # directly at each tile pixel's real coordinate avoids that
    # quantization, and _is_marine additionally checks the real mesh
    # triangulation when available -- see _is_marine's docstring: verified
    # against 5,844 real Rarotonga building footprints, the distance check
    # alone still wrongly marks 32% of them marine; adding the
    # triangulation check drops that to 0.05%.
    tile_lon_flat = lon_grid_tile.ravel()
    tile_lat_flat = lat_grid_tile.ravel()
    tile_points = np.column_stack([tile_lon_flat, tile_lat_flat])
    tile_point_dist, tile_point_idx = state.face_tree.query(tile_points, workers=KDTREE_QUERY_WORKERS)
    tile_valid = _is_marine(
        state.mesh_trifinder,
        tile_point_dist, state.face_spacing[tile_point_idx],
        tile_lon_flat, tile_lat_flat,
        COK_SUITABILITY_LAND_MASK_K, COK_SUITABILITY_LAND_MASK_ABSOLUTE_CAP_KM,
    ).reshape(tile_size, tile_size)
    in_domain = in_domain & tile_valid

    rgba = np.zeros((tile_size, tile_size, 4), dtype=np.uint8)
    for hazard_val, color in COK_SUIT_COLORS.items():
        mask = in_domain & (tile_hazard == hazard_val)
        rgba[mask] = color

    img = Image.fromarray(rgba, mode="RGBA")
    buffer = BytesIO()
    img.save(buffer, format="PNG")
    png_bytes = buffer.getvalue()

    disk_tile_cache_put("cok_suitability", cache_key, png_bytes)

    return png_bytes_response(
        png_bytes,
        headers={"Cache-Control": "public, max-age=300", "X-Tile-Cache": "MISS"},
    )


@app.get("/cok/suitability/grid/{time_index}")
def cok_suitability_grid(time_index: int):
    """Raw wind/wave/valid raster for a single timestep, quantized int16 +
    uint8 -- same wire format as niue_suitability_grid. Lets the frontend's
    custom-envelope overlay reclassify against arbitrary user-adjusted
    thresholds entirely client-side (a canvas repaint) instead of requesting
    freshly rendered tiles per threshold combination.

    Downsampled by COK_SUITABILITY_GRID_STRIDE from the tile-rendering
    raster: Cook Islands' full raster (2801 x 1902) is ~180x more cells than
    Niue's equivalent grid, so serving it at full resolution here would be a
    ~20MB+ payload per timestep instead of the ~1-2MB range this and Niue's
    own grid endpoint both target. The custom-envelope UI is a coarse
    "roughly where is it safe" view, not a replacement for the full-
    resolution preset tiles, so this coarser grid is an intentional
    trade-off, not a stopgap.
    """
    state = require_cok_suit_state()
    sds = state.dataset
    if time_index < 0 or time_index >= sds.sizes["time"]:
        raise HTTPException(
            status_code=400,
            detail=f"time_index {time_index} out of range 0-{sds.sizes['time'] - 1}",
        )

    stride = max(1, COK_SUITABILITY_GRID_STRIDE)
    lons = state.raster_lons[::stride]
    lats = state.raster_lats[::stride]

    # int16 units: wind at 0.01 kt (covers +/-327 kt), wave at 0.001 m
    # (covers +/-32 m) -- both far beyond any real value, at a finer
    # resolution than could ever change a hazard classification.
    wind_scale = 100.0
    wave_scale = 1000.0

    # Cache the encoded body on disk (same pool as the PNG tiles, under its
    # own namespace) -- the quantize + concat is cheap, but the full-plane
    # np.asarray() decode of the lazy chunk-backed raster is not.
    cache_key = (state.signature, "grid", time_index, stride)
    body = disk_tile_cache_get("cok_suitability_grid", cache_key)
    if body is None:
        # Stride before materializing: state.raster_wind_kt/raster_wave_m are
        # lazy, chunk-backed DataArrays when the product ships precomputed
        # rasters (see _rebuild_cok_suit_state_locked). Slicing first avoids
        # building the full dense (2801, 1902) float32 plane per field (~20MB
        # each) just to immediately throw away all but 1/stride^2 of it --
        # but at the default stride (4) against this product's on-disk chunk
        # shape ((1, 700, 480), confirmed via zarr.open_group), the strided
        # selection still lands in every spatial chunk, so this does NOT
        # currently reduce how many chunks Zarr decodes from disk. It becomes
        # a real decode-skipping win only once/if a caller can scope this to
        # a sub-region smaller than a chunk (this endpoint always requests
        # the full domain today).
        wind = np.asarray(state.raster_wind_kt[time_index, ::stride, ::stride], dtype=np.float32)
        wave = np.asarray(state.raster_wave_m[time_index, ::stride, ::stride], dtype=np.float32)
        # Live check against the actual mesh points rather than the
        # precomputed state.raster_valid -- see cok_suitability_tile for why
        # the precomputed mask (baked at full raster resolution, still
        # coarser than its own intended reach near densely-meshed islands)
        # isn't reused here either. Computed over the already-strided
        # lons/lats grid, so this is at most ~332K points (not the full
        # 2801x1902 raster), one batched query.
        lon_grid, lat_grid = np.meshgrid(lons, lats)
        grid_lon_flat = lon_grid.ravel()
        grid_lat_flat = lat_grid.ravel()
        grid_points = np.column_stack([grid_lon_flat, grid_lat_flat])
        grid_point_dist, grid_point_idx = state.face_tree.query(grid_points, workers=KDTREE_QUERY_WORKERS)
        valid = _is_marine(
            state.mesh_trifinder,
            grid_point_dist, state.face_spacing[grid_point_idx],
            grid_lon_flat, grid_lat_flat,
            COK_SUITABILITY_LAND_MASK_K, COK_SUITABILITY_LAND_MASK_ABSOLUTE_CAP_KM,
        ).reshape(len(lats), len(lons))

        wind_i16 = np.clip(np.nan_to_num(wind, nan=0.0) * wind_scale, -32768, 32767).astype("<i2")
        wave_i16 = np.clip(np.nan_to_num(wave, nan=0.0) * wave_scale, -32768, 32767).astype("<i2")
        valid_u8 = valid.astype(np.uint8)

        body = wind_i16.tobytes() + wave_i16.tobytes() + valid_u8.tobytes()
        disk_tile_cache_put("cok_suitability_grid", cache_key, body)

    height, width = len(lats), len(lons)

    valid_time = pd.Timestamp(sds.time.values[time_index]).isoformat() + "Z"
    headers = {
        "X-Grid-Width": str(width),
        "X-Grid-Height": str(height),
        "X-Lon-Min": str(float(lons[0])),
        "X-Lon-Max": str(float(lons[-1])),
        "X-Lat-Min": str(float(lats[0])),
        "X-Lat-Max": str(float(lats[-1])),
        "X-Wind-Scale": str(wind_scale),
        "X-Wave-Scale": str(wave_scale),
        "X-Valid-Time": valid_time,
        "X-Grid-Encoding": "wind:i16le,wave:i16le,valid:u8",
        "Cache-Control": "public, max-age=3600",
    }
    return Response(content=body, media_type="application/octet-stream", headers=headers)


@app.post("/cok/suitability/route")
def cok_suitability_route(payload: dict = Body(...)):
    """
    Route-based vessel suitability forecast for the Cook Islands raster
    product: densify a route into samples spaced roughly sample_spacing_nm
    apart, estimate an ETA per sample from departure_time and speed_kt, and
    score each sample against the nearest forecast timestep.

    Mirrors niue_suitability_route -- scores each sample against the nearest
    source point via state.face_tree (not the rendering raster), with the
    same adaptive land/off-mesh check (COK_SUITABILITY_LAND_MASK_K x that
    point's nearest-neighbor spacing) the raster build and the point reads
    use. Hazard is classified per-sample from that point's wind/wave against
    the vessel thresholds. Verified against the raster-cell approach on 6,000
    sample points at two timesteps of live data: 100% agreement on validity
    and hazard class.
    """
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Request body must be a JSON object")

    raw_route = payload.get("route")
    if not isinstance(raw_route, list) or len(raw_route) < 2:
        raise HTTPException(status_code=400, detail="'route' must contain at least two [lon, lat] coordinates")
    if len(raw_route) > _ROUTE_MAX_WAYPOINTS:
        raise HTTPException(
            status_code=400,
            detail=f"'route' has too many waypoints ({len(raw_route)} > {_ROUTE_MAX_WAYPOINTS})",
        )

    route_coords: list[tuple[float, float]] = []
    for i, pt in enumerate(raw_route):
        if not isinstance(pt, (list, tuple)) or len(pt) != 2:
            raise HTTPException(status_code=400, detail=f"route[{i}] must be a [lon, lat] pair")
        try:
            lon_pt, lat_pt = float(pt[0]), float(pt[1])
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail=f"route[{i}] must contain numeric [lon, lat] values")
        if not (-180.0 <= lon_pt <= 180.0) or not (-90.0 <= lat_pt <= 90.0):
            raise HTTPException(status_code=400, detail=f"route[{i}] coordinates out of valid lon/lat range")
        route_coords.append((lon_pt, lat_pt))

    departure_dt = _parse_utc(payload.get("departure_time"), "departure_time", status_code=400)

    speed_kt_raw = payload.get("speed_kt")
    try:
        speed_kt = float(speed_kt_raw)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="'speed_kt' must be a positive number")
    if speed_kt <= 0:
        raise HTTPException(status_code=400, detail="'speed_kt' must be > 0")

    spacing_raw = payload.get("sample_spacing_nm", 1)
    try:
        sample_spacing_nm = float(spacing_raw)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="'sample_spacing_nm' must be a positive number")
    if sample_spacing_nm <= 0:
        raise HTTPException(status_code=400, detail="'sample_spacing_nm' must be > 0")

    route_len_nm = sum(
        _haversine_nm(route_coords[i][0], route_coords[i][1], route_coords[i + 1][0], route_coords[i + 1][1])
        for i in range(len(route_coords) - 1)
    )
    # Cheap fast-fail on the whole-route estimate; _check_route_sample_count
    # below re-checks the real count after densification (see its docstring
    # for why the two can differ on a multi-leg route).
    if route_len_nm / sample_spacing_nm > _ROUTE_MAX_SAMPLES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"route densifies to too many samples ({route_len_nm / sample_spacing_nm:.0f} > "
                f"{_ROUTE_MAX_SAMPLES}); shorten the route or increase sample_spacing_nm"
            ),
        )

    # State must be loaded before vessel validation, since vessel_codes is
    # populated by _load_cok_suit_state().
    state = require_cok_suit_state()
    sds = state.dataset

    vessel_raw = payload.get("vessel")
    if not isinstance(vessel_raw, str) or not vessel_raw:
        raise HTTPException(status_code=400, detail="'vessel' is required")
    vessel_idx = _cok_resolve_vessel_index(vessel_raw, state.vessel_codes)
    if vessel_idx is None:
        raise HTTPException(
            status_code=400,
            detail=(
                f"'vessel' must be one of {list(state.vessel_codes)} "
                f"(got {vessel_raw!r}, and 'all' isn't valid for route scoring)"
            ),
        )

    sample_coords, cum_dist_nm = _densify_route(route_coords, sample_spacing_nm)
    _check_route_sample_count(len(sample_coords))

    eta_dts = [departure_dt + timedelta(hours=d / speed_kt) for d in cum_dist_nm]
    nearest_time_idx, out_of_horizon = _resolve_route_time_indices(sds, eta_dts)

    coords_arr = np.array(sample_coords)
    face_dists, face_idxs = state.face_tree.query(coords_arr, workers=KDTREE_QUERY_WORKERS)

    lon_arr = coords_arr[:, 0]
    lat_arr = coords_arr[:, 1]
    in_domain = (
        (state.lon_min <= lon_arr) & (lon_arr <= state.lon_max)
        & (state.lat_min <= lat_arr) & (lat_arr <= state.lat_max)
    )
    # Same adaptive land/off-mesh check as the raster build and the point
    # reads (see _is_marine).
    land_or_off_mesh = ~_is_marine(
        state.mesh_trifinder,
        face_dists, state.face_spacing[face_idxs],
        lon_arr, lat_arr,
        COK_SUITABILITY_LAND_MASK_K, COK_SUITABILITY_LAND_MASK_ABSOLUTE_CAP_KM,
    )
    available_mask = in_domain & ~land_or_off_mesh & ~out_of_horizon

    # Vectorized wind/wave/hazard lookup for every sample in one shot (each
    # array is indexed once by the full (time_index, face_index) pairing)
    # instead of the previous per-sample Python loop that called
    # _cok_classify_suitability_arrays once per sample on a length-1 array.
    # Values for unavailable samples are computed too but simply discarded
    # below -- cheaper than branching per-element on a vectorized path.
    wind_all = state.point_wind_kt[nearest_time_idx, face_idxs]
    wave_all = state.point_wave_m[nearest_time_idx, face_idxs]
    hazard_all = _cok_classify_suitability_arrays(wind_all, wave_all, vessel_idx, state)

    samples: list[dict] = []
    hazard_counts = {0: 0, 1: 0, 2: 0}
    worst_hazard: Optional[int] = None
    available_count = 0

    for i, (lon_s, lat_s) in enumerate(sample_coords):
        dist_nm = round(cum_dist_nm[i], 3)
        eta_str = eta_dts[i].strftime("%Y-%m-%dT%H:%M:%SZ")

        if not available_mask[i]:
            if not in_domain[i]:
                reason = "outside suitability model domain"
            elif land_or_off_mesh[i]:
                reason = "land or off-mesh point"
            else:
                reason = "eta outside forecast time horizon"
            samples.append({
                "sample_index": i,
                "lon": round(lon_s, 6),
                "lat": round(lat_s, 6),
                "distance_nm": dist_nm,
                "eta": eta_str,
                "time_index": None,
                "hazard_class": None,
                "hazard_label": None,
                "wave_height_m": None,
                "wind_speed_kt": None,
                "available": False,
                "unavailable_reason": reason,
            })
            continue

        time_index = int(nearest_time_idx[i])
        hazard = int(hazard_all[i])
        wind_kt = float(wind_all[i])
        wave_m = float(wave_all[i])

        samples.append({
            "sample_index": i,
            "lon": round(lon_s, 6),
            "lat": round(lat_s, 6),
            "distance_nm": dist_nm,
            "eta": eta_str,
            "time_index": time_index,
            "hazard_class": hazard,
            "hazard_label": HAZARD_LABELS.get(hazard, "Unknown"),
            "wave_height_m": round(wave_m, 2),
            "wind_speed_kt": round(wind_kt, 2),
            "available": True,
            "unavailable_reason": None,
        })
        hazard_counts[hazard] += 1
        available_count += 1
        worst_hazard = hazard if worst_hazard is None else max(worst_hazard, hazard)

    segments: list[dict] = []
    for i in range(len(samples) - 1):
        a, b = samples[i], samples[i + 1]
        both_available = a["available"] and b["available"]
        segments.append({
            "from_sample_index": a["sample_index"],
            "to_sample_index": b["sample_index"],
            "hazard_class": max(a["hazard_class"], b["hazard_class"]) if both_available else None,
            "available": both_available,
        })

    distance_nm_total = round(cum_dist_nm[-1], 3)
    duration_hours = round(distance_nm_total / speed_kt, 3)

    if available_count > 0:
        suitable_percent = round(100.0 * hazard_counts[0] / available_count)
        caution_percent = round(100.0 * hazard_counts[1] / available_count)
        warning_percent = round(100.0 * hazard_counts[2] / available_count)
        recommendation = HAZARD_LABELS.get(worst_hazard, "Unknown")
    else:
        suitable_percent = caution_percent = warning_percent = 0
        recommendation = "Unavailable"

    def _label(key: str) -> Optional[str]:
        raw = payload.get(key)
        if not isinstance(raw, str):
            return None
        cleaned = "".join(ch for ch in raw if ch.isprintable()).strip()[:80]
        return cleaned or None

    return {
        "route_id": payload.get("route_id"),
        "vessel": state.vessel_codes[vessel_idx],
        "departure_time": departure_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "speed_kt": speed_kt,
        "start_label": _label("start_label"),
        "destination_label": _label("destination_label"),
        "sample_spacing_nm": sample_spacing_nm,
        "sampling_interval_minutes": round(duration_hours * 60.0 / (len(samples) - 1), 1) if len(samples) > 1 else None,
        "coverage": {
            "samples_total": len(samples),
            "samples_available": available_count,
            "ratio": round(available_count / len(samples), 4) if samples else 0.0,
        },
        **_cok_suit_run_provenance(),
        "summary": {
            "distance_nm": distance_nm_total,
            "duration_hours": duration_hours,
            "worst_hazard_class": worst_hazard,
            "recommendation": recommendation,
            "suitable_percent": suitable_percent,
            "caution_percent": caution_percent,
            "warning_percent": warning_percent,
        },
        "samples": samples,
        "segments": segments,
    }


COK_BEST_DEPARTURE_MIN_COVERAGE = 0.8
_COK_BEST_DEPARTURE_MAX_CANDIDATES = 25


@app.post("/cok/suitability/route/best-departure")
def cok_suitability_route_best_departure(payload: dict = Body(...)):
    """
    Model-guidance search for a better departure time for the same route/vessel/speed:
    evaluates the requested departure plus later departures every `step_hours`
    (default 3) up to `window_hours` (default 24, max 72) after it, and ranks candidates.

    Body: everything /cok/suitability/route accepts, plus optional `window_hours`, `step_hours`.

    Ranking (documented so a client can print it): only candidates with at least
    COK_BEST_DEPARTURE_MIN_COVERAGE (80%) of route samples assessed are eligible; among them
    the lowest worst hazard class, then the lowest Caution+Warning share, then the earliest
    departure. `best` is null when no eligible candidate improves on the requested departure
    (`improves_on_requested` says so) -- never a recommendation on thin coverage.
    """
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Request body must be a JSON object")
    try:
        window_hours = float(payload.get("window_hours", 24))
        step_hours = float(payload.get("step_hours", 3))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="'window_hours' and 'step_hours' must be numbers")
    if not (0 < step_hours <= 24) or not (0 < window_hours <= 72):
        raise HTTPException(status_code=400, detail="'step_hours' must be in (0, 24] and 'window_hours' in (0, 72]")
    n_candidates = int(window_hours // step_hours) + 1
    if n_candidates > _COK_BEST_DEPARTURE_MAX_CANDIDATES:
        raise HTTPException(status_code=400, detail=f"too many candidate departures ({n_candidates} > {_COK_BEST_DEPARTURE_MAX_CANDIDATES}); increase step_hours")

    base_departure = _parse_utc(payload.get("departure_time"), "departure_time", status_code=400)
    base_payload = {k: v for k, v in payload.items() if k not in ("window_hours", "step_hours")}

    candidates = []
    for k in range(n_candidates):
        dep = base_departure + timedelta(hours=k * step_hours)
        result = cok_suitability_route({**base_payload, "departure_time": dep.strftime("%Y-%m-%dT%H:%M:%SZ")})
        summary = result["summary"]
        cov = result["coverage"]
        worst = summary["worst_hazard_class"]
        candidates.append({
            "departure_time": result["departure_time"],
            "offset_hours": round(k * step_hours, 3),
            "worst_hazard_class": worst,
            "caution_percent": summary["caution_percent"],
            "warning_percent": summary["warning_percent"],
            "coverage_ratio": cov["ratio"],
            "eligible": worst is not None and cov["ratio"] >= COK_BEST_DEPARTURE_MIN_COVERAGE,
        })

    eligible = [c for c in candidates if c["eligible"]]
    ranked = sorted(eligible, key=lambda c: (c["worst_hazard_class"], c["caution_percent"] + c["warning_percent"], c["offset_hours"]))
    requested = candidates[0]
    best = ranked[0] if ranked else None
    improves = bool(
        best is not None and best["offset_hours"] > 0 and (
            not requested["eligible"]
            or (best["worst_hazard_class"], best["caution_percent"] + best["warning_percent"])
            < (requested["worst_hazard_class"], requested["caution_percent"] + requested["warning_percent"])
        )
    )
    return {
        "vessel": payload.get("vessel"),
        "window_hours": window_hours,
        "step_hours": step_hours,
        "min_coverage": COK_BEST_DEPARTURE_MIN_COVERAGE,
        "requested": requested,
        "best": best if improves else None,
        "improves_on_requested": improves,
        "candidates": candidates,
        **_cok_suit_run_provenance(),
    }


# ---------------------------------------------------------------------------
# Cook Islands live suitability endpoints -- ports of the Niue
# suitability_point/area timeseries and best-comparison/best-contrast/summary
# endpoints above, reusing this section's cok_suit_state instead of loading
# or modeling anything new. The one real logic difference from a straight
# port: Niue's endpoints slice a precomputed per-face hazard_class array
# (state.overall/state.hazard), while the Cook Islands product carries only
# raw point wind/wave -- see CookSuitabilityState -- so every hazard value
# here is classified live via _cok_classify_suitability_arrays /
# _cok_classify_overall_suitability_arrays instead of being read off the
# dataset. The ranking/summary endpoints operate directly on the dataset's
# own source points (state.point_wind_kt/point_wave_m), which are already
# on-water survey points by construction, so unlike
# cok_suitability_point_timeseries/cok_suitability_area_timeseries (which
# take an arbitrary caller lon/lat) they need no land/off-mesh check.
# ---------------------------------------------------------------------------

def _cok_applied_bounds(requested_bounds: dict, state: CookSuitabilityState) -> dict:
    """Intersect requested bounds with the dataset's actual point domain --
    mirrors Niue's _applied_suit_bounds, kept separate since it's typed
    against CookSuitabilityState rather than NiueSuitabilityState."""
    west = max(requested_bounds["west"], state.lon_min)
    east = min(requested_bounds["east"], state.lon_max)
    south = max(requested_bounds["south"], state.lat_min)
    north = min(requested_bounds["north"], state.lat_max)
    if west > east or south > north:
        # Requested viewport doesn't overlap the model domain at all -- see
        # Niue's _applied_suit_bounds for why this collapses to a zero-area
        # point instead of reporting an inverted bbox.
        west = east = requested_bounds["west"]
        south = north = requested_bounds["south"]
    return {"west": west, "south": south, "east": east, "north": north}


def _cok_points_in_bounds(sds: xr.Dataset, bounds: dict) -> np.ndarray:
    """Point indices whose coordinate falls inside bounds (inclusive) --
    mirrors Niue's _faces_in_bounds for the Cook Islands point-based
    product (no face-polygon geometry here either, just point coordinates)."""
    lon = sds.lon.values
    lat = sds.lat.values
    mask = (
        (lon >= bounds["west"]) & (lon <= bounds["east"]) &
        (lat >= bounds["south"]) & (lat <= bounds["north"])
    )
    return np.flatnonzero(mask)


# Model-run provenance for every Cook Islands suitability response, so a client (e.g. a
# printed report) can state which forecast run its numbers came from and detect the
# forecast updating between two requests. run_id comes from the pipeline's summary
# JSON (YYYYMMDDHH, UTC); it is re-read only when that file changes.
COK_SUITABILITY_METHODOLOGY_VERSION = os.environ.get(
    "COK_SUITABILITY_METHODOLOGY_VERSION", "cok-suitability-live-v1"
)
_cok_run_provenance_cache: dict = {"sig": None, "value": None}


def _cok_suit_run_provenance() -> dict:
    """{"run_id", "model_run_time", "methodology_version"}. run_id/model_run_time are
    None (never guessed) if the summary JSON is missing or has no parseable run_id.
    Note: run_id is read from the summary JSON, not from the NetCDF/Zarr the state was
    loaded from, so during a publication they can briefly disagree."""
    base = {"methodology_version": COK_SUITABILITY_METHODOLOGY_VERSION}
    path = COK_SUITABILITY_DIR / "cok_suitability_summary.json"
    try:
        stat = path.stat()
    except OSError:
        return {"run_id": None, "model_run_time": None, **base}
    sig = (stat.st_mtime_ns, stat.st_size)
    cached = _cok_run_provenance_cache
    if cached["sig"] != sig:
        run_id = None
        model_run_time = None
        try:
            with open(path) as fh:
                raw = json.load(fh).get("run_id")
            run_id = str(raw) if raw is not None else None
            match = re.fullmatch(r"(\d{4})(\d{2})(\d{2})(\d{2})", run_id or "")
            if match:
                y, mo, d, h = (int(g) for g in match.groups())
                model_run_time = datetime(y, mo, d, h, tzinfo=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        except (OSError, ValueError, AttributeError):
            pass
        _cok_run_provenance_cache.update(sig=sig, value={"run_id": run_id, "model_run_time": model_run_time})
    return {**_cok_run_provenance_cache["value"], **base}


def _cok_suit_bounds_metadata(
    bounds: Optional[dict],
    applied_bounds: Optional[dict],
    eligible_point_count: int,
) -> dict:
    """Shared response-metadata block for the live COK ranking/summary
    endpoints below -- mirrors the shape of Niue's _suit_bounds_metadata, but
    without a classification-coverage figure: every COK source point is
    classified live from its own wind/wave value (no precomputed
    hazard_class that could carry per-point validity gaps), so there's no
    "eligible but unclassified" case to report."""
    return {
        "statistics_basis": "points_in_bounds" if bounds is not None else "full_domain",
        "requested_bounds": bounds,
        "applied_bounds": applied_bounds,
        "eligible_point_count": eligible_point_count,
        **_cok_suit_run_provenance(),
    }


@app.get("/cok/suitability/point/timeseries")
def cok_suitability_point_timeseries(
    lon: float = Query(..., description="Longitude"),
    lat: float = Query(..., description="Latitude"),
    vessel: str = Query("all", description="Vessel class name, integer index, or 'all'"),
):
    """
    Return live-classified suitability at the nearest source point to the
    requested point across ALL timesteps -- port of
    niue_suitability_point_timeseries. The nearest-point lookup is
    timestep-independent, so this does a single cKDTree query and slices
    the already-loaded full-time point_wind_kt/point_wave_m arrays, then
    classifies that slice against the vessel's thresholds.
    """
    state = require_cok_suit_state()
    sds = state.dataset
    vessel_idx = _cok_resolve_vessel_index(vessel, state.vessel_codes)

    cache_key = (state.signature, round(lon, 4), round(lat, 4), vessel)
    cached = cok_suitability_point_timeseries_cache.get(cache_key)
    if cached is not None:
        cok_suitability_point_timeseries_cache.move_to_end(cache_key)
        return cached

    dist_deg, point_idx = state.face_tree.query([[lon, lat]])
    point_idx = int(point_idx[0])
    dist_deg = float(dist_deg[0])

    point_lon = float(sds.lon.values[point_idx])
    point_lat = float(sds.lat.values[point_idx])
    # Same adaptive-distance + mesh-triangulation land/off-mesh check as the
    # raster/tile/route code (see _is_marine) -- tested at the *requested*
    # (lon, lat), not the nearest point's own coordinate, since that's the
    # point being classified.
    land_or_off_mesh = not bool(_is_marine(
        state.mesh_trifinder,
        dist_deg, float(state.face_spacing[point_idx]),
        lon, lat,
        COK_SUITABILITY_LAND_MASK_K, COK_SUITABILITY_LAND_MASK_ABSOLUTE_CAP_KM,
    ))
    times = [pd.Timestamp(t).isoformat() + "Z" for t in sds.time.values]

    if land_or_off_mesh:
        steps = [
            {
                "time_index": i,
                "valid_time": times[i],
                "hazard_class": None,
                "hazard_label": "Unavailable",
                "wind_speed_kt": None,
                "wave_height_m": None,
            }
            for i in range(len(times))
        ]
    else:
        wind_series = state.point_wind_kt[:, point_idx]
        wave_series = state.point_wave_m[:, point_idx]
        if vessel_idx is None:
            hazard_series = _cok_classify_overall_suitability_arrays(wind_series, wave_series, state)
        else:
            hazard_series = _cok_classify_suitability_arrays(wind_series, wave_series, vessel_idx, state)
        hazard_series = hazard_series.astype(int).tolist()
        wind_series = wind_series.astype(float).round(2).tolist()
        wave_series = wave_series.astype(float).round(2).tolist()

        steps = [
            {
                "time_index": i,
                "valid_time": times[i],
                "hazard_class": hazard_series[i],
                "hazard_label": HAZARD_LABELS.get(hazard_series[i], "Unknown"),
                "wind_speed_kt": wind_series[i],
                "wave_height_m": wave_series[i],
            }
            for i in range(len(times))
        ]

    result = {
        "lon_requested": lon,
        "lat_requested": lat,
        "vessel": suitability_vessel_name(vessel_idx, state.vessel_codes),
        "nearest_point_index": point_idx,
        "nearest_point_lon": point_lon,
        "nearest_point_lat": point_lat,
        "distance_deg": round(dist_deg, 6),
        "available": not land_or_off_mesh,
        "unavailable_reason": "nearest source point too far (land or off-mesh point)" if land_or_off_mesh else None,
        "land_or_off_mesh": land_or_off_mesh,
        "steps": steps,
    }

    cok_suitability_point_timeseries_cache[cache_key] = result
    cok_suitability_point_timeseries_cache.move_to_end(cache_key)
    while len(cok_suitability_point_timeseries_cache) > SUITABILITY_POINT_TS_CACHE_MAX_ITEMS:
        cok_suitability_point_timeseries_cache.popitem(last=False)

    return result


@app.get("/cok/suitability/area/timeseries")
def cok_suitability_area_timeseries(
    lon: float = Query(..., description="Longitude"),
    lat: float = Query(..., description="Latitude"),
    radius_m: float = Query(500.0, description="Aggregation radius in meters around the point"),
    vessel: str = Query("all", description="Vessel class name, integer index, or 'all'"),
):
    """
    Like /cok/suitability/point/timeseries, but aggregates every source
    point within radius_m of the requested point instead of reading only the
    single nearest one -- port of niue_suitability_area_timeseries.
    hazard_class is the worst case across the area (after live
    classification); wind/wave are the area mean.

    Falls back to the single nearest point (subject to the same land-mask
    check /cok/suitability/point/timeseries uses) when no point falls within
    the radius.
    """
    state = require_cok_suit_state()
    sds = state.dataset
    vessel_idx = _cok_resolve_vessel_index(vessel, state.vessel_codes)

    if radius_m <= 0:
        raise HTTPException(status_code=400, detail="'radius_m' must be > 0")

    cache_key = (state.signature, round(lon, 4), round(lat, 4), round(radius_m, 1), vessel)
    cached = cok_suitability_area_timeseries_cache.get(cache_key)
    if cached is not None:
        cok_suitability_area_timeseries_cache.move_to_end(cache_key)
        return cached

    # Elliptical degree-space membership test approximating a circular
    # radius_m test in metre-space -- same trick Niue's area/timeseries uses,
    # here adequate at Cook Islands' domain scale for aggregation radii on
    # the order of a landing area (hundreds of meters), well under the
    # ~1,500km span across which km_per_deg_lon itself varies.
    km_per_deg_lat = 111.32
    km_per_deg_lon = 111.32 * np.cos(np.deg2rad(lat))
    radius_km = radius_m / 1000.0
    lat_radius_deg = radius_km / km_per_deg_lat
    lon_radius_deg = radius_km / km_per_deg_lon if km_per_deg_lon > 1e-9 else lat_radius_deg

    point_lons = sds.lon.values
    point_lats = sds.lat.values
    dist_ratio = np.hypot((point_lons - lon) / lon_radius_deg, (point_lats - lat) / lat_radius_deg)
    point_indices = np.flatnonzero(dist_ratio <= 1.0)

    land_or_off_mesh = False
    used_nearest_point_fallback = False
    if len(point_indices) == 0:
        dist_deg, nearest_idx = state.face_tree.query([[lon, lat]])
        nearest_idx = int(nearest_idx[0])
        dist_deg = float(dist_deg[0])
        land_or_off_mesh = not bool(_is_marine(
            state.mesh_trifinder,
            dist_deg, float(state.face_spacing[nearest_idx]),
            lon, lat,
            COK_SUITABILITY_LAND_MASK_K, COK_SUITABILITY_LAND_MASK_ABSOLUTE_CAP_KM,
        ))
        point_indices = np.array([nearest_idx])
        used_nearest_point_fallback = True

    point_count = int(len(point_indices))
    times = [pd.Timestamp(t).isoformat() + "Z" for t in sds.time.values]

    if land_or_off_mesh:
        steps = [
            {
                "time_index": i,
                "valid_time": times[i],
                "hazard_class": None,
                "hazard_label": "Unavailable",
                "wind_speed_kt": None,
                "wave_height_m": None,
            }
            for i in range(len(times))
        ]
    else:
        wind_slice = state.point_wind_kt[:, point_indices]
        wave_slice = state.point_wave_m[:, point_indices]
        if vessel_idx is None:
            hazard_slice = _cok_classify_overall_suitability_arrays(wind_slice, wave_slice, state)
        else:
            hazard_slice = _cok_classify_suitability_arrays(wind_slice, wave_slice, vessel_idx, state)
        hazard_series = hazard_slice.max(axis=1).astype(int).tolist()
        wind_series = wind_slice.mean(axis=1).astype(float).round(2).tolist()
        wave_series = wave_slice.mean(axis=1).astype(float).round(2).tolist()

        steps = [
            {
                "time_index": i,
                "valid_time": times[i],
                "hazard_class": hazard_series[i],
                "hazard_label": HAZARD_LABELS.get(hazard_series[i], "Unknown"),
                "wind_speed_kt": wind_series[i],
                "wave_height_m": wave_series[i],
            }
            for i in range(len(times))
        ]

    result = {
        "lon_requested": lon,
        "lat_requested": lat,
        "radius_m": radius_m,
        "vessel": suitability_vessel_name(vessel_idx, state.vessel_codes),
        "point_count": point_count,
        "used_nearest_point_fallback": used_nearest_point_fallback,
        "available": not land_or_off_mesh,
        "unavailable_reason": "nearest source point too far (land or off-mesh point)" if land_or_off_mesh else None,
        "land_or_off_mesh": land_or_off_mesh,
        "steps_total": len(steps),
        "steps_available": sum(1 for s in steps if s["hazard_class"] is not None),
        **_cok_suit_run_provenance(),
        "steps": steps,
    }

    cok_suitability_area_timeseries_cache[cache_key] = result
    cok_suitability_area_timeseries_cache.move_to_end(cache_key)
    while len(cok_suitability_area_timeseries_cache) > SUITABILITY_POINT_TS_CACHE_MAX_ITEMS:
        cok_suitability_area_timeseries_cache.popitem(last=False)

    return result


@app.get("/cok/suitability/best-comparison-timestep")
def cok_suitability_best_comparison_timestep(
    vessel: str = Query("all", description="Vessel class name, integer index, or 'all'"),
    west: Optional[float] = Query(None, description="Bounding box west longitude; all of west/south/east/north are required together"),
    south: Optional[float] = Query(None, description="Bounding box south latitude"),
    east: Optional[float] = Query(None, description="Bounding box east longitude"),
    north: Optional[float] = Query(None, description="Bounding box north latitude"),
    start_time_index: Optional[int] = Query(None, description="Inclusive lower time index bound for the search window; defaults to the first timestep"),
    end_time_index: Optional[int] = Query(None, description="Inclusive upper time index bound for the search window; defaults to the last timestep"),
):
    """
    Return the timestep with the lowest warning/caution burden, live-classified
    from raw wind/wave -- port of niue_suitability_best_comparison_timestep.

    When west/south/east/north are provided, ranking is computed only over
    source points whose coordinate falls inside that box. Face/point
    membership is time-invariant, so a bbox with zero points inside it has
    zero points at every timestep -- that case returns time_index=null with
    an explicit eligible_point_count=0 instead of a ranking result.

    When start_time_index/end_time_index are provided, the search is
    restricted to that inclusive index range instead of the full forecast.
    """
    state = require_cok_suit_state()
    sds = state.dataset
    vessel_idx = _cok_resolve_vessel_index(vessel, state.vessel_codes)
    bounds = _parse_suit_bounds(west, south, east, north)
    start_idx, end_idx = _resolve_suit_time_range(sds, start_time_index, end_time_index)

    if bounds is None:
        applied_bounds = None
        point_indices = None
    else:
        applied_bounds = _cok_applied_bounds(bounds, state)
        point_indices = _cok_points_in_bounds(sds, applied_bounds)

    if point_indices is not None and len(point_indices) == 0:
        return {
            "time_index": None,
            "best_time_index": None,
            "valid_time": None,
            "valid_time_utc": None,
            "vessel": suitability_vessel_name(vessel_idx, state.vessel_codes),
            "ranking": None,
            **_cok_suit_bounds_metadata(bounds, applied_bounds, 0),
        }

    wind_window = state.point_wind_kt[start_idx:end_idx + 1]
    wave_window = state.point_wave_m[start_idx:end_idx + 1]
    if point_indices is not None:
        wind_window = wind_window[:, point_indices]
        wave_window = wave_window[:, point_indices]

    if vessel_idx is None:
        hazard_window = _cok_classify_overall_suitability_arrays(wind_window, wave_window, state)
    else:
        hazard_window = _cok_classify_suitability_arrays(wind_window, wave_window, vessel_idx, state)

    ranked = []
    for offset, idx in enumerate(range(start_idx, end_idx + 1)):
        counts = suitability_hazard_counts(hazard_window[offset])["counts"]
        ranked.append((counts["warning"], counts["caution"], -counts["suitable"], idx))

    best = min(ranked)
    best_index = int(best[3])
    eligible_point_count = int(len(point_indices)) if point_indices is not None else int(hazard_window.shape[1])

    return {
        "time_index": best_index,
        "best_time_index": best_index,
        "valid_time": suitability_valid_time_utc(sds, best_index),
        "valid_time_utc": suitability_valid_time_utc(sds, best_index),
        "vessel": suitability_vessel_name(vessel_idx, state.vessel_codes),
        "ranking": {
            "warning_count": int(best[0]),
            "caution_count": int(best[1]),
            "suitable_count": int(-best[2]),
        },
        **_cok_suit_bounds_metadata(bounds, applied_bounds, eligible_point_count),
    }


@app.get("/cok/suitability/best-contrast-timestep")
def cok_suitability_best_contrast_timestep(
    west: Optional[float] = Query(None, description="Bounding box west longitude; all of west/south/east/north are required together"),
    south: Optional[float] = Query(None, description="Bounding box south latitude"),
    east: Optional[float] = Query(None, description="Bounding box east longitude"),
    north: Optional[float] = Query(None, description="Bounding box north latitude"),
    start_time_index: Optional[int] = Query(None, description="Inclusive lower time index bound for the search window; defaults to the first timestep"),
    end_time_index: Optional[int] = Query(None, description="Inclusive upper time index bound for the search window; defaults to the last timestep"),
):
    """
    Return the timestep where vessel classes disagree most about suitability
    -- the timestep maximizing the spread in suitable_percent across vessel
    classes, live-classified from raw wind/wave. Port of
    niue_suitability_best_contrast_timestep; see that endpoint's docstring
    for why this is a separate metric from /best-comparison-timestep.

    When west/south/east/north are provided, per-vessel percentages are
    computed only over source points whose coordinate falls inside that box.
    A bbox with zero points inside it returns time_index=null rather than a
    ranking result.
    """
    state = require_cok_suit_state()
    sds = state.dataset
    bounds = _parse_suit_bounds(west, south, east, north)
    start_idx, end_idx = _resolve_suit_time_range(sds, start_time_index, end_time_index)

    if bounds is None:
        applied_bounds = None
        point_indices = None
    else:
        applied_bounds = _cok_applied_bounds(bounds, state)
        point_indices = _cok_points_in_bounds(sds, applied_bounds)

    if point_indices is not None and len(point_indices) == 0:
        return {
            "time_index": None,
            "best_time_index": None,
            "valid_time": None,
            "valid_time_utc": None,
            "contrast": None,
            **_cok_suit_bounds_metadata(bounds, applied_bounds, 0),
        }

    wind_window = state.point_wind_kt[start_idx:end_idx + 1]
    wave_window = state.point_wave_m[start_idx:end_idx + 1]
    if point_indices is not None:
        wind_window = wind_window[:, point_indices]
        wave_window = wave_window[:, point_indices]

    ranked = []
    for offset, idx in enumerate(range(start_idx, end_idx + 1)):
        suitable_percents = {}
        full_percents = {}
        for i, code in enumerate(state.vessel_codes):
            hazard = _cok_classify_suitability_arrays(wind_window[offset], wave_window[offset], i, state)
            pcts = suitability_hazard_counts(hazard)["percentages"]
            pct = pcts["suitable"]
            suitable_percents[code] = pct if pct is not None else 0.0
            full_percents[code] = pcts
        spread = max(suitable_percents.values()) - min(suitable_percents.values())
        ranked.append((-spread, idx, suitable_percents, full_percents))

    ranked.sort(key=lambda item: (item[0], item[1]))
    best_neg_spread, best_index, best_suitable_percents, best_full_percents = ranked[0]
    contrast_score = round(-best_neg_spread, 2)

    eligible_point_count = int(len(point_indices)) if point_indices is not None else int(wind_window.shape[1])
    most_suitable_vessel = max(best_suitable_percents, key=best_suitable_percents.get)
    least_suitable_vessel = min(best_suitable_percents, key=best_suitable_percents.get)

    return {
        "time_index": best_index,
        "best_time_index": best_index,
        "valid_time": suitability_valid_time_utc(sds, best_index),
        "valid_time_utc": suitability_valid_time_utc(sds, best_index),
        "contrast": {
            "suitable_percent_by_vessel": best_suitable_percents,
            "caution_percent_by_vessel": {c: p["caution"] for c, p in best_full_percents.items()},
            "warning_percent_by_vessel": {c: p["warning"] for c, p in best_full_percents.items()},
            "contrast_score": contrast_score,
            "most_suitable_vessel": most_suitable_vessel,
            "least_suitable_vessel": least_suitable_vessel,
        },
        **_cok_suit_bounds_metadata(bounds, applied_bounds, eligible_point_count),
    }


_cok_domain_boundary_cache: dict = {"sig": None, "value": None}


@app.get("/cok/suitability/domain-boundary")
def cok_suitability_domain_boundary():
    """
    GeoJSON of the wave model's domain boundary: the mesh triangulation's boundary edges (the
    outer edge of the modelled water plus the holes cut out for islands), as a MultiLineString
    of two-point segments. Derived from the same triangulation the land/off-mesh test uses, so it
    is exactly "where the model has values". Cached per suitability-state generation.

    503 when the mesh triangulation is not available (see _build_mesh_trifinder's fallback).
    """
    state = require_cok_suit_state()
    cached = _cok_domain_boundary_cache
    if cached["sig"] == state.signature and cached["value"] is not None:
        return cached["value"]
    triangulation = getattr(state.mesh_trifinder, "_triangulation", None)
    if triangulation is None:
        raise HTTPException(status_code=503, detail="Model mesh triangulation is not available, so the domain boundary cannot be derived")
    tri = np.asarray(triangulation.triangles)
    edges = np.sort(np.concatenate([tri[:, [0, 1]], tri[:, [1, 2]], tri[:, [2, 0]]]), axis=1)
    unique, counts = np.unique(edges, axis=0, return_counts=True)
    boundary = unique[counts == 1]
    lon, lat = np.asarray(triangulation.x), np.asarray(triangulation.y)
    segments = [
        [[round(float(lon[a]), 5), round(float(lat[a]), 5)], [round(float(lon[b]), 5), round(float(lat[b]), 5)]]
        for a, b in boundary
    ]
    value = {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "properties": {"kind": "model_domain_boundary", "segment_count": len(segments), "triangles": int(tri.shape[0])},
            "geometry": {"type": "MultiLineString", "coordinates": segments},
        }],
        **_cok_suit_run_provenance(),
    }
    cached.update(sig=state.signature, value=value)
    return value


@app.get("/cok/suitability/summary/timeseries")
def cok_suitability_summary_timeseries(
    vessel: str = Query("all_classes", description="'all_classes' for every vessel class, or a comma-separated list of vessel class names"),
    west: Optional[float] = Query(None, description="Bounding box west longitude; all of west/south/east/north are required together"),
    south: Optional[float] = Query(None, description="Bounding box south latitude"),
    east: Optional[float] = Query(None, description="Bounding box east longitude"),
    north: Optional[float] = Query(None, description="Bounding box north latitude"),
    start_time_index: Optional[int] = Query(None, description="Inclusive first time index; defaults to the first timestep"),
    end_time_index: Optional[int] = Query(None, description="Inclusive last time index (always included); defaults to the last timestep"),
    stride: int = Query(1, ge=1, le=240, description="Return every Nth time step (the last step is always included)"),
):
    """
    Per-vessel, per-timestep suitability percentages in ONE call -- the bulk form of
    /cok/suitability/summary/{time_index}, for outlook/trend charts and reports that would
    otherwise make (vessels x timesteps) requests. Same points-in-bounds methodology and
    provenance metadata as the single-step endpoint.

    Unlike the single-step endpoint, a point whose wind or wave value is not finite is NOT
    counted (it would otherwise classify as Suitable, since NaN never exceeds a threshold);
    percentages are shares of points with a valid wind AND wave value, and a step with no
    valid points reports null percentages, never zeros.

    Registered before /summary/{time_index} so 'timeseries' is not parsed as a time index.
    """
    state = require_cok_suit_state()
    sds = state.dataset
    bounds = _parse_suit_bounds(west, south, east, north)
    start_idx, end_idx = _resolve_suit_time_range(sds, start_time_index, end_time_index)

    if vessel.strip().lower() == "all_classes":
        vessel_indices = list(range(len(state.vessel_codes)))
    else:
        vessel_indices = []
        for name in (v.strip() for v in vessel.split(",") if v.strip()):
            idx = _cok_resolve_vessel_index(name, state.vessel_codes)
            if idx is None:
                raise HTTPException(status_code=400, detail="'vessel' entries must be vessel class names (use 'all_classes' for every class)")
            vessel_indices.append(idx)
        if not vessel_indices:
            raise HTTPException(status_code=400, detail="'vessel' must name at least one vessel class")

    if bounds is None:
        applied_bounds = None
        point_indices = None
    else:
        applied_bounds = _cok_applied_bounds(bounds, state)
        point_indices = _cok_points_in_bounds(sds, applied_bounds)

    time_indices = list(range(start_idx, end_idx + 1, stride))
    if time_indices[-1] != end_idx:
        time_indices.append(end_idx)

    wind = state.point_wind_kt[time_indices]
    wave = state.point_wave_m[time_indices]
    if point_indices is not None:
        wind = wind[:, point_indices]
        wave = wave[:, point_indices]
    eligible_point_count = int(wind.shape[1])
    valid = np.isfinite(wind) & np.isfinite(wave)
    total = valid.sum(axis=1)

    vessels_out = {}
    for vessel_idx in vessel_indices:
        hazard = _cok_classify_suitability_arrays(wind, wave, vessel_idx, state)
        counts = {label.lower(): (valid & (hazard == code)).sum(axis=1) for code, label in HAZARD_LABELS.items()}
        steps = []
        for row, t in enumerate(time_indices):
            n = int(total[row])
            steps.append({
                "time_index": int(t),
                "valid_time": suitability_valid_time_utc(sds, t),
                "classified_points": n,
                "counts": {k: int(v[row]) for k, v in counts.items()},
                "percentages": {k: (round(float(v[row]) / n * 100.0, 2) if n else None) for k, v in counts.items()},
            })
        vessels_out[state.vessel_codes[vessel_idx]] = steps

    return {
        "source": COK_SUITABILITY_NC_PATH,
        "hazard_labels": HAZARD_LABELS,
        "vessel_classes": [state.vessel_codes[i] for i in vessel_indices],
        "start_time_index": start_idx,
        "end_time_index": end_idx,
        "stride": stride,
        "total_points_in_domain": int(state.point_wind_kt.shape[1]),
        "total_points_in_scope": eligible_point_count,
        **_cok_suit_bounds_metadata(bounds, applied_bounds, eligible_point_count),
        "vessels": vessels_out,
    }


@app.get("/cok/suitability/summary/{time_index}")
def cok_suitability_live_summary(
    time_index: int,
    vessel: str = Query("all", description="Vessel class name, integer index, or 'all'"),
    west: Optional[float] = Query(None, description="Bounding box west longitude; all of west/south/east/north are required together"),
    south: Optional[float] = Query(None, description="Bounding box south latitude"),
    east: Optional[float] = Query(None, description="Bounding box east longitude"),
    north: Optional[float] = Query(None, description="Bounding box north latitude"),
):
    """
    Live advisory summary statistics for a Cook Islands suitability
    timestep, classified on the fly from wind/wave against vessel
    thresholds -- additive alongside the existing static, file-based
    /cok/suitability/summary above (that one stays: it's cheaper to serve
    off the forecast pipeline's precomputed JSON and may have other
    callers). This endpoint is distinguished by requiring {time_index} and
    matches the shape of /niue/suitability/summary/{time_index}.

    When west/south/east/north are provided, all statistics are recomputed
    over the source points whose coordinate falls inside that box instead of
    the full domain. A bbox with zero points inside it returns
    eligible_point_count=0 and null percentages rather than falling back to
    the full domain.
    """
    state = require_cok_suit_state()
    sds = state.dataset
    validate_suitability_time_index(sds, time_index)
    vessel_idx = _cok_resolve_vessel_index(vessel, state.vessel_codes)
    bounds = _parse_suit_bounds(west, south, east, north)

    wind_full = state.point_wind_kt[time_index]
    wave_full = state.point_wave_m[time_index]

    if bounds is None:
        applied_bounds = None
        point_indices = None
        wind_slice = wind_full
        wave_slice = wave_full
        eligible_point_count = int(wind_full.shape[0])
    else:
        applied_bounds = _cok_applied_bounds(bounds, state)
        point_indices = _cok_points_in_bounds(sds, applied_bounds)
        wind_slice = wind_full[point_indices]
        wave_slice = wave_full[point_indices]
        eligible_point_count = int(len(point_indices))

    if vessel_idx is None:
        hazard_slice = _cok_classify_overall_suitability_arrays(wind_slice, wave_slice, state)
    else:
        hazard_slice = _cok_classify_suitability_arrays(wind_slice, wave_slice, vessel_idx, state)

    summary = suitability_hazard_counts(hazard_slice)
    if bounds is not None and eligible_point_count == 0:
        # Explicit "unavailable", never a silent full-domain fallback.
        summary["percentages"] = {label.lower(): None for label in HAZARD_LABELS.values()}

    # Guard against a non-empty but entirely-NaN slice -- see
    # suitability_summary_payload for why nan must never reach json.dumps.
    if wind_slice.size and np.isfinite(wind_slice).any():
        wind_stats = {
            "min": round(float(np.nanmin(wind_slice)), 2),
            "mean": round(float(np.nanmean(wind_slice)), 2),
            "max": round(float(np.nanmax(wind_slice)), 2),
        }
    else:
        wind_stats = {"min": None, "mean": None, "max": None}

    if wave_slice.size and np.isfinite(wave_slice).any():
        wave_stats = {
            "min": round(float(np.nanmin(wave_slice)), 2),
            "mean": round(float(np.nanmean(wave_slice)), 2),
            "max": round(float(np.nanmax(wave_slice)), 2),
        }
    else:
        wave_stats = {"min": None, "mean": None, "max": None}

    payload = {
        "source": COK_SUITABILITY_NC_PATH,
        "time_index": int(time_index),
        "valid_time": suitability_valid_time_utc(sds, time_index),
        "valid_time_utc": suitability_valid_time_utc(sds, time_index),
        "vessel": suitability_vessel_name(vessel_idx, state.vessel_codes),
        "vessel_classes": list(state.vessel_codes),
        "hazard_labels": HAZARD_LABELS,
        "bounds": {
            "lon_min": state.lon_min,
            "lon_max": state.lon_max,
            "lat_min": state.lat_min,
            "lat_max": state.lat_max,
        },
        "wind_speed_kt": wind_stats,
        "wave_height_m": wave_stats,
        **_cok_suit_bounds_metadata(bounds, applied_bounds, eligible_point_count),
        # total_points (from `summary`, below) is the CLASSIFIED count. These make the three
        # different denominators explicit so a report can state coverage honestly.
        "total_points_in_domain": int(wind_full.shape[0]),
        "total_points_in_scope": eligible_point_count,
        "classified_points": int(summary["total_points"]),
        **summary,
    }

    return payload


# ---------------------------------------------------------------------------
# Cook Islands suitability map-image rendering -- Cook-Islands-specific
# counterpart to render_suitability_map_png/add_niue_cartography above,
# rather than a parameterized version of that whole-domain-with-a-fallback
# design. Niue is one ~10km island with a fixed center point
# (NIUE_LON/NIUE_LAT) to default a render to when no bounds are given; Cook
# Islands spans ~1,500km across ~10 separated islands, so there is no single
# sensible default viewport, and a "whole domain in one map" render would
# show illegible scattered dots rather than a useful chart. Every render
# here requires bounds (see _cok_resolve_map_bounds) -- niue_buffer_extent
# and apply_advisory_buffer_mask have no COK equivalent for the same reason.
#
# The hazard raster + wind/wave inputs are always classified live from
# state.raster_wind_kt/raster_wave_m (bilinear-sampled, per-cell land-masked
# via state.face_tree/_is_marine), the same technique cok_suitability_tile
# and cok_suitability_grid already use and for the same reason: the Cook
# Islands product's own precomputed raster_hazard_class/raster_overall_
# hazard_class is None whenever the legacy (non-precomputed) NetCDF path is
# in use, and even the precomputed product's classified raster is coarser
# than a live bilinear-then-classify pass (see cok_suitability_tile's
# docstring). The rendered stats-box text, however, is computed from the
# dataset's own source points (state.point_wind_kt/point_wave_m, filtered by
# _cok_points_in_bounds) rather than raster cells -- the same
# points-in-bounds methodology /cok/suitability/summary/{time_index} and the
# best-comparison/best-contrast endpoints use, so the numbers printed on a
# rendered map always agree with what those endpoints report for the same
# bounds, the way Niue's stats box reuses suitability_face_hazard/
# _faces_in_bounds (the same functions its own /summary endpoint uses)
# rather than counting raster pixels.
# ---------------------------------------------------------------------------

COK_ISLANDS: tuple[tuple[str, float, float], ...] = (
    # Southern group
    ("Rarotonga", -159.775, -21.237),
    ("Aitutaki", -159.782, -18.858),
    ("Atiu", -158.118, -19.977),
    ("Mangaia", -157.925, -21.921),
    ("Mauke", -157.345, -20.135),
    ("Mitiaro", -157.703, -19.855),
    ("Manuae", -159.000, -19.267),
    ("Takutea", -158.283, -19.833),
    ("Palmerston", -163.183, -18.050),
    # Northern group
    ("Pukapuka", -165.850, -10.883),
    ("Nassau", -165.400, -11.550),
    ("Suwarrow", -163.117, -13.233),
    ("Manihiki", -161.000, -10.400),
    ("Rakahanga", -161.100, -10.033),
    ("Penrhyn", -158.033, -9.017),
)
# One-time hardcoded content table rather than a per-point island-name field
# from the dataset -- the 460-point suitability product carries no such
# field (checked: its point-level variables are wind/wave/vessel-threshold
# data only, see CookSuitabilityState). No settlement-level detail in v1,
# unlike NIUE_SETTLEMENTS -- Cook Islands' ~15 named islands across
# ~1,500km make Niue's per-settlement label-offset hand-tuning impractical
# to replicate here; every island gets the same fixed label offset instead.

_cok_outline_cache: OrderedDict[tuple, list] = OrderedDict()
_COK_OUTLINE_CACHE_MAX_ITEMS = 64
# Discards contour rings smaller than this many raster cells' worth of area
# -- guards against tracing noise artifacts (single stray cells) as fake
# tiny "islands", the way _trace_niue_outline_from_raster's single-ring
# max(rings, key=_ring_area) selection implicitly does for Niue by only
# ever keeping the largest ring; Cook Islands needs every real island kept,
# just not every noise speck.
_COK_OUTLINE_MIN_RING_CELLS = 4.0
_COK_OUTLINE_MAX_RINGS = 25


def _trace_cok_land_outline(state: CookSuitabilityState, bounds: dict) -> list[tuple[np.ndarray, np.ndarray]]:
    """Trace every landmass within bounds from the suitability raster's
    land/no-data mask (state.raster_valid) -- mirrors
    _trace_niue_outline_from_raster's contourpy + periodic-spline-smoothing
    technique, but windowed on the caller's own bounds (there's no fixed
    NIUE_LON/NIUE_LAT to window a fixed +/-0.15/+/-0.2deg box around), and
    returning every ring found (largest first) rather than only the single
    largest -- a Cook Islands bounded crop can contain more than one
    landmass (e.g. Rarotonga + nearby atolls in one regional view), unlike
    Niue's single-island domain. Returns [] if no ring is found."""
    lon_win = (state.raster_lons >= bounds["west"]) & (state.raster_lons <= bounds["east"])
    lat_win = (state.raster_lats >= bounds["south"]) & (state.raster_lats <= bounds["north"])
    if not lon_win.any() or not lat_win.any():
        return []

    sub_lons = state.raster_lons[lon_win].astype(np.float64)
    sub_lats = state.raster_lats[lat_win].astype(np.float64)

    # Live per-cell marine check (mesh_trifinder-authoritative when
    # available), NOT the precomputed state.raster_valid -- see _is_marine's
    # own docstring: that field, as the pipeline ships it in the precomputed
    # product, marks large genuinely-marine patches of open ocean between
    # islands as invalid wherever the SWAN mesh happens to be sparse far
    # from any point, exactly the stale distance-cap failure mode
    # documented there. Confirmed directly: tracing raster_valid instead of
    # this live check painted enormous flower-shaped fake "islands" across
    # the open ocean between Rarotonga and Aitutaki at a multi-island
    # (regional) zoom. A fresh trifinder-based check has no such gap and
    # matches what render_cok_suitability_map_png already does for its own
    # hazard/no-data masking.
    sub_lon_grid, sub_lat_grid = np.meshgrid(sub_lons, sub_lats)
    sub_lon_flat = sub_lon_grid.ravel()
    sub_lat_flat = sub_lat_grid.ravel()
    sub_points = np.column_stack([sub_lon_flat, sub_lat_flat])
    sub_dist, sub_idx = state.face_tree.query(sub_points, workers=KDTREE_QUERY_WORKERS)
    sub_valid = _is_marine(
        state.mesh_trifinder,
        sub_dist, state.face_spacing[sub_idx],
        sub_lon_flat, sub_lat_flat,
        COK_SUITABILITY_LAND_MASK_K, COK_SUITABILITY_LAND_MASK_ABSOLUTE_CAP_KM,
    ).reshape(len(sub_lats), len(sub_lons))

    land_mask = (~sub_valid).astype(np.float64)
    gen = contourpy.contour_generator(x=sub_lons, y=sub_lats, z=land_mask)
    rings = [r for r in gen.lines(0.5) if len(r) >= 4]
    if not rings:
        return []

    min_area = _COK_OUTLINE_MIN_RING_CELLS * (COK_SUITABILITY_RASTER_STEP ** 2)
    rings = [r for r in rings if _ring_area(r) >= min_area]
    rings.sort(key=_ring_area, reverse=True)
    rings = rings[:_COK_OUTLINE_MAX_RINGS]

    outlines: list[tuple[np.ndarray, np.ndarray]] = []
    for ring in rings:
        x, y = ring[:, 0], ring[:, 1]
        if (x[0], y[0]) != (x[-1], y[-1]):
            x = np.append(x, x[0])
            y = np.append(y, y[0])
        try:
            tck, _ = splprep([x, y], per=True, s=0.0006, k=3)
            xs, ys = splev(np.linspace(0.0, 1.0, 240), tck)
            outlines.append((np.asarray(xs), np.asarray(ys)))
        except Exception:
            outlines.append((x, y))
    return outlines


def cok_land_outline(state: CookSuitabilityState, bounds: dict) -> list[tuple[np.ndarray, np.ndarray]]:
    """Cached wrapper around _trace_cok_land_outline. Keyed on
    (state.signature, rounded bounds) rather than state.signature alone
    (unlike Niue's niue_land_outline, which caches a single whole-domain
    outline) -- every Cook Islands render is bounds-scoped, so the input
    that actually determines the traced rings varies per request, not just
    per rebuild generation. Small bounded LRU rather than unbounded growth,
    same shape as the point/area-timeseries caches above."""
    cache_key = (
        state.signature,
        round(bounds["west"], 4), round(bounds["south"], 4),
        round(bounds["east"], 4), round(bounds["north"], 4),
    )
    cached = _cok_outline_cache.get(cache_key)
    if cached is not None:
        _cok_outline_cache.move_to_end(cache_key)
        return cached

    outlines = _trace_cok_land_outline(state, bounds)
    _cok_outline_cache[cache_key] = outlines
    _cok_outline_cache.move_to_end(cache_key)
    while len(_cok_outline_cache) > _COK_OUTLINE_CACHE_MAX_ITEMS:
        _cok_outline_cache.popitem(last=False)
    return outlines


def add_cok_cartography(
    ax,
    lon_min: float,
    lon_max: float,
    lat_min: float,
    lat_max: float,
    state: CookSuitabilityState,
    show_labels: bool = True,
) -> None:
    """Cook-Islands-side equivalent of add_niue_cartography: island fill/
    outline (from cok_land_outline) plus island-name labels only, no
    settlement-level detail in v1 (see COK_ISLANDS above). The island
    fill/outline is geographic context (doubles as the No Data
    visualization) so it always draws; show_labels only gates the name
    labels, same rationale as Niue's version -- illegible at reduced PDF
    embed sizes.

    A small marker dot is drawn at every in-view island's hardcoded
    centroid regardless of whether cok_land_outline actually found a
    coastline there, so a small atoll that's too coarse to trace at the
    current raster resolution still gets a visible anchor point for its
    label instead of a floating name with nothing to point at."""
    bounds = {"west": lon_min, "east": lon_max, "south": lat_min, "north": lat_max}
    for land_lon, land_lat in cok_land_outline(state, bounds):
        ax.fill(land_lon, land_lat, facecolor="#f4f1e8", edgecolor="#25323a", linewidth=1.0, zorder=7)
        ax.plot(land_lon, land_lat, color="white", linewidth=2.2, alpha=0.65, zorder=6)

    for name, lon, lat in COK_ISLANDS:
        if not (lon_min <= lon <= lon_max and lat_min <= lat <= lat_max):
            continue
        ax.scatter(
            [lon], [lat], s=12, marker="o",
            facecolor="#111827", edgecolor="white", linewidth=0.45, zorder=8,
        )
        if not show_labels:
            continue
        label = ax.text(
            lon + 0.012,
            lat + 0.008,
            name,
            fontsize=7.2,
            weight="bold",
            color="#111827",
            ha="left",
            va="center",
            zorder=9,
        )
        label.set_path_effects(MAP_TEXT_HALO)


def render_cok_suitability_map_png(
    vessel: str,
    time_index: int,
    bounds: dict,
    width: float,
    height: float,
    dpi: int,
    show_stats: bool = True,
    show_labels: bool = True,
    show_legend: bool = True,
) -> tuple[bytes, int]:
    """Cook-Islands-side counterpart to render_suitability_map_png. Always
    renders in cartography mode (island outlines, north arrow, scale bar) --
    unlike Niue's render_suitability_map_png, there's no non-cartography
    "map-image" branch here, since that branch's own axis-labeled/colorbar
    fallback view still needs *some* extent to render, and Cook Islands has
    no whole-domain or single-point default to fall back to either. bounds
    must already be domain-clamped (see _cok_resolve_map_bounds).

    Returns (png_bytes, classified_cells): classified_cells is the count of
    on-mesh, classified raster cells actually drawn (masked_hazard.count(),
    already computed below for the colour passes) -- callers expose it as a
    response header so a client can tell a genuinely empty render (0, e.g.
    bounds landing entirely on masked/off-mesh cells) apart from a normal
    PNG, without decoding pixels."""
    state = require_cok_suit_state()
    sds = state.dataset
    validate_suitability_time_index(sds, time_index)
    vessel_idx = _cok_resolve_vessel_index(vessel, state.vessel_codes)

    lon_min, lon_max = bounds["west"], bounds["east"]
    lat_min, lat_max = bounds["south"], bounds["north"]

    lon_idx = np.flatnonzero((state.raster_lons >= lon_min) & (state.raster_lons <= lon_max))
    lat_idx = np.flatnonzero((state.raster_lats >= lat_min) & (state.raster_lats <= lat_max))
    if len(lon_idx) == 0 or len(lat_idx) == 0:
        raise HTTPException(
            status_code=422,
            detail="requested bounds do not overlap the suitability raster domain",
        )
    # One extra cell of margin each side, same reasoning as
    # cok_suitability_tile's precomputed-raster crop: bilinear sampling and
    # the contour pass both need a neighbor cell just past the requested
    # edge to render cleanly to the exact boundary.
    lon_lo = max(0, int(lon_idx[0]) - 1)
    lon_hi = min(len(state.raster_lons), int(lon_idx[-1]) + 2)
    lat_lo = max(0, int(lat_idx[0]) - 1)
    lat_hi = min(len(state.raster_lats), int(lat_idx[-1]) + 2)

    crop_lons = state.raster_lons[lon_lo:lon_hi]
    crop_lats = state.raster_lats[lat_lo:lat_hi]
    wind = np.asarray(state.raster_wind_kt[time_index, lat_lo:lat_hi, lon_lo:lon_hi], dtype=np.float32)
    wave = np.asarray(state.raster_wave_m[time_index, lat_lo:lat_hi, lon_lo:lon_hi], dtype=np.float32)

    if vessel_idx is None:
        hazard = _cok_classify_overall_suitability_arrays(wind, wave, state)
    else:
        hazard = _cok_classify_suitability_arrays(wind, wave, vessel_idx, state)

    # Live per-cell land/off-mesh check against the actual mesh points,
    # rather than the precomputed state.raster_valid -- see
    # cok_suitability_grid/cok_suitability_tile for why the precomputed mask
    # (baked at COK_SUITABILITY_RASTER_STEP resolution) isn't reused here
    # either.
    crop_lon_grid, crop_lat_grid = np.meshgrid(crop_lons, crop_lats)
    crop_lon_flat = crop_lon_grid.ravel()
    crop_lat_flat = crop_lat_grid.ravel()
    crop_points = np.column_stack([crop_lon_flat, crop_lat_flat])
    crop_dist, crop_idx = state.face_tree.query(crop_points, workers=KDTREE_QUERY_WORKERS)
    valid = _is_marine(
        state.mesh_trifinder,
        crop_dist, state.face_spacing[crop_idx],
        crop_lon_flat, crop_lat_flat,
        COK_SUITABILITY_LAND_MASK_K, COK_SUITABILITY_LAND_MASK_ABSOLUTE_CAP_KM,
    ).reshape(crop_lat_grid.shape)

    hazard = np.where(valid, hazard, -1).astype(np.int8)
    masked_hazard = np.ma.masked_where(hazard < 0, hazard)
    masked_wind = np.ma.masked_where(hazard < 0, wind)
    extent = (float(crop_lons[0]), float(crop_lons[-1]), float(crop_lats[0]), float(crop_lats[-1]))

    fig, ax = plt.subplots(figsize=(width, height), dpi=dpi)
    fig.patch.set_facecolor("white")
    ax.set_facecolor("#dce9ee")
    fig.subplots_adjust(left=0, right=1, bottom=0, top=1)

    if masked_wind.count() > 0:
        wind_min = float(np.nanpercentile(masked_wind.compressed(), 10))
        wind_max = float(np.nanpercentile(masked_wind.compressed(), 95))
        if wind_max <= wind_min:
            wind_max = wind_min + 1.0
        ax.imshow(
            masked_wind, origin="lower", extent=extent, cmap="Greys",
            vmin=wind_min, vmax=wind_max, interpolation="bilinear", alpha=0.28, zorder=1,
        )

    no_data_mask = np.ma.masked_where(~np.ma.getmaskarray(masked_hazard), np.zeros(hazard.shape, dtype=np.float32))
    if no_data_mask.count() > 0:
        ax.imshow(
            no_data_mask, origin="lower", extent=extent,
            cmap=mcolors.ListedColormap([NO_DATA_COLOR_RGB]), interpolation="nearest", alpha=0.9, zorder=1.5,
        )

    for hazard_code in (0, 1, 2):
        class_mask = np.ma.masked_where(masked_hazard != hazard_code, masked_hazard)
        if class_mask.count() == 0:
            continue
        ax.imshow(
            class_mask, origin="lower", extent=extent,
            cmap=mcolors.ListedColormap([HAZARD_COLORS_RGB[hazard_code]]), interpolation="nearest",
            alpha=0.84, zorder=2 + hazard_code,
        )

    if masked_hazard.count() > 0:
        ax.contour(
            crop_lons, crop_lats, masked_hazard,
            levels=[0.5, 1.5], colors=["#f8fafc", "#263238"], linewidths=[1.25, 1.05], alpha=0.86, zorder=6,
        )

    ax.set_xlim(lon_min, lon_max)
    ax.set_ylim(lat_min, lat_max)

    add_cok_cartography(ax, lon_min, lon_max, lat_min, lat_max, state, show_labels=show_labels)
    if show_legend:
        add_north_arrow(ax, lon_min, lon_max, lat_min, lat_max)
        add_scale_bar(
            ax, lon_min, lon_max, lat_min, lat_max,
            length_km=pick_scale_bar_length_km(lon_min, lon_max, lat_min, lat_max),
        )

    ax.set_aspect("equal", adjustable="box")
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_xlabel("")
    ax.set_ylabel("")
    ax.grid(False)
    for spine in ax.spines.values():
        spine.set_visible(False)

    if show_stats:
        # Points-in-bounds + live classification, not a raster-pixel count
        # -- see this section's module docstring for why (keeps this number
        # identical to what /cok/suitability/summary/{time_index} reports
        # for the same bounds/vessel/time_index).
        point_indices = _cok_points_in_bounds(sds, bounds)
        if len(point_indices) == 0:
            text = "No data in requested bounds"
        else:
            wind_pts = state.point_wind_kt[time_index][point_indices]
            wave_pts = state.point_wave_m[time_index][point_indices]
            if vessel_idx is None:
                hazard_pts = _cok_classify_overall_suitability_arrays(wind_pts, wave_pts, state)
            else:
                hazard_pts = _cok_classify_suitability_arrays(wind_pts, wave_pts, vessel_idx, state)
            pts_summary = suitability_hazard_counts(hazard_pts)
            wind_pts_finite = wind_pts.size and np.isfinite(wind_pts).any()
            if pts_summary["total_points"] == 0 or not wind_pts_finite:
                text = "No data in requested bounds"
            else:
                text = (
                    f"Warning {pts_summary['percentages']['warning']:.1f}% | "
                    f"Caution {pts_summary['percentages']['caution']:.1f}% | "
                    f"Wind max {float(np.nanmax(wind_pts)):.1f} kt"
                )
        ax.text(
            0.012, 0.985, text, transform=ax.transAxes, va="top", ha="left", fontsize=8,
            color="#111827", bbox=dict(facecolor="white", edgecolor="#cbd5e1", boxstyle="round,pad=0.28", alpha=0.88),
            zorder=11,
        )

    buffer = BytesIO()
    fig.savefig(buffer, format="png", dpi=dpi, bbox_inches="tight", pad_inches=0)
    plt.close(fig)
    return buffer.getvalue(), int(masked_hazard.count())


def _cok_resolve_map_bounds(
    west: Optional[float],
    south: Optional[float],
    east: Optional[float],
    north: Optional[float],
    state: CookSuitabilityState,
) -> dict:
    """Shared bounds-required + minimum-viewport-size guard for all three
    COK map-image endpoints below. Unlike Niue's operational-map (bounds
    optional, falls back to niue_buffer_extent's fixed 100km-around-Niue
    default), every COK map render requires bounds -- see this section's
    module docstring for why there's nothing to fall back to."""
    bounds = _parse_suit_bounds(west, south, east, north)
    if bounds is None:
        raise HTTPException(
            status_code=422,
            detail="'west', 'south', 'east', and 'north' are required for this endpoint",
        )
    applied_bounds = _cok_applied_bounds(bounds, state)
    # See Niue's operational-map for the pathological-canvas-size reasoning:
    # a near-zero viewport next to unclipped cartography content can blow
    # bbox_inches="tight" up to a multi-billion-pixel PNG.
    MIN_SUIT_MAP_VIEWPORT_DEG = 0.02
    if (
        applied_bounds["east"] - applied_bounds["west"] < MIN_SUIT_MAP_VIEWPORT_DEG
        or applied_bounds["north"] - applied_bounds["south"] < MIN_SUIT_MAP_VIEWPORT_DEG
    ):
        raise HTTPException(
            status_code=422,
            detail="requested bounds do not overlap a renderable area of the suitability domain",
        )
    return applied_bounds


@app.get("/cok/suitability/map-image/{vessel}/{time_index}")
def cok_suitability_map_image(
    vessel: str,
    time_index: int,
    west: Optional[float] = Query(None, description="Bounding box west longitude; west/south/east/north are all required"),
    south: Optional[float] = Query(None, description="Bounding box south latitude"),
    east: Optional[float] = Query(None, description="Bounding box east longitude"),
    north: Optional[float] = Query(None, description="Bounding box north latitude"),
):
    """
    Static PNG map render for a Cook Islands vessel suitability timestep,
    scoped to a caller-supplied bounding box -- port of
    niue_suitability_map_image. See this section's module docstring for why
    bounds are required here (Cook Islands has no whole-domain default the
    way Niue does).
    """
    state = require_cok_suit_state()
    applied_bounds = _cok_resolve_map_bounds(west, south, east, north, state)
    png_bytes, classified_cells = render_cok_suitability_map_png(
        vessel=vessel, time_index=time_index, bounds=applied_bounds,
        width=7.0, height=6.0, dpi=150,
    )
    return png_bytes_response(png_bytes, headers={
        "Cache-Control": "public, max-age=300",
        "X-Classified-Cells": str(classified_cells),
    })


@app.get("/cok/suitability/presentation-map/{vessel}/{time_index}")
def cok_suitability_presentation_map(
    vessel: str,
    time_index: int,
    west: Optional[float] = Query(None, description="Bounding box west longitude; west/south/east/north are all required"),
    south: Optional[float] = Query(None, description="Bounding box south latitude"),
    east: Optional[float] = Query(None, description="Bounding box east longitude"),
    north: Optional[float] = Query(None, description="Bounding box north latitude"),
):
    """Larger/higher-dpi variant of cok_suitability_map_image for print/
    presentation use -- port of niue_suitability_presentation_map."""
    state = require_cok_suit_state()
    applied_bounds = _cok_resolve_map_bounds(west, south, east, north, state)
    png_bytes, classified_cells = render_cok_suitability_map_png(
        vessel=vessel, time_index=time_index, bounds=applied_bounds,
        width=10.0, height=7.0, dpi=160,
    )
    return png_bytes_response(png_bytes, headers={
        "Cache-Control": "public, max-age=300",
        "X-Classified-Cells": str(classified_cells),
    })


@app.get("/cok/suitability/operational-map/{vessel}/{time_index}")
def cok_suitability_operational_map(
    vessel: str,
    time_index: int,
    west: Optional[float] = Query(None, description="Bounding box west longitude; west/south/east/north are all required"),
    south: Optional[float] = Query(None, description="Bounding box south latitude"),
    east: Optional[float] = Query(None, description="Bounding box east longitude"),
    north: Optional[float] = Query(None, description="Bounding box north latitude"),
    show_stats: bool = Query(True, description="Set false to suppress the diagnostic stats overlay (for PDF capture)"),
    show_labels: bool = Query(True, description="Set false to suppress island-name labels (for PDF capture)"),
    show_legend: bool = Query(True, description="Set false to suppress the north arrow and scale bar (for PDF capture)"),
):
    """Fully parameterized map render for embedding in the advisory PDF /
    operational tooling -- port of niue_suitability_operational_map. Unlike
    Niue's version, bounds aren't optional here (no view_radius_km/whole-
    domain fallback either -- see this section's module docstring)."""
    state = require_cok_suit_state()
    applied_bounds = _cok_resolve_map_bounds(west, south, east, north, state)
    png_bytes, classified_cells = render_cok_suitability_map_png(
        vessel=vessel, time_index=time_index, bounds=applied_bounds,
        width=8.5, height=7.0, dpi=160,
        show_stats=show_stats, show_labels=show_labels, show_legend=show_legend,
    )
    headers = {
        "Cache-Control": "public, max-age=300",
        "X-Statistics-Basis": "points_in_bounds",
        "X-Applied-Bounds": (
            f"west={applied_bounds['west']},south={applied_bounds['south']},"
            f"east={applied_bounds['east']},north={applied_bounds['north']}"
        ),
        # A report client (Widget 5's PDF export) treats 0 here as "nothing was
        # actually drawn" and blocks export rather than embedding a blank map --
        # see render_cok_suitability_map_png's docstring.
        "X-Classified-Cells": str(classified_cells),
    }
    return png_bytes_response(png_bytes, headers=headers)


# Niue sea-level components endpoints
# Source: sea_level_components_latest.nc (tide + IB + SLA, native units: cm)
# Time axis is run-dependent; decoded via netCDF4.num2date — do not assume
# a fixed epoch.
# ===========================================================================

_SL_COMPONENT_LABELS = {
    "tide": "Astronomical tide",
    "IB":   "Inverse barometer",
    "SLA":  "Sea-level anomaly",
}
_SL_SOURCE_LABEL = "SPC sea-level forecast"
_SL_REQUIRED_VARS = ("time", "tide", "IB", "SLA")

_sl_signature: Optional[tuple[int, int, int]] = None
_sl_valid_times: Optional[list[str]] = None
_sl_valid_datetimes: Optional[list] = None  # list[datetime], UTC-aware, parallel to _sl_valid_times
_sl_tide_cm: Optional[np.ndarray] = None
_sl_ib_cm:   Optional[np.ndarray] = None
_sl_sla_cm:  Optional[np.ndarray] = None
_sl_time_units: Optional[str] = None
_sl_calendar:   Optional[str] = None
# Guards the read-check-reassign sequence in _load_sea_level: the file is
# refreshed in place by the operational pipeline, and FastAPI runs sync
# endpoints in a threadpool, so without a lock two concurrent requests can
# interleave global reassignment and leave mismatched array lengths.
_sl_cache_lock = threading.Lock()


def _sl_nc_signature() -> Optional[tuple[int, int, int]]:
    try:
        stat = Path(NIU_SEA_LEVEL_NC_PATH).stat()
        return (stat.st_ino, stat.st_mtime_ns, stat.st_size)
    except FileNotFoundError:
        return None


def _parse_utc(value: str, param_name: str, status_code: int = 422) -> datetime:
    """Parse an ISO 8601 datetime string into a UTC-normalized, timezone-aware
    datetime. Raises `status_code` on bad input.

    An offset-aware input (e.g. "...+13:00") is converted to UTC rather than
    merely accepted with its original offset intact -- callers (route ETA
    math, forecast-timestep comparisons) assume the returned datetime's wall-
    clock fields are already in UTC, which a non-UTC offset would violate."""
    if not isinstance(value, str):
        raise HTTPException(
            status_code=status_code,
            detail=f"'{param_name}' must be an ISO 8601 datetime string, got {value!r}",
        )
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(
            status_code=status_code,
            detail=f"Invalid ISO 8601 datetime for '{param_name}': {value!r}",
        )
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _load_sea_level() -> bool:
    global _sl_signature, _sl_valid_times, _sl_valid_datetimes
    global _sl_tide_cm, _sl_ib_cm, _sl_sla_cm
    global _sl_time_units, _sl_calendar

    def _clear():
        global _sl_signature, _sl_valid_times, _sl_valid_datetimes
        global _sl_tide_cm, _sl_ib_cm, _sl_sla_cm, _sl_time_units, _sl_calendar
        _sl_signature = _sl_valid_times = _sl_valid_datetimes = None
        _sl_tide_cm = _sl_ib_cm = _sl_sla_cm = None
        _sl_time_units = _sl_calendar = None

    with _sl_cache_lock:
        current_sig = _sl_nc_signature()
        if current_sig is None:
            _clear()
            return False

        if _sl_valid_times is not None and _sl_signature == current_sig:
            return True

        try:
            nc = netCDF4.Dataset(NIU_SEA_LEVEL_NC_PATH)
        except (FileNotFoundError, OSError):
            _clear()
            return False

        try:
            missing = [v for v in _SL_REQUIRED_VARS if v not in nc.variables]
            if missing:
                raise ValueError(f"sea_level_components.nc is missing required variables: {missing}")

            t_var    = nc.variables["time"]
            units    = t_var.units
            calendar = getattr(t_var, "calendar", "standard")
            datetimes = netCDF4.num2date(t_var[:], units=units, calendar=calendar)
            valid_times = [dt.strftime("%Y-%m-%dT%H:%M:%SZ") for dt in datetimes]
            valid_datetimes = [
                datetime.fromisoformat(vt.replace("Z", "+00:00")) for vt in valid_times
            ]
            tide_cm = np.array(nc.variables["tide"][:], dtype=np.float32)
            ib_cm   = np.array(nc.variables["IB"][:],   dtype=np.float32)
            sla_cm  = np.array(nc.variables["SLA"][:],  dtype=np.float32)

            lengths = {"time": len(valid_times), "tide": len(tide_cm), "IB": len(ib_cm), "SLA": len(sla_cm)}
            if len(set(lengths.values())) > 1:
                raise ValueError(f"sea_level_components.nc has mismatched variable lengths: {lengths}")
        except (ValueError, KeyError, AttributeError, OSError) as exc:
            _clear()
            raise HTTPException(status_code=503, detail=f"sea_level_components.nc is unreadable: {exc}")
        finally:
            nc.close()

        if len(valid_times) == 0:
            _clear()
            raise HTTPException(status_code=503, detail="sea_level_components.nc has no time steps")

        # Enforce chronological order regardless of how the source file wrote
        # its time axis, since the timeseries endpoint's contract guarantees
        # chronologically ordered output.
        order = np.argsort(valid_datetimes)
        valid_times = [valid_times[i] for i in order]
        valid_datetimes = [valid_datetimes[i] for i in order]
        tide_cm = tide_cm[order]
        ib_cm = ib_cm[order]
        sla_cm = sla_cm[order]

        _sl_signature       = current_sig
        _sl_valid_times     = valid_times
        _sl_valid_datetimes = valid_datetimes
        _sl_tide_cm         = tide_cm
        _sl_ib_cm           = ib_cm
        _sl_sla_cm          = sla_cm
        _sl_time_units      = units
        _sl_calendar        = calendar
        return True


def _require_sea_level() -> None:
    if not _load_sea_level():
        raise HTTPException(
            status_code=503,
            detail=f"Sea-level components file not found or unavailable: {NIU_SEA_LEVEL_NC_PATH}",
        )


@app.get("/niue/sea-level/metadata")
def niue_sea_level_metadata():
    _require_sea_level()
    last_modified_utc = None
    file_size_bytes   = None
    if _sl_signature is not None:
        mtime_ns, size = _sl_signature[1], _sl_signature[2]
        last_modified_utc = datetime.fromtimestamp(mtime_ns / 1e9, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        file_size_bytes   = int(size)
    return {
        "available": True,
        "source": _SL_SOURCE_LABEL,
        "file": str(Path(NIU_SEA_LEVEL_NC_PATH).name),
        "last_modified_utc": last_modified_utc,
        "file_size_bytes": file_size_bytes,
        "units": "m",
        "native_units": "cm",
        "components": ["tide", "IB", "SLA"],
        "component_labels": _SL_COMPONENT_LABELS,
        "total_sea_level_formula": "tide + IB + SLA",
        "time_units": str(_sl_time_units),
        "calendar": str(_sl_calendar),
        "steps": int(len(_sl_valid_times)),
        "time_start": str(_sl_valid_times[0]),
        "time_end": str(_sl_valid_times[-1]),
    }


@app.get("/niue/sea-level/timeseries")
def niue_sea_level_timeseries(
    start_time: Optional[str] = Query(None, description="ISO 8601 UTC lower bound (inclusive), e.g. 2026-06-13T00:00:00Z"),
    end_time:   Optional[str] = Query(None, description="ISO 8601 UTC upper bound (inclusive), e.g. 2026-06-22T12:00:00Z"),
):
    """
    Domain-wide Niue sea-level series (no lon/lat — tide/IB/SLA are not
    spatially varying across the mesh at the resolution this product ships).
    _load_sea_level() guarantees chronological order and inclusive
    start_time/end_time clipping is applied here.
    """
    _require_sea_level()

    dt_start = _parse_utc(start_time, "start_time") if start_time is not None else None
    dt_end   = _parse_utc(end_time,   "end_time")   if end_time   is not None else None

    indices = range(len(_sl_valid_datetimes))
    if dt_start is not None:
        indices = [i for i in indices if _sl_valid_datetimes[i] >= dt_start]
    if dt_end is not None:
        indices = [i for i in indices if _sl_valid_datetimes[i] <= dt_end]

    timesteps = []
    for i in indices:
        tide_m = round(float(_sl_tide_cm[i]) / 100.0, 4)
        ib_m   = round(float(_sl_ib_cm[i])   / 100.0, 4)
        sla_m  = round(float(_sl_sla_cm[i])  / 100.0, 4)
        timesteps.append({
            "valid_time_utc": _sl_valid_times[i],
            "tide_m": tide_m,
            "total_sea_level_m": round(float((_sl_tide_cm[i] + _sl_ib_cm[i] + _sl_sla_cm[i]) / 100.0), 4),
            "inverse_barometer_m": ib_m,
            "sla_m": sla_m,
        })

    return {
        "timesteps": timesteps,
        "source": _SL_SOURCE_LABEL,
        "units": "m",
        # The full product's time coverage (not clipped to start_time/end_time),
        # taken directly from the loaded series — omitted fields like a model
        # run time aren't included since the source file carries no run-time
        # attribute to report honestly.
        "forecast_start_utc": _sl_valid_times[0],
        "forecast_end_utc": _sl_valid_times[-1],
        "file": str(Path(NIU_SEA_LEVEL_NC_PATH).name),
        "native_units": "cm",
        "components": ["tide", "IB", "SLA"],
        "component_labels": _SL_COMPONENT_LABELS,
        "total_sea_level_formula": "tide + IB + SLA",
        "count": len(timesteps),
    }


@app.get("/niue/sea-level/summary/{time_index}")
def niue_sea_level_summary(time_index: int):
    _require_sea_level()

    n = len(_sl_valid_times)
    if time_index < 0 or time_index >= n:
        raise HTTPException(
            status_code=400,
            detail=f"time_index {time_index} out of range 0–{n - 1}",
        )

    tide_m = round(float(_sl_tide_cm[time_index]) / 100.0, 4)
    ib_m   = round(float(_sl_ib_cm[time_index])   / 100.0, 4)
    sla_m  = round(float(_sl_sla_cm[time_index])  / 100.0, 4)

    return {
        "source": _SL_SOURCE_LABEL,
        "file": str(Path(NIU_SEA_LEVEL_NC_PATH).name),
        "time_index": int(time_index),
        "valid_time_utc": _sl_valid_times[time_index],
        "units": "m",
        "native_units": "cm",
        "components": ["tide", "IB", "SLA"],
        "component_labels": _SL_COMPONENT_LABELS,
        "total_sea_level_formula": "tide + IB + SLA",
        "tide_m": tide_m,
        "ib_m":   ib_m,
        "sla_m":  sla_m,
        "total_sea_level_m": round(float((_sl_tide_cm[time_index] + _sl_ib_cm[time_index] + _sl_sla_cm[time_index]) / 100.0), 4),
    }


# ── WMS GetCapabilities proxy ──────────────────────────────────────────────────
# Fetches and parses WMS Capabilities server-side so the client never downloads
# the raw ~300 KB XML or runs DOMParser on the main thread.

_wms_caps_cache: dict[str, tuple[float, str]] = {}   # url -> (fetched_at, xml_text)
_WMS_CAPS_TTL = 3600.0  # seconds
# Unbounded growth guard: an attacker varying wms_url/layer on every request
# could otherwise grow this dict forever, since entries are only ever added,
# never proactively swept (an expired entry is simply overwritten on its next
# fetch, not removed).
_WMS_CAPS_CACHE_MAX_ITEMS = int(os.environ.get("WMS_CAPS_CACHE_MAX_ITEMS", "128"))

_WMS_NS = {
    "wms": "http://www.opengis.net/wms",
    "wms111": "http://www.opengis.net/wms",
}

# wms_url is caller-supplied and fetched server-side -- without a host
# allowlist and a check that it doesn't resolve to a private/loopback/
# link-local address, this endpoint is a classic SSRF: a caller could make
# this API's own network position probe or reach internal services it
# otherwise couldn't reach directly. Empty by default (matching this
# service's no-auth-anywhere-else posture) but should be set in any
# deployment that exposes this endpoint publicly.
WMS_ALLOWED_HOSTS = tuple(
    host.strip().lower()
    for host in os.environ.get("WMS_ALLOWED_HOSTS", "").split(",")
    if host.strip()
)
# Cap the response body read, not just the cached copy -- without this a
# malicious or misbehaving WMS endpoint could stream an unbounded response
# and exhaust worker memory before urlopen's own read() ever returns.
WMS_MAX_RESPONSE_BYTES = int(os.environ.get("WMS_MAX_RESPONSE_BYTES", str(5 * 1024 * 1024)))


def _validate_wms_url(url: str) -> None:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="'wms_url' must be an http or https URL")
    if not parsed.hostname:
        raise HTTPException(status_code=400, detail="'wms_url' must include a hostname")

    if WMS_ALLOWED_HOSTS and parsed.hostname.lower() not in WMS_ALLOWED_HOSTS:
        raise HTTPException(
            status_code=400,
            detail=f"'wms_url' host '{parsed.hostname}' is not an allowed WMS host",
        )

    try:
        addr_infos = socket.getaddrinfo(parsed.hostname, None)
    except OSError as exc:
        raise HTTPException(status_code=400, detail=f"Could not resolve WMS host: {exc}")

    for _family, _type, _proto, _canonname, sockaddr in addr_infos:
        ip = ipaddress.ip_address(sockaddr[0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise HTTPException(
                status_code=400,
                detail=f"'wms_url' host resolves to a disallowed address ({ip})",
            )


def _fetch_caps_xml(caps_url: str) -> str:
    now = datetime.now(timezone.utc).timestamp()
    cached = _wms_caps_cache.get(caps_url)
    if cached and (now - cached[0]) < _WMS_CAPS_TTL:
        return cached[1]

    _validate_wms_url(caps_url)

    req = urllib.request.Request(caps_url, headers={"User-Agent": "zarr-api/1.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        raw = resp.read(WMS_MAX_RESPONSE_BYTES + 1)
    if len(raw) > WMS_MAX_RESPONSE_BYTES:
        raise HTTPException(
            status_code=502,
            detail=f"WMS Capabilities response exceeds {WMS_MAX_RESPONSE_BYTES} bytes",
        )
    xml_text = raw.decode("utf-8", errors="replace")

    if len(_wms_caps_cache) >= _WMS_CAPS_CACHE_MAX_ITEMS and caps_url not in _wms_caps_cache:
        oldest_key = min(_wms_caps_cache, key=lambda key: _wms_caps_cache[key][0])
        _wms_caps_cache.pop(oldest_key, None)

    _wms_caps_cache[caps_url] = (now, xml_text)
    return xml_text

def _extract_time_string(xml_text: str, layer_name: str) -> str | None:
    root = ET.fromstring(xml_text)
    # Walk every Layer element regardless of namespace
    for layer_el in root.iter():
        if not layer_el.tag.endswith("}Layer") and layer_el.tag != "Layer":
            continue
        # Use 'is not None' — ET leaf elements are falsy so 'or' would give wrong results
        name_el = layer_el.find("{http://www.opengis.net/wms}Name")
        if name_el is None:
            name_el = layer_el.find("Name")
        if name_el is None or (name_el.text or "").strip() != layer_name:
            continue
        # Found the layer — look for Dimension or Extent with name="time"
        for tag in ("{http://www.opengis.net/wms}Dimension", "Dimension",
                    "{http://www.opengis.net/wms}Extent",   "Extent"):
            for dim in layer_el.findall(tag):
                attr = (dim.get("name") or dim.get("Name") or "").lower()
                if attr == "time":
                    return (dim.text or "").strip() or None
    return None


@app.get("/niue/wms/time-dimension")
def wms_time_dimension(
    wms_url: str = Query(..., description="Base WMS URL (without query params)"),
    layer:   str = Query(..., description="Layer name to extract time dimension for"),
):
    caps_url = wms_url.rstrip("?&")
    sep = "&" if "?" in caps_url else "?"
    caps_url += f"{sep}SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0"
    try:
        xml_text = _fetch_caps_xml(caps_url)
    except HTTPException:
        # _validate_wms_url's own 400s (bad scheme, disallowed host,
        # unresolvable/private address) should reach the caller as-is,
        # not get relabeled as a 502 "fetch failed".
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch WMS Capabilities: {exc}")
    try:
        time_string = _extract_time_string(xml_text, layer)
    except ET.ParseError as exc:
        raise HTTPException(status_code=502, detail=f"Invalid WMS Capabilities XML: {exc}")
    if time_string is None:
        raise HTTPException(status_code=404, detail=f"No time dimension found for layer '{layer}'")
    return {"layer": layer, "time_string": time_string}


risk_thresholds_lock = threading.Lock()
# Cross-process counterpart (see cross_process_lock()): risk_thresholds_lock
# only coordinates threads within one uvicorn worker process, but this file
# is shared across every worker process. Without a cross-process lock too,
# two workers' PUT requests can interleave their read-modify-write cycles --
# both read the same starting dict, both write their own updated copy, and
# the second os.replace() silently clobbers the first worker's update.
RISK_THRESHOLDS_CROSS_PROCESS_LOCK_PATH = RISK_THRESHOLDS_PATH.parent / ".risk-thresholds.lock"


def _load_risk_thresholds() -> dict:
    if not RISK_THRESHOLDS_PATH.exists():
        return {}
    with open(RISK_THRESHOLDS_PATH, "r") as f:
        return json.load(f)


def _save_risk_thresholds(data: dict) -> None:
    # Write to a per-pid temp file and rename so a crash mid-write can't
    # corrupt the store, and so two processes never observe each other's
    # partially written temp file even outside the cross-process lock window
    # (readers always see either the old or the new complete file).
    tmp_path = RISK_THRESHOLDS_PATH.with_suffix(f".tmp.{os.getpid()}")
    with open(tmp_path, "w") as f:
        json.dump(data, f, indent=2, sort_keys=True)
    os.replace(tmp_path, RISK_THRESHOLDS_PATH)


@app.get("/risk/thresholds")
def get_risk_thresholds():
    """
    Bulk read of all per-point Coastal Risk (TWL) threshold overrides, so the
    frontend can merge them into its points listing in one round trip instead
    of one request per point.
    """
    with risk_thresholds_lock:
        return _load_risk_thresholds()


@app.put("/risk/thresholds/{point_id}")
def put_risk_threshold(point_id: str, payload: dict = Body(...)):
    """
    Create or replace the risk threshold override for a single point.
    No auth is required, matching every other endpoint in this file (there is
    no auth of any kind anywhere in this API yet) — revisit if this store
    starts holding anything more sensitive than display thresholds.
    """
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Request body must be a JSON object")

    minor_raw = payload.get("minor")
    moderate_raw = payload.get("moderate")
    try:
        minor = float(minor_raw)
        moderate = float(moderate_raw)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="'minor' and 'moderate' must be numbers")

    if not (math.isfinite(minor) and math.isfinite(moderate)):
        raise HTTPException(status_code=400, detail="'minor' and 'moderate' must be finite numbers")
    if not minor < moderate:
        raise HTTPException(status_code=400, detail="'minor' must be less than 'moderate'")

    with risk_thresholds_lock:
        with cross_process_lock(RISK_THRESHOLDS_CROSS_PROCESS_LOCK_PATH):
            data = _load_risk_thresholds()
            data[point_id] = {"minor": minor, "moderate": moderate}
            _save_risk_thresholds(data)

    return {"point_id": point_id, "minor": minor, "moderate": moderate}
