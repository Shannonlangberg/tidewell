import { ImageResponse } from "next/og";

/*
 * The PLANTED. favicon: the typographic monogram "P." in ivory on charcoal.
 *
 * The brief is explicit that the mark is letterform only — no leaf, tree, root
 * or house — so the glyph is drawn as a vector outline rather than set in a
 * webfont. ImageResponse ships one sans (Geist) and nothing else, and fetching
 * Cormorant Garamond at build time would make the icon depend on the network,
 * so the Cormorant-flavoured serif here is a hand-drawn path: high stroke
 * contrast, a round bowl, fine bracketed serifs.
 *
 * Square, not rounded: planted.css keeps sharp corners throughout and the icon
 * follows the same rule. iOS applies its own corner mask anyway.
 *
 * app/apple-icon.tsx carries the same outline at 180px. Keep the two in sync —
 * they are duplicated rather than shared because Next.js metadata route files
 * should only export the conventional names.
 *
 * Unrelated: app/pwa-icon/route.tsx still serves the Tidewell tag mark for the
 * parked app. It is deliberately untouched and no longer referenced here.
 */

// The glyph, drawn on a 114 x 120 grid with the baseline at y = 103.
// Outer contour then the bowl's counter, wound the other way so it knocks out.
const MONOGRAM =
  "M20 17.6 L52 17.6 C69 17.6 79.5 27 79.5 40.5 C79.5 54 68.5 62.6 51 62.6 " +
  "L40 62.6 L40 95 C40 99.2 43 100.8 49.5 101.2 L53.5 101.2 L53.5 103 " +
  "L16.5 103 L16.5 101.2 L20.5 101.2 C27 100.8 30 99.2 30 95 L30 25 " +
  "C30 21.6 27 20 20 19.8 Z " +
  "M40 26 L40 54.6 L50 54.6 C61 54.6 67.5 49.5 67.5 40.5 C67.5 31.5 61 26 50 26 Z";

const CHARCOAL = "#252525";
const IVORY = "#F5F1EA";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  const h = Math.round(size.height * 0.62);
  const w = Math.round((h * 114) / 120);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: CHARCOAL,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg width={w} height={h} viewBox="0 0 114 120" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d={MONOGRAM} fill={IVORY} />
          <circle cx="92" cy="97.5" r="5.5" fill={IVORY} />
        </svg>
      </div>
    ),
    { ...size },
  );
}
