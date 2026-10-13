"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Logo } from "./Logo";

/*
 * Sticky navigation. Over the homepage hero it sits on the photograph in light
 * tone and becomes a solid ivory bar once you scroll past it; everywhere else it
 * is solid from the start. The mobile menu is a full-height charcoal panel.
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
  window.addEventListener("resize", onChange, { passive: true });
  return () => {
    window.removeEventListener("scroll", onChange);
    window.removeEventListener("resize", onChange);
  };
}
const pastHero = () => window.scrollY > window.innerHeight * 0.72;
const notPastHero = () => false;

export function Header() {
  const pathname = usePathname();
  const overHero = pathname === "/";
  const scrolled = useSyncExternalStore(subscribeScroll, pastHero, notPastHero);
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

  const solid = !overHero || scrolled;
  const tone = solid ? "dark" : "light";

  return (
    <>
      <header
        className={`fixed inset-x-0 top-0 z-50 transition-[background-color,border-color] duration-500 ${
          solid ? "border-b border-line bg-ivory/95 backdrop-blur-sm" : "border-b border-transparent"
        }`}
      >
        {/* Over the hero the sky can be bright, so the light wordmark and nav get
            their own scrim rather than relying on the photograph behind them. */}
        {!solid && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-32"
            style={{ background: "linear-gradient(to bottom, rgba(23,23,23,0.62) 0%, rgba(23,23,23,0.32) 55%, rgba(23,23,23,0) 100%)" }}
          />
        )}
        <div className="shell relative flex items-center justify-between gap-8 py-5 md:py-6">
          <Logo variant="wordmark" tone={tone} className="text-[1.5rem] md:text-[1.75rem]" />

          <nav aria-label="Main" className="hidden items-center gap-10 lg:flex">
            {NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`relative py-1 text-[0.8125rem] no-underline transition-colors duration-300 ${
                    tone === "light" ? "text-ivory/85 hover:text-ivory" : "text-ink-muted hover:text-charcoal"
                  } ${active ? (tone === "light" ? "!text-ivory" : "!text-charcoal") : ""}`}
                  style={{ letterSpacing: "0.04em" }}
                >
                  {item.label}
                  {active && (
                    <span
                      aria-hidden="true"
                      className={`absolute -bottom-0.5 left-0 h-px w-full ${tone === "light" ? "bg-ivory" : "bg-charcoal"}`}
                    />
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-4">
            <Link
              href="/rental-appraisal"
              className={`btn hidden md:inline-flex ${tone === "light" ? "btn-light" : "btn-primary"}`}
              style={{ minHeight: "2.75rem", padding: "0.625rem 1.5rem", fontSize: "0.75rem" }}
            >
              Get a Rental Appraisal
            </Link>

            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label="Open menu"
              aria-expanded={open}
              className="flex h-11 w-11 items-center justify-center lg:hidden"
            >
              <span className="flex w-6 flex-col gap-[5px]">
                <span className={`h-px w-full ${tone === "light" ? "bg-ivory" : "bg-charcoal"}`} />
                <span className={`h-px w-full ${tone === "light" ? "bg-ivory" : "bg-charcoal"}`} />
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Mobile and tablet menu */}
      {/* `invisible` when closed, so the panel is neither painted over the header
          nor reachable by keyboard; `visibility` is transitionable, so the fade
          out still plays before it goes. */}
      <div
        className={`fixed inset-0 z-[60] transition-[opacity,visibility] duration-500 lg:hidden ${
          open ? "visible opacity-100" : "invisible opacity-0"
        }`}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="absolute inset-0 bg-charcoal" onClick={() => setOpen(false)} />
        <div className="on-dark relative flex h-full flex-col">
          <div className="shell flex items-center justify-between py-5 md:py-6">
            <Logo variant="wordmark" tone="light" className="text-[1.5rem] md:text-[1.75rem]" href={null} />
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="flex h-11 w-11 items-center justify-center"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                <path d="M2 2l16 16M18 2L2 18" stroke="var(--color-ivory)" strokeWidth="1" />
              </svg>
            </button>
          </div>

          <nav aria-label="Main" className="shell flex flex-1 flex-col justify-center gap-1 pb-24">
            {NAV.map((item, i) => (
              <Link
                key={item.href}
                href={item.href}
                className="display display-md border-b border-taupe/25 py-5 text-ivory no-underline transition-[padding,opacity,transform] duration-500"
                style={{
                  opacity: open ? 1 : 0,
                  transform: open ? "none" : "translateY(0.75rem)",
                  transitionDelay: open ? `${80 + i * 55}ms` : "0ms",
                }}
              >
                {item.label}
              </Link>
            ))}
            <Link
              href="/rental-appraisal"
              className="btn btn-light mt-10 w-full transition-opacity duration-500"
              style={{ opacity: open ? 1 : 0, transitionDelay: open ? `${80 + NAV.length * 55}ms` : "0ms" }}
            >
              Get a Rental Appraisal
            </Link>
          </nav>
        </div>
      </div>
    </>
  );
}
