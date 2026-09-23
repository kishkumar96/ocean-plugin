import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, RadioTower, TriangleAlert } from 'lucide-react';
import './CookIslandsSuitabilityReadinessCard.css';

// Ported from widget1's SuitabilityReadinessCard.jsx. One structural
// difference: widget1 fetches an absolute `${apiBase}/niue/...` URL (it
// talks to ocean-zarr.spc.int cross-origin); this app's whole suitability
// surface is same-origin relative fetches (`/cok/...`, proxied server-side
// in both dev and production -- see setupProxy.js / nginx/sites/widget5.conf),
// so there's no apiBase prop here at all.
//
// Avatiu Harbour, Rarotonga -- the same reference coordinate already used
// elsewhere in this app (cookIslandsRouteForecastService.test.js's
// haversineNm test), not a newly invented probe point.
const PROBE_POINT = { lon: -159.7833, lat: -21.2039 };

function statusMeta(status) {
  if (status === 'ready') return { label: 'Ready', icon: CheckCircle2, className: 'is-ready' };
  if (status === 'checking') return { label: 'Checking', icon: Clock3, className: 'is-checking' };
  if (status === 'fallback') return { label: 'Fallback', icon: TriangleAlert, className: 'is-fallback' };
  return { label: 'Unavailable', icon: TriangleAlert, className: 'is-down' };
}

export default function CookIslandsSuitabilityReadinessCard({ selectedVessel, forecastTimeLabel }) {
  const [areaStatus, setAreaStatus] = useState({ status: 'checking', detail: '' });

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      lon: String(PROBE_POINT.lon),
      lat: String(PROBE_POINT.lat),
      radius_m: '500',
      vessel: selectedVessel || 'traditional_craft',
    });
    const url = `/cok/suitability/area/timeseries?${params}`;
    setAreaStatus({ status: 'checking', detail: 'Checking the 500 m area endpoint.' });

    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (response.ok) {
          const body = await response.json().catch(() => null);
          const pointCount = Number(body?.point_count);
          const suffix = Number.isFinite(pointCount) ? ` ${pointCount} source point${pointCount === 1 ? '' : 's'} sampled at Avatiu Harbour.` : '';
          setAreaStatus({
            status: body?.used_nearest_point_fallback ? 'fallback' : 'ready',
            detail: body?.used_nearest_point_fallback
              ? `Endpoint exists, but the probe site used nearest-point fallback.${suffix}`
              : `500 m area endpoint is responding.${suffix}`,
          });
          return;
        }
        if (response.status === 404) {
          setAreaStatus({
            status: 'fallback',
            detail: '500 m area endpoint is not deployed on this backend yet; landing-area tools cannot run.',
          });
          return;
        }
        setAreaStatus({
          status: 'down',
          detail: `500 m area endpoint returned HTTP ${response.status}.`,
        });
      })
      .catch((error) => {
        if (error.name === 'AbortError') return;
        setAreaStatus({
          status: 'down',
          detail: '500 m area endpoint could not be checked from this browser.',
        });
      });

    return () => controller.abort();
  }, [selectedVessel]);

  const areaMeta = statusMeta(areaStatus.status);
  const AreaIcon = areaMeta.icon;
  const productionReady = areaStatus.status === 'ready';
  const readinessText = useMemo(() => (
    productionReady
      ? 'Landing-area and point workflows can be used with clear analytical basis labels.'
      : 'Landing-area analytics are not yet available on this deployment -- do not treat them as production evidence.'
  ), [productionReady]);

  return (
    <div className={`cok-suitability-readiness ${productionReady ? 'cok-suitability-readiness--ready' : 'cok-suitability-readiness--caution'}`}>
      <div className="cok-suitability-readiness__header">
        <div>
          <div className="cok-suitability-readiness__eyebrow">Operational readiness</div>
          <div className="cok-suitability-readiness__title">
            <RadioTower size={15} />
            Suitability setup
          </div>
        </div>
        <span className={`cok-suitability-readiness__badge ${areaMeta.className}`}>
          <AreaIcon size={13} />
          {areaMeta.label}
        </span>
      </div>

      <div className="cok-suitability-readiness__grid">
        <div>
          <span>Forecast time</span>
          <strong>{forecastTimeLabel || 'Selected timestep'}</strong>
        </div>
        <div>
          <span>500 m landing areas</span>
          <strong>{areaStatus.status === 'ready' ? 'Area endpoint' : areaStatus.status === 'fallback' ? 'Fallback labelled' : 'Needs check'}</strong>
        </div>
      </div>

      <div className="cok-suitability-readiness__detail">{areaStatus.detail}</div>
      <div className="cok-suitability-readiness__note">{readinessText}</div>
    </div>
  );
}
