import { StatusChip } from "@/components/hq/StatusChip";
import { EmptyState } from "@/components/hq/EmptyState";
import { Panel, PanelHeader } from "@/components/hq/Primitives";
import { SubmitButton } from "@/components/hq/SubmitButton";
import { plural } from "@/lib/hq/format";
import { AddPodForm } from "./AddPodForm";
import { setPodActiveAction } from "./actions";

export type PodRow = { id: string; name: string; region: string | null; is_active: boolean; members: number };

/*
 * Pods: configurable teams. Anyone who can see People sees the list; only people.admin (directors
 * and administrators) can add one or switch one off. A pod with people in it is deactivated, never
 * deleted, so nobody is left pointing at a pod that has gone.
 */
export function PodsPanel({ pods, canAdmin }: { pods: readonly PodRow[]; canAdmin: boolean }) {
  return (
    <Panel aria-labelledby="pods-h" className="mt-10">
      <PanelHeader id="pods-h" level={2} title="Pods" meta={pods.length > 0 ? plural(pods.length, "pod") : undefined} />
      {pods.length === 0 ? (
        <EmptyState compact title="No pods yet">
          {canAdmin ? "A pod is a team, for example by region. Add one below and you can place people in it." : "A director or administrator can add pods."}
        </EmptyState>
      ) : (
        <ul aria-label="Pods" className="m-0 list-none p-0">
          {pods.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line py-3 first:border-t-0 first:pt-0">
              <div className="min-w-0">
                <p className="font-medium">{p.name}</p>
                <p className="hq-muted text-[13px]">
                  {p.region ?? "No region recorded"} · {plural(p.members, "person", "people")}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <StatusChip tone={p.is_active ? "success" : "neutral"}>{p.is_active ? "Active" : "Inactive"}</StatusChip>
                {canAdmin ? (
                  <form action={setPodActiveAction}>
                    <input type="hidden" name="podId" value={p.id} />
                    <input type="hidden" name="active" value={p.is_active ? "false" : "true"} />
                    <SubmitButton
                      variant="secondary"
                      size="sm"
                      pendingLabel={p.is_active ? "Deactivating pod" : "Reactivating pod"}
                      aria-label={`${p.is_active ? "Deactivate" : "Reactivate"} pod ${p.name}`}
                    >
                      {p.is_active ? "Deactivate" : "Reactivate"}
                    </SubmitButton>
                  </form>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canAdmin ? (
        <div className="mt-5 border-t border-line pt-5">
          <h3 className="hq-label mb-4">Add a pod</h3>
          <AddPodForm />
        </div>
      ) : null}
    </Panel>
  );
}
