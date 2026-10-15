"use client";

import { useEffect, useRef } from "react";
import type { ActionState } from "@/lib/hq/forms";
import { cx } from "./cx";
import { fieldId } from "./Field";
import { Icon } from "./icons";

/*
 * FormSummary: what the person sees at the top of a form after a failed submit.
 * role="alert" so it is announced, focus moves to it when a new failure arrives, and each
 * error is a LINK that moves focus to its field. Renders nothing for a clean or successful
 * state (confirm success with a toast: redirect(withToast(...))).
 *
 *   const [state, action] = useActionState(saveContact, idle);
 *   <form action={action} noValidate>
 *     <FormSummary state={state} labels={{ fullName: "Full name" }} />
 *     ...
 *
 * `labels` maps a field name to its on-screen label so the link can read
 * "Full name: Full name is required." (the label is omitted when the message already
 * starts with it). Pass the same `idPrefix` as the fields if you gave them one.
 */

export type FormSummaryProps = {
  state: ActionState | null | undefined;
  labels?: Record<string, string>;
  idPrefix?: string;
  className?: string;
};

export function FormSummary({ state, labels = {}, idPrefix, className }: FormSummaryProps) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useRef(state);
  const failed = !!state && !state.ok && (!!state.message || Object.keys(state.fieldErrors ?? {}).length > 0);

  // Move focus only when a NEW failed result arrives after a submit, never on first render
  // (a form that loads with errors in it must not grab focus).
  useEffect(() => {
    if (seen.current === state) return;
    seen.current = state;
    if (failed) ref.current?.focus();
  }, [failed, state]);

  if (!failed || !state) return null;

  const entries = Object.entries(state.fieldErrors ?? {});
  return (
    <div ref={ref} tabIndex={-1} role="alert" className={cx("hq-summary", className)}>
      <p className="hq-summary__title">
        <Icon name="alert" size={18} />
        <span>{state.message ?? "Please check the highlighted fields and try again."}</span>
      </p>
      {entries.length > 0 ? (
        <ul className="hq-summary__list">
          {entries.map(([name, message]) => {
            const label = labels[name];
            const text = label && !message.toLowerCase().startsWith(label.toLowerCase()) ? `${label}: ${message}` : message;
            const target = fieldId(name, idPrefix);
            return (
              <li key={name}>
                <a
                  href={`#${target}`}
                  onClick={(e) => {
                    const el = document.getElementById(target);
                    if (!el) return;
                    e.preventDefault();
                    const focusable = el.matches("input, select, textarea") ? el : el.querySelector<HTMLElement>("input, select, textarea");
                    (focusable ?? el).focus();
                    el.scrollIntoView({ block: "center" });
                  }}
                >
                  {text}
                </a>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
