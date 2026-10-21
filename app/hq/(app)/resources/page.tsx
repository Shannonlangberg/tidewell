import type { Metadata } from "next";
import { requireStaff } from "@/lib/hq/auth";
import { LOGO_FILES } from "@/lib/hq/brand";
import { listResources, signedPreviewUrls } from "@/lib/hq/resources/queries";
import { RESOURCE_CATEGORIES, RESOURCE_CATEGORY_LABEL, parseResourceListQuery } from "@/lib/hq/resources/rules";
import { EmptyState, ErrorState, FilterBar, LinkButton, PageHeader, SearchInput, Select, buildHref } from "@/components/hq";
import { BrandBand, type StripLogo } from "@/components/hq/features/resources/BrandBand";
import { ResourceGroups, resourceHref, zipHref } from "@/components/hq/features/resources/ResourceList";
import { AddResource } from "@/components/hq/features/resources/ResourceUploads";

export const metadata: Metadata = { title: "Resources" };

const PATH = "/hq/resources";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ResourcesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { db, can } = await requireStaff("resources.read", false, buildHref(PATH, sp));
  const canManage = can("resources.manage");
  const query = parseResourceListQuery(sp);

  // The whole library is read once (it is a few hundred rows at most); the logo strip needs the logos whatever the search.
  const [all, found] = await Promise.all([listResources(db), listResources(db, { category: query.category, q: query.q })]);

  const rows = found.ok ? found.data : [];
  const logoTitles = new Map(LOGO_FILES.filter((l) => l.strip).map((l, order) => [l.title, { l, order }]));
  // A search or a filter goes straight to the files: the band (colours, type, logos) is for the plain library page.
  const stripRows = all.ok && !query.filtered ? all.data.filter((r) => logoTitles.has(r.title) && r.category === "logos").sort((a, b) => logoTitles.get(a.title)!.order - logoTitles.get(b.title)!.order) : [];
  // Thumbnails and the logo strip: ONE signing call for every picture on the page, as this person.
  const pictures = [...new Set([...rows, ...stripRows].filter((r) => /^image\/(svg\+xml|png|jpeg)$/.test(r.mimeType)).map((r) => r.storagePath))];
  const urls = await signedPreviewUrls(db, pictures);
  const strip: StripLogo[] = stripRows.flatMap((r) => {
    const url = urls.get(r.storagePath);
    return url ? [{ title: r.title, url, ground: logoTitles.get(r.title)!.l.ground, href: resourceHref(r.id) }] : [];
  });

  const total = all.ok ? all.data.length : 0;
  const add = canManage ? <AddResource /> : null;
  const actions = (
    <span className="flex flex-wrap gap-2">
      {total > 0 ? (
        <LinkButton href={zipHref()} icon="download" external>
          Download all
        </LinkButton>
      ) : null}
      {add}
    </span>
  );

  const empty = query.filtered ? (
    <EmptyState
      title="Nothing matches"
      action={
        <LinkButton href={PATH} variant="secondary">
          Clear filters
        </LinkButton>
      }
    >
      Try fewer words, or clear the filters to see every file.
    </EmptyState>
  ) : (
    <EmptyState title="No files here yet" action={add ?? undefined}>
      {canManage
        ? "Add the brand guide, logos, photos and tokens. Everyone in HQ can view and download them, and connected chat apps can read them."
        : "When the brand files are added, they will be here for everyone to view and download."}
    </EmptyState>
  );

  return (
    <>
      <PageHeader title="Resources" description="PLANTED.'s brand library: guide, logos, photos, colours, fonts and design tokens. Everyone can view and download; a director or administrator adds and updates." actions={actions} />

      {query.filtered ? null : <BrandBand logos={strip} />}

      <section aria-labelledby="res-files" className={query.filtered ? "mt-2" : "mt-12"}>
        <h2 id="res-files" className="sr-only">
          Files
        </h2>
        <FilterBar
          action={PATH}
          label="Search and filter resources"
          resetHref={PATH}
          active={query.filtered}
          more={
            <Select
              name="category"
              label="Category"
              hideLabel
              placeholder="Any category"
              defaultValue={query.category ?? ""}
              options={RESOURCE_CATEGORIES.map((c) => ({ value: c, label: RESOURCE_CATEGORY_LABEL[c] }))}
            />
          }
          moreActive={query.category !== null}
          moreLabel="Filter"
        >
          <SearchInput placeholder="Search files, tags or RES-0001" defaultValue={query.q} label="Search resources" />
        </FilterBar>

        <div className="mt-6">
          {!found.ok || !all.ok ? (
            <ErrorState
              title="We could not load the resources"
              action={
                <LinkButton href={buildHref(PATH, sp)} size="sm">
                  Try again
                </LinkButton>
              }
            />
          ) : rows.length === 0 ? (
            empty
          ) : (
            <>
              <p className="hq-muted mb-5 text-[14px]" role="status">
                {query.filtered ? `${rows.length} of ${total} ${total === 1 ? "file" : "files"}` : `${total} ${total === 1 ? "file" : "files"}`}
              </p>
              <ResourceGroups rows={rows} thumbs={urls} filtered={query.filtered} />
            </>
          )}
        </div>
      </section>
    </>
  );
}
