"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/hq/Button";
import { CheckboxGroup } from "@/components/hq/Choice";
import { fieldError, FormActions } from "@/components/hq/Field";
import { FormSummary } from "@/components/hq/FormSummary";
import { Drawer } from "@/components/hq/Drawer";
import { SubmitButton } from "@/components/hq/SubmitButton";
import { useToast } from "@/components/hq/Toast";
import { idle, type ActionState } from "@/lib/hq/forms";
import { saveDashboardLayoutAction } from "./actions";

/*
 * "Customise": a drawer with a tick-list of the widgets this person may use. Saving stores
 * their own layout (hq.update_staff on themselves); "Use my role's default" clears it.
 * Only widgets the person's capabilities allow are listed, and the server filters again.
 */

export type WidgetOption = { id: string; title: string; description: string };

export function CustomiseDashboard({
  options,
  selected,
  customised,
}: {
  options: readonly WidgetOption[];
  /** What the dashboard is showing now. */
  selected: readonly string[];
  /** True when the person has their own layout rather than the role default. */
  customised: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const run = async (prev: ActionState, formData: FormData) => {
    const result = await saveDashboardLayoutAction(prev, formData);
    if (result.ok) {
      setOpen(false);
      toast(result.message ?? "Your dashboard has been updated.");
    }
    return result;
  };
  const [state, action] = useActionState(run, idle);
  const [resetState, resetAction] = useActionState(run, idle);

  return (
    <>
      <Button icon="settings" onClick={() => setOpen(true)}>
        Customise
      </Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Customise your dashboard"
        description={customised ? "You are using your own layout." : "You are using the default for your role."}
      >
        <form action={action} noValidate className="grid gap-6">
          <FormSummary state={state} labels={{ widgets: "Widgets" }} />
          <CheckboxGroup
            name="widgets"
            legend="Show these"
            hint="Only the widgets your role may use are listed."
            options={options.map((o) => ({ value: o.id, label: o.title, hint: o.description }))}
            defaultValue={selected}
            error={fieldError(state, "widgets")}
          />
          <input type="hidden" name="intent" value="save" />
          <FormActions>
            <SubmitButton pendingLabel="Saving your dashboard">Save</SubmitButton>
          </FormActions>
        </form>
        <FormSummary state={resetState} className="mt-6" />
        {customised ? (
          <form action={resetAction} className="mt-6 border-t border-line pt-5">
            <p className="hq-muted mb-3 text-[14px]">Go back to the layout chosen for your role.</p>
            <input type="hidden" name="intent" value="reset" />
            <SubmitButton variant="secondary" pendingLabel="Resetting your dashboard">
              Use my role&rsquo;s default
            </SubmitButton>
          </form>
        ) : null}
      </Drawer>
    </>
  );
}
