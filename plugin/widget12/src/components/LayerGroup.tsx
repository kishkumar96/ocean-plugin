"use client";

import type { ReactNode } from "react";
import type { Theme } from "@/story/themes";
import styles from "./LayerGroup.module.css";

/** Collapsible workbench section (e.g. "Current Conditions") wrapping layer cards. */
export default function LayerGroup({
  title,
  theme,
  activeCount,
  open,
  onToggle,
  children,
}: {
  title: string;
  /** Header colours (same as the story's welcome-card tile). */
  theme: Theme;
  /** Layers switched on in this group, shown next to the title. */
  activeCount: number;
  /** Expanded? Controlled by the story map (collapsed until a story opens). */
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className={styles.group}>
      <button
        className={styles.header}
        style={{ background: theme.color }}
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`}>
          ›
        </span>
        <span className={styles.title}>{title}</span>
        {activeCount > 0 && (
          <span className={styles.badge} aria-label={`${activeCount} on`}>
            {activeCount} on
          </span>
        )}
      </button>
      {/* Kept mounted when collapsed: the cards own their map layers, which
          must stay on the map (and keep their time) while the group is closed. */}
      <div className={styles.body} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
