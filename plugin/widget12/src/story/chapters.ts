// Typed access to the story config. Edit the content in story.json.
//
// story.json holds { title, subtitle, defaultCamera, stories: [{ id, title,
// description, chapters }], explore: [...] }. The title, subtitle, story list
// and explore tiles make up the welcome card; each story is played on its own.
//
// Explore tiles: { id, title, description, layers } with no story. Clicking
// one opens the workbench group with the same id; optional `layers` are
// switched on too (none by default).
//
// Chapter fields:
//   id       used in the URL hash, e.g. #monthly-sst (unique across all stories)
//   layout   "center" for a card in the middle of the screen (intro, status),
//            "bottom" (default) for the card docked at the bottom of the map
//   title    chapter heading; may use {outlookPeriod} (the BOM forecast
//            period, e.g. "October 2026 to March 2027")
//   body     paragraphs of text; {previousMonth} is replaced with the month
//            before the one the page is viewed in, e.g. "September 2026"
//   image    optional { src, alt, caption }; src is relative to /public
//   gauge    optional ENSO gauge in the card: { category, label, scale }.
//            scale "enso" (default): category "laNina", "neutral" or "elNino".
//            scale "outlook": the seven-step outlook dial, category one of
//            "laNina", "laNinaAlert", "laNinaWatch", "neutral", "elNinoWatch",
//            "elNinoAlert", "elNino". The arrow points to the category; label
//            is the text shown under it
//   layers   layer ids (see layers.ts) shown in this chapter; the previous
//            chapter's layers are switched off. Leave empty for a text-only
//            chapter that keeps the previous chapter's layers on the map
//   times    where the card's Animate button starts each layer: a date
//            ("2015-12"), an offset back from the latest data ("-10y", "-6m",
//            "-30d") or "first", e.g. { "sst-anomaly-monthly": "-10y" }.
//            Defaults to the first timestep. Layers open on their latest one.
//   autoplay optional; true starts animating as soon as the chapter opens
//   stats    optional figures shown as a row of chips under the gauge, e.g.
//            [{ "label": "Rel. Niño3", "value": "+3.05 °C" }]
//   notes    optional small lines under the gauge, e.g. "Outlook issued …"
//   camera   optional { center: [lng, lat], zoom }; defaults to defaultCamera
import storyJson from "./story.json";
import { STORY_LAYERS } from "./layers";
import {
  isOutlookCategory,
  type EnsoCategory,
  type OutlookCategory,
} from "@/components/EnsoGauge";

export type Camera = { center: [number, number]; zoom: number };

export type Chapter = {
  id: string;
  layout: "center" | "bottom";
  title: string;
  body: string[];
  image?: { src: string; alt: string; caption?: string };
  /** Figures shown as a row of chips under the gauge. */
  stats?: { label: string; value: string }[];
  /** Small lines shown under the gauge/image, e.g. issue dates. */
  notes?: string[];
  gauge?:
    | { scale?: "enso"; category: EnsoCategory; label?: string }
    | { scale: "outlook"; category: OutlookCategory; label?: string };
  layers: string[];
  times?: Record<string, string>;
  autoplay?: boolean;
  camera: Camera;
};

export type Story = {
  id: string;
  title: string;
  description?: string;
  chapters: Chapter[];
};

type RawChapter = Omit<Chapter, "layout" | "camera"> & {
  layout?: string;
  camera?: Camera;
};

type StoryJson = {
  title: string;
  subtitle?: string;
  defaultCamera: Camera;
  stories: {
    id: string;
    title: string;
    description?: string;
    chapters: RawChapter[];
  }[];
  explore?: ExploreTile[];
};

/** Welcome-card tile without a story: opens a workbench group and layers. */
export type ExploreTile = {
  id: string;
  title: string;
  description?: string;
  /** Layers to switch on (optional; none by default). */
  layers?: string[];
};

const raw = storyJson as unknown as StoryJson;

const LAYER_IDS = new Set(STORY_LAYERS.map((l) => l.id));
const chapterIds = new Set<string>();

/** Welcome card heading. */
export const STORY_HOME = { title: raw.title, subtitle: raw.subtitle };

export const STORIES: Story[] = raw.stories.map((s) => ({
  id: s.id,
  title: s.title,
  description: s.description,
  chapters: s.chapters.map((c) => {
    if (chapterIds.has(c.id)) {
      throw new Error(`story.json: chapter id "${c.id}" is used twice`);
    }
    chapterIds.add(c.id);
    if (c.gauge?.scale === "outlook" && !isOutlookCategory(c.gauge.category)) {
      throw new Error(
        `story.json chapter "${c.id}": unknown outlook category "${c.gauge.category}"`,
      );
    }
    for (const id of [...c.layers, ...Object.keys(c.times ?? {})]) {
      if (!LAYER_IDS.has(id)) {
        throw new Error(`story.json chapter "${c.id}": unknown layer "${id}"`);
      }
    }
    return {
      ...c,
      layout: c.layout === "center" ? "center" : "bottom",
      camera: c.camera ?? raw.defaultCamera,
    };
  }),
}));

export const EXPLORE: ExploreTile[] = (raw.explore ?? []).map((t) => {
  for (const id of t.layers ?? []) {
    if (!LAYER_IDS.has(id)) {
      throw new Error(`story.json explore "${t.id}": unknown layer "${id}"`);
    }
  }
  return t;
});
