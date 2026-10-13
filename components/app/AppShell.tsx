"use client";

import { useSyncExternalStore } from "react";
import { useAppState } from "./useAppState";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeDark(onChange: () => void) {
  const mq = window.matchMedia(DARK_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * Theme wrapper for the app and the stay page. The tab bar is rendered by the
 * role layouts (it needs the role from the session), not here.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { state } = useAppState();
  const systemDark = useSyncExternalStore(subscribeDark, () => window.matchMedia(DARK_QUERY).matches, () => false);
  const dark = state.theme === "dark" || (state.theme === "auto" && systemDark);

  return (
    <div className="tw tw-bg" data-theme={dark ? "dark" : "light"}>
      <div className="tw-col">{children}</div>
    </div>
  );
}
