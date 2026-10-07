"use client";

import { useCallback, useEffect, useState } from "react";
import type { Stage } from "@/lib/demo";
import { DEFAULT_TRIGGERS, type Interaction, type TriggerSettings } from "@/lib/humanTouch";

// Demo-only state kept in this browser. Replace with a real backend when there is one.
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
  // tenant
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

const KEY = "tidewell-app-demo";
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

function read(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<AppState>) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

export function useAppState() {
  const [state, setState] = useState<AppState>(EMPTY);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setState(read());
    setReady(true);
    const sync = () => setState(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const update = useCallback((fn: (s: AppState) => AppState) => {
    const next = fn(read());
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* private mode — state just won't persist */
    }
    setState(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return { state, ready, update };
}
