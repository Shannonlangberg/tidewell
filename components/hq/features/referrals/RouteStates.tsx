"use client";

import { useEffect } from "react";
import { Button } from "../../Button";
import { ErrorState } from "../../EmptyState";
import { Skeleton, SkeletonText } from "../../Primitives";

/*
 * What the Growth overview, the register and the pipeline show while they load and if something
 * unexpected throws. Nothing about the page's content goes to the console: the digest ties the
 * failure to the server log.
 */

export function RouteLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="grid gap-8">
      <span className="sr-only">Loading</span>
      <div className="grid gap-3">
        <Skeleton variant="heading" width="30%" />
        <Skeleton width="55%" />
      </div>
      <Skeleton variant="block" height={64} />
      <div className="grid gap-5">
        <SkeletonText lines={4} />
        <SkeletonText lines={4} />
      </div>
    </div>
  );
}

export function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("[hq] referrals route error", error.digest ?? "");
  }, [error]);
  return (
    <ErrorState
      title="Something went wrong"
      action={
        <Button size="sm" onClick={() => retry()}>
          Try again
        </Button>
      }
    >
      We couldn&rsquo;t show this page. Nothing was changed. Try again in a moment, and if it keeps happening, let the team know.
    </ErrorState>
  );
}
