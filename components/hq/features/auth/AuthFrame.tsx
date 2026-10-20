import type { ReactNode } from "react";
import { Wordmark } from "@/components/hq/Wordmark";

/*
 * The frame around every signed-out screen (sign-in, code, second step).
 *
 * Calm and card-less: charcoal and soft white, hairlines and space instead of boxes.
 * From 1024px a charcoal panel carries the wordmark and the form sits on soft white
 * beside it; on a phone the panel becomes a slim charcoal header and the form follows.
 * The title is in the display style; everything else is body Hanken Grotesk.
 *
 * Server-safe: no state.
 */

export function AuthFrame({
  title,
  lead,
  children,
  footer,
}: {
  title: string;
  /** One or two sentences under the title. */
  lead?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <header className="hq-on-dark bg-charcoal px-6 py-5 lg:flex lg:flex-col lg:justify-between lg:px-14 lg:py-14">
        <div className="lg:hidden">
          <Wordmark href={false} size="sm" />
        </div>
        <div className="hidden lg:block">
          <Wordmark href={false} size="lg" />
        </div>
        <p className="hidden text-[11px] font-medium uppercase tracking-[0.3em] text-taupe lg:block">People. Property. Potential.</p>
      </header>

      <main id="hq-auth-main" className="flex justify-center px-6 pb-16 pt-10 lg:items-center lg:px-16 lg:py-14">
        <div className="w-full max-w-[26rem]">
          <h1 className="hq-display text-[clamp(36px,6vw,46px)] leading-[1.02]">{title}</h1>
          {lead ? <div className="hq-muted mt-3 text-[15px] leading-relaxed">{lead}</div> : null}
          <div className="mt-8">{children}</div>
          {footer ? <div className="hq-muted mt-10 border-t border-line pt-5 text-[13px] leading-relaxed">{footer}</div> : null}
        </div>
      </main>
    </div>
  );
}
