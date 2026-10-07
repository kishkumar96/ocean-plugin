// Colours for each story, keyed by story id (matching the workbench group id).
// Used by the welcome-card tiles, the bottom story bar and the workbench
// group headers so they always match. Flat, muted tones; white text on `color`.
export type Theme = { color: string; dark: string };

export const THEMES: Record<string, Theme> = {
  // Current conditions: dull steel blue.
  current: { color: "#46698c", dark: "#3a5774" },
  // Outlook: dull terracotta.
  outlook: { color: "#9c5f30", dark: "#824e27" },
};

const FALLBACK: Theme = { color: "#5b6573", dark: "#4a535f" };

export const themeFor = (id: string): Theme => THEMES[id] ?? FALLBACK;
