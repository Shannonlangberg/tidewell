import type { Viewport } from "next";
import { Cormorant_Garamond, DM_Sans } from "next/font/google";

/*
 * Minimal root. It owns the document and the typefaces only.
 *
 * Styling belongs to the route groups: the PLANTED. site loads its own system in
 * app/(site)/layout.tsx, and the parked Tidewell app under /app and /stay keeps
 * the one it already had. Nothing visual lives here, so the two never collide.
 */

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  display: "swap",
  variable: "--font-cormorant",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-dm-sans",
});

export const viewport: Viewport = {
  themeColor: "#252525",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU" className={`${cormorant.variable} ${dmSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
