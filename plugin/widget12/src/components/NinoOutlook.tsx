"use client";

import { useEffect, useId, useState } from "react";
import { withBasePath } from "@/lib/basePath";
import { STORIES } from "@/story/chapters";
import { ENSO_INDICES } from "@/story/ensoIndices";
import {
  ENSO_CATEGORY,
  EnsoDial,
  loadIndex,
  OUTLOOK_CATEGORY,
  OutlookDial,
  type EnsoData,
} from "./EnsoGauge";
import gauge from "./EnsoGauge.module.css";
import styles from "./NinoOutlook.module.css";

// Relative Niño3.4 outlook card, shown beside the seasonal SST outlook layer:
// the last observed months (public/ocean.json), the BOM ACCESS-S2 monthly
// forecast and the NOAA CPC RONI outlook, from /api/nino34-outlook.

type Outlook = {
  bom: {
    run: string;
    months: {
      month: string;
      mean: number;
      above: number;
      neutral: number;
      below: number;
    }[];
  } | null;
  roni: {
    issued: string | null;
    seasons: {
      season: string;
      month: string;
      p5: number;
      p25: number;
      p50: number;
      p75: number;
      p95: number;
    }[];
  } | null;
};

/**
 * The ENSO Outlook chapter's dial and the notes under it (story.json),
 * repeated on top of the card.
 */
const OUTLOOK_CHAPTER = STORIES.flatMap((s) => s.chapters).find(
  (c) => c.id === "outlook-status",
);
const OUTLOOK_GAUGE = OUTLOOK_CHAPTER?.gauge;
const OUTLOOK_NOTES = OUTLOOK_CHAPTER?.notes ?? [];

/** Months of observations shown before the forecast. */
const OBSERVED_MONTHS = 6;
const THRESHOLD = 0.8; // °C, El Niño / La Niña

// Bars by state: observed solid, forecast a lighter tint with a hatch.
const COLORS = {
  elNino: { observed: "#b3343c", forecast: "#d98a8f" },
  laNina: { observed: "#1f5fa8", forecast: "#8fb0dc" },
  neutral: { observed: "#a3a3a3", forecast: "#d1d5db" },
};
const stateOf = (v: number) =>
  v >= THRESHOLD ? "elNino" : v <= -THRESHOLD ? "laNina" : "neutral";

const monthIndex = (ym: string) =>
  Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
const monthKey = (i: number) =>
  `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
const MONTH = new Intl.DateTimeFormat("en", {
  month: "short",
  timeZone: "UTC",
});
const LONG_MONTH_YEAR = new Intl.DateTimeFormat("en", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const DAY_MONTH_YEAR = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const dateOf = (i: number) => new Date(Date.UTC(Math.floor(i / 12), i % 12, 1));
const signed = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`;

let outlookCache: Promise<Outlook> | null = null;
/** Load (once) the BOM + NOAA outlook from /api/nino34-outlook. */
export const loadOutlook = () =>
  (outlookCache ??= fetch(withBasePath("/api/nino34-outlook")).then((r) => {
    if (!r.ok) throw new Error(`nino34 outlook: ${r.status}`);
    return r.json();
  }));

/** BOM forecast period, e.g. "October 2026 to March 2027" (null if none). */
export function outlookPeriod(outlook: Outlook | null | undefined) {
  const months = outlook?.bom?.months ?? [];
  if (!months.length) return null;
  const label = (m: string) => LONG_MONTH_YEAR.format(dateOf(monthIndex(m)));
  return `${label(months[0].month)} to ${label(months[months.length - 1].month)}`;
}

export default function NinoOutlook() {
  const [outlook, setOutlook] = useState<Outlook | null>();
  const [observed, setObserved] = useState<EnsoData | null>();
  const [open, setOpen] = useState(true);

  useEffect(() => {
    loadOutlook()
      .then(setOutlook)
      .catch(() => setOutlook(null));
    const ocean = ENSO_INDICES.find((ix) => ix.id === "nino34");
    (ocean ? loadIndex(ocean.url) : Promise.reject(new Error("no Niño3.4")))
      .then(setObserved)
      .catch(() => setObserved(null));
  }, []);

  const loading = outlook === undefined || observed === undefined;
  const range = outlookPeriod(outlook) ?? "Relative Niño3.4";

  return (
    <aside className={gauge.card} aria-label="ENSO outlook">
      <div className={gauge.header}>
        <button
          className={gauge.headerToggle}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <span className={gauge.logo} role="img" aria-label="COSPPaC" />
          <span className={gauge.headerText}>
            <span className={gauge.title}>ENSO outlook</span>
            <span className={gauge.month}>{range}</span>
          </span>
        </button>
        <button
          className={`${gauge.chevron} ${open ? gauge.chevronOpen : ""}`}
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Collapse ENSO outlook" : "Expand ENSO outlook"}
          aria-expanded={open}
        >
          ›
        </button>
      </div>

      {open && OUTLOOK_GAUGE && (
        <section className={gauge.combined}>
          {OUTLOOK_GAUGE.scale === "outlook" ? (
            <>
              <div className={`${gauge.combinedDial} ${styles.wideDial}`}>
                <OutlookDial category={OUTLOOK_GAUGE.category} />
              </div>
              <p
                className={gauge.state}
                style={{
                  color: OUTLOOK_CATEGORY[OUTLOOK_GAUGE.category].color,
                }}
              >
                {OUTLOOK_GAUGE.label ??
                  OUTLOOK_CATEGORY[OUTLOOK_GAUGE.category].label}
              </p>
            </>
          ) : (
            <>
              <div className={gauge.combinedDial}>
                <EnsoDial category={OUTLOOK_GAUGE.category} />
              </div>
              <p
                className={gauge.state}
                style={{ color: ENSO_CATEGORY[OUTLOOK_GAUGE.category].ink }}
              >
                {OUTLOOK_GAUGE.label ??
                  ENSO_CATEGORY[OUTLOOK_GAUGE.category].label}
              </p>
            </>
          )}
          {OUTLOOK_NOTES.map((n) => (
            <p key={n} className={styles.note}>
              {n}
            </p>
          ))}
        </section>
      )}

      {open &&
        (loading ? (
          <p className={gauge.muted}>Loading outlook…</p>
        ) : !outlook && !observed ? (
          <p className={gauge.muted}>Couldn&apos;t load the outlook</p>
        ) : (
          <>
            <OutlookChart
              outlook={outlook ?? null}
              observed={observed ?? null}
            />
            <ul className={styles.legend}>
              <li>
                <span
                  className={styles.swatch}
                  style={{ background: COLORS.elNino.observed }}
                />
                Observed (BOM)
              </li>
              <li>
                <span
                  className={`${styles.swatch} ${styles.swatchHatch}`}
                  style={{ backgroundColor: COLORS.elNino.forecast }}
                />
                ACCESS-S2 forecast (% of members)
              </li>
              <li>
                <span className={styles.diamond} />
                NOAA RONI: median, 50% and 90% range
              </li>
            </ul>
            <p className={styles.caption}>
              {[
                outlook?.bom &&
                  `BOM ACCESS-S2 run ${DAY_MONTH_YEAR.format(new Date(outlook.bom.run))}`,
                outlook?.roni?.issued && `NOAA CPC RONI ${outlook.roni.issued}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </>
        ))}
    </aside>
  );
}

/**
 * Bars for the observed months then the forecast months (labelled with the
 * mean and the share of members in its state), with the RONI outlook drawn
 * over each season's centre month, ±0.8 °C lines and an observed/forecast split.
 */
function OutlookChart({
  outlook,
  observed,
}: {
  outlook: Outlook | null;
  observed: EnsoData | null;
}) {
  const hatchId = `hatch${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const forecast = outlook?.bom?.months ?? [];
  const seasons = outlook?.roni?.seasons ?? [];

  // Observed value for a month, if any (entries may be numbers or objects).
  const observedAt = (i: number) => {
    const e = observed?.months[monthKey(i)];
    const v = typeof e === "number" ? e : e?.value;
    return typeof v === "number" ? v : undefined;
  };

  // The forecast starts at its first month; without one, after the latest
  // observation.
  const latestObserved = observed
    ? Math.max(...Object.keys(observed.months).map(monthIndex))
    : null;
  const firstForecast = forecast.length
    ? monthIndex(forecast[0].month)
    : (latestObserved ?? 0) + 1;
  const start = firstForecast - OBSERVED_MONTHS;
  const end = firstForecast + Math.max(forecast.length, 6) - 1;
  const n = end - start + 1;

  // Value range: everything drawn, plus room for the labels above the bars.
  const values = [
    ...Array.from({ length: n }, (_, k) => observedAt(start + k)),
    ...forecast.map((f) => f.mean),
    ...seasons.flatMap((s) => [s.p5, s.p95]),
  ].filter((v): v is number => v !== undefined);
  const lo = Math.floor(Math.min(-1.2, ...values) - 0.2);
  const hi = Math.ceil(Math.max(2, ...values) + 0.6);

  // Layout (SVG units ≈ pixels at the card's width).
  const W = 428;
  const H = 250;
  const left = 26;
  const right = 6;
  const top = 26;
  const bottom = 30;
  const slot = (W - left - right) / n;
  const x = (i: number) => left + (i - start) * slot; // left edge of month i
  const y = (v: number) => top + ((hi - v) / (hi - lo)) * (H - top - bottom);
  const barW = slot * 0.62;

  const ticks = [];
  for (let v = lo; v <= hi; v++) ticks.push(v);

  const bars = [];
  for (let i = start; i <= end; i++) {
    const f = forecast.find((m) => monthIndex(m.month) === i);
    const v = i < firstForecast ? observedAt(i) : f?.mean;
    if (v === undefined) continue;
    const state = stateOf(v);
    const isForecast = i >= firstForecast;
    const bx = x(i) + (slot - barW) / 2;
    const top0 = Math.min(y(v), y(0));
    const h = Math.max(Math.abs(y(v) - y(0)), 1);
    const share = f
      ? state === "elNino"
        ? f.above
        : state === "laNina"
          ? f.below
          : f.neutral
      : undefined;
    // Labels sit beyond the bar's end: above positive bars, below negative.
    const labelY = v >= 0 ? y(v) - 4 : y(v) + 10;
    bars.push(
      <g key={i}>
        <rect
          x={bx}
          y={top0}
          width={barW}
          height={h}
          fill={COLORS[state][isForecast ? "forecast" : "observed"]}
          stroke={isForecast ? "#6b7280" : "none"}
          strokeWidth={0.6}
        />
        {isForecast && (
          <rect
            x={bx}
            y={top0}
            width={barW}
            height={h}
            fill={`url(#${hatchId})`}
          />
        )}
        <text x={bx + barW / 2} y={labelY} className={styles.value}>
          {signed(v)}
        </text>
        {isForecast && share !== undefined && Number.isFinite(share) && (
          <text
            x={bx + barW / 2}
            y={v >= 0 ? labelY - 10 : labelY + 10}
            className={styles.share}
          >
            {Math.round(share)}%
          </text>
        )}
      </g>,
    );
  }

  // RONI markers, on the right of each season's centre month.
  const markers = seasons
    .filter((s) => monthIndex(s.month) >= start && monthIndex(s.month) <= end)
    .map((s) => {
      const mx = x(monthIndex(s.month)) + slot * 0.78;
      const d = 4;
      return (
        <g key={s.season} className={styles.roni}>
          <line x1={mx} x2={mx} y1={y(s.p5)} y2={y(s.p95)} strokeWidth={1.2} />
          <rect
            x={mx - 2.5}
            y={y(s.p75)}
            width={5}
            height={Math.max(y(s.p25) - y(s.p75), 1)}
          />
          <polygon
            points={`${mx},${y(s.p50) - d} ${mx + d},${y(s.p50)} ${mx},${y(s.p50) + d} ${mx - d},${y(s.p50)}`}
            className={styles.median}
          />
          <text x={mx} y={y(s.p5) + 9} className={styles.season}>
            {s.season}
          </text>
        </g>
      );
    });

  const split = x(firstForecast);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={styles.chart}
      role="img"
      aria-label="Relative Niño3.4: observed months, BOM ACCESS-S2 forecast and NOAA RONI outlook"
    >
      <defs>
        <pattern
          id={hatchId}
          width={5}
          height={5}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1={0} y1={0} x2={0} y2={5} className={styles.hatchLine} />
        </pattern>
      </defs>

      {ticks.map((v) => (
        <g key={v}>
          <line
            x1={left}
            x2={W - right}
            y1={y(v)}
            y2={y(v)}
            className={v === 0 ? styles.zero : styles.grid}
          />
          <text x={left - 4} y={y(v) + 3} className={styles.tick}>
            {v}
          </text>
        </g>
      ))}

      {/* ±0.8 °C thresholds */}
      <line
        x1={left}
        x2={W - right}
        y1={y(THRESHOLD)}
        y2={y(THRESHOLD)}
        className={styles.threshold}
      />
      <line
        x1={left}
        x2={W - right}
        y1={y(-THRESHOLD)}
        y2={y(-THRESHOLD)}
        className={styles.threshold}
      />
      <text
        x={W - right - 2}
        y={y(THRESHOLD) - 3}
        className={styles.thresholdLabel}
        fill={COLORS.elNino.observed}
      >
        El Niño
      </text>
      <text
        x={W - right - 2}
        y={y(-THRESHOLD) + 10}
        className={styles.thresholdLabel}
        fill={COLORS.laNina.observed}
      >
        La Niña
      </text>

      {bars}
      {markers}

      {/* Observed | forecast split */}
      <line
        x1={split}
        x2={split}
        y1={12}
        y2={H - bottom}
        className={styles.split}
      />
      <text x={split - 5} y={10} className={styles.splitLabel} textAnchor="end">
        ← Observed
      </text>
      <text
        x={split + 5}
        y={10}
        className={styles.splitLabel}
        textAnchor="start"
      >
        Forecast →
      </text>

      {/* Month and year under each bar (year on January and the first month). */}
      {Array.from({ length: n }, (_, k) => start + k).map((i) => (
        <g key={i}>
          <text
            x={x(i) + slot / 2}
            y={H - bottom + 12}
            className={styles.monthLabel}
          >
            {MONTH.format(dateOf(i))}
          </text>
          {(i === start || i % 12 === 0) && (
            <text
              x={x(i) + slot / 2}
              y={H - bottom + 23}
              className={styles.yearLabel}
            >
              {Math.floor(i / 12)}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
