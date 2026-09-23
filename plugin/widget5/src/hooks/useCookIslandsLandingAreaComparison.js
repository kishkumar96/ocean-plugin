import { useEffect, useState } from 'react';
import {
  fetchCookIslandsSuitabilityAreaTimeseries,
  fetchCookIslandsSuitabilityPointTimeseries,
  isCookIslandsAreaTimeseriesUnavailable,
} from '../lib/CookIslandsSuitabilityOverlay';
import { mapWithConcurrency } from '../utils/concurrency';

// Same concurrency-cap + delay discipline as Phase 1's scenario runs (see
// utils/concurrency.js's header comment on why a pause between requests,
// not just a concurrency ceiling, matters against a volume-based edge block).
const FETCH_CONCURRENCY = 3;
const FETCH_DELAY_MS = 120;

// Same noise-entry exclusion CookIslandsSuitabilityOverlay.js's map rendering
// already applies to the advice GeoJSON -- kept in sync rather than filtered
// twice with two different lists that could drift.
const EXCLUDED_LOCATION_NAMES = new Set(['ngatangiia harbour']);

// Discovers the named landing/fishing-ground sites from the suitability
// advice layer's own GeoJSON (the same source the map's advisory markers and
// getAdvisoryGroup() already use), rather than a separate hardcoded preset
// list -- unlike widget1's LANDING_AREA_PRESETS, which is explicitly marked
// "PLACEHOLDER DATA -- unverified" because Niue never got stakeholder-
// confirmed coordinates. Cook Islands' advice locations come from the real
// data pipeline, so there is no equivalent placeholder-list problem here.
async function discoverLandingAreaSites(timeIndex, vessel) {
  const resp = await fetch(`/cok/suitability/advice/${timeIndex}`);
  if (!resp.ok) throw new Error(`/cok/suitability/advice/${timeIndex} ${resp.status}`);
  const geojson = await resp.json();
  const byName = new Map();
  for (const feature of geojson?.features ?? []) {
    const props = feature?.properties ?? {};
    const name = props.name?.trim();
    if (!name || EXCLUDED_LOCATION_NAMES.has(name.toLowerCase())) continue;
    // The advice dump repeats each location once per vessel class -- keep
    // one entry per name (prefer the row matching the currently selected
    // vessel, so a per-site radiusKm/type override specific to that vessel,
    // if the pipeline ever adds one, is the one carried forward).
    if (byName.has(name) && props.vessel_class !== vessel) continue;
    const [lon, lat] = feature.geometry?.coordinates ?? [];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    byName.set(name, { id: props.id ?? name, name, label: name, lon, lat, type: props.type ?? null });
  }
  return Array.from(byName.values());
}

// Fetches suitability-over-time for every named landing/fishing-ground site
// at once (not just one), for the "compare all sites" heatmap. `enabled`
// gates the fetch so it only runs once a user actually opens the comparison
// view -- this hits the backend once per site, so it shouldn't fire
// automatically in the background.
export function useCookIslandsLandingAreaComparison(vessel, enabled) {
  const [state, setState] = useState({ loading: false, error: null, rows: [] });

  useEffect(() => {
    if (!enabled || !vessel) return undefined;

    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    (async () => {
      let sites;
      try {
        sites = await discoverLandingAreaSites(0, vessel);
      } catch (err) {
        if (cancelled) return;
        setState({ loading: false, error: `Could not load landing-area sites: ${err.message}`, rows: [] });
        return;
      }
      if (cancelled) return;
      if (sites.length === 0) {
        setState({ loading: false, error: 'No named landing or fishing-ground sites in this deployment.', rows: [] });
        return;
      }

      const rows = await mapWithConcurrency(sites, FETCH_CONCURRENCY, async (site) => {
        const radiusKm = 0.5;
        try {
          if (isCookIslandsAreaTimeseriesUnavailable()) {
            const fallback = await fetchCookIslandsSuitabilityPointTimeseries(site.lon, site.lat, vessel);
            return {
              ...site, radiusKm,
              statistics_basis: 'nearest_point_fallback',
              fallback_reason: '500 m area endpoint is not available in this deployment.',
              steps: fallback?.steps ?? [],
            };
          }
          const series = await fetchCookIslandsSuitabilityAreaTimeseries(site.lon, site.lat, vessel, radiusKm);
          return {
            ...site,
            radiusKm: series?.radius_km ?? radiusKm,
            statistics_basis: series?.statistics_basis ?? 'area_500m',
            point_count: series?.point_count,
            used_nearest_point_fallback: series?.used_nearest_point_fallback,
            available: series?.available,
            unavailable_reason: series?.unavailable_reason,
            steps: series?.steps ?? [],
          };
        } catch (err) {
          if (err.status === 404) {
            try {
              const fallback = await fetchCookIslandsSuitabilityPointTimeseries(site.lon, site.lat, vessel);
              return {
                ...site, radiusKm,
                statistics_basis: 'nearest_point_fallback',
                fallback_reason: '500 m area endpoint is not available in this deployment.',
                steps: fallback?.steps ?? [],
              };
            } catch (fallbackErr) {
              console.warn(`Landing-area comparison: fallback timeseries unavailable for ${site.name}:`, fallbackErr.message);
            }
          }
          // One site's failure (e.g. out of model domain) shouldn't blank
          // the whole comparison -- report it as an empty row, not a thrown
          // error that aborts every other site's fetch.
          console.warn(`Landing-area comparison: timeseries unavailable for ${site.name}:`, err.message);
          return { ...site, steps: [] };
        }
      }, FETCH_DELAY_MS);

      if (cancelled) return;
      const withData = rows.filter((row) => row.steps.length);
      setState({
        loading: false,
        error: withData.length ? null : 'No suitability timeseries returned for any landing area.',
        rows: withData,
      });
    })();

    return () => { cancelled = true; };
  }, [vessel, enabled]);

  return state;
}
