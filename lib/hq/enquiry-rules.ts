/*
 * Website enquiries: the pure rules shared by the intake (lib/hq/enquiry-intake.ts), the HQ screens and
 * the MCP tools. No imports beyond node:crypto and types, so it is unit tested with `node --test`
 * (enquiry-rules.test.mts).
 *
 *   - which client IP to hash (Netlify's x-nf-client-connection-ip, else the first x-forwarded-for),
 *     and the salted SHA-256 that is the ONLY form in which it ever leaves the server;
 *   - the arguments hq.submit_enquiry takes, from a validated enquiry;
 *   - a database refusal as a short reason the site can act on;
 *   - the labels, refs and filters the screens and tools use.
 */
import { createHash } from "node:crypto";

export const ENQUIRY_KINDS = ["appraisal", "contact"] as const;
export type EnquiryKindValue = (typeof ENQUIRY_KINDS)[number];
export const ENQUIRY_STATUSES = ["new", "in_progress", "spam", "archived"] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

export const ENQUIRY_KIND_LABEL: Record<EnquiryKindValue, string> = { appraisal: "Appraisal", contact: "Contact" };
export const ENQUIRY_STATUS_LABEL: Record<EnquiryStatus, string> = { new: "New", in_progress: "In progress", spam: "Spam", archived: "Archived" };

export const isEnquiryKind = (v: unknown): v is EnquiryKindValue => typeof v === "string" && (ENQUIRY_KINDS as readonly string[]).includes(v);
export const isEnquiryStatus = (v: unknown): v is EnquiryStatus => typeof v === "string" && (ENQUIRY_STATUSES as readonly string[]).includes(v);

/** ENQ-0001 (at least four digits), as the database writes it. */
export function enquiryRef(n: number): string {
  const s = String(Math.max(0, Math.trunc(n)));
  return `ENQ-${s.padStart(4, "0")}`;
}

/** "ENQ-0007", "enq 7", "7" -> 7; anything else -> null. */
export function parseEnquiryRef(value: string): number | null {
  const m = /^\s*(?:enq[-\s]?)?0*(\d{1,9})\s*$/i.exec(value);
  return m ? Number(m[1]) : null;
}

// ── the client IP, hashed ────────────────────────────────────

type HeaderGetter = { get(name: string): string | null };

/** A plausible IPv4 or IPv6 literal (digits, hex, dots and colons only; at most 45 characters). */
function plausibleIp(value: string): string | null {
  const v = value.trim().replace(/^\[|\]$/g, "");
  return v.length >= 2 && v.length <= 45 && /^[0-9A-Fa-f:.]+$/.test(v) && /[.:]/.test(v) ? v.toLowerCase() : null;
}

/**
 * The client's IP as Netlify reports it (x-nf-client-connection-ip, set by Netlify's edge and not by the
 * browser), else the first address in x-forwarded-for (the local dev server). Null when neither holds
 * a plausible address. Used only to compute the hash below; never stored, logged or returned.
 */
export function clientIp(headers: HeaderGetter): string | null {
  const nf = headers.get("x-nf-client-connection-ip");
  if (nf) {
    const ip = plausibleIp(nf);
    if (ip) return ip;
  }
  const xff = headers.get("x-forwarded-for");
  if (xff) return plausibleIp(xff.split(",")[0] ?? "");
  return null;
}

/** SHA-256 of salt and IP, 64 hex characters. The salt is server-side only, so the hash cannot be reversed by trying every address. */
export function hashIp(ip: string, salt: string): string {
  return createHash("sha256").update(`${salt}\u001f${ip}`).digest("hex");
}

/** The salt: ENQUIRY_IP_SALT when it is long enough to be a secret (16+ characters), else the fallback derived from the secret key. */
export function ipSalt(configured: string | undefined, fallback: string | null): string | null {
  const s = (configured ?? "").trim();
  if (s.length >= 16) return s;
  return fallback;
}

// ── the call ─────────────────────────────────────────────────

/** What the intake needs from a validated enquiry (lib/enquiries.ts builds it). */
export type IntakeEnquiry = {
  kind: EnquiryKindValue;
  data: Record<string, string>;
};

/** Fields that have their own columns; everything else the form sent goes in `details`. */
const OWN_COLUMNS = new Set(["name", "email", "phone", "suburb", "message"]);

export type SubmitArgs = {
  p_kind: EnquiryKindValue;
  p_name: string;
  p_email: string;
  p_phone?: string;
  p_suburb?: string;
  p_message?: string;
  p_details: Record<string, string>;
  p_source_page: string;
  p_ip_hash?: string;
};

export const SOURCE_PAGE: Record<EnquiryKindValue, string> = { appraisal: "/rental-appraisal", contact: "/contact" };

/** hq.submit_enquiry's arguments: the validated values as submitted; blanks left out. */
export function submitArgs(enquiry: IntakeEnquiry, ipHash: string | null): SubmitArgs {
  const d = enquiry.data;
  const details: Record<string, string> = {};
  for (const [k, v] of Object.entries(d)) {
    if (OWN_COLUMNS.has(k) || typeof v !== "string" || v.trim() === "") continue;
    details[k] = v;
  }
  const opt = (v: string | undefined) => (v && v.trim() ? v : undefined);
  return {
    p_kind: enquiry.kind,
    p_name: d.name ?? "",
    p_email: d.email ?? "",
    ...(opt(d.phone) ? { p_phone: d.phone } : {}),
    ...(opt(d.suburb) ? { p_suburb: d.suburb } : {}),
    ...(opt(d.message) ? { p_message: d.message } : {}),
    p_details: details,
    p_source_page: SOURCE_PAGE[enquiry.kind],
    ...(ipHash ? { p_ip_hash: ipHash } : {}),
  };
}

export type IntakeFailure = "unconfigured" | "rate_limited" | "invalid" | "timeout" | "failed";
export type IntakeResult =
  | { ok: true; ref: string; enquiryId: string; opportunityId: string | null; duplicate: boolean }
  | { ok: false; reason: IntakeFailure };

/** A PostgREST error from submit_enquiry as a reason. Never carries the database's message onwards. */
export function intakeFailure(error: { code?: string | null; hint?: string | null; name?: string | null; message?: string | null }): IntakeFailure {
  if (error.hint === "enquiry_rate_limited" || error.code === "54000") return "rate_limited";
  if (error.hint === "enquiry_invalid" || error.code === "22023") return "invalid";
  if (error.name === "AbortError" || error.name === "TimeoutError" || /abort|timeout/i.test(error.message ?? "")) return "timeout";
  return "failed";
}

/** The RPC's answer, checked: a success needs an id and an ENQ ref. */
export function intakeSuccess(data: unknown): IntakeResult {
  const d = (data ?? {}) as Record<string, unknown>;
  const id = typeof d.enquiry_id === "string" ? d.enquiry_id : null;
  const ref = typeof d.ref === "string" && /^ENQ-\d{4,}$/.test(d.ref) ? d.ref : null;
  if (!id || !ref) return { ok: false, reason: "failed" };
  return { ok: true, ref, enquiryId: id, opportunityId: typeof d.opportunity_id === "string" ? d.opportunity_id : null, duplicate: d.duplicate === true };
}

// ── links ────────────────────────────────────────────────────

export const enquiryPath = (id: string) => `/hq/growth/enquiries/${encodeURIComponent(id)}`;
export const leadPath = (id: string) => `/hq/growth/opportunities/${encodeURIComponent(id)}`;

// ── what the details mean (labels for the screens; unknown keys shown as they came) ──

export const DETAIL_LABEL: Record<string, string> = {
  address: "Property address",
  postcode: "Postcode",
  propertyType: "Property type",
  bedrooms: "Bedrooms",
  bathrooms: "Bathrooms",
  parking: "Parking spaces",
  tenancyStatus: "Currently rented",
  otherManager: "Using another property manager",
  timeframe: "Looking to appoint",
  contactMethod: "Preferred contact",
  consent: "Consent given",
  enquiryType: "Enquiry about",
};

/** The details as label / value lines in a stable order: known fields first (form order), then the rest by name. */
export function detailLines(details: unknown): { label: string; value: string }[] {
  if (!details || typeof details !== "object" || Array.isArray(details)) return [];
  const entries = Object.entries(details as Record<string, unknown>).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v));
  const order = Object.keys(DETAIL_LABEL);
  entries.sort(([a], [b]) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    return a.localeCompare(b);
  });
  return entries.map(([k, v]) => ({
    label: DETAIL_LABEL[k] ?? k,
    value: k === "consent" && v === "yes" ? "Yes" : String(v),
  }));
}

// ── the list ─────────────────────────────────────────────────

/** "Just now", "12 minutes ago", "3 hours ago", "Yesterday", "4 days ago"; null beyond 30 days (show the date alone). */
export function receivedAgo(iso: string, now: Date = new Date()): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const mins = Math.floor((now.getTime() - t) / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return mins === 1 ? "1 minute ago" : `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days <= 30) return `${days} days ago`;
  return null;
}

type Param = string | string[] | undefined;
const first = (v: Param) => (Array.isArray(v) ? v[0] : v);

/** ?status=new&kind=appraisal&page=2, validated. */
export function parseEnquiryListParams(sp: Record<string, Param>): { status: EnquiryStatus | null; kind: EnquiryKindValue | null; page: number; filtered: boolean } {
  const status = first(sp.status);
  const kind = first(sp.kind);
  const pageRaw = Number(first(sp.page));
  const s = isEnquiryStatus(status) ? status : null;
  const k = isEnquiryKind(kind) ? kind : null;
  return { status: s, kind: k, page: Number.isInteger(pageRaw) && pageRaw >= 1 && pageRaw <= 10_000 ? pageRaw : 1, filtered: s !== null || k !== null };
}
