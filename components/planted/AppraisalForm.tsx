"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { Turnstile } from "@marsidev/react-turnstile";
import { BRAND } from "@/lib/planted";
import { ButtonArrow } from "./ui";
import { submitAppraisal } from "@/app/(site)/enquiry-actions";
import {
  APPRAISAL_STEPS,
  appraisalErrors,
  BATHROOMS,
  BEDROOMS,
  CONTACT_METHODS,
  HONEYPOT_FIELD,
  IDLE_STATE,
  JS_FIELD,
  OTHER_MANAGER,
  PARKING,
  PROPERTY_TYPES,
  SUBURBS,
  TENANCY_STATUS,
  TIMEFRAMES,
  TIMESTAMP_FIELD,
  type FieldErrors,
  type Values,
} from "@/lib/enquiries";
import {
  CheckboxField,
  ErrorSummary,
  focusField,
  FormMessage,
  Honeypot,
  RadioField,
  SelectField,
  SubmitButton,
  SuccessPanel,
  TextAreaField,
  TextField,
  useHydrated,
  useStartedAt,
} from "./form-fields";

/*
 * The rental appraisal form: four steps with JavaScript, one long form without
 * it.
 *
 * Progressive enhancement, in that order. The server renders every step, and
 * the <noscript> stylesheet below undoes the step machinery for anyone without
 * JavaScript: all four fieldsets open, the step indicator and the Back and
 * Continue buttons gone, the submit button shown. The form posts to the same
 * Server Action either way, and that action re-validates everything from the
 * FormData regardless of what happened in the browser.
 *
 * Native `required` attributes are present in the server-rendered HTML so the
 * no-JavaScript path still gets the browser's own validation, and are removed
 * once this component has hydrated: a required field inside a hidden step
 * cannot be focused, and the browser would then refuse to submit with no
 * visible explanation at all.
 */

const FORM = "appraisal";
const TOTAL = APPRAISAL_STEPS.length;
const MESSAGE_ID = `${FORM}-form-message`;
const SUMMARY_ID = `${FORM}-error-summary`;

/** Undoes the step machinery when there is no JavaScript to drive it. */
const NO_JS_CSS = `<style>
[data-step-panel]{display:block!important;margin-top:4rem}
[data-step-panel="1"]{margin-top:0}
[data-js-only]{display:none!important}
[data-nojs-submit]{display:inline-flex!important}
</style>`;

const EMPTY: Values = {
  address: "",
  suburb: "",
  postcode: "",
  propertyType: "",
  bedrooms: "",
  bathrooms: "",
  parking: "",
  tenancyStatus: "",
  otherManager: "",
  timeframe: "",
  name: "",
  email: "",
  phone: "",
  contactMethod: "",
  message: "",
  consent: "",
};

const LABELS: Record<string, string> = {
  address: "Property address",
  suburb: "Suburb",
  postcode: "Postcode",
  propertyType: "Property type",
  bedrooms: "Bedrooms",
  bathrooms: "Bathrooms",
  parking: "Parking spaces",
  tenancyStatus: "Currently rented",
  otherManager: "Another property manager",
  timeframe: "Timeframe",
  name: "Full name",
  email: "Email",
  phone: "Phone",
  contactMethod: "Preferred contact",
  message: "Your message",
  consent: "Consent",
};

/** Which step a field belongs to, 1-based. */
const STEP_OF: Record<string, number> = {};
APPRAISAL_STEPS.forEach((s, i) => {
  for (const field of s.fields) STEP_OF[field] = i + 1;
});

const NO_ERRORS: FieldErrors = {};

export function AppraisalForm({ turnstileSiteKey }: { turnstileSiteKey: string | null }) {
  const [state, formAction, pending] = useActionState(submitAppraisal, IDLE_STATE);
  const hydrated = useHydrated();
  const startedAt = useStartedAt();

  // Seeded from the action's state so a no-JavaScript re-render after a
  // validation error comes back with everything still typed in.
  const [values, setValues] = useState<Values>(() => ({ ...EMPTY, ...state.values }));
  const [clientErrors, setClientErrors] = useState<FieldErrors>(NO_ERRORS);
  /** Fields changed since the last submission: their old error no longer applies. */
  const [edited, setEdited] = useState<Record<string, true>>({});
  const [step, setStep] = useState(1);

  /** A request to move focus, counted so that asking twice for the same field
   *  still moves it. Carried out in an effect, which always runs after the
   *  render that put the field on screen. */
  const [focusRequest, setFocusRequest] = useState<{ name: string; n: number } | null>(null);

  const legendRefs = useRef<Array<HTMLLegendElement | null>>([]);
  const stepMoved = useRef(false);

  function requestFocus(name: string) {
    setFocusRequest((prev) => ({ name, n: (prev?.n ?? 0) + 1 }));
  }

  useEffect(() => {
    if (!focusRequest) return;
    focusField(FORM, focusRequest.name);
  }, [focusRequest]);

  // The server has replied. Put the reader where the answer is.
  useEffect(() => {
    if (state.status !== "invalid" && state.status !== "failed") return;
    const target = document.getElementById(SUMMARY_ID) ?? document.getElementById(MESSAGE_ID);
    target?.focus();
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [state]);

  // Announce a new step by moving focus to its heading, but never on load.
  useEffect(() => {
    if (!stepMoved.current) return;
    stepMoved.current = false;
    legendRefs.current[step - 1]?.focus();
  }, [step]);

  const serverErrors = state.status === "invalid" ? state.errors : NO_ERRORS;
  const errors: FieldErrors = {};
  for (const [field, message] of Object.entries({ ...serverErrors, ...clientErrors })) {
    if (!edited[field]) errors[field] = message;
  }

  function set(name: string, value: string) {
    setValues((v) => ({ ...v, [name]: value }));
    setEdited((e) => (e[name] ? e : { ...e, [name]: true }));
  }

  /** The subset of the full rule set that applies to one step. */
  function errorsForStep(n: number, all: FieldErrors): FieldErrors {
    const out: FieldErrors = {};
    for (const field of APPRAISAL_STEPS[n - 1].fields) if (all[field]) out[field] = all[field];
    return out;
  }

  function goNext() {
    const stepErrors = errorsForStep(step, appraisalErrors(values));
    const failed = APPRAISAL_STEPS[step - 1].fields.filter((f) => stepErrors[f]);
    if (failed.length > 0) {
      setClientErrors(stepErrors);
      setEdited({});
      requestFocus(failed[0]);
      return;
    }
    setClientErrors(NO_ERRORS);
    stepMoved.current = true;
    setStep((s) => Math.min(TOTAL, s + 1));
  }

  function goBack() {
    stepMoved.current = true;
    setStep((s) => Math.max(1, s - 1));
  }

  /** A jump from the error summary, which may live on another step. */
  function goToField(name: string) {
    const target = STEP_OF[name] ?? step;
    if (target !== step) setStep(target);
    requestFocus(name);
  }

  // The last line of client-side defence. The action validates all of this
  // again whatever happens here; this only saves a round trip.
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (!hydrated) return;
    const all = appraisalErrors(values);
    setEdited({});

    if (Object.keys(all).length === 0) {
      setClientErrors(NO_ERRORS);
      return;
    }

    event.preventDefault();
    setClientErrors(all);
    const first = Object.keys(all).sort((a, b) => (STEP_OF[a] ?? 0) - (STEP_OF[b] ?? 0))[0];
    setStep(STEP_OF[first] ?? 1);
    requestFocus(first);
  }

  if (state.status === "sent") {
    return (
      <SuccessPanel heading="Thank you for getting in touch.">
        <p>
          We have your property details and your enquiry is with us. We&rsquo;ll look at what
          you&rsquo;ve told us and be in touch to talk through your property&rsquo;s rental
          potential.
        </p>
        <p className="mt-6">
          <Link href="/property-management" className="link-rule">
            Read how we manage properties
          </Link>
        </p>
      </SuccessPanel>
    );
  }

  // With JavaScript only the current step is on screen, so only its problems
  // are worth listing; without it the whole form is open and so is the summary.
  const visibleErrors = hydrated ? errorsForStep(step, errors) : errors;
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
      <noscript dangerouslySetInnerHTML={{ __html: NO_JS_CSS }} />

      <input type="hidden" name={JS_FIELD} value={hydrated ? "1" : ""} readOnly />
      <input type="hidden" name={TIMESTAMP_FIELD} value={startedAt} readOnly />
      <Honeypot form={FORM} name={HONEYPOT_FIELD} />

      <h2 id={`${FORM}-title`} className="sr-only">
        Rental appraisal request
      </h2>

      {/* A real step indicator: the count, the step's name and a hairline that
          fills. The whole block is a polite live region, so moving between
          steps is announced as well as drawn. */}
      <div data-js-only="true" className="mb-12" role="status" aria-live="polite" aria-atomic="true">
        <div className="flex items-baseline justify-between gap-6">
          <p className="label">
            Step <span className="tnum">{step}</span> of <span className="tnum">{TOTAL}</span>
          </p>
          <p className="text-[0.8125rem] text-ink-muted">{APPRAISAL_STEPS[step - 1].title}</p>
        </div>
        <div aria-hidden="true" className="mt-4 h-px w-full bg-line">
          <div
            className="h-px bg-charcoal transition-[width] duration-500"
            style={{ width: `${(step / TOTAL) * 100}%` }}
          />
        </div>
      </div>

      {formMessage && (
        <div className="mb-10">
          <FormMessage id={MESSAGE_ID}>{formMessage}</FormMessage>
        </div>
      )}

      {Object.keys(visibleErrors).length > 0 && (
        <div className="mb-10">
          <ErrorSummary
            id={SUMMARY_ID}
            form={FORM}
            errors={visibleErrors}
            labels={LABELS}
            heading="There's something to fix before we can send this."
            onJump={goToField}
          />
        </div>
      )}

      {/* ── Step 1 ─────────────────────────────────────────── */}
      <fieldset data-step-panel="1" hidden={step !== 1}>
        <legend
          className="display display-sm"
          tabIndex={-1}
          ref={(el) => {
            legendRefs.current[0] = el;
          }}
        >
          {APPRAISAL_STEPS[0].title}
        </legend>
        <p className="mt-3 text-[0.9375rem] text-ink-muted">{APPRAISAL_STEPS[0].blurb}</p>

        <div className="mt-8 grid gap-7">
          <TextField
            form={FORM}
            name="address"
            label="Property address"
            value={values.address}
            onChange={(v) => set("address", v)}
            autoComplete="street-address"
            maxLength={200}
            required={!hydrated}
            error={errors.address}
            hint="The street address of the property you'd like appraised."
          />
          <div className="grid gap-7 sm:grid-cols-2">
            <SelectField
              form={FORM}
              name="suburb"
              label="Suburb"
              value={values.suburb}
              onChange={(v) => set("suburb", v)}
              options={SUBURBS}
              required={!hydrated}
              error={errors.suburb}
            />
            <TextField
              form={FORM}
              name="postcode"
              label="Postcode"
              value={values.postcode}
              onChange={(v) => set("postcode", v.replace(/\D/g, "").slice(0, 4))}
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
              autoComplete="postal-code"
              required={!hydrated}
              error={errors.postcode}
            />
          </div>
          <SelectField
            form={FORM}
            name="propertyType"
            label="Property type"
            value={values.propertyType}
            onChange={(v) => set("propertyType", v)}
            options={PROPERTY_TYPES}
            required={!hydrated}
            error={errors.propertyType}
          />
          <div className="grid gap-7 sm:grid-cols-3">
            <SelectField
              form={FORM}
              name="bedrooms"
              label="Bedrooms"
              value={values.bedrooms}
              onChange={(v) => set("bedrooms", v)}
              options={BEDROOMS}
              placeholder="Choose"
              required={!hydrated}
              error={errors.bedrooms}
            />
            <SelectField
              form={FORM}
              name="bathrooms"
              label="Bathrooms"
              value={values.bathrooms}
              onChange={(v) => set("bathrooms", v)}
              options={BATHROOMS}
              placeholder="Choose"
              required={!hydrated}
              error={errors.bathrooms}
            />
            <SelectField
              form={FORM}
              name="parking"
              label="Parking spaces"
              value={values.parking}
              onChange={(v) => set("parking", v)}
              options={PARKING}
              placeholder="Choose"
              required={!hydrated}
              error={errors.parking}
            />
          </div>
        </div>
      </fieldset>

      {/* ── Step 2 ─────────────────────────────────────────── */}
      <fieldset data-step-panel="2" hidden={step !== 2}>
        <legend
          className="display display-sm"
          tabIndex={-1}
          ref={(el) => {
            legendRefs.current[1] = el;
          }}
        >
          {APPRAISAL_STEPS[1].title}
        </legend>
        <p className="mt-3 text-[0.9375rem] text-ink-muted">{APPRAISAL_STEPS[1].blurb}</p>

        <div className="mt-8 grid gap-9">
          <RadioField
            form={FORM}
            name="tenancyStatus"
            label="Is the property currently rented?"
            value={values.tenancyStatus}
            onChange={(v) => set("tenancyStatus", v)}
            options={TENANCY_STATUS}
            required={!hydrated}
            error={errors.tenancyStatus}
          />
          <RadioField
            form={FORM}
            name="otherManager"
            label="Are you currently using another property manager?"
            value={values.otherManager}
            onChange={(v) => set("otherManager", v)}
            options={OTHER_MANAGER}
            columns={2}
            required={!hydrated}
            error={errors.otherManager}
          />
          <RadioField
            form={FORM}
            name="timeframe"
            label="When are you looking to appoint a property manager?"
            value={values.timeframe}
            onChange={(v) => set("timeframe", v)}
            options={TIMEFRAMES}
            columns={2}
            required={!hydrated}
            error={errors.timeframe}
          />
        </div>
      </fieldset>

      {/* ── Step 3 ─────────────────────────────────────────── */}
      <fieldset data-step-panel="3" hidden={step !== 3}>
        <legend
          className="display display-sm"
          tabIndex={-1}
          ref={(el) => {
            legendRefs.current[2] = el;
          }}
        >
          {APPRAISAL_STEPS[2].title}
        </legend>
        <p className="mt-3 text-[0.9375rem] text-ink-muted">{APPRAISAL_STEPS[2].blurb}</p>

        <div className="mt-8 grid gap-7">
          <TextField
            form={FORM}
            name="name"
            label="Full name"
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
              required={!hydrated && values.contactMethod === "Phone"}
              optional={values.contactMethod !== "Phone"}
              error={errors.phone}
              hint="Needed if you'd rather we called."
            />
          </div>
          <RadioField
            form={FORM}
            name="contactMethod"
            label="How would you prefer to be contacted?"
            value={values.contactMethod}
            onChange={(v) => set("contactMethod", v)}
            options={CONTACT_METHODS}
            required={!hydrated}
            error={errors.contactMethod}
          />
        </div>
      </fieldset>

      {/* ── Step 4 ─────────────────────────────────────────── */}
      <fieldset data-step-panel="4" hidden={step !== 4}>
        <legend
          className="display display-sm"
          tabIndex={-1}
          ref={(el) => {
            legendRefs.current[3] = el;
          }}
        >
          {APPRAISAL_STEPS[3].title}
        </legend>
        <p className="mt-3 text-[0.9375rem] text-ink-muted">{APPRAISAL_STEPS[3].blurb}</p>

        <div className="mt-8 grid gap-7">
          <TextAreaField
            form={FORM}
            name="message"
            label="Anything else we should know?"
            value={values.message}
            onChange={(v) => set("message", v)}
            maxLength={2000}
            optional
            error={errors.message}
            hint="Recent works, tenancy details, access notes — whatever helps."
          />
          <CheckboxField
            form={FORM}
            name="consent"
            label={`I'm happy for ${BRAND.name} to use these details to respond to my enquiry.`}
            checked={values.consent === "yes"}
            onChange={(checked) => set("consent", checked ? "yes" : "")}
            required={!hydrated}
            error={errors.consent}
          >
            <>
              How we handle your details is set out in our{" "}
              <Link href="/privacy" className="underline underline-offset-4">
                Privacy Policy
              </Link>
              .
            </>
          </CheckboxField>

          {turnstileSiteKey && (
            <div>
              <Turnstile siteKey={turnstileSiteKey} options={{ size: "flexible", theme: "light" }} />
            </div>
          )}
        </div>
      </fieldset>

      {/* ── Navigation ─────────────────────────────────────── */}
      <div className="mt-14 flex flex-col gap-4 sm:flex-row sm:items-center">
        <button type="button" data-js-only="true" hidden={step === 1} onClick={goBack} className="btn btn-outline btn-noarrow">
          Back
        </button>
        <button type="button" data-js-only="true" hidden={step === TOTAL} onClick={goNext} className="btn">
          <span>Continue</span>
          <ButtonArrow />
        </button>
        <SubmitButton
          pending={pending}
          hidden={step !== TOTAL}
          dataAttr={{ "data-nojs-submit": "true" }}
          pendingLabel="Sending your request…"
        >
          Request my rental appraisal
        </SubmitButton>
      </div>

      <p className="mt-8 text-[0.8125rem] leading-relaxed text-ink-muted">
        We use what you send here to respond to your enquiry. Nothing else.
      </p>
    </form>
  );
}
