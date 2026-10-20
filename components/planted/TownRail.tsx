"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Arrow } from "./ui";

/*
 * The horizontal "Towns we serve" rail (2026 handoff, Community section): a
 * scroll-snap row whose left edge lines up with the page container, previous
 * and next controls that disable at each end, mouse drag to scroll, and a
 * keyboard-focusable region. Touch and trackpads simply scroll it natively.
 *
 * `head` is the section heading: it sits in the page container with the
 * previous and next controls at its right, and the rail below bleeds to the
 * right edge of the screen.
 */

export function TownRail({
  head,
  children,
  label = "Towns we serve, scrollable",
}: {
  head: ReactNode;
  children: ReactNode;
  label?: string;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false });

  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    const update = () => setEdge({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth > el.scrollWidth - 8 });

    let down = false;
    let moved = false;
    let startX = 0;
    let startLeft = 0;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      down = true;
      moved = false;
      startX = e.clientX;
      startLeft = el.scrollLeft;
    };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 4) {
        moved = true;
        el.classList.add("dragging");
      }
      el.scrollLeft = startLeft - dx;
    };
    const onUp = () => {
      if (!down) return;
      down = false;
      el.classList.remove("dragging");
    };
    // A drag must not also follow a link it happened to end on.
    const onClick = (e: MouseEvent) => {
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
        moved = false;
      }
    };

    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    el.addEventListener("click", onClick, true);
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      el.removeEventListener("click", onClick, true);
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  const nudge = (dir: number) => {
    const el = rail.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * el.clientWidth * 0.7, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <>
      <div className="shell mt-[clamp(3rem,6vw,5rem)] flex flex-wrap items-end justify-between gap-x-8 gap-y-6">
        <div>{head}</div>
        <div className="flex gap-2">
        <button type="button" className="ctrl" aria-label="Previous towns" disabled={edge.start} onClick={() => nudge(-1)}>
          <Arrow direction="left" />
        </button>
        <button type="button" className="ctrl" aria-label="Next towns" disabled={edge.end} onClick={() => nudge(1)}>
          <Arrow />
        </button>
        </div>
      </div>
      <div ref={rail} className="rail" tabIndex={0} role="region" aria-label={label}>
        {children}
      </div>
    </>
  );
}
