import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import { Suspense } from "react";
import { FlashFromSearchParams, ToastProvider } from "@/components/hq/Toast";
import "./hq.css";

/*
 * Wrapper for EVERY /hq route, including the sign-in screens, so it asks for no
 * session and renders no navigation. The signed-in chrome (sidebar, top bar, tab
 * bar) is components/hq AppShell, rendered by a separate route group's layout.
 *
 * hq.css is imported here and nowhere else: it carries Tailwind and the HQ tokens,
 * and must never reach the public site or the parked Tidewell app.
 *
 * ToastProvider and FlashFromSearchParams live here (not in AppShell) so the sign-in
 * pages can toast too, and a toast survives navigation between pages of one group.
 *
 * Font: the root layout loads DM Sans at weights 400 and 500 only. HQ needs 600 and
 * 700 (page titles, figures, table names), so this layout loads the variable font for
 * the /hq routes alone. If the root layout's weights are ever widened to 400-700 this
 * can be removed and hq.css will fall back to `--font-dm-sans`.
 */

const dmSans = DM_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-hq-dm-sans",
});

export const metadata: Metadata = {
  title: { default: "Planted HQ", template: "%s | Planted HQ" },
  robots: { index: false, follow: false },
};

export default function HqLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`hq-root ${dmSans.variable}`}>
      <ToastProvider>
        {/* useSearchParams needs a Suspense boundary so it cannot block prerendering. */}
        <Suspense fallback={null}>
          <FlashFromSearchParams />
        </Suspense>
        {children}
      </ToastProvider>
    </div>
  );
}
