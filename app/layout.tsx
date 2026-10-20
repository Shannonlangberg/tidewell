import type { Viewport } from "next";
import { Cormorant_Garamond, Hanken_Grotesk } from "next/font/google";

/*
 * Minimal root. It owns the document and the typefaces only.
 *
 * Styling belongs to the route groups: the PLANTED. site loads its own system in
 * app/(site)/layout.tsx, HQ loads hq.css, and the parked Tidewell app under /app
 * and /stay keeps the one it already had. Nothing visual lives here.
 *
 * 2026 brand: Hanken Grotesk for everything, Cormorant Garamond only for the
 * italic accent word in a headline (`.it`). The logo is outlined artwork, never
 * live text, so it needs neither font.
 */

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
  variable: "--font-hanken",
});

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-cormorant",
});

export const viewport: Viewport = {
  themeColor: "#14291F",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the site layout adds a `js` class before hydration.
    <html lang="en-AU" className={`${hanken.variable} ${cormorant.variable}`} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
