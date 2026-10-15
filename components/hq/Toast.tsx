"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FLASH_MAX_LENGTH, FLASH_PARAM, FLASH_TONE_PARAM, type FlashTone } from "./flash";
import { IconButton } from "./Button";
import { cx } from "./cx";
import { Icon, type IconName } from "./icons";

/*
 * Toasts: short confirmations that do not take focus.
 *
 *  - <ToastProvider> (mounted once, in app/hq/layout.tsx) owns an aria-live="polite"
 *    region, so a screen reader hears each message without losing its place.
 *  - useToast() returns { toast, dismiss }: toast("Contact saved") or
 *    toast("Could not save", { tone: "error" }). Call it from event handlers and effects.
 *  - A toast dismisses itself after a few seconds (longer for an error) but PAUSES while
 *    the pointer is over it or focus is inside it, and has a close button.
 *  - <FlashFromSearchParams/> turns `?toast=Contact+saved` into a toast and removes the
 *    parameters from the address bar, so a Server Action can finish with
 *    redirect(withToast(path, "Contact saved")). See ./flash.ts.
 *
 * Tone is carried by an icon AND words, never colour alone. Toasts are flat charcoal with
 * no shadow (shadows are reserved for menus, drawers and the palette).
 */

export type ToastTone = FlashTone;
export type ToastOptions = { tone?: ToastTone; duration?: number };
type ToastItem = { id: number; message: string; tone: ToastTone; duration: number };

type ToastApi = {
  toast: (message: string, options?: ToastOptions) => number;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider> (app/hq/layout.tsx mounts it).");
  return ctx;
}

const DEFAULT_MS: Record<ToastTone, number> = { success: 5000, info: 6000, error: 9000 };
const MAX_VISIBLE = 4;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((cur) => cur.filter((t) => t.id !== id)), []);

  const toast = useCallback((message: string, options: ToastOptions = {}) => {
    const tone = options.tone ?? "success";
    const id = nextId.current++;
    const text = message.slice(0, FLASH_MAX_LENGTH);
    setItems((cur) => [...cur, { id, message: text, tone, duration: options.duration ?? DEFAULT_MS[tone] }].slice(-MAX_VISIBLE));
    return id;
  }, []);

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* The live region exists from first paint so the first message is announced. */}
      <div className="hq-toasts" role="region" aria-label="Notifications">
        <ol aria-live="polite" aria-atomic="false">
          {items.map((t) => (
            <ToastView key={t.id} item={t} onDismiss={dismiss} />
          ))}
        </ol>
      </div>
    </ToastContext.Provider>
  );
}

const TONE_ICON: Record<ToastTone, IconName> = { success: "check", error: "alert", info: "info" };
const TONE_WORD: Record<ToastTone, string> = { success: "Done.", error: "Problem.", info: "Note." };

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(item.duration);
  const startedAt = useRef(0);

  useEffect(() => {
    if (paused) return;
    startedAt.current = Date.now();
    const timer = window.setTimeout(() => onDismiss(item.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(1000, remaining.current - (Date.now() - startedAt.current));
    };
  }, [paused, item.id, onDismiss]);

  return (
    <li
      className={cx("hq-toast", `hq-toast--${item.tone}`)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
      }}
    >
      <Icon name={TONE_ICON[item.tone]} size={18} className="hq-toast__icon" />
      <p className="hq-toast__text">
        <span className="sr-only">{TONE_WORD[item.tone]} </span>
        {item.message}
      </p>
      <IconButton icon="close" label="Dismiss notification" size="sm" onDark onClick={() => onDismiss(item.id)} iconSize={16} />
    </li>
  );
}

/**
 * Shows a toast from `?toast=` (and optional `?toast_tone=`), once, then cleans the URL.
 * Mounted once in app/hq/layout.tsx inside a Suspense boundary (it reads search params).
 */
export function FlashFromSearchParams() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();
  const shown = useRef<string | null>(null);

  const message = params.get(FLASH_PARAM);
  const toneParam = params.get(FLASH_TONE_PARAM);

  useEffect(() => {
    if (!message) {
      shown.current = null;
      return;
    }
    const key = `${pathname}|${message}|${toneParam ?? ""}`;
    // React Strict Mode runs effects twice in development: show each flash once.
    if (shown.current === key) return;
    shown.current = key;
    const tone: ToastTone = toneParam === "error" || toneParam === "info" ? toneParam : "success";
    toast(message, { tone });
    const next = new URLSearchParams(params.toString());
    next.delete(FLASH_PARAM);
    next.delete(FLASH_TONE_PARAM);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [message, toneParam, params, pathname, router, toast]);

  return null;
}
