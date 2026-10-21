import {
  BRAND_COLOURS,
  COLOUR_GROUP_LABEL,
  COLOUR_NOTES,
  GOOGLE_FONTS_IMPORT,
  NAME_RULES,
  TYPEFACES,
  isLightColour,
  rgbOf,
  type BrandColour,
  type Typeface,
} from "@/lib/hq/brand";
import { SectionLabel } from "../../Primitives";
import { CopyButton, CopySwatch } from "./CopyButton";

/*
 * "Brand at a glance": the colours (click a swatch to copy its hex), the two typefaces as specimens, and the
 * logo lockups as a small strip. Colours and type come from lib/hq/brand.ts (the design system's own tokens);
 * the logos are the library's own files, shown through short-lived signed links in <img> (an uploaded SVG is
 * never put into the page itself). Server-rendered; only the copy buttons are client components.
 */

export type StripLogo = { title: string; url: string; ground: "light" | "dark"; href: string };

function Swatch({ c }: { c: BrandColour }) {
  return (
    <li className="hq-res-colour">
      <CopySwatch hex={c.hex} name={c.name} textOnLight={isLightColour(c.hex)} />
      <div className="hq-res-colour__body">
        <p className="hq-res-colour__name">{c.name}</p>
        <p className="hq-res-colour__role">{c.role}</p>
        <p className="hq-res-colour__use">{c.use}</p>
        <p className="hq-res-colour__meta">
          RGB {rgbOf(c.hex)}
          {c.cmyk ? <> &middot; CMYK {c.cmyk}</> : null}
          <br />
          <code>{c.token}</code>
        </p>
      </div>
    </li>
  );
}

function Specimen({ t }: { t: Typeface }) {
  const family = t.key === "hanken" ? 'var(--font-hanken), "Hanken Grotesk", Arial, sans-serif' : 'var(--font-cormorant), "Cormorant Garamond", Georgia, serif';
  return (
    <div className="hq-res-specimen">
      <p className="hq-res-specimen__role">{t.role}</p>
      <h3 className="hq-res-specimen__family">{t.family}</h3>
      <p className="hq-res-specimen__sample" style={{ fontFamily: family, fontStyle: t.key === "cormorant" ? "italic" : "normal", fontWeight: t.key === "hanken" ? 400 : 500 }}>
        {t.sample}
      </p>
      <ul className="hq-res-specimen__weights" aria-label={`${t.family} weights`}>
        {t.weights.map((w) => {
          const weight = Number.parseInt(w, 10);
          const italic = /italic/i.test(w);
          return (
            <li key={w} style={{ fontFamily: family, fontWeight: weight, fontStyle: italic ? "italic" : "normal" }}>
              Aa <span className="hq-res-specimen__wlabel">{w}</span>
            </li>
          );
        })}
      </ul>
      <p className="hq-res-specimen__use">{t.use}</p>
      <div className="hq-res-specimen__link">
        <code>{t.googleUrl}</code>
        <CopyButton text={t.googleUrl} label="Copy link" done={`Copied the ${t.family} Google Fonts link`} size="sm" ariaLabel={`Copy the Google Fonts link for ${t.family}`} />
      </div>
    </div>
  );
}

export function BrandBand({ logos }: { logos: readonly StripLogo[] }) {
  const groups = (["core", "supporting", "functional"] as const).map((g) => ({ g, list: BRAND_COLOURS.filter((c) => c.group === g) }));
  return (
    <section aria-labelledby="res-glance" className="hq-res-band">
      <SectionLabel as="h2" id="res-glance" className="mb-5 border-b border-line pb-3.5">
        Brand at a glance
      </SectionLabel>

      <div className="grid gap-10">
        <div>
          <h3 className="hq-res-h">Colour</h3>
          <p className="hq-res-lede">Click a swatch to copy its hex.</p>
          {groups.map(({ g, list }) => (
            <div key={g} className="mt-5">
              <p className="hq-res-sub">{COLOUR_GROUP_LABEL[g]}</p>
              <ul className={g === "core" ? "hq-res-colours hq-res-colours--core" : "hq-res-colours"}>
                {list.map((c) => (
                  <Swatch key={c.key} c={c} />
                ))}
              </ul>
            </div>
          ))}
          <ul className="hq-res-notes">
            {COLOUR_NOTES.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="hq-res-h">Type</h3>
          <p className="hq-res-lede">Both families load from Google Fonts: the design system has no font files.</p>
          <div className="hq-res-specimens">
            {TYPEFACES.map((t) => (
              <Specimen key={t.key} t={t} />
            ))}
          </div>
          <div className="hq-res-import">
            <p className="hq-res-sub">Load both</p>
            <div className="hq-res-specimen__link">
              <code>{GOOGLE_FONTS_IMPORT}</code>
              <CopyButton text={GOOGLE_FONTS_IMPORT} label="Copy import" done="Copied the Google Fonts import" size="sm" ariaLabel="Copy the CSS import that loads both families" />
            </div>
            <p className="hq-res-notes-line">
              The same line is in the <em>Font loading (fonts.css)</em> file below.
            </p>
          </div>
        </div>

        <div>
          <h3 className="hq-res-h">Name</h3>
          <ul className="hq-res-notes">
            {NAME_RULES.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>

        {logos.length > 0 ? (
          <div>
            <h3 className="hq-res-h">Logos</h3>
            <p className="hq-res-lede">The lockups most often used. Open one for the file; the rest are in the Logos list below.</p>
            <ul className="hq-res-logos">
              {logos.map((l) => (
                <li key={l.title}>
                  <a href={l.href} className="hq-res-logo" data-ground={l.ground}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- a private signed URL; next/image would proxy it */}
                    <img src={l.url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                    <span className="hq-res-logo__title">{l.title}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
