"use client";

import { RouteError } from "@/components/hq/features/tasks/RouteStates";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError error={error} retry={retry} />;
}
