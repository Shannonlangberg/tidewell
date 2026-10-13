"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { Turnstile } from "@marsidev/react-turnstile";
import { submitContact } from "@/app/(site)/enquiry-actions";
import {
  CONTACT_FIELDS,
  contactErrors,
  ENQUIRY_TYPES,
  HONEYPOT_FIELD,
  IDLE_STATE,
  JS_FIELD,
  TIMESTAMP_FIELD,
  type FieldErrors,
  type Values,
} from "@/lib/enquiries";
import {
  ErrorSummary,
  focusField,
  FormMessage,
  Honeypot,
  SelectField,
  SubmitButton,
  SuccessPanel,
  TextAreaField,
  TextField,
  useHydrated,
} from "./form-fields";

/*
 * The general contact form. One step, the same pipeline as the appraisal form
 * and the same promise: it only ever says an enquiry was sent once the server
 * confirms it was delivered.
 *
 * Without JavaScript this posts to the Server Action as an ordinary form and
 * the action redirects to /enquiry-received. Native `required` attributes are
 * in the server-rendered HTML for that path and step aside once this component
 * has hydrated and can give better messages of its own.
 */

const FORM = "contact";
const MESSAGE_ID = `${FORM}-form-message`;
const SUMMARY_ID = `${FORM}-error-summary`;

const EMPTY: Values = { name: "", email: "", phone: "", enquiryType: "", message: "" };

const LABELS: Record<string, string> = {
  name: "Your name",
  email: "Email",
  phone: "Phone",
  enquiryType: "What this is about",
  message: "Your message",
};

const NO_ERRORS: FieldErrors = {};

export function ContactForm({
  turnstileSiteKey,
  initialEnquiryType = "",
}: {
  turnstileSiteKey: string | null;
  /** Preselected from ?enquiry= on the way in, e.g. from the homepage. */
  initialEnquiryType?: string;
}) {
  const [state, formAction, pending] = useActionState(submitContact, IDLE_STATE);
  const hydrated = useHydrated();

  const [values, setValues] = useState<Values>(() => ({
    ...EMPTY,
    enquiryType: initialEnquiryType,
    ...state.values,
  }));
  const [clientErrors, setClientErrors] = useState<FieldErrors>(NO_ERRORS);
  const [edited, setEdited] = useState<Record<string, true>>({});

  const jsRef = useRef<HTMLInputElement>(null);
  const startedRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (jsRef.current) jsRef.current.value = "1";
    if (startedRef.current) startedRef.current.value = String(Date.now());
  }, []);

  useEffect(() => {
    if (state.status !== "invalid" && state.status !== "failed") return;
    requestAnimationFrame(() => {
      const target = document.getElementById(SUMMARY_ID) ?? document.getElementById(MESSAGE_ID);
      target?.focus();
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, [state]);

  const serverErrors = state.status === "invalid" ? state.errors : NO_ERRORS;
  const errors: FieldErrors = {};
  for (const [field, message] of Object.entries({ ...serverErrors, ...clientErrors })) {
    if (!edited[field]) errors[field] = message;
  }

  function set(name: string, value: string) {
    setValues((v) => ({ ...v, [name]: value }));
    setEdited((e) => (e[name] ? e : { ...e, [name]: true }));
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (!hydrated) return;
    const all = contactErrors(values);
    setEdited({});

    if (Object.keys(all).length === 0) {
      setClientErrors(NO_ERRORS);
      return;
    }

    event.preventDefault();
    setClientErrors(all);
    const first = CONTACT_FIELDS.find((f) => all[f]);
    if (first) requestAnimationFrame(() => focusField(FORM, first));
  }

  if (state.status === "sent") {
    return (
      <SuccessPanel heading="Thank you for getting in touch.">
        <p>
          Your message has reached us. We&rsquo;ll read it properly and come back to you about what
          you&rsquo;ve asked.
        </p>
        <p className="mt-6">
          <Link href="/property-management" className="link-rule">
            Read how we manage properties
          </Link>
        </p>
      </SuccessPanel>
    );
  }

  const formMessage =
    state.status === "failed" || (state.status === "invalid" && Object.keys(state.errors).length === 0)
      ? state.message
      : null;

  return (
    <form
      id={FORM}
      action={formAction}
      onSubmit={onSubmit}
      noValidate={hydrated}
      className="relative"
      aria-labelledby={`${FORM}-title`}
    >
      <input type="hidden" name={JS_FIELD} ref={jsRef} defaultValue="" />
      <input type="hidden" name={TIMESTAMP_FIELD} ref={startedRef} defaultValue="" />
      <Honeypot form={FORM} name={HONEYPOT_FIELD} />

      <h2 id={`${FORM}-title`} className="sr-only">
        Send an enquiry
      </h2>

      {formMessage && (
        <div className="mb-10">
          <FormMessage id={MESSAGE_ID}>{formMessage}</FormMessage>
        </div>
      )}

      {Object.keys(errors).length > 0 && (
        <div className="mb-10">
          <ErrorSummary
            id={SUMMARY_ID}
            form={FORM}
            errors={errors}
            labels={LABELS}
            heading="There's something to fix before we can send this."
          />
        </div>
      )}

      <div className="grid gap-7">
        <TextField
          form={FORM}
          name="name"
          label="Your name"
          value={values.name}
          onChange={(v) => set("name", v)}
          autoComplete="name"
          maxLength={120}
          required={!hydrated}
          error={errors.name}
        />
        <div className="grid gap-7 sm:grid-cols-2">
          <TextField
            form={FORM}
            name="email"
            label="Email"
            type="email"
            inputMode="email"
            value={values.email}
            onChange={(v) => set("email", v)}
            autoComplete="email"
            maxLength={254}
            required={!hydrated}
            error={errors.email}
          />
          <TextField
            form={FORM}
            name="phone"
            label="Phone"
            type="tel"
            inputMode="tel"
            value={values.phone}
            onChange={(v) => set("phone", v)}
            autoComplete="tel"
            maxLength={40}
            optional
            error={errors.phone}
          />
        </div>
        <SelectField
          form={FORM}
          name="enquiryType"
          label="What's this about?"
          value={values.enquiryType}
          onChange={(v) => set("enquiryType", v)}
          options={ENQUIRY_TYPES}
          required={!hydrated}
          error={errors.enquiryType}
        />
        <TextAreaField
          form={FORM}
          name="message"
          label="Your message"
          value={values.message}
          onChange={(v) => set("message", v)}
          maxLength={2000}
          required={!hydrated}
          error={errors.message}
          hint="Tell us about your property or what you'd like to know."
        />

        {turnstileSiteKey && (
          <div>
            <Turnstile siteKey={turnstileSiteKey} options={{ size: "flexible", theme: "light" }} />
          </div>
        )}
      </div>

      <div className="mt-12">
        <SubmitButton pending={pending} pendingLabel="Sending your message…">
          Send Enquiry
        </SubmitButton>
      </div>

      <p className="mt-8 text-[0.8125rem] leading-relaxed text-ink-muted">
        We use what you send here to respond to your enquiry. Nothing else. How we handle your
        details is set out in our{" "}
        <Link href="/privacy" className="underline underline-offset-4">
          Privacy Policy
        </Link>
        .
      </p>
    </form>
  );
}
