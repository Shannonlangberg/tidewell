"use client";

import { useState } from "react";
import { Button } from "../../Button";
import { ConfirmDialog } from "../../ConfirmDialog";
import { movePartnerStage } from "./pathway-actions";

/*
 * One "Move to ..." button on the referral pathway. It only OPENS a confirmation that names exactly who
 * changes; the Server Action works it out again and does the work. Hiding it from people who cannot write
 * is a courtesy: row level security is the control.
 */

export type MoveChangeView = { id: string; name: string; from: string; to: string };

export function PathwayMoveButton({
  partner,
  partnerName,
  to,
  toLabel,
  changes,
  direction,
  returnTo,
}: {
  partner: { kind: "organisation" | "independent"; id: string };
  partnerName: string;
  to: string;
  toLabel: string;
  changes: readonly MoveChangeView[];
  direction: "forward" | "back";
  returnTo: string;
}) {
  const [open, setOpen] = useState(false);
  const label = direction === "forward" ? `Move to ${toLabel}` : `Move back to ${toLabel}`;
  return (
    <>
      <Button size="sm" variant={direction === "forward" ? "primary" : undefined} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title={`${label}?`}
        confirmLabel={label}
        action={movePartnerStage}
        fields={{ kind: partner.kind, id: partner.id, to, return_to: returnTo }}
      >
        <p>
          {partnerName} will be at <b>{toLabel}</b>. {changes.length === 1 ? "This changes one person's relationship status:" : `This changes ${changes.length} people's relationship status:`}
        </p>
        <ul className="mt-3 grid gap-1.5">
          {changes.map((c) => (
            <li key={c.id}>
              {c.name}: {c.from} → {c.to}
            </li>
          ))}
        </ul>
        <p className="mt-3">Nobody else changes. The change is recorded in the audit log, and you can move them again at any time.</p>
      </ConfirmDialog>
    </>
  );
}
