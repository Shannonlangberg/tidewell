"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { buttonClass } from "./Button";
import { cx } from "./cx";
import { Icon } from "./icons";
import type { QuickAction } from "./nav";

/*
 * Quick add: a menu of the four things staff add most (contact, call, task, referral).
 *
 * Keyboard (the ARIA menu-button pattern): Enter, Space or Down opens it on the first
 * item, Up opens on the last; Up and Down move (wrapping), Home and End jump, typing a
 * letter jumps to the item that starts with it, Esc closes and returns focus to the
 * button, Tab closes. A click or tap outside closes it. Items are real links, so
 * Enter follows one and the menu closes.
 *
 * `variant="bar"` is the top-bar button; `"fab"` is the floating button on phones, whose
 * menu opens upward. Which actions appear depends on the person's capabilities (the
 * server filters them with visibleQuickActions).
 */

export function QuickAdd({ actions, variant = "bar" }: { actions: readonly QuickAction[]; variant?: "bar" | "fab" }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<"first" | "last" | null>(null);
  const uid = useId();
  const menuId = `${uid}-menu`;

  const items = useCallback(() => Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []), []);

  const openWith = (where: "first" | "last" | null) => {
    if (open && where) {
      // Already open (opened by a pointer): just move focus into it.
      const list = items();
      (where === "last" ? list[list.length - 1] : list[0])?.focus();
      return;
    }
    pendingFocus.current = where;
    setOpen(true);
  };
  // Enter and Space arrive as a click with detail 0: open on the first item, as the menu-button pattern says.
  const toggle = (e: React.MouseEvent) => {
    if (open) close(false);
    else openWith(e.detail === 0 ? "first" : null);
  };
  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  };

  // Move focus into the menu after it renders.
  useEffect(() => {
    if (!open || !pendingFocus.current) return;
    const list = items();
    (pendingFocus.current === "last" ? list[list.length - 1] : list[0])?.focus();
    pendingFocus.current = null;
  }, [open, items]);

  // Light dismiss.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  if (actions.length === 0) return null;

  function onButtonKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      openWith("first");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      openWith("last");
    }
  }

  function onMenuKey(e: React.KeyboardEvent) {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number) => list[(i + list.length) % list.length]?.focus();
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusAt(index + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusAt(index - 1);
        break;
      case "Home":
        e.preventDefault();
        focusAt(0);
        break;
      case "End":
        e.preventDefault();
        focusAt(list.length - 1);
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        close(true);
        break;
      case "Tab":
        setOpen(false);
        break;
      case " ":
        // Space activates a link in a menu, like Enter.
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.click();
        break;
      default:
        if (e.key.length === 1 && /\S/.test(e.key)) {
          const letter = e.key.toLowerCase();
          const ordered = [...list.slice(index + 1), ...list.slice(0, index + 1)];
          ordered.find((el) => el.textContent?.trim().toLowerCase().startsWith(letter))?.focus();
        }
    }
  }

  return (
    <div ref={wrap} className={cx("hq-quickadd", variant === "fab" && "hq-quickadd--fab")}>
      {variant === "fab" ? (
        <button
          ref={button}
          type="button"
          className="hq-fab"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          aria-label="Quick add"
          onClick={toggle}
          onKeyDown={onButtonKey}
        >
          <Icon name={open ? "close" : "plus"} size={22} />
        </button>
      ) : (
        <button
          ref={button}
          type="button"
          className={buttonClass({ variant: "secondary" })}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={toggle}
          onKeyDown={onButtonKey}
        >
          <span className="hq-btn__label">
            <Icon name="plus" size={16} />
            Quick add
          </span>
        </button>
      )}

      {open ? (
        <div ref={menu} id={menuId} role="menu" aria-label="Quick add" className="hq-menu" onKeyDown={onMenuKey}>
          {actions.map((a) => (
            <Link key={a.key} href={a.href} role="menuitem" tabIndex={-1} className="hq-menu__item" onClick={() => setOpen(false)}>
              <Icon name={a.icon} size={17} className="hq-menu__icon" />
              {a.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
