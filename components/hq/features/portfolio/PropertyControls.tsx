"use client";

import { useState } from "react";
import { Button } from "../../Button";
import { ConfirmDialog } from "../../ConfirmDialog";

/*
 * Archive and restore on a property's page, for people who hold portfolio.write. Each posts to a
 * Server Action passed in as a prop (this file imports no server code); the action checks the
 * capability again and the database decides in the end. Archiving is for a record made by mistake:
 * a property Planted stops managing is marked Ended instead, so it still counts in the history.
 */

type Act = (formData: FormData) => void | Promise<void>;

export function ArchiveProperty({ id, label, archive }: { id: string; label: string; archive: Act }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="danger" onClick={() => setOpen(true)}>
        Archive
      </Button>
      <ConfirmDialog open={open} onClose={() => setOpen(false)} title="Archive this property?" confirmLabel="Archive property" cancelLabel="Keep property" tone="danger" action={archive} fields={{ id }}>
        {label} will leave the portfolio and stop counting towards the goal. A director, administrator or senior property manager can restore it. Use this for a record made by mistake; if Planted has stopped managing the property, edit it and set the status to Ended instead.
      </ConfirmDialog>
    </>
  );
}

export function RestoreProperty({ id, restore }: { id: string; restore: Act }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Restore property
      </Button>
      <ConfirmDialog open={open} onClose={() => setOpen(false)} title="Restore this property?" confirmLabel="Restore property" action={restore} fields={{ id }}>
        It will be back in the portfolio and count towards the goal again.
      </ConfirmDialog>
    </>
  );
}
