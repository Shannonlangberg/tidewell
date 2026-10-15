"use client";

/*
 * Interactive pieces of the dev gallery (app/hq/dev-gallery). DEVELOPMENT ONLY: the page
 * that uses these returns notFound() in production. Everything here is sample content.
 */

import { useActionState, useState } from "react";
import {
  Button,
  Checkbox,
  CheckboxGroup,
  ConfirmDialog,
  Drawer,
  FormActions,
  FormSummary,
  NativeSelectPicker,
  RadioGroup,
  Select,
  SubmitButton,
  Textarea,
  TextInput,
  DateInput,
  fieldError,
  useShell,
  useToast,
} from "@/components/hq";
import type { ActionState } from "@/lib/hq/forms";
import { CATEGORY_LABEL, PARTNER_CATEGORIES, RELATIONSHIP_LABEL, RELATIONSHIP_STATUSES } from "@/lib/hq/constants";

export function ShellOpeners() {
  const { openPalette, openAsk } = useShell();
  return (
    <div className="flex flex-wrap gap-3">
      <Button icon="search" onClick={openPalette}>
        Open the command palette
      </Button>
      <Button icon="sparkle" variant="primary" onClick={openAsk}>
        Open Ask Planted
      </Button>
    </div>
  );
}

export function DrawerDemo() {
  const [right, setRight] = useState(false);
  const [sheet, setSheet] = useState(false);
  return (
    <>
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => setRight(true)}>Open drawer (right, bottom sheet on phones)</Button>
        <Button onClick={() => setSheet(true)}>Open bottom sheet (always)</Button>
      </div>

      <Drawer
        open={right}
        onClose={() => setRight(false)}
        title="Log a call"
        description="Sample drawer. Nothing here is saved."
        footer={
          <>
            <Button onClick={() => setRight(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => setRight(false)}>
              Save call
            </Button>
          </>
        }
      >
        <div className="grid gap-5">
          <TextInput name="drawer-contact" label="Contact" placeholder="Alex Sample" data-autofocus />
          <Textarea name="drawer-notes" label="What was discussed" rows={5} hint="A line or two is plenty." />
          <DateInput name="drawer-follow" label="Follow up on" />
          <p className="hq-muted">
            Tab moves through this form and stays inside the drawer. Esc closes it. Focus goes back to the button that opened it. Scroll this body: the page
            behind does not move.
          </p>
          {Array.from({ length: 6 }, (_, i) => (
            <TextInput key={i} name={`drawer-extra-${i}`} label={`Extra sample field ${i + 1}`} />
          ))}
        </div>
      </Drawer>

      <Drawer open={sheet} onClose={() => setSheet(false)} title="Bottom sheet" placement="bottom">
        <p>A sheet that rises from the bottom at every width. The More menu on phones uses this.</p>
      </Drawer>
    </>
  );
}

export function ConfirmDemo() {
  const [plain, setPlain] = useState(false);
  const [danger, setDanger] = useState(false);
  const { toast } = useToast();
  return (
    <>
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => setPlain(true)}>Confirm (default)</Button>
        <Button variant="danger" onClick={() => setDanger(true)}>
          Confirm (danger, async)
        </Button>
      </div>
      <ConfirmDialog open={plain} onClose={() => setPlain(false)} title="Mark referral as lost?" confirmLabel="Mark as lost" onConfirm={() => {
          toast("Sample: marked as lost", { tone: "info" });
        }}>
        It will leave the open pipeline. You can reopen it later.
      </ConfirmDialog>
      <ConfirmDialog
        open={danger}
        onClose={() => setDanger(false)}
        title="Archive Alex Sample?"
        confirmLabel="Archive contact"
        tone="danger"
        onConfirm={() => new Promise<void>((resolve) => setTimeout(() => { toast("Sample: contact archived"); resolve(); }, 1200))}
      >
        Their history is kept, and they will no longer appear in lists. This pretends to take a moment, to show the pending state.
      </ConfirmDialog>
    </>
  );
}

export function ToastDemo() {
  const { toast } = useToast();
  return (
    <div className="flex flex-wrap gap-3">
      <Button onClick={() => toast("Contact saved")}>Success toast</Button>
      <Button onClick={() => toast("We could not save that. Check the highlighted fields and try again.", { tone: "error" })}>Error toast</Button>
      <Button onClick={() => toast("Sample info: imports finish in the background.", { tone: "info" })}>Info toast</Button>
      <Button onClick={() => toast("A deliberately long message to check wrapping: Wallaroo, Moonta, Kadina and the surrounding communities of the Copper Coast, all sample text.", { duration: 12000 })}>
        Long toast
      </Button>
    </div>
  );
}

export function SubmitDemo({ action }: { action: (formData: FormData) => Promise<void> }) {
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <SubmitButton pendingLabel="Saving sample">Save sample</SubmitButton>
      <SubmitButton variant="secondary" pendingLabel="Saving sample">
        Secondary submit
      </SubmitButton>
      <SubmitButton variant="danger" icon="check" pendingLabel="Archiving sample">
        Danger submit
      </SubmitButton>
      <span className="hq-muted text-[13px]">Click one: it shows a spinner for a moment and keeps its width.</span>
    </form>
  );
}

const LABELS = { fullName: "Full name", email: "Email", phone: "Phone", category: "Category", organisation: "Organisation" };

export function FormDemo({
  action,
  initial,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  initial: ActionState;
}) {
  const [state, formAction] = useActionState(action, initial);
  // The typed values come back in state.data after a failed submit (see sampleSave), so the reset React 19 does after an action does not wipe them.
  const values = (state.data?.values ?? {}) as Record<string, string>;
  return (
    <form action={formAction} noValidate className="grid max-w-2xl gap-5">
      <FormSummary state={state} labels={LABELS} />
      <TextInput name="fullName" label="Full name" required error={fieldError(state, "fullName")} defaultValue={values.fullName ?? ""} autoComplete="off" />
      <div className="grid gap-5 sm:grid-cols-2">
        <TextInput name="email" type="email" label="Email" error={fieldError(state, "email")} defaultValue={values.email ?? "not-an-email"} hint="We use this only to contact them." />
        <TextInput name="phone" type="tel" label="Phone" error={fieldError(state, "phone")} defaultValue={values.phone ?? ""} />
      </div>
      <Select
        name="category"
        label="Category"
        required
        placeholder="Choose a category"
        options={PARTNER_CATEGORIES.map((v) => ({ value: v, label: CATEGORY_LABEL[v] }))}
        error={fieldError(state, "category")}
        defaultValue={values.category ?? ""}
      />
      <NativeSelectPicker
        name="organisation"
        label="Organisation"
        placeholder="No organisation"
        hint="Choosing an organisation saves its id, not the typed name."
        error={fieldError(state, "organisation")}
        defaultValue={values.organisation ?? ""}
        options={[
          { value: "3f7f0d1e-1c5a-4a52-9a52-8a3b0f4a0001", label: "Sample Lending Co.", group: "Mortgage brokers" },
          { value: "3f7f0d1e-1c5a-4a52-9a52-8a3b0f4a0002", label: "Placeholder Finance", group: "Mortgage brokers" },
          { value: "3f7f0d1e-1c5a-4a52-9a52-8a3b0f4a0003", label: "Example Conveyancing", group: "Conveyancers" },
          { value: "3f7f0d1e-1c5a-4a52-9a52-8a3b0f4a0004", label: "Demo Buyers Agency", group: "Buyers agents" },
        ]}
      />
      <FormActions>
        <Button>Cancel</Button>
        <SubmitButton pendingLabel="Saving contact">Save contact</SubmitButton>
      </FormActions>
    </form>
  );
}

export function ChoiceDemo() {
  return (
    <div className="grid max-w-2xl gap-6">
      <RadioGroup
        name="direction"
        legend="Direction"
        segmented
        required
        defaultValue="received"
        options={[
          { value: "received", label: "Received" },
          { value: "sent", label: "Sent" },
        ]}
      />
      <RadioGroup
        name="priority"
        legend="Priority"
        hint="Radio buttons, as a list."
        defaultValue="medium"
        options={[
          { value: "high", label: "High", hint: "Needs attention this week." },
          { value: "medium", label: "Medium" },
          { value: "low", label: "Low", disabled: true, hint: "Disabled sample option." },
        ]}
      />
      <CheckboxGroup
        name="statuses"
        legend="Relationship status"
        inline
        defaultValue={["identified", "met"]}
        options={RELATIONSHIP_STATUSES.slice(0, 5).map((v) => ({ value: v, label: RELATIONSHIP_LABEL[v] }))}
      />
      <CheckboxGroup
        name="statuses-error"
        legend="Choose at least one"
        error="Choose at least 1."
        options={[
          { value: "a", label: "Sample option A" },
          { value: "b", label: "Sample option B" },
        ]}
      />
      <Checkbox name="create-task" label="Create a follow-up task" hint="It will appear under Operations." defaultChecked />
      <Checkbox name="disabled-box" label="A disabled checkbox" disabled />
    </div>
  );
}

export function StatesDemo() {
  return (
    <div className="grid max-w-2xl gap-5">
      <TextInput name="state-default" label="Default" placeholder="Placeholder text" />
      <TextInput name="state-filled" label="Filled, with a hint" hint="This is a hint under the label." defaultValue="Alex Sample" />
      <TextInput name="state-disabled" label="Disabled" defaultValue="Cannot be edited" disabled />
      <TextInput name="state-error" label="With an error" required error="Enter an email address." defaultValue="not-an-email" type="email" />
      <TextInput
        name="state-long"
        label="Long value"
        defaultValue="Montgomery-Featherstonehaugh Sample Conveyancing and Settlement Services Proprietary Limited, Wallaroo and Moonta Bay"
      />
      <Textarea name="state-textarea" label="Textarea" hint="Grows by dragging the corner." defaultValue="Two clients looking at Copper Coast investments. Warm about managing locally." />
      <DateInput name="state-date" label="Date" defaultValue="2026-10-20" />
    </div>
  );
}
