import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/app/AppShell";
import "../app/app.css";

export const metadata: Metadata = { title: "Your stay · Tidewell", robots: { index: false } };
export const viewport: Viewport = { viewportFit: "cover", themeColor: "#10382F" };

// Guests don't have accounts — the link is the key. No tab bar.
export default function StayLayout({ children }: { children: React.ReactNode }) {
  return <AppShell tabs={false}>{children}</AppShell>;
}
