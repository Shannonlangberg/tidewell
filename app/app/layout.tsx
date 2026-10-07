import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/app/AppShell";
import "./app.css";

export const metadata: Metadata = {
  title: "Tidewell",
  appleWebApp: { capable: true, title: "Tidewell", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#10382F" },
    { media: "(prefers-color-scheme: dark)", color: "#0A211C" },
  ],
};

export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
