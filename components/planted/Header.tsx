"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CONTACT, telHref } from "@/lib/planted";
import { Logo } from "./Logo";
import { Button } from "./ui";

/*
 * The floating pill nav (2026 handoff, design/components/navigation/Header).
 *
 * Transparent at the top of the page; past 40px it becomes a blurred ivory
 * capsule that narrows to 62rem. It hides on scroll down once past 400px and
 * returns on scroll up. Below 64rem a "Menu" pill opens a full-screen forest
 * panel that wipes down. The links are the site's real routes; the call to
 * action goes to the homepage contact form on the homepage and to the rental
 * appraisal page everywhere else.
 */

const NAV = [
  { href: "/property-management", label: "Property Management" },
  { href: "/why-planted", label: "Why PLANTED." },
  { href: "/our-approach", label: "Our Approach" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export function Header() {
  const pathname = usePathname();
  const [solid, setSolid] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);
  const ctaHref = pathname === "/" ? "#contact" : "/rental-appraisal";

  // Close the menu when the route changes. Adjusting state during render is the
  // supported pattern; an effect would run a frame late.
  const [routeAtOpen, setRouteAtOpen] = useState(pathname);
  if (pathname !== routeAtOpen) {
    setRouteAtOpen(pathname);
    if (open) setOpen(false);
  }

  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      setSolid(y > 40);
      setHidden((h) => (y > 400 && y > last + 4 ? true : y < last - 4 ? false : h));
      last = y;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Stop the page scrolling behind the open menu; Escape closes it.
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Focus moves into the panel when it opens and back to the toggle when it closes.
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
    // The panel is `visibility: hidden` until its transition starts.
    const t = window.setTimeout(() => closeButton.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, [open]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      <header className={`pl-nav ${solid ? "is-solid" : ""} ${hidden && !open ? "is-hidden" : ""}`}>
        <div className="pl-nav-in">
          <Logo height={20} href="/" />

          <nav className="pl-nav-links" aria-label="Main">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="pl-nav-link" aria-current={isActive(item.href) ? "page" : undefined}>
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <span className="pl-nav-cta">
              <Button href={ctaHref} size="sm">
                Book an appraisal
              </Button>
            </span>
            <button
              ref={openButton}
              type="button"
              className="pl-burger"
              onClick={() => setOpen(true)}
              aria-expanded={open}
              aria-controls="site-menu"
            >
              Menu
              <i aria-hidden="true">
                <b />
                <b />
              </i>
            </button>
          </div>
        </div>
      </header>

      <div
        id="site-menu"
        className={`pl-menu on-dark ${open ? "is-open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        aria-hidden={!open}
        inert={!open}
      >
        <div className="flex items-center justify-between">
          <Logo height={20} tone="light" />
          <button ref={closeButton} type="button" className="pl-menu-close" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>

        <nav aria-label="Main" className="flex flex-1 flex-col justify-center py-10">
          {NAV.map((item, i) => (
            <Link
              key={item.href}
              href={item.href}
              className="pl-menu-link"
              aria-current={isActive(item.href) ? "page" : undefined}
              onClick={() => setOpen(false)}
              style={{ transitionDelay: open ? `${0.25 + i * 0.06}s` : "0s" }}
            >
              {item.label}
              <span aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
            </Link>
          ))}
        </nav>

        <div className="grid gap-5">
          <div onClick={() => setOpen(false)}>
            <Button href={ctaHref} variant="lime" block>
              Book a rental appraisal
            </Button>
          </div>
          <div className="flex flex-wrap justify-between gap-2 text-[0.875rem] text-muted-dark">
            {CONTACT.phone && (
              <a href={telHref(CONTACT.phone)} className="no-underline hover:text-ivory">
                {CONTACT.phone}
              </a>
            )}
            {CONTACT.email && (
              <a href={`mailto:${CONTACT.email}`} className="no-underline hover:text-ivory">
                {CONTACT.email}
              </a>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
