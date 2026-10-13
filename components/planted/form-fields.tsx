"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";

/*
 * The field primitives both enquiry forms are built from.
 *
 * Same discipline as the rest of the system: sharp corners, hairline borders,
 * no shadows. Labels always sit above their field and are never replaced by a
 * placeholder. Every control is wired for assistive technology — the label is
 * associated, `aria-invalid` is set when a field is wrong, and the message is
 * tied to the field with `aria-describedby`, so a screen reader hears the
 * specific problem on the specific field rather than a general complaint.
 *
 * There is no red in the PLANTED. palette and planted.css belongs to another
 * agent, so errors are carried by clay-deep (5:1 on ivory and on softwhite),
 * a changed border, the wording itself and the ARIA state — never by colour
 * alone.
 */

/* ── hydration ───────────────────────────────────────────────────────────
 * False while the page is rendered on the server and through hydration, true
 * once React has taken over in the browser. Both forms use it to swap native
 * `required` validation for their own, so the no-JavaScript path keeps the
 * browser's checks and everyone else gets better messages.
 */

const noopSubscribe = () => () => {};

export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
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

const CONTROL =
  "w-full min-h-[3.25rem] rounded-none border bg-softwhite px-4 py-3.5 text-[1rem] leading-normal text-charcoal transition-colors duration-300 placeholder:text-ink-muted/70 focus:border-charcoal disabled:opacity-60";

const borderFor = (error?: string) => (error ? "border-clay-deep" : "border-line");

const LABEL = "block text-[0.9375rem] font-medium text-charcoal";
const OPTIONAL = "ml-2 text-[0.8125rem] font-normal text-ink-muted";

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
    <p id={id} className="mt-2 text-[0.8125rem] leading-relaxed text-ink-muted">
      {children}
    </p>
  );
}

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-2 flex gap-2 text-[0.8125rem] leading-relaxed text-clay-deep">
      <span aria-hidden="true" className="mt-[0.55em] block h-px w-3 shrink-0 bg-clay-deep" />
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
        className={`${CONTROL} ${borderFor(error)} mt-2`}
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
        className={`${CONTROL} ${borderFor(error)} mt-2 min-h-[9rem] resize-y`}
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
          className={`${CONTROL} ${borderFor(error)} appearance-none pr-12`}
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
          className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-charcoal"
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
  className?: string;
}) {
  const describedBy = described(form, name, error, hint);
  return (
    <fieldset className={className} aria-describedby={describedBy}>
      <legend className={LABEL}>{label}</legend>
      <div
        className={`mt-3 grid gap-3 ${columns === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}
      >
        {options.map((option, i) => {
          const id = `${fieldId(form, name)}-${i}`;
          return (
            <label
              key={option}
              htmlFor={id}
              className={`relative flex min-h-[3.25rem] cursor-pointer items-center gap-3 border ${borderFor(error)} bg-softwhite px-4 py-3 text-[0.9375rem] text-charcoal transition-colors duration-300`}
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
                className="peer h-[1.125rem] w-[1.125rem] shrink-0 accent-charcoal"
              />
              <span>{option}</span>
              {/* The selected state is a drawn border, so it survives any
                  variant support question and reads at a glance. */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -inset-px border border-transparent peer-checked:border-charcoal"
              />
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
      <div className={`flex gap-4 border ${borderFor(error)} bg-softwhite p-4`}>
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
          className="mt-1 h-[1.125rem] w-[1.125rem] shrink-0 accent-charcoal"
        />
        <div>
          <label htmlFor={id} className="block cursor-pointer text-[0.9375rem] leading-relaxed text-charcoal">
            {label}
          </label>
          {children && <div className="mt-2 text-[0.8125rem] leading-relaxed text-ink-muted">{children}</div>}
        </div>
      </div>
      {error && <FieldError id={errorId(form, name)}>{error}</FieldError>}
    </div>
  );
}

/* ── honeypot ────────────────────────────────────────────────────────────
 * Off-screen rather than display:none, so a bot that checks computed styles
 * still fills it in. Hidden from assistive technology and from the tab order,
 * and labelled plainly for the rare person who reaches it anyway.
 */

export function Honeypot({ form, name }: { form: string; name: string }) {
  const id = fieldId(form, name);
  return (
    <div
      aria-hidden="true"
      className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden"
      style={{ clipPath: "inset(50%)" }}
    >
      <label htmlFor={id}>Company (leave this field empty)</label>
      <input id={id} name={name} type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
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
      className="border-l-2 border-clay-deep bg-softwhite px-5 py-4 text-[0.9375rem] leading-relaxed text-charcoal"
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
    <div id={id} role="alert" tabIndex={-1} className="border-l-2 border-clay-deep bg-softwhite px-5 py-4">
      <p className="text-[0.9375rem] font-medium text-charcoal">{heading}</p>
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
              className="text-clay-deep underline underline-offset-4"
            >
              {labels[name]}
            </a>
            <span className="text-ink-muted"> — {message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── submit ──────────────────────────────────────────────────────────────── */

export function SubmitButton({
  children,
  pending,
  pendingLabel = "Sending…",
  className = "",
  hidden,
  dataAttr,
}: {
  children: ReactNode;
  pending: boolean;
  pendingLabel?: string;
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
      {...dataAttr}
      className={`btn btn-primary ${className}`}
      style={pending ? { opacity: 0.65 } : undefined}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

/* ── success ─────────────────────────────────────────────────────────────── */

/**
 * Shown in place of the form once an enquiry has actually been delivered.
 * Focus moves here so the confirmation is the next thing anyone hears.
 */
export function SuccessPanel({ heading, children }: { heading: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div ref={ref} tabIndex={-1} role="status" className="border border-line bg-softwhite p-8 md:p-12">
      <h2 className="display display-md">{heading}</h2>
      <div className="prose-measure mt-6 text-ink-muted">{children}</div>
    </div>
  );
}
