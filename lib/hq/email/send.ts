import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { HqClient } from "@/lib/hq/db";
import { ROLE_LABEL, type StaffRole } from "@/lib/hq/constants";
import { sendDraftWith, type BegunEmail, type SendResult, type SendVia } from "./orchestrator";
import { chooseProvider, fakeFailure, fakeProvider, fromMailbox, type OutgoingEmail } from "./provider";
import { renderEmail } from "./render";
import { deliverViaSendGrid, sendGridConfigured } from "./sendgrid";

/*
 * sendDraft(db, draftId, via): the one way HQ sends an email, shared by the HQ "Approve and send"
 * action and the MCP send_email_draft tool. `db` carries the person's OWN session, so
 * begin_email_send / finish_email_send decide as that person (capability, MFA, the status machine,
 * the recipient re-check and the daily limit). See orchestrator.ts for why it cannot send twice.
 *
 * Provider: SendGrid in production. Elsewhere the fake provider, unless HQ_EMAIL_PROVIDER=sendgrid is
 * set explicitly; the fake one writes each email to a local outbox folder
 * (HQ_EMAIL_OUTBOX_DIR, default <os temp dir>/planted-hq-email-outbox) and never sends anything.
 */

export type { SendResult, SendVia };

export function emailProvider(): "sendgrid" | "fake" | "none" {
  const c = chooseProvider({ nodeEnv: process.env.NODE_ENV, provider: process.env.HQ_EMAIL_PROVIDER, hasKey: sendGridConfigured() });
  return c.kind;
}

export function emailFrom() {
  return fromMailbox({ address: process.env.EMAIL_FROM_ADDRESS, name: process.env.EMAIL_FROM_NAME });
}

function outboxDir(): string {
  return process.env.HQ_EMAIL_OUTBOX_DIR?.trim() || path.join(os.tmpdir(), "planted-hq-email-outbox");
}

async function recordInOutbox(id: string, email: OutgoingEmail): Promise<void> {
  const dir = outboxDir();
  await mkdir(dir, { recursive: true });
  const meta = { id, at: new Date().toISOString(), to: email.to, from: email.from, replyTo: email.replyTo, subject: email.subject, text: email.text };
  await writeFile(path.join(dir, `${id}.json`), JSON.stringify(meta, null, 2), { mode: 0o600 });
  await writeFile(path.join(dir, `${id}.html`), email.html, { mode: 0o600 });
}

const roleLabel = (role: string) => (Object.hasOwn(ROLE_LABEL, role) ? ROLE_LABEL[role as StaffRole] : null);

export async function sendDraft(db: HqClient, draftId: string, via: SendVia): Promise<SendResult> {
  const kind = emailProvider();
  const fake = fakeProvider(recordInOutbox, { fail: fakeFailure(process.env.HQ_EMAIL_FAKE_FAIL), newId: randomUUID });
  return sendDraftWith(
    {
      unavailable: () => (kind === "none" ? "not_configured" : null),
      begin: async (id, v) => {
        const { data, error } = await db.rpc("begin_email_send", { p_id: id, p_via: v });
        return { data: (data as BegunEmail | null) ?? null, error };
      },
      render: (b) => renderEmail({ subject: b.subject, body: b.body_text, senderName: b.sender_name, senderRole: roleLabel(b.sender_role) }),
      deliver: (email) => (kind === "sendgrid" ? deliverViaSendGrid(email) : fake.deliver(email)),
      finish: async (id, ok, messageId, errorCode) => {
        const { error } = await db.rpc("finish_email_send", { p_id: id, p_ok: ok, p_message_id: messageId ?? undefined, p_error: errorCode ?? undefined });
        return { error };
      },
      from: emailFrom(),
      log: (where, code) => console.error(`[hq] ${where}:`, code),
    },
    draftId,
    via,
  );
}
