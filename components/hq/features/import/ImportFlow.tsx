"use client";

import { useActionState, useState } from "react";
import { importAction } from "@/app/hq/(app)/growth/import/actions";
import { idle } from "@/lib/hq/forms";
import { plural } from "@/lib/hq/format";
import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS } from "@/lib/hq/import/parse";
import { CLASSIFICATION_LABEL, type ImportClassification, type ImportReview, type ImportReviewRow, type ImportState } from "@/lib/hq/import/types";
import { Button, LinkButton } from "../../Button";
import { Checkbox } from "../../Choice";
import { ErrorState } from "../../EmptyState";
import { Field, FormActions, fieldError } from "../../Field";
import { FormSummary } from "../../FormSummary";
import { InlineNote, SectionLabel } from "../../Primitives";
import { Stat, StatBand } from "../../Stat";
import { StatusChip, type StatusTone } from "../../StatusChip";
import { SubmitButton } from "../../SubmitButton";
import { TextInput } from "../../TextInput";

/*
 * The partner import, in three steps on one screen:
 *   1. choose a file (or load the research leads bundled with HQ),
 *   2. REVIEW what would happen to every row (nothing is written yet),
 *   3. confirm, and see exactly what was created.
 *
 * Everything that matters happens on the server (importAction): the file is parsed there, the
 * database classifies each row, and the confirm step writes in one transaction. This component
 * only shows the review and carries the person's choices back.
 */

const TONE: Record<ImportClassification, StatusTone> = {
  new_organisation: "success",
  new_contact: "success",
  duplicate: "neutral",
  possible_duplicate: "warning",
  invalid: "error",
};

const LABELS = { file: "File", source: "Source label" };

export function ImportFlow() {
  const [state, formAction] = useActionState<ImportState, FormData>(importAction, idle);
  // "Start again" hides what is on screen without touching the server.
  const [dismissed, setDismissed] = useState<ImportState | null>(null);
  const visible = state !== dismissed;

  if (visible && state.result) {
    return <Outcome result={state.result} onAgain={() => setDismissed(state)} />;
  }
  if (visible && state.review) {
    return <Review key={state.review.version} review={state.review} state={state} formAction={formAction} onCancel={() => setDismissed(state)} />;
  }
  return <ChooseFile state={visible ? state : idle} formAction={formAction} />;
}

// ── step 1: choose ───────────────────────────────────────────

function ChooseFile({ state, formAction }: { state: ImportState; formAction: (formData: FormData) => void }) {
  const [tooBig, setTooBig] = useState(false);
  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <section aria-labelledby="upload-h" className="grid max-w-2xl content-start gap-5">
        <SectionLabel as="h2" id="upload-h" className="border-b border-line pb-3">
          Upload a file
        </SectionLabel>
        <form action={formAction} noValidate className="grid gap-5">
          <FormSummary state={state} labels={LABELS} />
          <Field
            name="file"
            label="Partner file"
            required
            hint={`A .json or .csv file with one row per person: up to ${plural(IMPORT_MAX_ROWS, "row")} and 1 MB.`}
            error={tooBig ? "That file is larger than 1 MB." : fieldError(state, "file")}
          >
            {(a11y) => (
              <input
                {...a11y}
                type="file"
                name="file"
                accept=".json,.csv,application/json,text/csv"
                className="hq-input"
                onChange={(e) => setTooBig((e.target.files?.[0]?.size ?? 0) > IMPORT_MAX_BYTES)}
              />
            )}
          </Field>
          <TextInput
            name="source"
            label="Source label"
            hint="Optional. Stored with every row that is imported. It defaults to the file's own source, or its name."
            maxLength={120}
            error={fieldError(state, "source")}
          />
          <FormActions align="start">
            <SubmitButton name="intent" value="upload" icon="arrow-up" pendingLabel="Checking the file" disabled={tooBig}>
              Check the file
            </SubmitButton>
          </FormActions>
        </form>
        <p className="text-[13px] text-grey-text">
          Nothing is added to HQ at this step. You will see what would happen to every row first, and confirm it.
        </p>
      </section>

      <aside className="grid content-start gap-8" aria-label="About this import">
        <section aria-labelledby="research-h" className="grid gap-3">
          <SectionLabel as="h2" id="research-h" className="border-b border-line pb-3">
            Research leads
          </SectionLabel>
          <p className="text-[14px]">
            The list of research leads supplied by Planted is bundled with HQ. Load it to review it the same way as any other file. People already in HQ are recognised and skipped, so loading it again adds
            nobody twice.
          </p>
          <form action={formAction}>
            <SubmitButton name="intent" value="research" variant="secondary" pendingLabel="Loading the research leads">
              Load the research leads file
            </SubmitButton>
          </form>
        </section>

        <section aria-labelledby="format-h" className="grid gap-3">
          <SectionLabel as="h2" id="format-h" className="border-b border-line pb-3">
            The file
          </SectionLabel>
          <ul className="grid gap-2 text-[14px]">
            <li>
              <b className="font-semibold">organisation</b> and <b className="font-semibold">full_name</b> are required.
            </li>
            <li>
              <b className="font-semibold">categories</b> is required: a list in JSON, or separated by <code>|</code> in a CSV (<code>lawyer|conveyancer</code>).
            </li>
            <li>
              Optional: service_region, position, phone, email, website, location, notes, flags.
            </li>
            <li>Everyone imported is recorded as Identified and as needing verification. Nothing is filled in that the file does not say.</li>
          </ul>
        </section>
      </aside>
    </div>
  );
}

// ── step 2: review ───────────────────────────────────────────

function Review({
  review,
  state,
  formAction,
  onCancel,
}: {
  review: ImportReview;
  state: ImportState;
  formAction: (formData: FormData) => void;
  onCancel: () => void;
}) {
  const [dirty, setDirty] = useState(false);
  const c = review.counts;
  const blocked = c.invalid > 0;
  const confirmed = review.rows.filter((r) => r.confirmedDistinct).length;
  const toConfirm = c.possibleDuplicates - confirmed;
  const shown = review.rows.length > 300 ? review.rows.slice(0, 300) : review.rows;

  return (
    <form action={formAction} noValidate className="grid gap-8">
      <input type="hidden" name="payload" value={review.payload} />
      <input type="hidden" name="file_name" value={review.fileName} />
      <input type="hidden" name="origin" value={review.origin} />

      <FormSummary state={state} labels={LABELS} />

      <div>
        <p className="hq-label">Review</p>
        <h2 className="mt-1 text-[20px] font-semibold">{review.fileName}</h2>
        <p className="mt-1 text-[14px] text-grey-text">
          {plural(c.rows, "row")} in the file. Nothing has been added to HQ yet.
        </p>
      </div>

      <StatBand columns={3} label="What this import will do">
        <Stat label="Organisations to create" value={c.organisationsToCreate} hint="Not yet in HQ." />
        <Stat label="Contacts to create" value={c.contactsToCreate} hint="New people, as research leads." />
        <Stat
          label="Skipped"
          value={c.skipped}
          hint={`${c.duplicates} already in HQ, ${plural(toConfirm, "possible duplicate")} to confirm, ${c.invalid} invalid.`}
        />
      </StatBand>

      {review.warnings.map((w) => (
        <InlineNote key={w}>{w}</InlineNote>
      ))}

      {blocked ? (
        <ErrorState title={`${plural(c.invalid, "row")} ${c.invalid === 1 ? "is" : "are"} not valid, so this file cannot be imported yet.`}>
          An import is all or nothing. Fix the rows marked Invalid in your file and upload it again.
        </ErrorState>
      ) : null}

      <section aria-labelledby="rows-h">
        <SectionLabel as="h3" id="rows-h" className="mb-3">
          Every row
        </SectionLabel>
        <div className="hq-tablewrap !mt-0" role="region" aria-label="Import review (scrollable)" tabIndex={0}>
          <table className="hq-table">
            <caption className="sr-only">Each row of the file and what would happen to it</caption>
            <thead className="max-md:sr-only">
              <tr>
                <th scope="col" className="hq-th">
                  Row
                </th>
                <th scope="col" className="hq-th">
                  Person
                </th>
                <th scope="col" className="hq-th">
                  Result
                </th>
                <th scope="col" className="hq-th">
                  Why
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <ReviewRow key={r.line} row={r} onChoice={() => setDirty(true)} />
              ))}
            </tbody>
          </table>
        </div>
        {review.rows.length > shown.length ? (
          <p className="mt-3 text-[13px] text-grey-text">
            Showing the first {shown.length} of {review.rows.length.toLocaleString("en-AU")} rows. The rest are included in the import.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="confirm-h" className="grid max-w-xl gap-5 border-t border-line pt-8">
        <SectionLabel as="h3" id="confirm-h">
          Confirm
        </SectionLabel>
        <TextInput
          name="source"
          label="Source label"
          required
          hint="Stored with every row that is imported, so you can tell where each person came from."
          maxLength={120}
          defaultValue={review.source}
          error={fieldError(state, "source")}
        />
        {dirty ? <InlineNote>You changed a choice. Update the review to see the new totals, then confirm.</InlineNote> : null}
        <FormActions align="start">
          {dirty ? (
            <SubmitButton name="intent" value="review" variant="primary" pendingLabel="Updating the review">
              Update the review
            </SubmitButton>
          ) : (
            <SubmitButton name="intent" value="apply" disabled={blocked || c.contactsToCreate === 0} icon="check" pendingLabel="Importing">
              {blocked ? "Fix the invalid rows first" : c.contactsToCreate === 0 ? "Nothing new to import" : `Import ${plural(c.contactsToCreate, "contact")}`}
            </SubmitButton>
          )}
          <Button onClick={onCancel}>Start again</Button>
        </FormActions>
        {!blocked && c.contactsToCreate === 0 ? (
          <p className="text-[14px] text-grey-text">
            Everyone in this file is already in HQ, or needs a decision above. Applying a file twice never adds anyone twice.
          </p>
        ) : null}
      </section>
    </form>
  );
}

function ReviewRow({ row, onChoice }: { row: ImportReviewRow; onChoice: () => void }) {
  return (
    <tr className="max-md:block max-md:border-b max-md:border-line max-md:py-3">
      <td className="hq-td hq-td--nowrap tabular-nums text-grey-text max-md:inline-block max-md:border-0 max-md:py-0 max-md:pr-2">
        <span className="md:sr-only">Row </span>
        {row.line}
      </td>
      <th scope="row" className="hq-td hq-td--primary max-md:block max-md:border-0 max-md:py-0.5">
        {row.fullName || <span className="hq-cell-nil">Unnamed</span>}
        {row.organisation ? <span className="hq-cell-sub">{row.organisation}</span> : null}
      </th>
      <td className="hq-td hq-td--nowrap max-md:block max-md:border-0 max-md:py-1">
        <StatusChip tone={TONE[row.classification]}>{CLASSIFICATION_LABEL[row.classification]}</StatusChip>
      </td>
      <td className="hq-td max-md:block max-md:border-0 max-md:py-0.5">
        <span className="block text-[13.5px]">{row.reason || <span className="hq-cell-nil">No further detail</span>}</span>
        {row.classification === "possible_duplicate" ? (
          <Checkbox
            name="distinct"
            value={String(row.line)}
            idPrefix={`row-${row.line}`}
            label="Import as a separate person"
            hint="Tick this only if you have checked that they are not the same person."
            defaultChecked={row.confirmedDistinct}
            onChange={onChoice}
            className="mt-2"
          />
        ) : null}
      </td>
    </tr>
  );
}

// ── step 3: the outcome ──────────────────────────────────────

function Outcome({ result, onAgain }: { result: NonNullable<ImportState["result"]>; onAgain: () => void }) {
  const created = result.contactsCreated;
  return (
    <div className="grid max-w-3xl gap-8" role="status">
      <div>
        <p className="hq-label">Import finished</p>
        <h2 className="mt-1 text-[20px] font-semibold">
          {created === 0 ? "Nothing new was added" : `${plural(created, "contact")} added`}
        </h2>
        <p className="mt-1 text-[14px] text-grey-text">
          From {result.fileName} ({plural(result.rowsInFile, "row")}). Source: {result.source}.
        </p>
      </div>

      <StatBand columns={3} label="What the import did">
        <Stat label="Organisations created" value={result.organisationsCreated} />
        <Stat label="Contacts created" value={result.contactsCreated} />
        <Stat label="Already in HQ" value={result.alreadyInHq} hint={result.possibleDuplicates > 0 ? `${plural(result.possibleDuplicates, "possible duplicate")} left for you to decide.` : "Skipped, so nobody is added twice."} />
      </StatBand>

      {created === 0 ? (
        <InlineNote>
          {result.alreadyInHq > 0
            ? `${plural(result.alreadyInHq, "row")} ${result.alreadyInHq === 1 ? "is" : "are"} already in HQ, so nothing was created.`
            : "Nothing in the file was new."}{" "}
          {result.possibleDuplicates > 0
            ? `${plural(result.possibleDuplicates, "row")} ${result.possibleDuplicates === 1 ? "looks" : "look"} like someone already in HQ. Load the file again and confirm them if they are different people.`
            : ""}
        </InlineNote>
      ) : (
        <InlineNote>Everyone imported is a research lead: Identified, and marked as needing verification until a person has checked them.</InlineNote>
      )}

      <FormActions align="start">
        <LinkButton href="/hq/growth/contacts?verify=needs" variant="primary">
          View contacts that need verifying
        </LinkButton>
        <LinkButton href="/hq/growth/organisations">View organisations</LinkButton>
        <Button onClick={onAgain}>Import another file</Button>
      </FormActions>
    </div>
  );
}
