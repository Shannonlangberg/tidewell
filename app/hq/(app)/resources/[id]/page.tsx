import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { LOGO_FILES } from "@/lib/hq/brand";
import { formatDate, formatDateTime } from "@/lib/hq/format";
import { isUuid } from "@/lib/hq/forms";
import { getResource, listVersions, readText, signedPreviewUrls } from "@/lib/hq/resources/queries";
import { RESOURCE_CATEGORY_LABEL, TEXT_PREVIEW_MAX_BYTES, fileKindLabel, formatBytes, previewKind } from "@/lib/hq/resources/rules";
import { ErrorState, InlineNote, KeyValueList, LinkButton, PageHeader, SectionLabel, type KeyValueItem } from "@/components/hq";
import { ArchiveResource, EditResource, RestoreResource } from "@/components/hq/features/resources/ResourceControls";
import { CopyButton } from "@/components/hq/features/resources/CopyButton";
import { downloadHref } from "@/components/hq/features/resources/ResourceList";
import { ReplaceFile } from "@/components/hq/features/resources/ResourceUploads";
import { TextPreview } from "@/components/hq/features/resources/TextPreview";

export const metadata: Metadata = { title: "Resources" };

type Params = Promise<{ id: string }>;

export default async function ResourcePage({ params }: { params: Params }) {
  const { id } = await params;
  const { db, staff, can } = await requireStaff("resources.read", false, isUuid(id) ? `/hq/resources/${id}` : "/hq/resources");
  if (!isUuid(id)) notFound();
  const canManage = can("resources.manage");

  const [found, history] = await Promise.all([getResource(db, id), listVersions(db, id)]);
  if (!found.ok) {
    return (
      <>
        <PageHeader title="Resources" breadcrumbs={[{ label: "Resources", href: "/hq/resources" }, { label: "Resource" }]} />
        <ErrorState
          title="We could not load this resource"
          action={
            <LinkButton href={`/hq/resources/${id}`} size="sm">
              Try again
            </LinkButton>
          }
        />
      </>
    );
  }
  // Missing, archived (for someone who cannot restore it) and "not yours to see" are the same answer.
  if (!found.data) notFound();
  const r = found.data;
  const live = !r.archived;
  const kind = previewKind(r.mimeType);
  const ground = LOGO_FILES.find((l) => l.title === r.title)?.ground ?? "light";

  // The preview: a picture through a short-lived signed link in an <img>; small text as text; everything else a download.
  let image: string | undefined;
  let text: { text: string; truncated: boolean } | null = null;
  let tooBig = false;
  if (kind === "image") image = (await signedPreviewUrls(db, [r.storagePath])).get(r.storagePath);
  if (kind === "text") {
    if (r.sizeBytes > TEXT_PREVIEW_MAX_BYTES) tooBig = true;
    else text = await readText(db, r.storagePath, TEXT_PREVIEW_MAX_BYTES);
  }

  const details: KeyValueItem[] = [
    { label: "Category", value: RESOURCE_CATEGORY_LABEL[r.category] },
    { label: "File", value: <span className="break-all">{r.fileName}</span> },
    { label: "Type", value: fileKindLabel(r.fileName, r.mimeType) },
    { label: "Size", value: formatBytes(r.sizeBytes) },
    { label: "Version", value: r.version },
    { label: "Added", value: `${formatDate(r.createdAt)}${r.createdByName ? ` by ${r.createdByName}` : ""}` },
    { label: "Last changed", value: <time dateTime={r.updatedAt}>{formatDateTime(r.updatedAt, staff.timezone)}</time> },
    { label: "Tags", value: r.tags.length ? r.tags.join(", ") : null, empty: "None" },
    { label: "Fingerprint", value: <code className="hq-res-hash">{r.contentSha256}</code> },
  ];

  const versions = history.ok ? history.data : [];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Resources", href: "/hq/resources" }, { label: r.ref }]}
        eyebrow={r.ref}
        title={r.title}
        meta={
          <span className="text-[13px] text-grey-text">
            {RESOURCE_CATEGORY_LABEL[r.category]} &middot; {fileKindLabel(r.fileName, r.mimeType)} &middot; {formatBytes(r.sizeBytes)} &middot; {r.version}
          </span>
        }
        actions={
          <span className="flex flex-wrap gap-2">
            {live ? (
              <LinkButton href={downloadHref(r.id)} variant="primary" icon="download" external>
                Download
              </LinkButton>
            ) : null}
            <CopyButton text={`/hq/resources/${r.id}`} absolute label="Copy link" done="Copied the link to this resource" />
          </span>
        }
      />

      {r.archived ? <InlineNote className="mb-6">This resource is archived: staff and connected chat apps do not see it. Nothing was erased; restore it to bring it back.</InlineNote> : null}

      {r.note ? (
        <div className="hq-kb-banner mb-6" role="note">
          <span className="hq-kb-banner__text">
            <span className="hq-kb-banner__title">Note</span>
            {r.note}
          </span>
        </div>
      ) : null}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-10">
          <section aria-labelledby="res-preview">
            <SectionLabel as="h2" id="res-preview" className="mb-4 border-b border-line pb-3.5">
              Preview
            </SectionLabel>
            {r.description ? <p className="mb-5 text-[15px] text-grey-text">{r.description}</p> : null}
            {kind === "image" && image ? (
              <div className="hq-res-frame" data-ground={ground}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a private signed URL; the file is shown only through <img>, never inline */}
                <img src={image} alt={`Preview of ${r.title}`} decoding="async" referrerPolicy="no-referrer" />
              </div>
            ) : null}
            {kind === "image" && !image ? <InlineNote>We could not make a preview of this picture. You can still download it.</InlineNote> : null}
            {kind === "text" && text ? <TextPreview text={text.text} label={r.fileName} truncated={text.truncated} /> : null}
            {kind === "text" && !text && !tooBig ? <InlineNote>We could not read this file to show it. You can still download it.</InlineNote> : null}
            {kind === "text" && tooBig ? <InlineNote>This file is {formatBytes(r.sizeBytes)}, too large to show here. Download it to read it.</InlineNote> : null}
            {kind === "none" ? <InlineNote>There is no preview for this kind of file. Download it to open it.</InlineNote> : null}
            {r.mimeType === "text/html" && text ? (
              <p className="hq-muted mt-3 text-[13px]">HTML files are shown as their source and offered as a download. HQ never displays them as a web page.</p>
            ) : null}
          </section>

          <section aria-labelledby="res-versions">
            <SectionLabel as="h2" id="res-versions" className="mb-5 border-b border-line pb-3.5">
              Version history
            </SectionLabel>
            {versions.length === 0 ? (
              <p className="hq-muted text-[14px]">No earlier versions.</p>
            ) : (
              <ol className="hq-res-versions">
                {versions.map((v, i) => (
                  <li key={v.id} className="hq-res-version">
                    <div className="hq-res-version__main">
                      <p className="hq-res-version__title">
                        {v.label}
                        {i === 0 ? <span className="hq-res-version__current"> &middot; current</span> : null}
                      </p>
                      <p className="hq-res-version__meta">
                        {v.fileName} &middot; {formatBytes(v.sizeBytes)} &middot; <time dateTime={v.createdAt}>{formatDateTime(v.createdAt, staff.timezone)}</time>
                        {v.createdByName ? ` · ${v.createdByName}` : ""}
                      </p>
                      {v.changeNote ? <p className="hq-res-version__note">{v.changeNote}</p> : null}
                    </div>
                    {live ? (
                      <LinkButton href={downloadHref(r.id, v.versionNumber)} size="sm" variant="ghost" icon="download" external aria-label={`Download ${v.label} of ${r.title}`}>
                        Download
                      </LinkButton>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <aside className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-8" aria-label="Details and actions">
          <section aria-labelledby="res-details">
            <SectionLabel as="h2" id="res-details" className="mb-4 border-b border-line pb-3.5">
              Details
            </SectionLabel>
            <KeyValueList items={details} />
          </section>

          {canManage ? (
            <section aria-labelledby="res-manage">
              <SectionLabel as="h2" id="res-manage" className="mb-4 border-b border-line pb-3.5">
                Manage
              </SectionLabel>
              <div className="flex flex-wrap gap-2">
                {live ? (
                  <>
                    <EditResource resource={{ id: r.id, title: r.title, category: r.category, description: r.description, tags: r.tags, note: r.note, sortOrder: r.sortOrder }} />
                    <ReplaceFile id={r.id} title={r.title} version={r.version} />
                    <ArchiveResource id={r.id} title={r.title} />
                  </>
                ) : (
                  <RestoreResource id={r.id} />
                )}
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </>
  );
}
