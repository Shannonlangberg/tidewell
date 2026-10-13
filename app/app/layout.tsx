import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/app/AppShell";
import { SessionKeeper } from "@/components/SessionKeeper";
import "./app.css";

export const metadata: Metadata = {
  title: "Tidewell",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Tidewell", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#10382F" },
    { media: "(prefers-color-scheme: dark)", color: "#0A211C" },
  ],
};

/**
 * Every /app route is request-rendered: the session is read from cookies on
 * each request and never cached. Role guards live in the role layouts; the
 * SessionKeeper keeps the refresh token turning over through /api/session.
 */
export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <SessionKeeper />
      {children}
    </AppShell>
  );
}
