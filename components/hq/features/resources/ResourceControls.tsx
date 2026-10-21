"use client";

import { useActionState, useState } from "react";
import {
  DESCRIPTION_MAX,
  NOTE_MAX,
  RESOURCE_CATEGORIES,
  RESOURCE_CATEGORY_LABEL,
  SORT_MAX,
  TAGS_MAX,
  TITLE_MAX,
  type ResourceCategory,
} from "@/lib/hq/resources/rules";
import { idle, type ActionState } from "@/lib/hq/forms";
import { archiveResourceAction, restoreResourceAction, updateResourceAction } from "@/app/hq/(app)/resources/actions";
import { Button } from "../../Button";
import { ConfirmDialog } from "../../ConfirmDialog";
import { Drawer } from "../../Drawer";
import { fieldError } from "../../Field";
import { FormSummary } from "../../FormSummary";
import { Select } from "../../Select";
import { SubmitButton } from "../../SubmitButton";
import { Textarea, TextInput } from "../../TextInput";

/*
 * The buttons on a resource that change it. Editing posts to a Server Action (updateResourceAction) and the
 * archive and restore buttons ask first, naming the resource. Each action checks resources.manage again and
 * the database decides in the end. Nothing here changes the file: that is "Replace file".
 */

const LABELS = { title: "Title", category: "Category", description: "Description", tags: "Tags", note: "Note", sort_order: "Order" };

export type EditableResource = {
  id: string;
  title: string;
  category: ResourceCategory;
  description: string | null;
  tags: readonly string[];
  note: string | null;
  sortOrder: number;
};

export function EditResource({ resource }: { resource: EditableResource }) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  return (
    <>
      <Button
        icon="note"
        onClick={() => {
          setSession((n) => n + 1);
          setOpen(true);
        }}
      >
        Edit details
      </Button>
      <EditSession key={session} resource={resource} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function EditSession({ resource, open, onClose }: { resource: EditableResource; open: boolean; onClose: () => void }) {
  const [state, formAction] = useActionState<ActionState, FormData>(updateResourceAction, idle);
  const values = (state.data?.values ?? {}) as Record<string, string>;
  const idPrefix = `edit-res-${resource.id}`;
  return (
    <form action={formAction} noValidate className="contents">
      <Drawer
        open={open}
        onClose={onClose}
        title="Edit details"
        description={`${resource.title}. The file itself is changed with Replace file.`}
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <SubmitButton pendingLabel="Saving">Save details</SubmitButton>
          </>
        }
      >
        <div className="grid gap-5">
          <FormSummary state={state} labels={LABELS} idPrefix={idPrefix} />
          <input type="hidden" name="id" value={resource.id} />
          <TextInput name="title" idPrefix={idPrefix} label="Title" required maxLength={TITLE_MAX} defaultValue={values.title ?? resource.title} error={fieldError(state, "title")} data-autofocus />
          <Select
            name="category"
            idPrefix={idPrefix}
            label="Category"
            required
            options={RESOURCE_CATEGORIES.map((c) => ({ value: c, label: RESOURCE_CATEGORY_LABEL[c] }))}
            defaultValue={values.category ?? resource.category}
            error={fieldError(state, "category")}
          />
          <Textarea name="description" idPrefix={idPrefix} label="Description" rows={3} maxLength={DESCRIPTION_MAX} defaultValue={values.description ?? resource.description ?? ""} error={fieldError(state, "description")} />
          <TextInput
            name="tags"
            idPrefix={idPrefix}
            label="Tags"
            hint={`Separate with commas, up to ${TAGS_MAX}.`}
            defaultValue={values.tags ?? resource.tags.join(", ")}
            error={fieldError(state, "tags")}
          />
          <Textarea
            name="note"
            idPrefix={idPrefix}
            label="Note"
            rows={3}
            maxLength={NOTE_MAX}
            hint="Shown as a banner on the resource, for a warning such as part of it being out of date. Leave empty for none."
            defaultValue={values.note ?? resource.note ?? ""}
            error={fieldError(state, "note")}
          />
          <TextInput
            name="sort_order"
            idPrefix={idPrefix}
            label="Order"
            inputMode="numeric"
            hint={`A number from 0 to ${SORT_MAX}. Lower numbers come first within the category; the rest are in title order.`}
            defaultValue={values.sort_order ?? String(resource.sortOrder)}
            error={fieldError(state, "sort_order")}
          />
        </div>
      </Drawer>
    </form>
  );
}

export function ArchiveResource({ id, title }: { id: string; title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        Archive
      </Button>
      <ConfirmDialog open={open} onClose={() => setOpen(false)} title="Archive this resource?" confirmLabel="Archive resource" cancelLabel="Keep resource" tone="danger" action={archiveResourceAction} fields={{ id }}>
        &ldquo;{title}&rdquo; will leave the library for staff and for connected chat apps. Nothing is erased: every file and version is kept, and a director or administrator can restore it.
      </ConfirmDialog>
    </>
  );
}

export function RestoreResource({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Restore resource
      </Button>
      <ConfirmDialog open={open} onClose={() => setOpen(false)} title="Restore this resource?" confirmLabel="Restore resource" action={restoreResourceAction} fields={{ id }}>
        It will be back in the library, exactly as it was.
      </ConfirmDialog>
    </>
  );
}
