"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { HONEYPOT_INPUT_PROPS, HONEYPOT_LABEL } from "@/lib/enquiries";

/*
 * The field primitives both enquiry forms are built from.
 *
 * 2026 style (design/components/forms in the Claude Design handoff): 12px
 * controls, white on light grounds and forest-2 on dark, radio groups as pill
 * chips that fill lime when chosen. Labels always sit above their field and are
 * never replaced by a placeholder. Every control is wired for assistive technology — the label is
 * associated, `aria-invalid` is set when a field is wrong, and the message is
 * tied to the field with `aria-describedby`, so a screen reader hears the
 * specific problem on the specific field rather than a general complaint.
 *
 * Errors use the brand's error colour (#8A3A24, #E8B4A0 on forest), a changed
 * border, the wording itself and the ARIA state: never colour alone. The look
 * lives in planted.css (.pl-control, .pl-radio, .pl-check).
 */

/* ── hydration ───────────────────────────────────────────────────────────
 * False while the page is rendered on the server and through hydration, true
 * once React has taken over in the browser. Both forms use it to swap native
 * `required` validation for their own, so the no-JavaScript path keeps the
 * browser's checks and everyone else gets better messages.
 */

const noopSubscribe = () => () => {};
const notYet = () => "";
const onTheServer = () => false;
const inTheBrowser = () => true;

export function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, inTheBrowser, onTheServer);
}

/**
 * The moment this form appeared in a browser, as a string for a hidden field,
 * and empty when there is no JavaScript. The server reads it to throw out
 * submissions that arrive faster than a person can type.
 *
 * It has to come through a snapshot like this rather than a `useState` in an
 * effect: React resets an uncontrolled input's value on every re-render, so
 * writing the time straight to the DOM does not survive.
 */
export function useStartedAt(): string {
  const snapshot = useMemo(() => {
    let value = "";
    return () => (value ||= String(Date.now()));
  }, []);
  return useSyncExternalStore(noopSubscribe, snapshot, notYet);
}

/* ── ids ─────────────────────────────────────────────────────────────────── */

export const fieldId = (form: string, name: string) => `${form}-${name}`;
const errorId = (form: string, name: string) => `${form}-${name}-error`;
const hintId = (form: string, name: string) => `${form}-${name}-hint`;

/** Moves focus to a field by name, including the first radio of a group. */
export function focusField(form: string, name: string) {
  const id = fieldId(form, name);
  const el = (document.getElementById(id) ?? document.getElementById(`${id}-0`)) as HTMLElement | null;
  el?.focus();
  el?.scrollIntoView({ block: "center", behavior: "smooth" });
}

function described(form: string, name: string, error?: string, hint?: string) {
  const ids = [hint ? hintId(form, name) : null, error ? errorId(form, name) : null].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

/* ── shared classes ──────────────────────────────────────────────────────── */

const CONTROL = "pl-control";

const LABEL = "block text-[0.9375rem] font-medium";
const OPTIONAL = "ml-2 text-[0.8125rem] font-normal text-muted";

/* ── label, hint, error ──────────────────────────────────────────────────── */

function FieldLabel({
  htmlFor,
  children,
  optional,
}: {
  htmlFor: string;
  children: ReactNode;
  optional?: boolean;
}) {
  return (
    <label htmlFor={htmlFor} className={LABEL}>
      {children}
      {optional && <span className={OPTIONAL}>Optional</span>}
    </label>
  );
}

function Hint({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-2 text-[0.8125rem] leading-relaxed text-muted">
      {children}
    </p>
  );
}

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-2 flex gap-2 text-[0.8125rem] leading-relaxed text-[var(--planted-error)]">
      <span aria-hidden="true" className="mt-[0.8em] block h-px w-3 shrink-0 bg-current" />
      <span>{children}</span>
    </p>
  );
}

/* ── text and email and tel ──────────────────────────────────────────────── */

type TextProps = {
  form: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "tel";
  inputMode?: "text" | "email" | "tel" | "numeric";
  autoComplete?: string;
  maxLength?: number;
  pattern?: string;
  placeholder?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  optional?: boolean;
  className?: string;
};

export function TextField({
  form,
  name,
  label,
  value,
  onChange,
  type = "text",
  inputMode,
  autoComplete,
  maxLength,
  pattern,
  placeholder,
  hint,
  error,
  required,
  optional,
  className = "",
}: TextProps) {
  const id = fieldId(form, name);
  return (
    <div className={className}>
      <FieldLabel htmlFor={id} optional={optional}>
        {label}
      </FieldLabel>
      <input
        id={id}
        name={name}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        maxLength={maxLength}
        pattern={pattern}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={described(form, name, error, hint)}
        className={`${CONTROL} mt-2`}
      />
      {hint && <Hint id={hintId(form, name)}>{hint}</Hint>}
      {error && <FieldError id={errorId(form, name)}>{error}</FieldError>}
    </div>
  );
}

/* ── message box ─────────────────────────────────────────────────────────── */

export function TextAreaField({
  form,
  name,
  label,
  value,
  onChange,
  maxLength,
  rows = 6,
  hint,
  error,
  required,
  optional,
  className = "",
}: Omit<TextProps, "type" | "inputMode" | "autoComplete" | "pattern" | "placeholder"> & { rows?: number }) {
  const id = fieldId(form, name);
  return (
    <div className={className}>
      <FieldLabel htmlFor={id} optional={optional}>
        {label}
      </FieldLabel>
      <textarea
        id={id}
        name={name}
        rows={rows}
        maxLength={maxLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={described(form, name, error, hint)}
        className={`${CONTROL} mt-2`}
      />
      {hint && <Hint id={hintId(form, name)}>{hint}</Hint>}
      {error && <FieldError id={errorId(form, name)}>{error}</FieldError>}
    </div>
  );
}

/* ── select ──────────────────────────────────────────────────────────────── */

export function SelectField({
  form,
  name,
  label,
  value,
  onChange,
  options,
  placeholder = "Please choose",
  hint,
  error,
  required,
  autoComplete,
  className = "",
}: {
  form: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  placeholder?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  autoComplete?: string;
  className?: string;
}) {
  const id = fieldId(form, name);
  return (
    <div className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="relative mt-2">
        <select
          id={id}
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          aria-describedby={described(form, name, error, hint)}
          className={CONTROL}
        >
          <option value="">{placeholder}</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <svg
          aria-hidden="true"
          width="12"
          height="8"
          viewBox="0 0 12 8"
          fill="none"
          className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-forest [.on-dark_&]:text-ivory"
        >
          <path d="M1 1l5 5 5-5" stroke="currentColor" strokeWidth="1" />
        </svg>
      </div>
      {hint && <Hint id={hintId(form, name)}>{hint}</Hint>}
      {error && <FieldError id={errorId(form, name)}>{error}</FieldError>}
    </div>
  );
}

/* ── radio group ─────────────────────────────────────────────────────────── */

export function RadioField({
  form,
  name,
  label,
  value,
  onChange,
  options,
  hint,
  error,
  required,
  columns = 3,
  layout = "grid",
  labels,
  className = "",
}: {
  form: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  hint?: string;
  error?: string;
  required?: boolean;
  columns?: 2 | 3;
  /** `chips` wraps pills in a row; `grid` sets them in even columns. */
  layout?: "chips" | "grid";
  /** Display text per option value, when it differs from the value sent. */
  labels?: Record<string, string>;
  className?: string;
}) {
  const describedBy = described(form, name, error, hint);
  return (
    <fieldset className={className} aria-describedby={describedBy}>
      <legend className={LABEL}>{label}</legend>
      <div
        className={
          layout === "chips"
            ? "mt-3 flex flex-wrap gap-2"
            : `mt-3 grid gap-3 ${columns === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3"}`
        }
      >
        {options.map((option, i) => {
          const id = `${fieldId(form, name)}-${i}`;
          return (
            <label
              key={option}
              htmlFor={id}
              className={`pl-radio ${error ? "is-invalid" : ""}`}
            >
              <input
                id={id}
                type="radio"
                name={name}
                value={option}
                checked={value === option}
                onChange={() => onChange(option)}
                required={required}
                // aria-invalid is not a supported property of role="radio";
                // the group's error reaches the reader through aria-describedby.
                aria-describedby={describedBy}
              />
              {/* The input is visually hidden; the chip fills lime when chosen
                  and shows the focus ring (planted.css, .pl-radio). */}
              <span>{labels?.[option] ?? option}</span>
            </label>
          );
        })}
      </div>
      {hint && <Hint id={hintId(form, name)}>{hint}</Hint>}
      {error && <FieldError id={errorId(form, name)}>{error}</FieldError>}
    </fieldset>
  );
}

/* ── checkbox ────────────────────────────────────────────────────────────── */

export function CheckboxField({
  form,
  name,
  label,
  checked,
  onChange,
  error,
  required,
  children,
  className = "",
}: {
  form: string;
  name: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string;
  required?: boolean;
  /** Rendered under the label. Keep links out of the label itself. */
  children?: ReactNode;
  className?: string;
}) {
  const id = fieldId(form, name);
  return (
    <div className={className}>
      <div className={`pl-check flex gap-4 rounded-[var(--radius-sm)] border bg-white p-4 [.on-dark_&]:bg-forest-2 ${error ? "border-[var(--planted-error)]" : "border-[var(--line)]"}`}>
        <input
          id={id}
          name={name}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          required={required}
          value="yes"
          aria-invalid={error ? true : undefined}
          aria-describedby={described(form, name, error)}
          className="mt-1"
        />
        <div>
          <label htmlFor={id} className="block cursor-pointer text-[0.9375rem] leading-relaxed">
            {label}
          </label>
          {children && <div className="mt-2 text-[0.8125rem] leading-relaxed text-muted">{children}</div>}
        </div>
      </div>
      {error && <FieldError id={errorId(form, name)}>{error}</FieldError>}
    </div>
  );
}

/* ── honeypot ────────────────────────────────────────────────────────────
 * Off-screen rather than display:none, so a bot that checks computed styles
 * still fills it in. Hidden from assistive technology and from the tab order,
 * and labelled plainly for the rare person who reaches it anyway. Its name,
 * label and attributes (lib/enquiries.ts) keep autofill out of it.
 */

export function Honeypot({ form, name }: { form: string; name: string }) {
  const id = fieldId(form, name);
  return (
    <div
      aria-hidden="true"
      className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden"
      style={{ clipPath: "inset(50%)" }}
    >
      <label htmlFor={id}>{HONEYPOT_LABEL}</label>
      <input id={id} name={name} {...HONEYPOT_INPUT_PROPS} defaultValue="" />
    </div>
  );
}

/* ── form-level messages ─────────────────────────────────────────────────── */

/**
 * A problem with the submission as a whole. `role="alert"` announces it the
 * moment it appears; the form that owns it moves focus here when there is no
 * single field to blame.
 */
export function FormMessage({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <div
      id={id}
      role="alert"
      tabIndex={-1}
      className="rounded-r-[var(--radius-sm)] border-l-2 border-[var(--planted-error)] bg-white px-5 py-4 text-[0.9375rem] leading-relaxed text-[var(--planted-error)] [.on-dark_&]:bg-forest-2"
    >
      {children}
    </div>
  );
}

/**
 * The list of field problems, each one a jump to the field it belongs to. The
 * links work as plain anchors without JavaScript, and `onJump` lets a stepped
 * form open the right step first.
 */
export function ErrorSummary({
  id,
  form,
  errors,
  labels,
  heading,
  onJump,
}: {
  id?: string;
  form: string;
  errors: Record<string, string>;
  labels: Record<string, string>;
  heading: string;
  onJump?: (name: string) => void;
}) {
  const entries = Object.entries(errors).filter(([name]) => labels[name]);
  if (entries.length === 0) return null;
  return (
    <div id={id} role="alert" tabIndex={-1} className="rounded-r-[var(--radius-sm)] border-l-2 border-[var(--planted-error)] bg-white px-5 py-4 [.on-dark_&]:bg-forest-2">
      <p className="text-[0.9375rem] font-medium text-[var(--planted-error)]">{heading}</p>
      <ul className="mt-3 space-y-2">
        {entries.map(([name, message]) => (
          <li key={name} className="text-[0.875rem] leading-relaxed">
            <a
              href={`#${fieldId(form, name)}`}
              onClick={(e) => {
                e.preventDefault();
                if (onJump) onJump(name);
                else focusField(form, name);
              }}
              className="text-[var(--planted-error)] underline underline-offset-4"
            >
              {labels[name]}
            </a>
            <span className="text-muted"> — {message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── submit ──────────────────────────────────────────────────────────────── */

const SubmitArrow = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M1 7h11.5M8 2.5 12.5 7 8 11.5" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

export function SubmitButton({
  children,
  pending,
  pendingLabel = "Sending…",
  variant = "primary",
  className = "",
  hidden,
  dataAttr,
}: {
  children: ReactNode;
  pending: boolean;
  pendingLabel?: string;
  variant?: "primary" | "lime" | "light";
  className?: string;
  hidden?: boolean;
  /** Lets the no-JavaScript stylesheet reveal the button. */
  dataAttr?: Record<string, string>;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      hidden={hidden}
      aria-live="polite"
      {...dataAttr}
      className={`btn ${variant !== "primary" ? `btn-${variant}` : ""} ${className}`}
    >
      <span>{pending ? pendingLabel : children}</span>
      <span className="ar" aria-hidden="true">
        {pending ? (
          <span className="pl-spin" />
        ) : (
          <>
            <SubmitArrow />
            <SubmitArrow />
          </>
        )}
      </span>
    </button>
  );
}

/* ── success ─────────────────────────────────────────────────────────────── */

/**
 * Shown in place of the form once an enquiry has actually been delivered.
 * Focus moves here so the confirmation is the next thing anyone hears.
 */
export function SuccessPanel({
  heading,
  children,
  tone = "light",
}: {
  heading: string;
  children: ReactNode;
  tone?: "light" | "dark";
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const dark = tone === "dark";
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="status"
      className={`rounded-[var(--radius-lg)] p-[clamp(2rem,4vw,3.5rem)] outline-none ${
        dark ? "bg-forest-2 text-ivory" : "border border-[var(--line)] bg-white"
      }`}
    >
      <span aria-hidden="true" className="inline-grid h-12 w-12 place-items-center rounded-full bg-lime text-forest">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M2 9.5 7 14l9-10" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </span>
      <h2 className={`mt-7 ${dark ? "display-lg" : "display-md"}`}>{heading}</h2>
      <div className="prose-measure mt-4 text-muted">{children}</div>
    </div>
  );
}
