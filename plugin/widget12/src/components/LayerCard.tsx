"use client";

import { useEffect, useRef, useState } from "react";
import { nearestTime, seasonLabel, type TimeStep } from "@/lib/time";
import styles from "./LayerCard.module.css";

/** Time between frames while playing. */
const PLAY_INTERVAL_MS = 500;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

type Props = {
  title: string;
  visible: boolean;
  onVisibleChange?: (visible: boolean) => void;
  step: TimeStep;
  times: string[];
  time: string | null;
  onTimeChange: (time: string) => void;
  legendUrl?: string | null;
  /** step "custom": label for each timestep, in order (e.g. "4 weeks"). */
  stepLabels?: string[];
  /** Extra legend keys drawn as short coloured lines (e.g. contours). */
  legendItems?: { label: string; color: string }[];
  /** Checkboxes for optional overlays (e.g. species zones), with line swatches. */
  toggles?: {
    title: string;
    items: {
      id: string;
      label: string;
      color: string;
      checked: boolean;
      /** Shown greyed out and can't be ticked. */
      disabled?: boolean;
    }[];
    onChange: (id: string, on: boolean) => void;
  };
  /** Shown in place of the time controls, e.g. while loading or on error. */
  status?: { text: string; error?: boolean } | null;
  /** Data is loading; shows a small spinner without shifting the layout. */
  busy?: boolean;
  /**
   * The map is showing `time` (its data has loaded and been drawn). Playback
   * waits for this before moving on, so the label never runs ahead of the map.
   */
  frameReady?: boolean;
  /** Play through time automatically; switching it off stops playback. */
  autoplay?: boolean;
  /** Where playback loops back to after the last timestep (default: the first). */
  loopStart?: string | null;
};

/** Workbench card for one layer: on/off, collapse, time picker and legend. */
export default function LayerCard({
  title,
  visible,
  onVisibleChange,
  step,
  times,
  time,
  onTimeChange,
  legendUrl,
  stepLabels,
  legendItems,
  toggles,
  status,
  busy = false,
  frameReady = true,
  autoplay = false,
  loopStart,
}: Props) {
  const [expanded, setExpanded] = useState(visible);

  // Expand with the layer on, collapse with it off.
  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    setExpanded(visible);
  }

  return (
    <section className={styles.card}>
      <div className={styles.titleRow}>
        <label className={styles.titleLabel}>
          <input
            type="checkbox"
            // Stop Firefox restoring a previous page's state over React's.
            autoComplete="off"
            checked={visible}
            onChange={(e) => onVisibleChange?.(e.target.checked)}
          />
          <span>{title}</span>
        </label>
        {busy && (
          <span className={styles.spinner} role="status" aria-label="Loading" />
        )}
        <button
          className={`${styles.chevron} ${expanded ? styles.chevronOpen : ""}`}
          onClick={() => setExpanded((x) => !x)}
          aria-label={expanded ? "Collapse layer" : "Expand layer"}
          aria-expanded={expanded}
        >
          ›
        </button>
      </div>

      {expanded && (
        <>
          {status && (
            <p className={status.error ? styles.error : styles.muted}>
              {status.text}
            </p>
          )}
          {time && times.length > 0 && (
            <TimeControl
              step={step}
              times={times}
              time={time}
              onTimeChange={onTimeChange}
              stepLabels={stepLabels}
              autoplay={autoplay}
              loopStart={loopStart}
              frameReady={frameReady}
            />
          )}
          {legendUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className={styles.legend}
              src={legendUrl}
              alt={`${title} legend`}
            />
          )}
          {toggles && (
            <fieldset className={styles.toggles}>
              <legend className={styles.label}>{toggles.title}</legend>
              {toggles.items.map((item) => (
                <label
                  key={item.id}
                  className={`${styles.toggleItem} ${item.disabled ? styles.toggleDisabled : ""}`}
                >
                  <input
                    type="checkbox"
                    autoComplete="off"
                    checked={item.checked}
                    disabled={item.disabled}
                    onChange={(e) =>
                      toggles.onChange(item.id, e.target.checked)
                    }
                  />
                  <span
                    className={styles.legendLine}
                    style={{ background: item.color }}
                  />
                  {item.label}
                </label>
              ))}
            </fieldset>
          )}
          {legendItems && legendItems.length > 0 && (
            <ul className={styles.legendItems}>
              {legendItems.map((item) => (
                <li key={item.label}>
                  <span
                    className={styles.legendLine}
                    style={{ background: item.color }}
                  />
                  {item.label}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function TimeControl({
  step,
  times,
  time,
  onTimeChange,
  stepLabels,
  autoplay,
  loopStart,
  frameReady,
}: {
  step: TimeStep;
  times: string[];
  time: string;
  onTimeChange: (time: string) => void;
  stepLabels?: string[];
  autoplay: boolean;
  loopStart?: string | null;
  frameReady: boolean;
}) {
  const index = times.indexOf(time);
  const [playing, setPlaying] = useState(autoplay);

  // Start/stop when the story turns autoplay on or off.
  const [prevAutoplay, setPrevAutoplay] = useState(autoplay);
  if (autoplay !== prevAutoplay) {
    setPrevAutoplay(autoplay);
    setPlaying(autoplay);
  }

  // Latest handler for the playback timer, without restarting it on re-render.
  const onTimeChangeRef = useRef(onTimeChange);
  useEffect(() => {
    onTimeChangeRef.current = onTimeChange;
  });

  // Once the current frame is on the map, wait one interval and step forward
  // (looping back to loopStart). Slow data simply plays slower; it never skips
  // ahead of what's drawn.
  useEffect(() => {
    if (!playing || !frameReady) return;
    const first = Math.max(0, loopStart ? times.indexOf(loopStart) : 0);
    const timer = setTimeout(() => {
      const next = index + 1;
      onTimeChangeRef.current(times[next < times.length ? next : first]);
    }, PLAY_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [playing, frameReady, index, times, loopStart]);

  const unit =
    step === "monthly"
      ? "month"
      : step === "seasonal"
        ? "season"
        : step === "custom"
          ? "step"
          : "day";
  const current = new Date(time);
  const year = current.getUTCFullYear();
  const month = current.getUTCMonth();
  const years = [...new Set(times.map((t) => new Date(t).getUTCFullYear()))];
  const monthsInYear = new Set(
    times
      .filter((t) => new Date(t).getUTCFullYear() === year)
      .map((t) => new Date(t).getUTCMonth()),
  );

  // Pick the timestep for a year/month, clamping to the nearest available month.
  const select = (y: number, m: number) => {
    const inYear = times.filter((t) => new Date(t).getUTCFullYear() === y);
    const match =
      inYear.find((t) => new Date(t).getUTCMonth() === m) ??
      inYear.reduce((best, t) =>
        Math.abs(new Date(t).getUTCMonth() - m) <
        Math.abs(new Date(best).getUTCMonth() - m)
          ? t
          : best,
      );
    onTimeChange(match);
  };

  return (
    <div className={styles.field}>
      <span className={styles.label}>
        {step === "monthly"
          ? "Month"
          : step === "seasonal"
            ? "Season (3-month mean)"
            : step === "custom"
              ? "Outlook"
              : "Date"}
      </span>
      <div className={styles.timeRow}>
        <button
          className={styles.step}
          onClick={() => onTimeChange(times[index - 1])}
          disabled={index <= 0}
          aria-label={`Previous ${unit}`}
        >
          ‹
        </button>
        {step === "custom" ? (
          <select
            value={time}
            onChange={(e) => onTimeChange(e.target.value)}
            aria-label="Outlook period"
          >
            {times.map((t, i) => (
              <option key={t} value={t}>
                {stepLabels?.[i] ?? t.slice(0, 10)}
              </option>
            ))}
          </select>
        ) : step === "seasonal" ? (
          <select
            value={time}
            onChange={(e) => onTimeChange(e.target.value)}
            aria-label="Season"
          >
            {times.map((t) => (
              <option key={t} value={t}>
                {seasonLabel(t)}
              </option>
            ))}
          </select>
        ) : step === "monthly" ? (
          <>
            <select
              value={month}
              onChange={(e) => select(year, Number(e.target.value))}
              aria-label="Month"
            >
              {MONTHS.map((name, m) => (
                <option key={name} value={m} disabled={!monthsInYear.has(m)}>
                  {name}
                </option>
              ))}
            </select>
            <select
              value={year}
              onChange={(e) => select(Number(e.target.value), month)}
              aria-label="Year"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </>
        ) : (
          <input
            type="date"
            className={styles.date}
            value={time.slice(0, 10)}
            min={times[0].slice(0, 10)}
            max={times[times.length - 1].slice(0, 10)}
            onChange={(e) =>
              e.target.value && onTimeChange(nearestTime(times, e.target.value))
            }
            aria-label="Date"
          />
        )}
        <button
          className={styles.step}
          onClick={() => onTimeChange(times[index + 1])}
          disabled={index >= times.length - 1}
          aria-label={`Next ${unit}`}
        >
          ›
        </button>
      </div>
      <div className={styles.playRow}>
        <button
          className={styles.play}
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? "Pause" : "Play"}
          aria-pressed={playing}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <input
          type="range"
          className={styles.slider}
          min={0}
          max={times.length - 1}
          value={index}
          onChange={(e) => onTimeChange(times[Number(e.target.value)])}
          aria-label="Timeline"
        />
      </div>
    </div>
  );
}
