/*
 * Small, dependency-free helpers for reading and validating form posts in Server
 * Actions. Every HQ action validates on the server, whatever the browser did.
 *
 * Pure: no server-only imports, so it can be unit tested with `node --test`.
 */

/** What a Server Action returns to `useActionState`. */
export type ActionState = {
  ok: boolean;
  /** A short sentence for a summary banner. Never contains personal data or internals. */
  message?: string;
  /** Field name -> message, shown beside the field and tied to it with aria-describedby. */
  fieldErrors?: Record<string, string>;
  /** Anything the page needs back after success, such as the new record's id. */
  data?: Record<string, unknown>;
};

export const idle: ActionState = { ok: false };

export function fail(message: string, fieldErrors?: Record<string, string>): ActionState {
  return { ok: false, message, fieldErrors };
}

export function succeed(message?: string, data?: Record<string, unknown>): ActionState {
  return { ok: true, message, data };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

type Errors = Record<string, string>;

/** Collects field errors while reading a FormData. */
export class FormReader {
  readonly errors: Errors = {};
  // Written out in full rather than as a constructor parameter property: Node's
  // type-stripping test runner does not support that syntax.
  private readonly form: FormData;
  constructor(form: FormData) {
    this.form = form;
  }

  get ok() {
    return Object.keys(this.errors).length === 0;
  }

  private raw(name: string): string {
    const v = this.form.get(name);
    return typeof v === "string" ? v.trim() : "";
  }

  /** Optional text, trimmed. Empty becomes null. */
  text(name: string, opts: { max?: number; label?: string } = {}): string | null {
    const v = this.raw(name);
    if (!v) return null;
    if (opts.max && v.length > opts.max) {
      this.errors[name] = `${opts.label ?? "This"} must be ${opts.max} characters or fewer.`;
      return null;
    }
    return v;
  }

  /** Required text. */
  requiredText(name: string, opts: { max?: number; label?: string } = {}): string {
    const v = this.text(name, opts);
    if (v === null && !this.errors[name]) this.errors[name] = `${opts.label ?? "This"} is required.`;
    return v ?? "";
  }

  email(name: string, opts: { required?: boolean } = {}): string | null {
    const v = this.raw(name).toLowerCase();
    if (!v) {
      if (opts.required) this.errors[name] = "Email is required.";
      return null;
    }
    if (v.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      this.errors[name] = "That doesn't look like an email address.";
      return null;
    }
    return v;
  }

  /** Permissive phone: digits and the usual punctuation, 8 to 15 digits. */
  phone(name: string): string | null {
    const v = this.raw(name);
    if (!v) return null;
    const digits = v.replace(/\D/g, "");
    if (!/^[0-9 ()+\-.]+$/.test(v) || digits.length < 8 || digits.length > 15) {
      this.errors[name] = "That doesn't look like a phone number.";
      return null;
    }
    return v;
  }

  url(name: string): string | null {
    const v = this.raw(name);
    if (!v) return null;
    const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
    try {
      const u = new URL(withScheme);
      if (!u.hostname.includes(".")) throw new Error("no dot");
      return withScheme.slice(0, 300);
    } catch {
      this.errors[name] = "That doesn't look like a web address.";
      return null;
    }
  }

  uuid(name: string, opts: { required?: boolean; label?: string } = {}): string | null {
    const v = this.raw(name);
    if (!v) {
      if (opts.required) this.errors[name] = `${opts.label ?? "This"} is required.`;
      return null;
    }
    if (!isUuid(v)) {
      this.errors[name] = "Choose one of the options.";
      return null;
    }
    return v;
  }

  date(name: string, opts: { required?: boolean } = {}): string | null {
    const v = this.raw(name);
    if (!v) {
      if (opts.required) this.errors[name] = "A date is required.";
      return null;
    }
    if (!isIsoDate(v)) {
      this.errors[name] = "Enter a valid date.";
      return null;
    }
    return v;
  }

  /** One of a fixed list. */
  oneOf<T extends string>(name: string, list: readonly T[], opts: { required?: boolean; fallback?: T } = {}): T | null {
    const v = this.raw(name);
    if (!v) {
      if (opts.fallback) return opts.fallback;
      if (opts.required) this.errors[name] = "Choose an option.";
      return null;
    }
    if (!(list as readonly string[]).includes(v)) {
      this.errors[name] = "Choose one of the options.";
      return null;
    }
    return v as T;
  }

  /** Several of a fixed list (checkboxes or a multi-select). */
  manyOf<T extends string>(name: string, list: readonly T[], opts: { min?: number } = {}): T[] {
    const values = this.form.getAll(name).filter((v): v is string => typeof v === "string");
    const bad = values.some((v) => !(list as readonly string[]).includes(v));
    if (bad) {
      this.errors[name] = "Choose from the options provided.";
      return [];
    }
    const unique = [...new Set(values)] as T[];
    if (opts.min && unique.length < opts.min) this.errors[name] = `Choose at least ${opts.min}.`;
    return unique;
  }

  bool(name: string): boolean {
    const v = this.form.get(name);
    return v === "on" || v === "true" || v === "yes" || v === "1";
  }

  /** Whole dollars typed by a person, returned as cents. */
  dollarsToCents(name: string): number | null {
    const v = this.raw(name).replace(/[$,\s]/g, "");
    if (!v) return null;
    if (!/^\d+(\.\d{1,2})?$/.test(v)) {
      this.errors[name] = "Enter an amount in dollars, like 12500.";
      return null;
    }
    const cents = Math.round(Number(v) * 100);
    if (!Number.isSafeInteger(cents) || cents > 100_000_000_00) {
      this.errors[name] = "That amount is too large.";
      return null;
    }
    return cents;
  }

  fail(message = "Please check the highlighted fields and try again."): ActionState {
    return fail(message, this.errors);
  }
}

/** Positive integer from a search param, bounded. */
export function intParam(value: string | string[] | undefined, fallback: number, min = 1, max = 10_000): number {
  const v = Array.isArray(value) ? value[0] : value;
  const n = Number.parseInt(v ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** First value of a search param, trimmed, bounded in length. */
export function strParam(value: string | string[] | undefined, max = 200): string {
  const v = Array.isArray(value) ? value[0] : value;
  return (v ?? "").trim().slice(0, max);
}

/** Escape the characters that are special in a PostgREST `ilike` / `or` filter value. */
export function likeValue(input: string): string {
  return input.replace(/[\\%_,()]/g, (c) => `\\${c}`);
}
