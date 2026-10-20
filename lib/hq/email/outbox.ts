import "server-only";

import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OutgoingEmail } from "./provider";

/*
 * The fake provider's local outbox (development only; production always uses SendGrid). Each email is
 * written as <id>.json (the envelope and the plain text) and <id>.html, readable only by the user, to
 * HQ_EMAIL_OUTBOX_DIR (default <os temp dir>/planted-hq-email-outbox). Nothing is ever sent.
 * Shared by the staff notice (enquiry-notify.ts) and the enquirer's thank-you (enquiry-ack.ts).
 */

export function outboxDir(): string {
  return process.env.HQ_EMAIL_OUTBOX_DIR?.trim() || path.join(os.tmpdir(), "planted-hq-email-outbox");
}

export async function recordInOutbox(id: string, email: OutgoingEmail): Promise<void> {
  const dir = outboxDir();
  await mkdir(dir, { recursive: true });
  const meta = { id, at: new Date().toISOString(), to: email.to, from: email.from, replyTo: email.replyTo, subject: email.subject, text: email.text };
  await writeFile(path.join(dir, `${id}.json`), JSON.stringify(meta, null, 2), { mode: 0o600 });
  await writeFile(path.join(dir, `${id}.html`), email.html, { mode: 0o600 });
}
