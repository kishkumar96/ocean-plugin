"use client";

import { useRef, useState, type PointerEvent } from "react";

type Offset = { x: number; y: number };

/**
 * Drag an element by a handle. Returns the offset to apply as a transform and
 * the props to spread on the handle. Buttons/links inside the handle still
 * click normally; double-clicking the handle resets the position. The element
 * is kept on screen so its handle stays reachable.
 */
export function useDraggable(key: string) {
  // One remembered position per key (e.g. "center" and "bottom" cards).
  const [offsets, setOffsets] = useState<Record<string, Offset>>({});
  const offset = offsets[key] ?? { x: 0, y: 0 };
  const drag = useRef<{
    startX: number;
    startY: number;
    from: Offset;
    rect: DOMRect;
  } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, a, input, select")) return;
    // Measure the whole card (the handle's positioned ancestor section).
    const card = e.currentTarget.closest("section") ?? e.currentTarget;
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      from: offset,
      rect: card.getBoundingClientRect(),
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const keep = 80; // px of the card that must stay on screen
    const dx = clamp(
      e.clientX - d.startX,
      keep - d.rect.right,
      window.innerWidth - keep - d.rect.left,
    );
    const dy = clamp(
      e.clientY - d.startY,
      -d.rect.top,
      window.innerHeight - 48 - d.rect.top,
    );
    setOffsets((o) => ({
      ...o,
      [key]: { x: d.from.x + dx, y: d.from.y + dy },
    }));
  };

  const onPointerUp = (e: PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onDoubleClick = () =>
    setOffsets((o) => ({ ...o, [key]: { x: 0, y: 0 } }));

  return {
    offset,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onDoubleClick,
      title: "Drag to move · double-click to reset",
    },
  };
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(v, lo), Math.max(lo, hi));
