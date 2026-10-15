"use client";

import { useEffect, useState } from "react";
import { Button } from "./Button";
import { Icon } from "./icons";
import { useShell } from "./ShellProvider";

/* Buttons in the shell chrome that open the shared overlays. */

/** "⌘K" on Apple platforms, "Ctrl K" elsewhere. Set after mount so server and client markup match. */
function useShortcutHint() {
  const [hint, setHint] = useState("Ctrl K");
  useEffect(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    const platform = nav.userAgentData?.platform ?? navigator.platform ?? "";
    // Deliberately a post-mount update: server and first client render both say "Ctrl K".
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (/mac|iphone|ipad/i.test(platform)) setHint("⌘K");
  }, []);
  return hint;
}

/** The wide search field in the desktop top bar: a button that opens the palette. */
export function SearchTrigger() {
  const { openPalette } = useShell();
  const hint = useShortcutHint();
  return (
    <button type="button" className="hq-searchtrigger" onClick={openPalette} aria-haspopup="dialog" aria-keyshortcuts="Control+K Meta+K">
      <Icon name="search" size={16} />
      <span className="hq-searchtrigger__text">Search contacts, organisations, tasks</span>
      <kbd className="hq-kbd" aria-hidden="true">
        {hint}
      </kbd>
    </button>
  );
}

/** The prominent charcoal button. `onDark` outlines it for the mobile header. */
export function AskPlantedButton({ onDark, size = "md" }: { onDark?: boolean; size?: "sm" | "md" }) {
  const { openAsk } = useShell();
  return (
    <Button variant={onDark ? "secondary" : "primary"} onDark={onDark} size={size} icon="sparkle" onClick={openAsk} aria-haspopup="dialog">
      Ask Planted
    </Button>
  );
}

/** Labelled search button for the mobile header. */
export function MobileSearchButton() {
  const { openPalette } = useShell();
  return (
    <Button variant="secondary" onDark size="sm" icon="search" onClick={openPalette} aria-haspopup="dialog">
      Search
    </Button>
  );
}
