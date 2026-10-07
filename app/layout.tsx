import type { Metadata, Viewport } from "next";
import "./globals.css";

const FONTS =
  "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700&family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap";

export const metadata: Metadata = {
  title: "Tidewell — your place, kept well",
  description:
    "Property management on the Copper Coast, South Australia. Short-stay, long-term and property care, with published prices and a reply inside the hour.",
};

export const viewport: Viewport = { themeColor: "#10382F" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href={FONTS} />
      </head>
      <body>{children}</body>
    </html>
  );
}
