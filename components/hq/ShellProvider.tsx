"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AskPlantedPanel } from "./AskPlantedPanel";
import { CommandPalette } from "./CommandPalette";
import type { NavEntry, QuickAction } from "./nav";
import type { SearchAction } from "./types";

/*
 * Owns the two overlays that can be opened from anywhere in the shell (the command
 * palette and the Ask Planted panel) and the Cmd/Ctrl+K shortcut. The buttons that open
 * them (top bar, mobile header) read `useShell()`.
 *
 * AppShell (a Server Component) renders this and passes the page through as `children`,
 * so the page itself stays server-rendered.
 */

type ShellApi = { openPalette: () => void; openAsk: () => void };
const ShellContext = createContext<ShellApi | null>(null);

export function useShell(): ShellApi {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside <AppShell>.");
  return ctx;
}

export function ShellProvider({
  children,
  searchAction,
  nav,
  quickActions,
}: {
  children: ReactNode;
  searchAction: SearchAction;
  nav: readonly NavEntry[];
  quickActions: readonly QuickAction[];
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);

  const openPalette = useCallback(() => {
    setAskOpen(false);
    setPaletteOpen(true);
  }, []);
  const openAsk = useCallback(() => {
    setPaletteOpen(false);
    setAskOpen(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setAskOpen(false);
        setPaletteOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const api = useMemo(() => ({ openPalette, openAsk }), [openPalette, openAsk]);

  return (
    <ShellContext.Provider value={api}>
      {children}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} searchAction={searchAction} nav={nav} quickActions={quickActions} />
      <AskPlantedPanel open={askOpen} onClose={() => setAskOpen(false)} onOpenSearch={openPalette} />
    </ShellContext.Provider>
  );
}
