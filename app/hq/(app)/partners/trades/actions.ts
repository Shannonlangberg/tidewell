"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { HQ_BASE } from "@/lib/hq/constants";
import { logTag } from "@/lib/hq/contractors/db-errors";
import { FormReader, fail, type ActionState } from "@/lib/hq/forms";
import { withToast } from "@/components/hq/flash";

/*
 * Server Actions for the editable list of trades (hq.trades, migration 0123).
 *
 * Every action calls requireStaff(<capability>) FIRST and then calls the RPC as the person, which
 * checks the capability again (the database is the control; a hidden button is a courtesy):
 *
 *   addTrade        contractors.write    create_trade (slug derived from the label, never changes)
 *   editTrade       contractors.write    update_trade (rename, describe)
 *   moveTrade       contractors.write    move_trade (one place up or down)
 *   setTradeActive  contractors.approve  set_trade_active (archive refused while a live contractor uses it)
 *
 * The RPCs' messages are plain English and safe to show; what is logged is the error code only.
 */

const TRADES = `${HQ_BASE}/partners/trades`;
const EDIT = `${TRADES}?edit=1`;
const GENERIC = "Something went wrong and nothing was changed. Try again in a moment.";
const FORBIDDEN = "You don't have permission to do that.";

type DbErr = { code?: string | null; message?: string | null } | null | undefined;

function refresh() {
  revalidatePath(TRADES);
  revalidatePath(`${HQ_BASE}/partners`);
  revalidatePath(`${HQ_BASE}/partners/new`);
  revalidatePath(HQ_BASE);
}

/** A refusal in words: the RPC's own sentence for a rule (safe to show), generic otherwise. */
function tradeFailure(where: string, error: DbErr, field: string | null): ActionState {
  console.error(`[hq] ${where} failed:`, logTag(error));
  const code = error?.code ?? "";
  const said = (error?.message ?? "").slice(0, 300);
  if (code === "42501") return fail(FORBIDDEN);
  if (code === "P0002") return fail("That trade could not be found. Reload the page.");
  if ((code === "23505" || code === "22023") && said) {
    const text = said[0].toUpperCase() + said.slice(1) + ".";
    return field ? fail("Please check the highlighted fields and try again.", { [field]: text }) : fail(text);
  }
  if (code === "23514" && said) return fail(`Not archived: ${said}.`);
  return fail(GENERIC);
}

export async function addTrade(formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("contractors.write");
  const f = new FormReader(formData);
  const label = f.requiredText("label", { max: 60, label: "The trade's name" });
  const description = f.text("description", { max: 500, label: "The description" });
  if (!f.ok) return f.fail();

  const { data, error } = await db.rpc("create_trade", { p_label: label, p_description: description ?? undefined });
  if (error) return tradeFailure("create_trade", error, "label");
  const made = (data ?? {}) as { label?: string };
  refresh();
  redirect(withToast(EDIT, `Trade added: ${made.label ?? label}`));
}

export async function editTrade(formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("contractors.write");
  const f = new FormReader(formData);
  const id = f.uuid("id", { required: true });
  const label = f.requiredText("label", { max: 60, label: "The trade's name" });
  const description = f.text("description", { max: 500, label: "The description" });
  if (!id || !f.ok) return f.fail();

  // A blank description clears it (update_trade: "" clears, null would leave it).
  const { data, error } = await db.rpc("update_trade", { p_trade: id, p_label: label, p_description: description ?? "" });
  if (error) return tradeFailure("update_trade", error, "label");
  const changed = (data as { changed?: boolean } | null)?.changed !== false;
  refresh();
  redirect(withToast(EDIT, changed ? "Trade saved" : "Nothing changed", changed ? "success" : "info"));
}

/** One place up or down. A plain form post (no dialog); lands back in edit mode. */
export async function moveTrade(formData: FormData): Promise<void> {
  const { db } = await requireStaff("contractors.write");
  const f = new FormReader(formData);
  const id = f.uuid("id", { required: true });
  const direction = f.oneOf("direction", ["up", "down"] as const, { required: true });
  if (!id || !direction) redirect(withToast(EDIT, "That trade could not be moved.", "error"));

  const { error } = await db.rpc("move_trade", { p_trade: id, p_direction: direction });
  if (error) {
    console.error("[hq] move_trade failed:", logTag(error));
    redirect(withToast(EDIT, error.code === "42501" ? FORBIDDEN : "That trade could not be moved. Nothing was changed.", "error"));
  }
  refresh();
  redirect(`${EDIT}#trade-${id}`);
}

export async function setTradeActive(formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("contractors.approve");
  const f = new FormReader(formData);
  const id = f.uuid("id", { required: true });
  const active = f.oneOf("active", ["true", "false"] as const, { required: true });
  const reason = f.text("reason", { max: 200, label: "The reason" });
  if (!id || !active || !f.ok) return f.fail("That trade could not be changed.");

  const { data, error } = await db.rpc("set_trade_active", { p_trade: id, p_active: active === "true", p_reason: reason ?? undefined });
  if (error) return tradeFailure("set_trade_active", error, null);
  const out = (data ?? {}) as { label?: string; changed?: boolean };
  refresh();
  if (out.changed === false) redirect(withToast(EDIT, "Nothing changed", "info"));
  redirect(withToast(EDIT, active === "true" ? `Trade restored: ${out.label ?? ""}` : `Trade archived: ${out.label ?? ""}`));
}
