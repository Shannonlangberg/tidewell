"use client";

import { useState } from "react";
import { Button } from "../../Button";
import { ConfirmDialog } from "../../ConfirmDialog";

/** Archive behind a confirmation. The Server Action (passed in) checks projects.write; the database decides. */
export function ArchiveProject({ id, name, archive }: { id: string; name: string; archive: (formData: FormData) => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="danger" onClick={() => setOpen(true)}>
        Archive project
      </Button>
      <ConfirmDialog open={open} onClose={() => setOpen(false)} title="Archive this project?" confirmLabel="Archive project" cancelLabel="Keep project" tone="danger" action={archive} fields={{ id }}>
        &ldquo;{name}&rdquo; will leave the projects list. Its tasks, milestones and history are kept, and it can be restored.
      </ConfirmDialog>
    </>
  );
}
