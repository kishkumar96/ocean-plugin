import { withBasePath } from "@/lib/basePath";

// ENSO indices shown beside the SST layer: a dial each (in this order, left to
// right) and a monthly bar chart each (top to bottom). Each `url` is a JSON
// file in /public with { thresholds, range, units, months } — see EnsoGauge.tsx.
export type EnsoIndex = { id: string; label: string; url: string };

export const ENSO_INDICES: EnsoIndex[] = [
  { id: "nino34", label: "Ocean - Niño3.4", url: withBasePath("/ocean.json") },
  { id: "soi", label: "Atmosphere - SOI", url: withBasePath("/soi.json") },
];

/**
 * Months shown in each bar chart, paged back from the latest month so the
 * current month is always inside. 11 years keeps the story's 10-year SST
 * autoplay (121 months inclusive) on a single page.
 */
export const ENSO_CHART_MONTHS = 132;

/**
 * Text of the ENSO status card's info (ⓘ) popup: how the Watch, Alert and
 * El Niño / La Niña stages are declared. One string per paragraph.
 */
export const ENSO_STATUS_INFO = {
  title: "ENSO alert stages",
  paragraphs: [
    "An El Niño (La Niña) Watch is issued when the current climate state is neutral or declining La Niña (El Niño), the SOI analogue threshold is met or significant sub-surface warming (cooling) has been observed in western or central equatorial Pacific, and one-third or more of surveyed climate models show sustained warming (cooling) to at least 0.8˚C (-0.8˚C) in the NINO3 or NINO3.4 regions of the Pacific by late winter or spring.",
    "An El Niño (La Niña) Alert is issued when a clear warming (cooling) trend has been observed in the NINO3 or NINO3.4 regions of the Pacific during the past three to six months, trade winds have been weaker (stronger) than average in the western or central equatorial Pacific Ocean during two of the last three months, the two-month average SOI is -7 (7) or lower (higher), and a majority of surveyed climate models show sustained warming (cooling) to at least 0.8˚C (-0.8˚C) in the NINO3 or NINO3.4 regions by late winter or spring.",
    "El Niño (La Niña) conditions are said to be occurring when sea surface temperatures in the NINO3 or NINO3.4 regions of the Pacific are 0.8˚C (-0.8˚C) warmer (cooler) than average, trade winds have been weaker (stronger) than average in the western or central equatorial Pacific during any three of the last four months, the three-month SOI is -7 (7) or lower (higher), and a majority of surveyed climate models show sustained warming (cooling) to at least 0.8˚C (-0.8˚C) above (below) average in the NINO3 or NINO3.4 regions of the Pacific until the end of the year.",
  ],
  // Shown as "Source: <label>"; set url to make it a link.
  source: { label: "Australian Bureau of Meteorology", url: "" },
};
