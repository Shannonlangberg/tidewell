"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
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
  RadioField,
  SubmitButton,
  SuccessPanel,
  TextAreaField,
  TextField,
  useHydrated,
  useStartedAt,
} from "./form-fields";

/*
 * The general contact form. One step, the same pipeline as the appraisal form
 * and the same promise: it only ever says an enquiry was sent once the server
 * confirms it was delivered.
 *
 * 2026 layout (homepage "Contact & appraisal" band in the Claude Design
 * handoff): "I'm interested in" as pill chips, name and email, phone and
 * property suburb, the message, then the submit. `tone="dark"` is the forest
 * band on the homepage; the /contact page uses the light default.
 *
 * Without JavaScript this posts to the Server Action as an ordinary form and
 * the action redirects to /enquiry-received. Native `required` attributes are
 * in the server-rendered HTML for that path and step aside once this component
 * has hydrated and can give better messages of its own.
 */

const FORM = "contact";
const MESSAGE_ID = `${FORM}-form-message`;
const SUMMARY_ID = `${FORM}-error-summary`;

const EMPTY: Values = { name: "", email: "", phone: "", suburb: "", enquiryType: "", message: "" };

const LABELS: Record<string, string> = {
  enquiryType: "I’m interested in",
  name: "Your name",
  email: "Email",
  phone: "Phone",
  suburb: "Property suburb",
  message: "Tell us about your property",
};

/** The chip shown for each enquiry type the server accepts (lib/enquiries.ts). */
const INTEREST_LABELS: Record<string, string> = {
  "Rental Appraisal": "Rental appraisal",
  "Property Management": "Property management",
  "Switching Property Managers": "Switching managers",
  "Tenant Enquiry": "I’m a tenant",
  "General Enquiry": "Something else",
};

const NO_ERRORS: FieldErrors = {};

export function ContactForm({
  turnstileSiteKey,
  initialEnquiryType = "",
  tone = "light",
}: {
  turnstileSiteKey: string | null;
  /** Preselected from ?enquiry= on the way in, e.g. from the homepage. */
  initialEnquiryType?: string;
  tone?: "light" | "dark";
}) {
  const dark = tone === "dark";
  const [state, formAction, pending] = useActionState(submitContact, IDLE_STATE);
  const hydrated = useHydrated();
  const startedAt = useStartedAt();

  const [values, setValues] = useState<Values>(() => ({
    ...EMPTY,
    enquiryType: initialEnquiryType,
    ...state.values,
  }));
  const [clientErrors, setClientErrors] = useState<FieldErrors>(NO_ERRORS);
  const [edited, setEdited] = useState<Record<string, true>>({});
  /** A request to move focus, counted so that asking twice for the same field
   *  still moves it. Carried out in an effect, which always runs after the
   *  render that showed the error. */
  const [focusRequest, setFocusRequest] = useState<{ name: string; n: number } | null>(null);

  function requestFocus(name: string) {
    setFocusRequest((prev) => ({ name, n: (prev?.n ?? 0) + 1 }));
  }

  useEffect(() => {
    if (!focusRequest) return;
    focusField(FORM, focusRequest.name);
  }, [focusRequest]);

  useEffect(() => {
    if (state.status !== "invalid" && state.status !== "failed") return;
    const target = document.getElementById(SUMMARY_ID) ?? document.getElementById(MESSAGE_ID);
    target?.focus();
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
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
    if (first) requestFocus(first);
  }

  if (state.status === "sent") {
    return (
      <SuccessPanel heading="Thank you for getting in touch." tone={tone}>
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
      <input type="hidden" name={JS_FIELD} value={hydrated ? "1" : ""} readOnly />
      <input type="hidden" name={TIMESTAMP_FIELD} value={startedAt} readOnly />
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
        <RadioField
          form={FORM}
          name="enquiryType"
          label="I’m interested in"
          layout="chips"
          value={values.enquiryType}
          onChange={(v) => set("enquiryType", v)}
          options={ENQUIRY_TYPES}
          labels={INTEREST_LABELS}
          required={!hydrated}
          error={errors.enquiryType}
        />
        <div className="grid gap-5 sm:grid-cols-2">
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
          <TextField
            form={FORM}
            name="suburb"
            label="Property suburb"
            value={values.suburb}
            onChange={(v) => set("suburb", v)}
            autoComplete="address-level2"
            maxLength={80}
            optional
            error={errors.suburb}
          />
        </div>
        <TextAreaField
          form={FORM}
          name="message"
          label="Tell us about your property"
          value={values.message}
          onChange={(v) => set("message", v)}
          maxLength={2000}
          rows={4}
          required={!hydrated}
          error={errors.message}
          hint="Or whatever you’d like to ask."
        />

        {turnstileSiteKey && (
          <div>
            <Turnstile siteKey={turnstileSiteKey} options={{ size: "flexible", theme: dark ? "dark" : "light" }} />
          </div>
        )}
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-5">
        <SubmitButton pending={pending} pendingLabel="Sending your enquiry…" variant={dark ? "lime" : "primary"}>
          Send enquiry
        </SubmitButton>
        <p className="m-0 max-w-[18rem] text-[0.8125rem] leading-relaxed text-muted">
          We use what you send here to respond to your enquiry. Nothing else. See our{" "}
          <Link href="/privacy" className="underline underline-offset-4">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </form>
  );
}
