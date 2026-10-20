"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/*
 * Site motion, per the 2026 handoff (design/website/Motion.jsx): one
 * requestAnimationFrame loop on scroll, deliberately not IntersectionObserver
 * (it proved unreliable in embedded previews).
 *
 *  - reveals: `.rv`, `.reveal-img` and `.line-mask` get `.in` once their top
 *    passes 92% of the viewport height; safety passes at 300ms and 2.5s
 *  - parallax: `[data-parallax="0.5"]` moves with its frame's offset from the
 *    viewport centre
 *  - `.words`: the approach statement lights word by word as it scrolls past
 *  - scroll-spy: the current `main > section[id]` shows or hides `.mcta`, the
 *    phone call-to-action, which steps aside for the hero and the contact band
 *
 * With JavaScript off nothing is held back (planted.css keys the hidden states
 * on `html.js`, set by an inline script in the site layout). Under
 * prefers-reduced-motion everything is shown at once and nothing moves.
 */

export function Motion() {
  const pathname = usePathname();

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const SEL = ".rv:not(.in),.reveal-img:not(.in),.line-mask:not(.in)";
    let raf = 0;

    const tick = () => {
      raf = 0;
      const vh = window.innerHeight;

      document.querySelectorAll<HTMLElement>(SEL).forEach((el) => {
        if (reduce || el.getBoundingClientRect().top < vh * 0.92) el.classList.add("in");
      });

      if (!reduce) {
        document.querySelectorAll<HTMLElement>("[data-parallax]").forEach((el) => {
          const frame = el.parentElement;
          if (!frame) return;
          const r = frame.getBoundingClientRect();
          if (r.bottom < 0 || r.top > vh) return;
          const p = (r.top + r.height / 2 - vh / 2) / vh;
          el.style.transform = `translate3d(0, ${(p * parseFloat(el.dataset.parallax ?? "0") * -100).toFixed(1)}px, 0)`;
        });
      }

      document.querySelectorAll<HTMLElement>(".words").forEach((el) => {
        const r = el.getBoundingClientRect();
        const progress = Math.min(1, Math.max(0, (vh * 0.85 - r.top) / (r.height + vh * 0.35)));
        const words = el.querySelectorAll(".w");
        const lit = reduce ? words.length : Math.round(progress * words.length);
        words.forEach((w, i) => w.classList.toggle("on", i < lit));
      });

      const cta = document.querySelector<HTMLElement>(".mcta");
      if (cta) {
        let current = "";
        document.querySelectorAll<HTMLElement>("main > section[id]").forEach((s) => {
          if (s.getBoundingClientRect().top < vh * 0.4) current = s.id;
        });
        const show = current !== "" && current !== "top" && current !== "contact";
        cta.classList.toggle("show", show);
        cta.setAttribute("aria-hidden", String(!show));
        cta.toggleAttribute("inert", !show);
      }
    };

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };

    tick();
    const t1 = window.setTimeout(tick, 300);
    const t2 = window.setTimeout(tick, 2500);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
    // Re-run on navigation so a new page's elements are picked up.
  }, [pathname]);

  return null;
}

/**
 * The approach statement, split into words that light up on scroll. The whole
 * sentence is the accessible name; the word spans are hidden from assistive
 * technology so it is read once, normally.
 */
export function Words({ text, className = "" }: { text: string; className?: string }) {
  return (
    <p className={`statement words ${className}`.trim()} aria-label={text}>
      {text.split(" ").map((w, i) => (
        <span key={i} className="w" aria-hidden="true">
          {w}{" "}
        </span>
      ))}
    </p>
  );
}
