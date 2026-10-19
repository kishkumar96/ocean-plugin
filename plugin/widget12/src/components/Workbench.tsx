"use client";

import type { ReactNode } from "react";
import styles from "./Workbench.module.css";

type Props = {
  title?: string;
  children?: ReactNode;
  /** Expanded or collapsed (controlled by the story map). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export default function Workbench({
  title = "El-Niño Tracker",
  children,
  open,
  onOpenChange: setOpen,
}: Props) {
  return (
    <>
      <aside
        className={`${styles.panel} ${open ? "" : styles.collapsed}`}
        aria-hidden={!open}
      >
        <div className={styles.inner}>
          <header className={styles.header}>
            <div className={styles.brand}>
              {/* COSPPaC logo: the white PNG used as a mask, filled in brand blue. */}
              <span className={styles.logo} role="img" aria-label="COSPPaC" />
              <h2>{title}</h2>
            </div>
            <button
              className={styles.iconButton}
              onClick={() => setOpen(false)}
              aria-label="Collapse workbench"
            >
              ‹
            </button>
          </header>
          <div className={styles.body}>
            {children ?? <p className={styles.empty}>No layers added yet.</p>}
          </div>
        </div>
      </aside>
      {!open && (
        <button
          className={styles.expand}
          onClick={() => setOpen(true)}
          aria-label="Expand workbench"
        >
          {title} ›
        </button>
      )}
    </>
  );
}
