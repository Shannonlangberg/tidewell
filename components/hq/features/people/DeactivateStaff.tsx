"use client";

import { useState } from "react";
import { Button } from "@/components/hq/Button";
import { ConfirmDialog } from "@/components/hq/ConfirmDialog";
import { useToast } from "@/components/hq/Toast";
import { deactivateStaffAction } from "./actions";

/*
 * Ends someone's access. Confirmed first, because it takes effect at once. The database has the
 * last word: it refuses to deactivate yourself, a director (unless you are one) or the last
 * active director, and the reason is shown as a toast.
 */
export function DeactivateStaff({ staffId, name }: { staffId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        Deactivate
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Deactivate ${name}?`}
        confirmLabel={`Deactivate ${name}`}
        tone="danger"
        onConfirm={async () => {
          const result = await deactivateStaffAction(staffId);
          toast(result.message ?? (result.ok ? "Their access has ended." : "We could not do that."), { tone: result.ok ? "success" : "error" });
        }}
      >
        They will lose access to Planted HQ straight away. Their history stays on record. You can give them access back later by setting their status to Active.
      </ConfirmDialog>
    </>
  );
}
