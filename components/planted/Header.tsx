"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CONTACT, telHref } from "@/lib/planted";
import { Logo } from "./Logo";

/*
 * Sticky navigation on ivory. Once the page scrolls it tightens, gains a
 * hairline, and a clay line along its foot fills as you read (CSS only, see
 * planted.css). The point (the wordmark's full stop, in clay) marks the page
 * you are on. "Get a rental appraisal" stays in reach at every width: on the
 * homepage on phones it moves to a bar at the foot of the screen once the
 * cover has scrolled away, alongside a call button, and steps aside again for
 * the closing section. The mobile menu is a full-height charcoal panel.
 */

const NAV = [
  { href: "/property-management", label: "Property Management" },
  { href: "/why-planted", label: "Why PLANTED." },
  { href: "/our-approach", label: "Our Approach" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

/** Scroll position as an external store, so no effect has to set state for it. */
function subscribeScroll(onChange: () => void) {
  window.addEventListener("scroll", onChange, { passive: true });
  return () => window.removeEventListener("scroll", onChange);
}
type ScrollState = "top" | "scrolled" | "bar";
/** "bar": past the cover and not yet at the close, where the mobile action bar shows. */
function scrollState(): ScrollState {
  const y = window.scrollY;
  if (y <= 8) return "top";
  const close = document.getElementById("close");
  const closeInView = close ? close.getBoundingClientRect().top < window.innerHeight : false;
  return y > window.innerHeight * 0.8 && !closeInView ? "bar" : "scrolled";
}
const serverScrollState = (): ScrollState => "top";

export function Header() {
  const pathname = usePathname();
  const scroll = useSyncExternalStore(subscribeScroll, scrollState, serverScrollState);
  const scrolled = scroll !== "top";
  const showBar = pathname === "/" && scroll === "bar";
  const [open, setOpen] = useState(false);

  // Close the menu when the route changes. Adjusting state during render is the
  // supported pattern for this; an effect would run a frame late and trips
  // react-hooks/set-state-in-effect.
  const [routeAtOpen, setRouteAtOpen] = useState(pathname);
  if (pathname !== routeAtOpen) {
    setRouteAtOpen(pathname);
    if (open) setOpen(false);
  }

  // Stop the page scrolling behind the open menu.
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Move focus into the panel when it opens and back to the toggle when it
  // closes, so keyboard and screen-reader users are never left behind it.
  const openButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    const was = wasOpen.current;
    wasOpen.current = open;
    if (!open) {
      if (was) openButton.current?.focus();
      return;
    }
    // The panel is still `visibility: hidden` for a frame as its transition
    // starts, and a hidden element can't take focus, so wait for it.
    const t = window.setTimeout(() => closeButton.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, [open]);

  return (
    <>
      <header
        className={`fixed inset-x-0 top-0 z-50 border-b bg-ivory/95 backdrop-blur-sm transition-[border-color] duration-500 ${
          scrolled ? "border-line" : "border-transparent"
        }`}
      >
        <div
          className={`shell flex items-center justify-between gap-6 transition-[padding] duration-500 ${
            scrolled ? "py-2.5 md:py-3" : "py-4 md:py-5"
          }`}
        >
          <Logo variant="wordmark" tone="dark" className="text-[1.5rem] md:text-[1.75rem]" />

          <nav aria-label="Main" className="hidden items-center gap-9 lg:flex">
            {NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`relative inline-flex items-center gap-2 py-2 text-[0.875rem] font-medium no-underline transition-colors duration-300 ${
                    active ? "text-charcoal" : "text-ink-muted hover:text-charcoal"
                  }`}
                  style={{ letterSpacing: "0.02em" }}
                >
                  <span
                    aria-hidden="true"
                    className={`pt transition-[opacity,transform] duration-300 [--pt-size:0.375rem] ${
                      active ? "opacity-100" : "scale-50 opacity-0"
                    }`}
                  />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2 md:gap-4">
            <Link
              href="/rental-appraisal"
              className={`btn btn-outline sm:btn-primary-sm hdr-cta ${showBar ? "is-tucked" : ""}`}
              style={{ minHeight: "2.75rem", padding: "0.625rem 0.875rem", fontSize: "0.75rem", letterSpacing: "0.05em", whiteSpace: "nowrap" }}
            >
              <span className="sm:hidden"><span className="hidden min-[360px]:inline">Rental </span>appraisal</span>
              <span className="hidden sm:inline">Get a rental appraisal</span>
            </Link>

            <button
              type="button"
              ref={openButton}
              onClick={() => setOpen(true)}
              aria-label="Open menu"
              aria-expanded={open}
              aria-controls="site-menu"
              className="-mr-2 flex h-11 w-11 items-center justify-center lg:hidden"
            >
              <span className="flex w-6 flex-col gap-[6px]">
                <span className="h-px w-full bg-charcoal" />
                <span className="h-px w-full bg-charcoal" />
              </span>
            </button>
          </div>
        </div>
        <span aria-hidden="true" className="read-progress" />
      </header>

      {/* Homepage, phones only: the two ways to start, at thumb height. Hidden from
          assistive tech and the tab order while it is off screen. */}
      {pathname === "/" && (
        <div
          className={`action-bar sm:hidden ${showBar ? "is-shown" : ""}`}
          aria-hidden={!showBar}
          inert={!showBar}
        >
          {CONTACT.phone && (
            <a href={telHref(CONTACT.phone)} className="btn btn-outline flex-1 !bg-ivory" style={{ minHeight: "3rem", padding: "0.75rem 1rem" }}>
              Call
            </a>
          )}
          <Link href="/rental-appraisal" className="btn btn-primary flex-[2.2]" style={{ minHeight: "3rem", padding: "0.75rem 1rem" }}>
            Get a rental appraisal
          </Link>
        </div>
      )}

      {/* Mobile and tablet menu */}
      {/* `invisible` when closed, so the panel is neither painted over the header
          nor reachable by keyboard; `visibility` is transitionable, so the fade
          out still plays before it goes. */}
      <div
        id="site-menu"
        className={`fixed inset-0 z-[60] transition-[opacity,visibility] duration-500 lg:hidden ${
          open ? "visible opacity-100" : "invisible opacity-0"
        }`}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="absolute inset-0 bg-charcoal" onClick={() => setOpen(false)} />
        <div className="on-dark relative flex h-full flex-col overflow-y-auto">
          <div className="shell flex items-center justify-between py-4 md:py-5">
            <Logo variant="wordmark" tone="light" className="text-[1.5rem] md:text-[1.75rem]" href={null} />
            <button
              type="button"
              ref={closeButton}
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="-mr-2 flex h-11 w-11 items-center justify-center"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                <path d="M2 2l16 16M18 2L2 18" stroke="var(--color-ivory)" strokeWidth="1" />
              </svg>
            </button>
          </div>

          <nav aria-label="Main" className="shell flex flex-1 flex-col justify-center gap-1 pb-16 pt-8">
            {NAV.map((item, i) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className="display display-md flex items-center gap-4 border-b border-taupe/25 py-5 text-ivory no-underline transition-[opacity,transform] duration-500"
                  style={{
                    opacity: open ? 1 : 0,
                    transform: open ? "none" : "translateY(0.75rem)",
                    transitionDelay: open ? `${80 + i * 55}ms` : "0ms",
                  }}
                >
                  {item.label}
                  {active && <span aria-hidden="true" className="pt [--pt-size:0.5rem]" />}
                </Link>
              );
            })}
            <Link
              href="/rental-appraisal"
              className="btn btn-light mt-10 w-full transition-opacity duration-500"
              style={{ opacity: open ? 1 : 0, transitionDelay: open ? `${80 + NAV.length * 55}ms` : "0ms" }}
            >
              Get a rental appraisal
            </Link>
          </nav>
        </div>
      </div>
    </>
  );
}
