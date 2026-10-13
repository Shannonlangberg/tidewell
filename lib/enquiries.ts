/**
 * The enquiry pipeline: types, validation, spam checks and delivery.
 *
 * Two kinds of enquiry (a rental appraisal request and a general contact
 * message) share one path: read the form, validate it, screen it for spam,
 * deliver it, report honestly what happened. Nothing here ever reports success
 * for an enquiry that was not delivered.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ENVIRONMENT VARIABLES THIS PIPELINE READS
 *
 * Delivery adapters are tried in the order listed. The first one that is
 * configured and succeeds wins. (For the lead: fold this block into
 * .env.example and the README.)
 *
 *   RESEND_API_KEY
 *     Resend API key (re_...). With ENQUIRY_TO_EMAIL, enquiries are emailed
 *     through https://api.resend.com/emails using fetch (no SDK).
 *     Absent: the email adapter is skipped.
 *
 *   ENQUIRY_TO_EMAIL
 *     The address enquiries are sent to. Required for the email adapter;
 *     without it RESEND_API_KEY alone does nothing.
 *     Absent: the email adapter is skipped.
 *
 *   ENQUIRY_FROM_EMAIL          (optional)
 *     The sender, e.g. "PLANTED. Website <enquiries@yourdomain.com.au>". The
 *     domain must be verified in Resend.
 *     Absent: falls back to Resend's shared testing sender
 *     "PLANTED. Website <onboarding@resend.dev>", which only delivers to the
 *     Resend account owner's own address. Set a verified sender before launch.
 *
 *   ENQUIRY_WEBHOOK_URL
 *     An HTTPS endpoint that receives the enquiry as JSON (POST). This is the
 *     hook for a CRM or a database later.
 *     Absent: the webhook adapter is skipped.
 *
 *   ENQUIRY_WEBHOOK_SECRET      (optional)
 *     Sent with the webhook as the `X-Enquiry-Secret` header so the receiver
 *     can authenticate the call.
 *     Absent: the webhook is posted without that header.
 *
 *   TURNSTILE_SECRET_KEY
 *     Cloudflare Turnstile secret, verified server-side on every submission.
 *     Absent: the Turnstile check is skipped entirely.
 *
 *   NEXT_PUBLIC_TURNSTILE_SITE_KEY
 *     Cloudflare Turnstile site key. Read by the two pages (not by this file)
 *     and passed to the form.
 *     Absent: the widget is not rendered.
 *     NOTE FOR THE LEAD: next.config.mjs currently allows the Turnstile script
 *     and iframe on /app only. Before these keys are set, /rental-appraisal and
 *     /contact need the same CSP exception, or the widget will be blocked.
 *
 *   NODE_ENV
 *     When it is not "production" and no adapter above is configured, the
 *     enquiry is logged to the server console and treated as delivered, so
 *     local testing works end to end.
 *     In production with no adapter configured, delivery FAILS: the person is
 *     told the form is not connected yet, and the server logs which variables
 *     are missing. Nobody is ever shown a success message for an enquiry that
 *     went nowhere.
 * ──────────────────────────────────────────────────────────────────────────
 */

import { AREAS, BRAND } from "@/lib/planted";

/* ── options ──────────────────────────────────────────────────────────────
 * Every select and radio group on both forms. These lists are the single
 * source of truth: the fields render from them and the validator checks
 * against them, so the two can never drift apart.
 */

export const ELSEWHERE = "Elsewhere on the Copper Coast";
export const SUBURBS: readonly string[] = [...AREAS.map((a) => a.name), ELSEWHERE];

export const PROPERTY_TYPES = ["House", "Unit", "Townhouse", "Apartment", "Other"] as const;
export const BEDROOMS = ["1", "2", "3", "4", "5 or more"] as const;
export const BATHROOMS = ["1", "2", "3", "4 or more"] as const;
export const PARKING = ["None", "1", "2", "3", "4 or more"] as const;

export const TENANCY_STATUS = ["Yes", "No", "Soon to be"] as const;
export const OTHER_MANAGER = ["Yes", "No"] as const;
export const TIMEFRAMES = ["Immediately", "Within 30 days", "Within 3 months", "Just exploring"] as const;

export const CONTACT_METHODS = ["Email", "Phone", "Either"] as const;

export const ENQUIRY_TYPES = [
  "Property Management",
  "Rental Appraisal",
  "Switching Property Managers",
  "General Enquiry",
] as const;

/** The homepage links to /contact?enquiry=switching; these are the values we understand. */
export const ENQUIRY_TYPE_BY_PARAM: Record<string, string> = {
  management: "Property Management",
  "property-management": "Property Management",
  appraisal: "Rental Appraisal",
  "rental-appraisal": "Rental Appraisal",
  switching: "Switching Property Managers",
  switch: "Switching Property Managers",
  general: "General Enquiry",
};

/** The four fieldsets of the appraisal form, in order. Drives the step indicator,
 *  the per-step client validation and the jump to the first server-side error. */
export const APPRAISAL_STEPS: { title: string; blurb: string; fields: string[] }[] = [
  {
    title: "Property details",
    blurb: "Where the property is and what it is.",
    fields: ["address", "suburb", "postcode", "propertyType", "bedrooms", "bathrooms", "parking"],
  },
  {
    title: "Ownership details",
    blurb: "How the property is managed today.",
    fields: ["tenancyStatus", "otherManager", "timeframe"],
  },
  {
    title: "Contact details",
    blurb: "How we reach you.",
    fields: ["name", "email", "phone", "contactMethod"],
  },
  {
    title: "Additional information",
    blurb: "Anything else worth knowing.",
    fields: ["message", "consent"],
  },
];

export const CONTACT_FIELDS = ["name", "email", "phone", "enquiryType", "message"];

/* ── types ───────────────────────────────────────────────────────────────── */

export type EnquiryKind = "appraisal" | "contact";

export type FieldErrors = Record<string, string>;

export type Values = Record<string, string>;

/**
 * What a Server Action hands back to the form.
 *
 *  idle    nothing submitted yet
 *  invalid the submission was rejected; `errors` is keyed by field name
 *  failed  the submission was fine but could not be delivered — never a success
 *  sent    delivered
 */
export type EnquiryState = {
  status: "idle" | "invalid" | "failed" | "sent";
  /** Form-level message. Field-level messages live in `errors`. */
  message: string | null;
  errors: FieldErrors;
  /** Echoed back so a no-JavaScript re-render does not empty the form. */
  values: Values;
};

export const IDLE_STATE: EnquiryState = { status: "idle", message: null, errors: {}, values: {} };

/** A validated enquiry, ready to deliver. `fields` is the human ordering. */
export type Enquiry = {
  kind: EnquiryKind;
  submittedAt: string;
  subject: string;
  replyTo: string;
  /** Only ever a suburb name from SUBURBS, or null. Safe to log. */
  suburb: string | null;
  fields: { label: string; value: string }[];
  data: Values;
};

/* ── field limits ────────────────────────────────────────────────────────── */

const LIMITS = {
  name: 120,
  email: 254,
  phone: 40,
  address: 200,
  postcode: 4,
  suburb: 80,
  message: 2000,
} as const;

/* ── small helpers ───────────────────────────────────────────────────────── */

/** Collapse whitespace and trim: for single-line fields. */
function one(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** Trim and normalise line endings: for the message box. */
function many(value: string | undefined): string {
  return (value ?? "").replace(/\r\n/g, "\n").trim();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Permissive on purpose: Australian numbers are written every which way. */
function looksLikePhone(value: string): boolean {
  if (!/^[\d\s()+.-]+$/.test(value)) return false;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15;
}

function requireText(errors: FieldErrors, values: Values, field: string, max: number, missing: string, long: string) {
  const value = values[field] ?? "";
  if (!value) errors[field] = missing;
  else if (value.length > max) errors[field] = long;
}

function requireChoice(errors: FieldErrors, values: Values, field: string, allowed: readonly string[], missing: string) {
  const value = values[field] ?? "";
  if (!value) errors[field] = missing;
  else if (!allowed.includes(value)) errors[field] = "Choose one of the options listed.";
}

/* ── reading a submission ────────────────────────────────────────────────── */

function text(form: FormData, name: string): string {
  const raw = form.get(name);
  return typeof raw === "string" ? raw : "";
}

export function readAppraisal(form: FormData): Values {
  return {
    address: one(text(form, "address")),
    suburb: one(text(form, "suburb")),
    postcode: one(text(form, "postcode")),
    propertyType: one(text(form, "propertyType")),
    bedrooms: one(text(form, "bedrooms")),
    bathrooms: one(text(form, "bathrooms")),
    parking: one(text(form, "parking")),
    tenancyStatus: one(text(form, "tenancyStatus")),
    otherManager: one(text(form, "otherManager")),
    timeframe: one(text(form, "timeframe")),
    name: one(text(form, "name")),
    email: one(text(form, "email")),
    phone: one(text(form, "phone")),
    contactMethod: one(text(form, "contactMethod")),
    message: many(text(form, "message")),
    // A checkbox is absent from FormData when it is unticked.
    consent: form.get("consent") ? "yes" : "",
  };
}

export function readContact(form: FormData): Values {
  return {
    name: one(text(form, "name")),
    email: one(text(form, "email")),
    phone: one(text(form, "phone")),
    enquiryType: one(text(form, "enquiryType")),
    message: many(text(form, "message")),
  };
}

/* ── validation ──────────────────────────────────────────────────────────
 * Both validators are pure functions over a plain record, so the client runs
 * exactly the same rules per step that the server runs over the whole form.
 * The server never trusts the client's result: it re-reads the FormData and
 * re-runs these from scratch.
 */

export function appraisalErrors(input: Values): FieldErrors {
  const v: Values = { ...input };
  for (const key of Object.keys(v)) v[key] = key === "message" ? many(v[key]) : one(v[key]);
  const e: FieldErrors = {};

  requireText(e, v, "address", LIMITS.address, "Enter the property address.", "Please shorten the address to 200 characters or fewer.");
  requireChoice(e, v, "suburb", SUBURBS, "Choose the suburb the property is in.");

  if (!v.postcode) e.postcode = "Enter the postcode.";
  else if (!/^\d{4}$/.test(v.postcode)) e.postcode = "A postcode is four digits, for example 5554.";

  requireChoice(e, v, "propertyType", PROPERTY_TYPES, "Choose the property type.");
  requireChoice(e, v, "bedrooms", BEDROOMS, "Choose the number of bedrooms.");
  requireChoice(e, v, "bathrooms", BATHROOMS, "Choose the number of bathrooms.");
  requireChoice(e, v, "parking", PARKING, "Choose the number of parking spaces.");

  requireChoice(e, v, "tenancyStatus", TENANCY_STATUS, "Let us know whether the property is currently rented.");
  requireChoice(e, v, "otherManager", OTHER_MANAGER, "Let us know whether another property manager is involved.");
  requireChoice(e, v, "timeframe", TIMEFRAMES, "Choose the timeframe that fits best.");

  requireText(e, v, "name", LIMITS.name, "Enter your full name.", "Please shorten your name to 120 characters or fewer.");

  if (!v.email) e.email = "Enter your email address.";
  else if (v.email.length > LIMITS.email) e.email = "That email address is too long.";
  else if (!EMAIL_RE.test(v.email)) e.email = "That doesn't look like an email address. Check for a typo.";

  requireChoice(e, v, "contactMethod", CONTACT_METHODS, "Choose how you'd prefer to be contacted.");

  // Phone is required only when it is the way they have asked to be reached.
  if (!v.phone) {
    if (v.contactMethod === "Phone") e.phone = "Enter a phone number, or change your preferred contact method to email.";
  } else if (v.phone.length > LIMITS.phone) {
    e.phone = "That phone number is too long.";
  } else if (!looksLikePhone(v.phone)) {
    e.phone = "Enter a phone number using digits, spaces and + ( ) - only.";
  }

  if (v.message && v.message.length > LIMITS.message) {
    e.message = "Please shorten your message to 2,000 characters or fewer.";
  }

  if (v.consent !== "yes") {
    e.consent = "Please tick the box so we know we may use your details to reply.";
  }

  return e;
}

export function contactErrors(input: Values): FieldErrors {
  const v: Values = { ...input };
  for (const key of Object.keys(v)) v[key] = key === "message" ? many(v[key]) : one(v[key]);
  const e: FieldErrors = {};

  requireText(e, v, "name", LIMITS.name, "Enter your name.", "Please shorten your name to 120 characters or fewer.");

  if (!v.email) e.email = "Enter your email address.";
  else if (v.email.length > LIMITS.email) e.email = "That email address is too long.";
  else if (!EMAIL_RE.test(v.email)) e.email = "That doesn't look like an email address. Check for a typo.";

  if (v.phone) {
    if (v.phone.length > LIMITS.phone) e.phone = "That phone number is too long.";
    else if (!looksLikePhone(v.phone)) e.phone = "Enter a phone number using digits, spaces and + ( ) - only.";
  }

  requireChoice(e, v, "enquiryType", ENQUIRY_TYPES, "Choose what your enquiry is about.");

  if (!v.message) e.message = "Tell us a little about what you need.";
  else if (v.message.length > LIMITS.message) e.message = "Please shorten your message to 2,000 characters or fewer.";

  return e;
}

/** The first step (1-based) that holds an error, for jumping back to it. */
export function firstStepWithError(errors: FieldErrors): number {
  const index = APPRAISAL_STEPS.findIndex((step) => step.fields.some((f) => errors[f]));
  return index === -1 ? 1 : index + 1;
}

/* ── building the enquiry ────────────────────────────────────────────────── */

export function buildAppraisal(v: Values): Enquiry {
  const suburb = SUBURBS.includes(v.suburb) ? v.suburb : null;
  return {
    kind: "appraisal",
    submittedAt: new Date().toISOString(),
    subject: `Rental appraisal request${suburb ? ` — ${suburb}` : ""}`,
    replyTo: v.email,
    suburb,
    fields: [
      { label: "Property address", value: v.address },
      { label: "Suburb", value: v.suburb },
      { label: "Postcode", value: v.postcode },
      { label: "Property type", value: v.propertyType },
      { label: "Bedrooms", value: v.bedrooms },
      { label: "Bathrooms", value: v.bathrooms },
      { label: "Parking spaces", value: v.parking },
      { label: "Currently rented", value: v.tenancyStatus },
      { label: "Using another property manager", value: v.otherManager },
      { label: "Looking to appoint", value: v.timeframe },
      { label: "Name", value: v.name },
      { label: "Email", value: v.email },
      { label: "Phone", value: v.phone || "Not given" },
      { label: "Preferred contact", value: v.contactMethod },
      { label: "Message", value: v.message || "None" },
      { label: "Consent given", value: "Yes" },
    ],
    data: { ...v },
  };
}

export function buildContact(v: Values): Enquiry {
  return {
    kind: "contact",
    submittedAt: new Date().toISOString(),
    subject: `Website enquiry — ${v.enquiryType}`,
    replyTo: v.email,
    suburb: null,
    fields: [
      { label: "Name", value: v.name },
      { label: "Email", value: v.email },
      { label: "Phone", value: v.phone || "Not given" },
      { label: "Enquiry about", value: v.enquiryType },
      { label: "Message", value: v.message },
    ],
    data: { ...v },
  };
}

/* ── spam screening ──────────────────────────────────────────────────────
 * Three layers, none of which asks anything of a real person:
 *   honeypot  a field no human sees; anything in it is discarded silently
 *   timing    a submission inside MIN_FILL_MS was not typed by a person
 *   turnstile verified server-side, and only when the keys are configured
 */

export const HONEYPOT_FIELD = "company";
export const TIMESTAMP_FIELD = "startedAt";
/** The form tells us whether JavaScript is running, so the action knows
 *  whether to return a state or redirect to the shared success page. */
export const JS_FIELD = "js";

const MIN_FILL_MS = 3000;

export type SpamVerdict = "ok" | "honeypot" | "too-fast";

export function screen(form: FormData): SpamVerdict {
  if (one(text(form, HONEYPOT_FIELD))) return "honeypot";

  // Set by the client on mount. Absent without JavaScript, which is no signal.
  const started = Number(text(form, TIMESTAMP_FIELD));
  if (Number.isFinite(started) && started > 0) {
    const elapsed = Date.now() - started;
    if (elapsed >= 0 && elapsed < MIN_FILL_MS) return "too-fast";
  }
  return "ok";
}

/** True when the browser running the form had JavaScript. */
export function hasJs(form: FormData): boolean {
  return text(form, JS_FIELD) === "1";
}

const TURNSTILE_VERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 10_000;

/**
 * The site key to hand the form — but only when the secret is there to check
 * the answer with. A widget whose token nobody verifies is theatre, and worse
 * than nothing: it asks something of every visitor and buys no safety at all.
 * Server-side only; in a client bundle the secret reads as undefined, so this
 * would always return null.
 */
export function turnstileSiteKey(): string | null {
  const site = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const secret = process.env.TURNSTILE_SECRET_KEY;
  return site && secret ? site : null;
}

/** Verified only when TURNSTILE_SECRET_KEY is set; otherwise skipped entirely. */
export async function verifyTurnstile(form: FormData): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;

  const token = text(form, "cf-turnstile-response");
  if (!token) return false;

  try {
    const body = new URLSearchParams({ secret, response: token });
    const res = await fetch(TURNSTILE_VERIFY, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch (error) {
    console.error("[enquiry] Turnstile verification could not be completed:", errText(error));
    return false;
  }
}

/* ── delivery ────────────────────────────────────────────────────────────
 * Adapters are attempted in order and the first success wins. If nothing is
 * configured in production the result is an explicit failure: the caller must
 * not tell anyone their enquiry was sent.
 */

export type Delivery =
  | { ok: true; via: "resend" | "webhook" | "console" }
  | { ok: false; reason: "unconfigured" | "failed" };

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

function plainBody(enquiry: Enquiry): string {
  const lines = enquiry.fields.map((f) => `${f.label}: ${f.value}`);
  return [
    `${enquiry.subject}`,
    `Received: ${enquiry.submittedAt}`,
    `Sent from the ${BRAND.name} website.`,
    "",
    ...lines,
    "",
    `Reply to: ${enquiry.replyTo}`,
  ].join("\n");
}

function htmlBody(enquiry: Enquiry): string {
  const rows = enquiry.fields
    .map(
      (f) =>
        `<tr><th align="left" style="padding:6px 16px 6px 0;vertical-align:top;font-weight:600;white-space:nowrap">${esc(f.label)}</th>` +
        `<td style="padding:6px 0;vertical-align:top;white-space:pre-wrap">${esc(f.value)}</td></tr>`,
    )
    .join("");
  return [
    `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.6;color:#252525">`,
    `<h2 style="font-weight:600;font-size:18px;margin:0 0 4px">${esc(enquiry.subject)}</h2>`,
    `<p style="margin:0 0 16px;color:#6b6761">Sent from the ${esc(BRAND.name)} website at ${esc(enquiry.submittedAt)}.</p>`,
    `<table cellpadding="0" cellspacing="0" border="0">${rows}</table>`,
    `<p style="margin:16px 0 0">Reply to <a href="mailto:${esc(enquiry.replyTo)}">${esc(enquiry.replyTo)}</a>.</p>`,
    `</div>`,
  ].join("");
}

async function viaResend(enquiry: Enquiry): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.ENQUIRY_TO_EMAIL;
  if (!key || !to) return false;

  const from = process.env.ENQUIRY_FROM_EMAIL || `${BRAND.name} Website <onboarding@resend.dev>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: [enquiry.replyTo],
        subject: `${BRAND.name} — ${enquiry.subject}`,
        text: plainBody(enquiry),
        html: htmlBody(enquiry),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      // The body can echo the submitted content, so only the status is logged.
      console.error(`[enquiry] Resend rejected the request: HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[enquiry] Resend request failed:", errText(error));
    return false;
  }
}

async function viaWebhook(enquiry: Enquiry): Promise<boolean> {
  const url = process.env.ENQUIRY_WEBHOOK_URL;
  if (!url) return false;

  const secret = process.env.ENQUIRY_WEBHOOK_SECRET;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { "X-Enquiry-Secret": secret } : {}),
      },
      body: JSON.stringify({
        source: "planted-website",
        kind: enquiry.kind,
        submittedAt: enquiry.submittedAt,
        subject: enquiry.subject,
        data: enquiry.data,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[enquiry] The enquiry webhook rejected the request: HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[enquiry] The enquiry webhook could not be reached:", errText(error));
    return false;
  }
}

function configured(): boolean {
  return Boolean((process.env.RESEND_API_KEY && process.env.ENQUIRY_TO_EMAIL) || process.env.ENQUIRY_WEBHOOK_URL);
}

export async function deliver(enquiry: Enquiry): Promise<Delivery> {
  if (configured()) {
    if (await viaResend(enquiry)) return { ok: true, via: "resend" };
    if (await viaWebhook(enquiry)) return { ok: true, via: "webhook" };
    return { ok: false, reason: "failed" };
  }

  // Development only, and only when no real adapter is configured — a broken
  // Resend key must never fall through to a console "success".
  if (process.env.NODE_ENV !== "production") {
    console.info(
      `[enquiry] DEV delivery (no adapter configured). ${enquiry.subject}\n` +
        enquiry.fields.map((f) => `  ${f.label}: ${f.value}`).join("\n"),
    );
    return { ok: true, via: "console" };
  }

  console.error(
    "[enquiry] NOT DELIVERED: no delivery adapter is configured. Set RESEND_API_KEY and " +
      "ENQUIRY_TO_EMAIL (optionally ENQUIRY_FROM_EMAIL), or ENQUIRY_WEBHOOK_URL " +
      "(optionally ENQUIRY_WEBHOOK_SECRET). The enquiry has been discarded.",
  );
  return { ok: false, reason: "unconfigured" };
}

/** A record of the submission with no personal data in it. */
export function logOutcome(kind: EnquiryKind, suburb: string | null, outcome: Delivery | SpamVerdict) {
  const delivery =
    typeof outcome === "string" ? `screened:${outcome}` : outcome.ok ? `delivered:${outcome.via}` : `not-delivered:${outcome.reason}`;
  console.info(`[enquiry] kind=${kind} suburb=${suburb ?? "n/a"} at=${new Date().toISOString()} delivery=${delivery}`);
}

/* ── the copy shown when something goes wrong ────────────────────────────── */

export const MESSAGES = {
  invalid: "Please check the highlighted fields and try again.",
  /** No adapter configured: honest, and no promise about when. */
  unconfigured:
    "We're sorry — the enquiry form isn't connected yet, so this wasn't sent. Please try again later.",
  failed: "We're sorry — something went wrong sending your enquiry and it didn't reach us. Please try again.",
  tooFast: "That came through faster than a form is usually filled in. Please try again.",
  robot: "The security check didn't pass. Reload the page and try again.",
  sent: "Thank you — your enquiry has reached us.",
} as const;
