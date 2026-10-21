"use client";

import type { ReactNode } from "react";
import { Button } from "../../Button";
import { cx } from "../../cx";
import { Icon } from "../../icons";
import { useToast } from "../../Toast";

/*
 * Copy to the clipboard, and say so (a toast: a polite live region, so a screen reader hears it too).
 *
 *  - CopyButton: a button with a label ("Copy link", "Copy text").
 *  - CopySwatch: the whole colour swatch is the button; it copies the hex.
 *
 * `text` is copied as it is; pass `absolute` to copy a path as a full address on this site. Where the
 * clipboard is not available (an insecure page, a blocked permission) a fallback selects hidden text, and if
 * that fails too the toast says so and shows the value.
 */

async function copy(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the older route
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

function useCopier(text: string, absolute: boolean | undefined, doneMessage: string) {
  const { toast } = useToast();
  return async () => {
    const value = absolute ? new URL(text, window.location.origin).toString() : text;
    const ok = await copy(value);
    toast(ok ? doneMessage : `Could not copy automatically. Select this and copy it: ${value}`, { tone: ok ? "success" : "error" });
  };
}

export function CopyButton({
  text,
  label = "Copy",
  done = "Copied",
  absolute,
  size = "md",
  variant = "secondary",
  ariaLabel,
}: {
  text: string;
  label?: ReactNode;
  done?: string;
  absolute?: boolean;
  size?: "sm" | "md";
  variant?: "secondary" | "ghost";
  ariaLabel?: string;
}) {
  const run = useCopier(text, absolute, done);
  return (
    <Button size={size} variant={variant} icon="copy" onClick={run} aria-label={ariaLabel}>
      {label}
    </Button>
  );
}

/** A colour swatch that copies its hex. The swatch itself is the button; the text on it is its name. */
export function CopySwatch({ hex, name, textOnLight, className }: { hex: string; name: string; textOnLight: boolean; className?: string }) {
  const run = useCopier(hex, false, `Copied ${hex}`);
  return (
    <button
      type="button"
      onClick={run}
      className={cx("hq-res-swatch", className)}
      data-text={textOnLight ? "dark" : "light"}
      style={{ background: hex }}
      aria-label={`Copy ${name}, ${hex}`}
    >
      <span className="hq-res-swatch__hex">{hex}</span>
      <span className="hq-res-swatch__copy" aria-hidden="true">
        <Icon name="copy" size={14} /> Copy
      </span>
    </button>
  );
}
