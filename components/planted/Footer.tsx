import Link from "next/link";
import { AREAS, BRAND, CONTACT, SOCIAL, STAFF_HQ_URL, telHref } from "@/lib/planted";
import { Logo } from "./Logo";

/*
 * Forest footer (2026 handoff, design/components/navigation/Footer): the
 * tagline and link columns, then the wordmark at full width, then the legal
 * row. Every contact line is conditional: nothing appears until it is a real,
 * confirmed detail in lib/planted.ts.
 */

const EXPLORE = [
  { href: "/property-management", label: "Property Management" },
  { href: "/why-planted", label: "Why PLANTED." },
  { href: "/our-approach", label: "Our Approach" },
  { href: "/areas-we-serve", label: "Areas We Serve" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

const LEGAL = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  // Planted HQ, the private staff portal, on its own host. Discreet by design:
  // HQ is noindex and requires a staff login.
  { href: STAFF_HQ_URL, label: "Staff login" },
];

const head = "mb-4 text-[0.8125rem] text-muted-dark";

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="on-dark bg-forest text-ivory">
      <div className="shell pb-6 pt-12">
        <div className="pl-grid border-t border-[var(--line-dark)] pt-12">
          <p className="m-0 max-w-[22rem] text-[clamp(1.4rem,2vw,1.75rem)] leading-[1.2] tracking-[-0.025em] md:col-span-5">
            {BRAND.tagline}
          </p>

          <nav className="md:col-span-3 lg:col-span-2" aria-labelledby="footer-explore">
            <p className={head} id="footer-explore">
              Explore
            </p>
            <ul className="grid gap-[0.45rem]">
              {EXPLORE.map((p) => (
                <li key={p.href}>
                  <Link href={p.href} className="pl-foot-link">
                    {p.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav className="md:col-span-2" aria-labelledby="footer-areas">
            <p className={head} id="footer-areas">
              Areas
            </p>
            <ul className="grid gap-[0.45rem]">
              {AREAS.map((a) => (
                <li key={a.slug}>
                  <Link href={`/areas-we-serve/${a.slug}`} className="pl-foot-link">
                    {a.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="md:col-span-12 lg:col-span-3">
            <p className={head}>Contact</p>
            <ul className="grid gap-[0.45rem]">
              {CONTACT.phone && (
                <li>
                  <a href={telHref(CONTACT.phone)} className="pl-foot-link tnum">
                    {CONTACT.phone}
                  </a>
                </li>
              )}
              {CONTACT.email && (
                <li className="[overflow-wrap:anywhere]">
                  <a href={`mailto:${CONTACT.email}`} className="pl-foot-link">
                    {CONTACT.email}
                  </a>
                </li>
              )}
              {CONTACT.businessHours && <li className="text-muted-dark">{CONTACT.businessHours}</li>}
              <li>
                <Link href="/contact" className="pl-foot-link">
                  Send an enquiry
                </Link>
              </li>
              {SOCIAL.map((s) => (
                <li key={s.href}>
                  <a href={s.href} className="pl-foot-link">
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-[clamp(4rem,8vw,7rem)]">
          <Logo tone="light" height={null} />
        </div>

        <div className="mt-8 flex flex-wrap justify-between gap-4 text-[0.8125rem] text-muted-dark">
          <span>
            &copy; {year} {BRAND.name}
            {CONTACT.legalName && <> &middot; {CONTACT.legalName}</>}
            {CONTACT.abn && <span className="whitespace-nowrap"> &middot; ABN {CONTACT.abn}</span>}
            {CONTACT.licenceNumber && <> &middot; {CONTACT.licenceNumber}</>}
          </span>
          <span className="flex gap-6">
            {LEGAL.map((l) =>
              l.href.startsWith("http") ? (
                <a key={l.href} href={l.href} className="pl-foot-legal">
                  {l.label}
                </a>
              ) : (
                <Link key={l.href} href={l.href} className="pl-foot-legal">
                  {l.label}
                </Link>
              ),
            )}
          </span>
        </div>
      </div>
    </footer>
  );
}
