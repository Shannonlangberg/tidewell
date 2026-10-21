import Link from "next/link";
import { extensionOf, formatBytes, RESOURCE_CATEGORIES, RESOURCE_CATEGORY_BLURB, RESOURCE_CATEGORY_LABEL, fileKindLabel, previewKind, type ResourceCategory } from "@/lib/hq/resources/rules";
import type { ResourceRow } from "@/lib/hq/resources/queries";
import { LOGO_FILES } from "@/lib/hq/brand";
import { LinkButton } from "../../Button";
import { Icon } from "../../icons";
import { SectionLabel } from "../../Primitives";
import { StatusChip } from "../../StatusChip";

/*
 * The library, grouped by category: a thumbnail for pictures (a short-lived signed link in an <img>; an
 * uploaded SVG is never put into the page), the title, its file type, size and version, the note when it has
 * one, and a Download button. Server-rendered; the groups are native <details>, so they work without script
 * and by keyboard. Every file has its own Download link, and each group has a zip of its category. On the plain
 * library page the small foundation guideline cards (tag "foundation") sit under "More guidelines", so the brand
 * book and the current voice document lead; a search or filter shows every match flat.
 */

/** The tag the importer gives the guideline cards (one page each on spacing, radius, motion and so on). */
export const FOUNDATION_TAG = "foundation";

export const resourceHref = (id: string) => `/hq/resources/${id}`;
export const downloadHref = (id: string, version?: number) => `/hq/resources/${id}/download${version ? `?v=${version}` : ""}`;
export const zipHref = (category?: ResourceCategory) => `/hq/resources/zip${category ? `?category=${category}` : ""}`;

/** The short word on a file's tile: its extension (SVG, MD, JSX, D.TS). */
const thumbLabel = (fileName: string) => (fileName.toLowerCase().endsWith(".d.ts") ? "D.TS" : extensionOf(fileName).toUpperCase().slice(0, 5) || "FILE");

const darkTitles = new Set(LOGO_FILES.filter((l) => l.ground === "dark").map((l) => l.title));

function Thumb({ r, url }: { r: ResourceRow; url: string | undefined }) {
  if (url && previewKind(r.mimeType) === "image") {
    return (
      <span className="hq-res-thumb" data-ground={darkTitles.has(r.title) ? "dark" : "light"} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- a private signed URL; next/image would proxy it */}
        <img src={url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
      </span>
    );
  }
  return (
    <span className="hq-res-thumb hq-res-thumb--kind" aria-hidden="true">
      <Icon name="note" size={20} />
      <span>{thumbLabel(r.fileName)}</span>
    </span>
  );
}

function Row({ r, thumbs }: { r: ResourceRow; thumbs: ReadonlyMap<string, string> }) {
  return (
    <li className="hq-res-row">
      <Thumb r={r} url={thumbs.get(r.storagePath)} />
      <div className="hq-res-row__main">
        <p className="hq-res-row__title">
          <Link href={resourceHref(r.id)}>{r.title}</Link>
        </p>
        <p className="hq-res-row__meta">
          <span className="tabular-nums">{r.ref}</span> &middot; {fileKindLabel(r.fileName, r.mimeType)} &middot; {formatBytes(r.sizeBytes)} &middot; {r.version}
        </p>
        {r.description ? <p className="hq-res-row__desc">{r.description}</p> : null}
        {r.note || r.tags.length > 0 ? (
          <p className="hq-res-row__flags">
            {r.note ? <StatusChip tone="warning">Has a note</StatusChip> : null}
            {r.tags.slice(0, 4).map((t) => (
              <span key={t} className="hq-res-tag">
                {t}
              </span>
            ))}
          </p>
        ) : null}
      </div>
      <LinkButton href={downloadHref(r.id)} size="sm" icon="download" aria-label={`Download ${r.title}`} external className="hq-res-row__dl">
        Download
      </LinkButton>
    </li>
  );
}

export function ResourceGroups({ rows, thumbs, filtered }: { rows: readonly ResourceRow[]; thumbs: ReadonlyMap<string, string>; filtered: boolean }) {
  const groups = RESOURCE_CATEGORIES.map((c) => ({ c, list: rows.filter((r) => r.category === c) })).filter((g) => g.list.length > 0);
  return (
    <div className="grid gap-8">
      {groups.map(({ c, list }) => {
        const id = `res-group-${c}`;
        // A long group starts closed on the plain library page; a search or filter opens everything it found.
        const open = filtered || list.length <= 30;
        const tuck = !filtered && c === "guidelines";
        const main = tuck ? list.filter((r) => !r.tags.includes(FOUNDATION_TAG)) : list;
        const more = tuck ? list.filter((r) => r.tags.includes(FOUNDATION_TAG)) : [];
        return (
          <details key={c} className="hq-res-group" open={open}>
            <summary className="hq-res-group__summary">
              <SectionLabel as="h2" id={id} className="hq-res-group__label">
                {RESOURCE_CATEGORY_LABEL[c]} <span className="hq-res-group__count">({list.length})</span>
              </SectionLabel>
              <span className="hq-res-group__blurb">{RESOURCE_CATEGORY_BLURB[c]}</span>
              <Icon name="chevron-down" size={16} className="hq-res-group__chev" />
            </summary>
            <div className="hq-res-group__tools">
              <LinkButton href={zipHref(c)} size="sm" variant="ghost" icon="download" external>
                Download {RESOURCE_CATEGORY_LABEL[c].toLowerCase()} (zip)
              </LinkButton>
            </div>
            <ul className="hq-res-list">
              {main.map((r) => (
                <Row key={r.id} r={r} thumbs={thumbs} />
              ))}
            </ul>
            {more.length > 0 ? (
              <details className="hq-res-group mt-4">
                <summary className="hq-res-group__summary">
                  <SectionLabel as="h3" className="hq-res-group__label">
                    More guidelines <span className="hq-res-group__count">({more.length})</span>
                  </SectionLabel>
                  <span className="hq-res-group__blurb">One page each on colour, type, spacing, radius, motion, photography and the logo rules.</span>
                  <Icon name="chevron-down" size={16} className="hq-res-group__chev" />
                </summary>
                <ul className="hq-res-list">
                  {more.map((r) => (
                    <Row key={r.id} r={r} thumbs={thumbs} />
                  ))}
                </ul>
              </details>
            ) : null}
          </details>
        );
      })}
    </div>
  );
}
