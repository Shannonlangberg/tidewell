"use client";

import { useState } from "react";
import { Button } from "../../Button";
import { ConfirmDialog } from "../../ConfirmDialog";

/*
 * The buttons on a knowledge document that change its state. Each posts to a Server Action passed in as
 * a prop (this file imports no server code); the actions check the capability again and the database
 * decides in the end. Every one asks first, naming the document and the version.
 */

type Act = (formData: FormData) => void | Promise<void>;

export function ApproveButton({ id, version, title, approve, label = "Approve this version" }: { id: string; version: number; title: string; approve: Act; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <ConfirmDialog open={open} onClose={() => setOpen(false)} title={`Approve version ${version}?`} confirmLabel="Approve" action={approve} fields={{ id, version: String(version) }}>
        Staff will read version {version} of &ldquo;{title}&rdquo; from now on. The version it replaces stays in the history and can be brought back.
      </ConfirmDialog>
    </>
  );
}

export function DiscardDraftButton({ id, version, discard }: { id: string; version: number; discard: Act }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Discard draft
      </Button>
      <ConfirmDialog open={open} onClose={() => setOpen(false)} title={`Discard draft version ${version}?`} confirmLabel="Discard draft" cancelLabel="Keep draft" tone="danger" action={discard} fields={{ id, version: String(version) }}>
        The document goes back to its approved text. The draft stays in the history, marked discarded.
      </ConfirmDialog>
    </>
  );
}

export function RestoreVersionButton({ id, version, baseVersion, restore }: { id: string; version: number; baseVersion: number; restore: Act }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Restore as draft
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Bring back version ${version}?`}
        confirmLabel="Restore as draft"
        action={restore}
        fields={{ id, version: String(version), base_version: String(baseVersion) }}
      >
        Its text is copied into a new draft version. Nothing staff read changes until someone approves that draft.
      </ConfirmDialog>
    </>
  );
}

export function ArchiveKnowledgeButton({ id, title, archive }: { id: string; title: string; archive: Act }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="danger" onClick={() => setOpen(true)}>
        Archive
      </Button>
      <ConfirmDialog open={open} onClose={() => setOpen(false)} title="Archive this document?" confirmLabel="Archive document" cancelLabel="Keep document" tone="danger" action={archive} fields={{ id }}>
        &ldquo;{title}&rdquo; will leave the knowledge base for staff. Nothing is erased: every version is kept and a director or administrator can restore it.
      </ConfirmDialog>
    </>
  );
}

export function RestoreKnowledgeButton({ id, restore }: { id: string; restore: Act }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Restore document
      </Button>
      <ConfirmDialog open={open} onClose={() => setOpen(false)} title="Restore this document?" confirmLabel="Restore document" action={restore} fields={{ id }}>
        It will be back in the knowledge base, exactly as it was.
      </ConfirmDialog>
    </>
  );
}
