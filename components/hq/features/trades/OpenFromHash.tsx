"use client";

import { useEffect } from "react";

/*
 * Opens the folded trade a link points at (/hq/partners/trades#trade-plumbing): native <details>
 * does not open for a URL fragment on its own. Opens the target and every <details> around it.
 */
export function OpenFromHash() {
  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const el = document.getElementById(id);
      if (!el) return;
      for (let d: Element | null = el; d; d = d.parentElement) if (d instanceof HTMLDetailsElement) d.open = true;
      el.scrollIntoView({ block: "start" });
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  return null;
}
