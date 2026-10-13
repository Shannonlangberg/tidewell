"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { Stage } from "@/lib/demo";
import { DEFAULT_TRIGGERS, type Interaction, type TriggerSettings } from "@/lib/humanTouch";

// Demo-only state kept in this browser. The screens are rewired to real rows in
// later phases; sign-out wipes it (see SignOutButton). Only `theme` is meant to stay.
export type AppState = {
  person: string | null;
  theme: "auto" | "light" | "dark";
  // owner
  approved: string[];
  asked: Record<string, string>;
  quiet: boolean;
  // crew
  photographed: Record<string, string[]>; // jobId → rooms done
  jobsDone: string[];
  handover: Record<string, string>;
  // reports raised from the app
  reports: { id: string; title: string; detail: string; urgent: boolean; at: number }[];
  // manager
  sent: string[];
  priced: number[];
  stages: Record<string, Stage>;
  payoutsRun: boolean;
  // human touch
  assign: Record<string, string>; // item id → team member id
  logs: Interaction[];
  handled: string[]; // task ids cleared by a logged interaction
  handback: string[]; // threads handed back to the assistant (resolved)
  takenOver: string[]; // routine threads a person took over
  triggers: TriggerSettings;
  cadence: Record<string, string>; // owner id → cadence override
};

export type OwnerState = AppState;

export const STORAGE_KEY = "tidewell-app-demo";
export const EMPTY: AppState = {
  person: null,
  theme: "auto",
  approved: [],
  asked: {},
  quiet: false,
  photographed: {},
  jobsDone: [],
  handover: {},
  reports: [],
  sent: [],
  priced: [],
  stages: {},
  payoutsRun: false,
  assign: {},
  logs: [],
  handled: [],
  handback: [],
  takenOver: [],
  triggers: DEFAULT_TRIGGERS,
  cadence: {},
};
const EVENT = "tidewell-app-state";

// localStorage as an external store: the snapshot is cached per raw string so
// React sees a stable object until the stored value actually changes.
let cachedRaw: string | null | undefined;
let cachedState: AppState = EMPTY;
/** Used only when localStorage refuses writes (private mode), so the screen still updates. */
let memoryRaw: string | null = null;

function read(): AppState {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY) ?? memoryRaw;
  } catch {
    raw = memoryRaw;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cachedState = raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<AppState>) } : EMPTY;
    } catch {
      cachedState = EMPTY;
    }
  }
  return cachedState;
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const serverSnapshot = () => EMPTY;
const noSubscribe = () => () => {};

/** False during server render and hydration, true once the client is running. */
export function useHydrated(): boolean {
  return useSyncExternalStore(noSubscribe, () => true, () => false);
}

export function useAppState() {
  const state = useSyncExternalStore(subscribe, read, serverSnapshot);
  const ready = useHydrated();

  const update = useCallback((fn: (s: AppState) => AppState) => {
    const next = fn(read());
    const raw = JSON.stringify(next);
    try {
      localStorage.setItem(STORAGE_KEY, raw);
      memoryRaw = null;
    } catch {
      memoryRaw = raw; // private mode — state won't persist past this tab
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return { state, ready, update };
}
