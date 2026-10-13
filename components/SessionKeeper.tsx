"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

const EVERY_MS = 20 * 60 * 1000;
/** Pages that have a signed-out state of their own; a 401 there means nothing. */
const PUBLIC = new Set(["/app", "/app/verify"]);

/**
 * Keeps the session fresh without a proxy. Server Components never refresh a
 * token (they cannot write cookies), so this calls /api/session, whose
 * cookie-writing client refreshes through the refresh token and returns 204
 * with new cookies: on mount, when the tab comes back, and every 20 minutes.
 */
export function SessionKeeper() {
  const pathname = usePathname();
  const router = useRouter();
  const pathRef = useRef(pathname);

  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;

    const ping = async () => {
      if (PUBLIC.has(pathRef.current)) return; // nothing to keep alive on the sign-in pages
      try {
        const res = await fetch("/api/session", { credentials: "same-origin", cache: "no-store" });
        if (!cancelled && res.status === 401) {
          // The session is gone (signed out elsewhere, or the refresh token was revoked).
          router.replace("/app");
        }
      } catch {
        /* offline: the next visibilitychange or tick tries again */
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void ping();
    };

    void ping();
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => void ping(), EVERY_MS);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [router]);

  return null;
}
