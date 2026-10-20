/*
 * Sending one approved email: begin_email_send -> the provider -> finish_email_send. Used by the HQ
 * "Approve and send" action and by the MCP send_email_draft tool (both through lib/hq/email/send.ts).
 *
 * Why a double send cannot happen, even with retries or two taps at once:
 *   - begin_email_send locks the draft and flips it to `sending`; a second call (or a concurrent one,
 *     which waits on the lock) finds it sending or sent and is refused, so the provider is reached at
 *     most once per approval;
 *   - the provider is called once, with a short timeout and no retry;
 *   - after a failure (including a timeout, when the email may have been delivered) the draft is
 *     `failed`, and only a NEW approval in HQ makes it sendable again. Nothing here retries.
 *
 * Pure: every effect is passed in (`deps`), so it is unit tested with a mocked database and provider.
 */

export type SendVia = "hq" | "chat";

/** What begin_email_send returns (the fields the send needs). */
export type BegunEmail = {
  draft_id: string;
  ref: string;
  to_email: string;
  to_name: string;
  subject: string;
  body_text: string;
  reply_to_email: string;
  sender_name: string;
  sender_role: string;
  recipient_contact_id: string | null;
};

type DbError = { code?: string | null; message?: string | null; hint?: string | null } | null;
type Mailbox = { email: string; name?: string | null };

export type SendDeps = {
  /** Null when the provider can send; otherwise the reason (nothing is begun). */
  unavailable: () => "not_configured" | null;
  begin: (draftId: string, via: SendVia) => Promise<{ data: BegunEmail | null; error: DbError }>;
  render: (b: BegunEmail) => { subject: string; text: string; html: string };
  deliver: (email: { to: Mailbox; from: Mailbox; replyTo: Mailbox; subject: string; text: string; html: string }) => Promise<
    { ok: true; messageId: string | null } | { ok: false; code: string }
  >;
  finish: (draftId: string, ok: boolean, messageId: string | null, errorCode: string | null) => Promise<{ error: DbError }>;
  from: Mailbox;
  /** Gets a place and a short code only: never an address, a message or a key. */
  log: (where: string, code: string) => void;
};

export type SendResult =
  | { status: "sent"; ref: string; draftId: string; toName: string; toEmail: string; fromEmail: string; fromName: string; replyTo: string; messageId: string | null; recorded: true }
  /** Delivered, but HQ could not record it: the draft stays "sending" and is never re-sent automatically. */
  | { status: "sent_unrecorded"; ref: string; draftId: string; toName: string; toEmail: string; fromEmail: string; fromName: string; replyTo: string; messageId: string | null; recorded: false }
  | { status: "failed"; ref: string; draftId: string; toName: string; toEmail: string; code: string; recorded: boolean }
  | { status: "refused"; reason: "not_configured" | "database"; error: DbError };

export async function sendDraftWith(deps: SendDeps, draftId: string, via: SendVia): Promise<SendResult> {
  const why = deps.unavailable();
  if (why) {
    deps.log("email send", why);
    return { status: "refused", reason: "not_configured", error: null };
  }

  const begun = await deps.begin(draftId, via);
  if (begun.error || !begun.data) {
    deps.log("begin_email_send", begun.error?.hint || begun.error?.code || "no_data");
    return { status: "refused", reason: "database", error: begun.error };
  }
  const b = begun.data;

  // From here the draft is `sending`: whatever happens, the provider is called at most once.
  let outcome: { ok: true; messageId: string | null } | { ok: false; code: string };
  try {
    const rendered = deps.render(b);
    outcome = await deps.deliver({
      to: { email: b.to_email, name: b.to_name },
      from: deps.from,
      replyTo: { email: b.reply_to_email, name: b.sender_name },
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
  } catch (e) {
    deps.log("email deliver", e instanceof Error ? e.name : "unknown");
    outcome = { ok: false, code: "provider_error" };
  }

  const finished = await deps.finish(b.draft_id, outcome.ok, outcome.ok ? outcome.messageId : null, outcome.ok ? null : outcome.code).catch(
    (e: unknown) => ({ error: { code: e instanceof Error ? e.name : "unknown" } as DbError }),
  );
  if (finished.error) deps.log("finish_email_send", finished.error.hint || finished.error.code || "unknown");

  if (outcome.ok) {
    const common = { ref: b.ref, draftId: b.draft_id, toName: b.to_name, toEmail: b.to_email, fromEmail: deps.from.email, fromName: deps.from.name ?? "", replyTo: b.reply_to_email, messageId: outcome.messageId };
    return finished.error ? { status: "sent_unrecorded", ...common, recorded: false } : { status: "sent", ...common, recorded: true };
  }
  deps.log("email deliver", outcome.code);
  return { status: "failed", ref: b.ref, draftId: b.draft_id, toName: b.to_name, toEmail: b.to_email, code: outcome.code, recorded: !finished.error };
}
