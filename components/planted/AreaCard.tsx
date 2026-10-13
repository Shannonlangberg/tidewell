import Image from "next/image";
import type { Area } from "@/lib/planted";
import { Label, PhotoPlaceholder, RuleLink } from "@/components/planted/ui";

/*
 * Shared presentation for a service area: the photograph registry, and the
 * editorial entry used on /areas-we-serve.
 *
 * Adding an area is a two-step job: add it to AREAS in lib/planted.ts, then add
 * a photograph here if one exists. Everything else follows automatically.
 */

type Photo = { src: string; alt: string };

/**
 * The only real photographs we hold. There are four, for six areas; the two
 * areas without one get a visible placeholder rather than a borrowed image,
 * because putting a coastal photograph beside an inland town would be a quiet
 * lie. Alt text describes the house or the scene and nothing more: none of
 * these is captioned as a property PLANTED. manages, because none of them is.
 *
 * Provenance: the file names are the only record of where these were taken, and
 * they came with the photographs from the owner, so wallaroo / north-beach /
 * port-hughes are treated as reliable. 12-bayview-road.jpg is deliberately NOT
 * mapped to a town: "12 Bayview Road, Moonta Bay" was an invented address in an
 * earlier project's demo data, so placing it here would publish a fiction as a
 * fact. It is used on the homepage hero instead, where no town is claimed.
 * Confirm all four locations with the photographer before launch, then add
 * moonta-bay (and kadina and moonta, once photographed) below.
 */
export const AREA_PHOTOS: Record<string, Photo> = {
  wallaroo: {
    src: "/photos/wallaroo.jpg",
    alt: "A sandstone villa with a bullnose verandah, cast-iron lacework and a low stone front wall, seen from the street in late afternoon light.",
  },
  "north-beach": {
    src: "/photos/north-beach.jpg",
    alt: "A single-storey limestone house with a deep wraparound verandah, lawn in front of it and the sea visible beyond the trees.",
  },
  "port-hughes": {
    src: "/photos/port-hughes.jpg",
    alt: "A contemporary two-storey house with a glass-balustraded deck above a garage, looking out over the dunes and the sea at dusk.",
  },
};

export function AreaPhoto({
  slug,
  name,
  sizes,
  priority = false,
  ratio = "4 / 3",
  className = "",
}: {
  slug: string;
  name: string;
  sizes: string;
  priority?: boolean;
  ratio?: string;
  className?: string;
}) {
  const photo = AREA_PHOTOS[slug];

  if (!photo) {
    return <PhotoPlaceholder label={`${name} photography to come`} ratio={ratio} className={className} />;
  }

  return (
    <div className={`relative overflow-hidden bg-stone ${className}`.trim()} style={{ aspectRatio: ratio }}>
      <Image src={photo.src} alt={photo.alt} fill sizes={sizes} priority={priority} className="img-cover" />
    </div>
  );
}

/**
 * One area on the overview page. `reverse` mirrors the layout so the column of
 * entries alternates rather than marching down one side.
 */
export function AreaCard({
  area,
  tag,
  note,
  reverse = false,
}: {
  area: Area;
  tag: string;
  note: string;
  reverse?: boolean;
}) {
  return (
    <article className="grid items-start gap-x-16 gap-y-8 md:grid-cols-12">
      <div className={reverse ? "md:col-span-5 md:col-start-8 md:row-start-1" : "md:col-span-5"}>
        <AreaPhoto slug={area.slug} name={area.name} sizes="(min-width: 768px) 38vw, 100vw" />
      </div>

      <div className={reverse ? "md:col-span-6 md:col-start-1 md:row-start-1" : "md:col-span-6 md:col-start-7"}>
        <Label>{tag}</Label>
        <h3 className="display display-md mt-5">{area.name}</h3>
        <div className="prose-measure mt-6 text-ink-muted">
          <p>{area.intro}</p>
          <p className="mt-4 text-[0.9375rem]">{note}</p>
        </div>
        <div className="mt-9">
          <RuleLink href={`/areas-we-serve/${area.slug}`}>{area.name} property management</RuleLink>
        </div>
      </div>
    </article>
  );
}
