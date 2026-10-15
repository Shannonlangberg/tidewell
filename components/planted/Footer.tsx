import Link from "next/link";
import { AREAS, BRAND, CONTACT, SOCIAL, telHref } from "@/lib/planted";
import { Logo } from "./Logo";

/*
 * Charcoal footer with the wordmark at display scale. Every contact line is
 * conditional: nothing appears here until it is a real, confirmed detail.
 */

const PAGES = [
  { href: "/property-management", label: "Property Management" },
  { href: "/why-planted", label: "Why PLANTED." },
  { href: "/our-approach", label: "Our Approach" },
  { href: "/areas-we-serve", label: "Areas We Serve" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

const LEGAL = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms & Disclaimer" },
  // Planted HQ, the private staff portal. Discreet by design: the page is noindex and
  // requires a staff login.
  { href: "/hq", label: "Staff login" },
];

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="on-dark bg-charcoal text-ivory">
      <div className="shell py-20 md:py-28">
        <div className="grid gap-16 lg:grid-cols-12 lg:gap-12">
          {/* Wordmark at display scale */}
          <div className="lg:col-span-5">
            <Logo variant="full" tone="light" href={null} className="text-[clamp(2.75rem,6vw,4.5rem)]" />
            <p className="lede lede-light mt-8 max-w-sm">{BRAND.tagline}</p>
          </div>

          <nav className="lg:col-span-3" aria-labelledby="footer-pages">
            <p className="label label-light" id="footer-pages">
              Pages
            </p>
            <ul className="mt-6 space-y-3">
              {PAGES.map((p) => (
                <li key={p.href}>
                  <Link href={p.href} className="text-[0.9375rem] text-stone no-underline transition-colors duration-300 hover:text-ivory">
                    {p.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav className="lg:col-span-2" aria-labelledby="footer-areas">
            <p className="label label-light" id="footer-areas">
              Areas
            </p>
            <ul className="mt-6 space-y-3">
              {AREAS.map((a) => (
                <li key={a.slug}>
                  <Link
                    href={`/areas-we-serve/${a.slug}`}
                    className="text-[0.9375rem] text-stone no-underline transition-colors duration-300 hover:text-ivory"
                  >
                    {a.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="lg:col-span-2">
            <p className="label label-light">Get in touch</p>
            <ul className="mt-6 space-y-3 text-[0.9375rem] text-stone">
              {CONTACT.phone && (
                <li>
                  <a href={telHref(CONTACT.phone)} className="no-underline transition-colors duration-300 hover:text-ivory">
                    {CONTACT.phone}
                  </a>
                </li>
              )}
              {CONTACT.email && (
                <li>
                  <a href={`mailto:${CONTACT.email}`} className="break-words no-underline transition-colors duration-300 hover:text-ivory">
                    {CONTACT.email}
                  </a>
                </li>
              )}
              {CONTACT.businessHours && <li>{CONTACT.businessHours}</li>}
              <li>
                <Link href="/contact" className="no-underline transition-colors duration-300 hover:text-ivory">
                  Send an enquiry
                </Link>
              </li>
              {SOCIAL.length > 0 && (
                <li className="flex gap-4 pt-2">
                  {SOCIAL.map((s) => (
                    <a key={s.href} href={s.href} className="no-underline hover:text-ivory">
                      {s.label}
                    </a>
                  ))}
                </li>
              )}
            </ul>
          </div>
        </div>

        <div className="rule-dark mt-20 flex flex-col gap-6 pt-8 md:flex-row md:items-center md:justify-between">
          <p className="text-[0.8125rem] text-taupe">
            &copy; {year} {BRAND.name} {CONTACT.legalName && <span>&middot; {CONTACT.legalName}</span>}
            {CONTACT.abn && <span> &middot; {CONTACT.abn}</span>}
            {CONTACT.licenceNumber && <span> &middot; {CONTACT.licenceNumber}</span>}
          </p>
          <ul className="flex flex-wrap gap-6">
            {LEGAL.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="text-[0.8125rem] text-taupe no-underline transition-colors duration-300 hover:text-ivory">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/*
          Before launch, add here: registered business name, ABN, South Australian
          land agent registration number and the registered office address.
          lib/planted.ts holds them; each line above appears once its value is set.
        */}
      </div>
    </footer>
  );
}
