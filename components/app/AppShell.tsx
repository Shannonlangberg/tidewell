"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { TabBar } from "./TabBar";
import { useAppState } from "./useAppState";

export function AppShell({ children, tabs = true }: { children: React.ReactNode; tabs?: boolean }) {
  const { state } = useAppState();
  const path = usePathname();
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemDark(mq.matches);
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const dark = state.theme === "dark" || (state.theme === "auto" && systemDark);
  const showTabs = tabs && path !== "/app";

  return (
    <div className="tw tw-bg" data-theme={dark ? "dark" : "light"}>
      <div className="tw-col">
        {children}
        {showTabs && <TabBar />}
      </div>
    </div>
  );
}
