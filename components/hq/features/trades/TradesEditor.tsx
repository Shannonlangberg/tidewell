"use client";

import { useState } from "react";
import { addTrade, editTrade, moveTrade, setTradeActive } from "@/app/hq/(app)/partners/trades/actions";
import { tradeSlugBase, uniqueTradeSlug, type Trade } from "@/lib/hq/trades/rules";
import { Button, IconButton } from "../../Button";
import { fieldError } from "../../Field";
import { InlineNote } from "../../Primitives";
import { StatusChip } from "../../StatusChip";
import { Textarea, TextInput } from "../../TextInput";
import { ErrorLine, FormDialog, useDecision } from "../contractors/FormDialog";

/*
 * Edit mode of the Trades page (contractors.write): add a trade, rename it, describe it, move it up
 * or down, and (contractors.approve) archive or restore it. Every change goes through a Server
 * Action that checks the capability and an RPC that checks it again; the database also refuses to
 * archive a trade any live contractor still uses, whatever this screen shows.
 *
 * The slug (what is stored on each contractor) is shown once, when a trade is added, and never
 * changes: renaming only changes the name people see.
 */

export type EditorTrade = Trade & { inUse: number };

type Props = {
  trades: readonly EditorTrade[];
  canApprove: boolean;
};

type Open = { kind: "add" } | { kind: "edit"; trade: EditorTrade } | { kind: "archive"; trade: EditorTrade } | { kind: "restore"; trade: EditorTrade } | null;

export function TradesEditor({ trades, canApprove }: Props) {
  const [open, setOpen] = useState<Open>(null);
  const close = () => setOpen(null);
  const active = trades.filter((t) => t.isActive);
  const archived = trades.filter((t) => !t.isActive);
  const slugs = trades.map((t) => t.slug);

  return (
    <section aria-labelledby="edit-trades-h" className="hq-panel hq-panel--white mb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="edit-trades-h" className="text-[17px] font-semibold text-charcoal">
            Edit the list of trades
          </h2>
          <p className="mt-1 text-[14px] text-grey-text">
            Rename a trade (for example Plumbing to Plumbers), describe it, or change its place on the page. Contractors keep their trades when a name changes.
          </p>
        </div>
        <Button variant="primary" size="sm" icon="plus" onClick={() => setOpen({ kind: "add" })}>
          Add a trade
        </Button>
      </div>

      {active.length === 0 ? (
        <InlineNote className="mt-5">There are no active trades. Add one, or restore an archived trade below.</InlineNote>
      ) : (
        <ol className="mt-5" aria-label="Trades, in the order they are shown">
          {active.map((t, i) => (
            <li key={t.id} id={`trade-${t.id}`} className="grid gap-3 border-t border-line py-3.5 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="min-w-0">
                <p className="font-medium text-charcoal">
                  <span className="hq-nums mr-2 text-grey-text">{i + 1}.</span>
                  {t.label}
                </p>
                <p className="mt-0.5 text-[13px] text-grey-text">
                  {t.description ? `${t.description} · ` : ""}
                  {t.inUse === 0 ? "No contractors" : t.inUse === 1 ? "1 contractor" : `${t.inUse} contractors`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <form action={moveTrade}>
                  <input type="hidden" name="id" value={t.id} />
                  <input type="hidden" name="direction" value="up" />
                  <IconButton type="submit" icon="arrow-up" label={`Move ${t.label} up`} size="sm" variant="secondary" disabled={i === 0} />
                </form>
                <form action={moveTrade}>
                  <input type="hidden" name="id" value={t.id} />
                  <input type="hidden" name="direction" value="down" />
                  <IconButton type="submit" icon="arrow-down" label={`Move ${t.label} down`} size="sm" variant="secondary" disabled={i === active.length - 1} />
                </form>
                <Button size="sm" onClick={() => setOpen({ kind: "edit", trade: t })} aria-label={`Rename or describe ${t.label}`}>
                  Rename
                </Button>
                {canApprove ? (
                  <Button size="sm" variant="ghost" onClick={() => setOpen({ kind: "archive", trade: t })} aria-label={`Archive ${t.label}`}>
                    Archive
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}

      {archived.length > 0 ? (
        <div className="mt-6">
          <h3 className="hq-label border-b border-line pb-2.5">Archived trades</h3>
          <ul aria-label="Archived trades">
            {archived.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-3 first:border-t-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-charcoal">{t.label}</span>
                  <StatusChip tone="neutral">Archived</StatusChip>
                  {t.inUse > 0 ? <span className="text-[13px] text-grey-text">still on {t.inUse === 1 ? "1 contractor" : `${t.inUse} contractors`}</span> : null}
                </span>
                {canApprove ? (
                  <Button size="sm" onClick={() => setOpen({ kind: "restore", trade: t })} aria-label={`Restore ${t.label}`}>
                    Restore
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!canApprove ? <p className="mt-5 text-[13px] text-grey-text">Archiving and restoring a trade is for a director or administrator.</p> : null}

      {open?.kind === "add" ? <AddDialog slugs={slugs} onClose={close} /> : null}
      {open?.kind === "edit" ? <EditDialog trade={open.trade} onClose={close} /> : null}
      {open?.kind === "archive" ? <ActiveDialog trade={open.trade} active={false} onClose={close} /> : null}
      {open?.kind === "restore" ? <ActiveDialog trade={open.trade} active onClose={close} /> : null}
    </section>
  );
}

function AddDialog({ slugs, onClose }: { slugs: readonly string[]; onClose: () => void }) {
  const { state, formAction, pending } = useDecision(addTrade, onClose);
  const [label, setLabel] = useState("");
  const slug = label.trim() ? uniqueTradeSlug(label, slugs) : null;
  return (
    <FormDialog title="Add a trade" onClose={onClose} confirmLabel="Add trade" pending={pending} action={formAction}>
      <p>It is added at the end of the list. You can move it, rename it or describe it at any time.</p>
      <TextInput
        name="label"
        idPrefix="add-trade"
        label="Name"
        required
        maxLength={60}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        hint={slug ? `Stored on contractors as “${slug}”${slug !== tradeSlugBase(label) ? " (that name was taken)" : ""}. This never changes, even if you rename the trade.` : "For example Solar, or Pool maintenance."}
        error={fieldError(state, "label")}
      />
      <Textarea name="description" idPrefix="add-trade" label="Description (optional)" rows={2} maxLength={500} hint="What the trade covers, in a line." error={fieldError(state, "description")} />
      <ErrorLine state={state} />
    </FormDialog>
  );
}

function EditDialog({ trade, onClose }: { trade: EditorTrade; onClose: () => void }) {
  const { state, formAction, pending } = useDecision(editTrade, onClose);
  // Controlled, so a refused rename keeps what was typed (a form action resets uncontrolled fields).
  const [label, setLabel] = useState(trade.label);
  const [description, setDescription] = useState(trade.description ?? "");
  return (
    <FormDialog title={`Rename or describe ${trade.label}`} onClose={onClose} confirmLabel="Save trade" pending={pending} action={formAction}>
      <input type="hidden" name="id" value={trade.id} />
      <p>{trade.inUse > 0 ? `The ${trade.inUse === 1 ? "contractor" : `${trade.inUse} contractors`} in this trade keep it; only the name people see changes.` : "Only the name people see changes."}</p>
      <TextInput name="label" idPrefix={`edit-trade-${trade.id}`} label="Name" required maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} error={fieldError(state, "label")} />
      <Textarea
        name="description"
        idPrefix={`edit-trade-${trade.id}`}
        label="Description (optional)"
        rows={2}
        maxLength={500}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        hint="Leave blank to remove it."
        error={fieldError(state, "description")}
      />
      <ErrorLine state={state} />
    </FormDialog>
  );
}

function ActiveDialog({ trade, active, onClose }: { trade: EditorTrade; active: boolean; onClose: () => void }) {
  const { state, formAction, pending } = useDecision(setTradeActive, onClose);
  const blocked = !active && trade.inUse > 0;
  return (
    <FormDialog
      title={active ? `Restore ${trade.label}?` : `Archive ${trade.label}?`}
      onClose={onClose}
      confirmLabel={active ? "Restore trade" : "Archive trade"}
      tone={active ? "primary" : "danger"}
      confirmDisabled={blocked}
      pending={pending}
      action={formAction}
    >
      <input type="hidden" name="id" value={trade.id} />
      <input type="hidden" name="active" value={active ? "true" : "false"} />
      {active ? (
        <p>It goes back on the Trades page in its old place, and can be chosen for contractors again.</p>
      ) : blocked ? (
        <InlineNote>
          {trade.inUse === 1 ? "1 contractor is" : `${trade.inUse} contractors are`} still in {trade.label}. Move them to another trade, or remove it from them, first. A trade in use cannot be archived.
        </InlineNote>
      ) : (
        <p>It comes off the Trades page and out of the choices for contractors. Nothing is deleted, and it can be restored.</p>
      )}
      {!active && !blocked ? <TextInput name="reason" idPrefix={`archive-trade-${trade.id}`} label="Reason (optional)" maxLength={200} error={fieldError(state, "reason")} /> : null}
      <ErrorLine state={state} />
    </FormDialog>
  );
}
