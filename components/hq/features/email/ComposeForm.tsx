"use client";

import { useActionState, useRef, useState } from "react";
import { idle, type ActionState } from "@/lib/hq/forms";
import { ADDRESS_MAX, BODY_MAX, EMAIL_TEMPLATES, EMAIL_TEMPLATE_LABEL, NAME_MAX, SUBJECT_MAX, templateStart, type EmailTemplate } from "@/lib/hq/email/rules";
import { LinkButton } from "../../Button";
import { FormActions, fieldError } from "../../Field";
import { FormSummary } from "../../FormSummary";
import { Select } from "../../Select";
import { SubmitButton } from "../../SubmitButton";
import { TextInput, Textarea } from "../../TextInput";

/*
 * Writing (or editing) a draft. The recipient is FIXED here: it was chosen from HQ's own contacts and
 * staff on the page before (an id), and to change it you discard and redraft. The one exception is
 * "Email someone new" (recipient null): the person types a name and an address, and HQ adds them to
 * Contacts as needing a check when the draft is saved (only roles that may edit contacts get this).
 * Choosing a template fills in a suggested subject and a greeting while the fields are untouched; a
 * template never adds facts. Saving makes a DRAFT only; nothing is sent until someone approves it.
 */

type FormAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export type ComposeRecipient = { kind: "contact" | "staff"; id: string; name: string; email: string; detail: string | null };

export function ComposeForm({
  action,
  recipient,
  draftId,
  initial,
  cancelHref,
}: {
  action: FormAction;
  /** The person chosen on the page before, or null to type a name and address for someone new. */
  recipient: ComposeRecipient | null;
  /** Set when editing an existing draft. */
  draftId?: string;
  initial: { template: EmailTemplate; subject: string; body: string };
  cancelHref: string;
}) {
  const [state, formAction] = useActionState(action, idle);
  const retained = (state.data?.values ?? null) as Record<string, string> | null;
  const [template, setTemplate] = useState<EmailTemplate>((retained?.template as EmailTemplate) ?? initial.template);
  const [subject, setSubject] = useState(retained?.subject ?? initial.subject);
  const [body, setBody] = useState(retained?.body ?? initial.body);
  const [newName, setNewName] = useState(retained?.to_name ?? "");
  const touched = useRef({ subject: Boolean(draftId), body: Boolean(draftId) });

  function chooseTemplate(next: EmailTemplate) {
    setTemplate(next);
    const start = templateStart(next, recipient ? recipient.name : newName);
    if (!touched.current.subject) setSubject(start.subject);
    if (!touched.current.body) setBody(start.body);
  }

  return (
    <form action={formAction} noValidate className="grid max-w-2xl gap-6">
      <FormSummary state={state} labels={{ subject: "Subject", body: "Message", template: "Template", recipient_id: "To", to_name: "Name", to_email: "Email address" }} idPrefix="email" />
      {draftId ? <input type="hidden" name="id" value={draftId} /> : null}
      <input type="hidden" name="recipient_kind" value={recipient ? recipient.kind : "new"} />
      {recipient ? <input type="hidden" name="recipient_id" value={recipient.id} /> : null}

      {recipient ? (
        <div className="hq-email-to">
          <p className="hq-label">To</p>
          <p className="hq-email-to__name">{recipient.name}</p>
          <p className="hq-email-to__addr">
            <span className="break-all">{recipient.email}</span>
            {recipient.detail ? <span className="text-grey-text"> &middot; {recipient.detail}</span> : null}
          </p>
          <p className="hq-muted mt-1 text-[13px]">The address on their HQ record. {draftId ? "To send to someone else, discard this draft and write a new one." : null}</p>
        </div>
      ) : (
        <fieldset className="grid gap-4">
          <legend className="hq-label mb-2">To someone new</legend>
          <TextInput
            name="to_name"
            idPrefix="email"
            label="Their name"
            required
            maxLength={NAME_MAX}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            error={fieldError(state, "to_name")}
            className="max-w-md"
          />
          <TextInput
            name="to_email"
            idPrefix="email"
            label="Their email address"
            type="email"
            required
            maxLength={ADDRESS_MAX}
            defaultValue={retained?.to_email ?? ""}
            hint="Type it exactly as you were given it. Saving adds them to Contacts, marked as needing a check."
            error={fieldError(state, "to_email")}
          />
        </fieldset>
      )}

      <Select
        name="template"
        idPrefix="email"
        label="Template"
        hint="Fills in a suggested subject and a greeting. You write the rest."
        options={EMAIL_TEMPLATES.map((t) => ({ value: t, label: EMAIL_TEMPLATE_LABEL[t] }))}
        value={template}
        onChange={(e) => chooseTemplate(e.target.value as EmailTemplate)}
        error={fieldError(state, "template")}
        className="max-w-xs"
      />
      <TextInput
        name="subject"
        idPrefix="email"
        label="Subject"
        required
        maxLength={SUBJECT_MAX}
        value={subject}
        onChange={(e) => {
          touched.current.subject = true;
          setSubject(e.target.value);
        }}
        error={fieldError(state, "subject")}
      />
      <Textarea
        name="body"
        idPrefix="email"
        label="Message"
        required
        rows={12}
        maxLength={BODY_MAX}
        value={body}
        onChange={(e) => {
          touched.current.body = true;
          setBody(e.target.value);
        }}
        hint="Plain text. Leave a blank line between paragraphs. Your name, role and the PLANTED. footer are added below it, so there is no need to sign off."
        error={fieldError(state, "body")}
      />
      <FormActions>
        <LinkButton href={cancelHref}>Cancel</LinkButton>
        <SubmitButton pendingLabel="Saving the draft">{draftId ? "Save draft" : "Save draft"}</SubmitButton>
      </FormActions>
      <p className="hq-muted -mt-2 text-[13px]">Saving does not send anything. The draft waits for someone who can approve emails to tap Approve and send.{recipient ? null : " A new address is never sent from a chat app: it is approved here in HQ."}</p>
    </form>
  );
}
