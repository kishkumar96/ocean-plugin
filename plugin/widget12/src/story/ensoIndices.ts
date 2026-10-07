import { withBasePath } from "@/lib/basePath";

// ENSO indices shown beside the SST layer: a dial each (in this order, left to
// right) and a monthly bar chart each (top to bottom). Each `url` is a JSON
// file in /public with { thresholds, range, units, months } — see EnsoGauge.tsx.
export type EnsoIndex = { id: string; label: string; url: string };

export const ENSO_INDICES: EnsoIndex[] = [
  { id: "nino34", label: "Niño3.4 - Ocean", url: withBasePath("/ocean.json") },
  { id: "soi", label: "SOI - Atmosphere", url: withBasePath("/soi.json") },
];

/**
 * Months shown in each bar chart, paged back from the latest month so the
 * current month is always inside. 11 years keeps the story's 10-year SST
 * autoplay (121 months inclusive) on a single page.
 */
export const ENSO_CHART_MONTHS = 132;
