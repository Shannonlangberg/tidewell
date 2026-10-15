"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { importContractorsAction } from "@/app/hq/(app)/partners/import/actions";
import { idle } from "@/lib/hq/forms";
import { plural } from "@/lib/hq/format";
import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS } from "@/lib/hq/contractors/import-parse";
import {
  CONTRACTOR_CLASSIFICATION_LABEL,
  type ContractorImportClassification,
  type ContractorImportReview,
  type ContractorImportState,
  type ContractorReviewRow,
} from "@/lib/hq/contractors/import-types";
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
 * The contractor import, in three steps on one screen:
 *   1. choose a file (or load the maintenance prospects bundled with HQ),
 *   2. REVIEW what would happen to every row (nothing is written yet),
 *   3. confirm, and see exactly what was created.
 *
 * Everything that matters happens on the server (importContractorsAction): the file is parsed
 * there, the database classifies each row, and the confirm step writes in one transaction. This
 * component only shows the review and carries the person's choices back.
 */

const TONE: Record<ContractorImportClassification, StatusTone> = {
  new_contractor: "success",
  duplicate: "neutral",
  possible_duplicate: "warning",
  invalid: "error",
};

const LABELS = { file: "File", source: "Source label" };

export function ContractorImportFlow() {
  const [state, formAction] = useActionState<ContractorImportState, FormData>(importContractorsAction, idle);
  const [dismissed, setDismissed] = useState<ContractorImportState | null>(null);
  const visible = state !== dismissed;

  if (visible && state.result) return <Outcome result={state.result} onAgain={() => setDismissed(state)} />;
  if (visible && state.review) return <Review key={state.review.version} review={state.review} state={state} formAction={formAction} onCancel={() => setDismissed(state)} />;
  return <ChooseFile state={visible ? state : idle} formAction={formAction} />;
}

// ── step 1: choose ───────────────────────────────────────────

function ChooseFile({ state, formAction }: { state: ContractorImportState; formAction: (formData: FormData) => void }) {
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
            label="Contractor file"
            required
            hint={`A .json or .csv file with one row per contractor: up to ${plural(IMPORT_MAX_ROWS, "row")} and 1 MB.`}
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
        <p className="text-[13px] text-grey-text">Nothing is added to HQ at this step. You will see what would happen to every row first, and confirm it.</p>
      </section>

      <aside className="grid content-start gap-8" aria-label="About this import">
        <section aria-labelledby="prospects-h" className="grid gap-3">
          <SectionLabel as="h2" id="prospects-h" className="border-b border-line pb-3">
            Maintenance prospects
          </SectionLabel>
          <p className="text-[14px]">
            The 31 maintenance contractors researched for Planted are bundled with HQ: a business name and a trade group for each, and nothing else. Load them to review them the same way as any other file. Anyone already in HQ is recognised and skipped,
            so loading it again adds nobody twice.
          </p>
          <form action={formAction}>
            <SubmitButton name="intent" value="prospects" variant="secondary" pendingLabel="Loading the maintenance prospects">
              Load the maintenance prospects file
            </SubmitButton>
          </form>
        </section>

        <section aria-labelledby="format-h" className="grid gap-3">
          <SectionLabel as="h2" id="format-h" className="border-b border-line pb-3">
            The file
          </SectionLabel>
          <ul className="grid gap-2 text-[14px]">
            <li>
              <b className="font-semibold">business_name</b> and <b className="font-semibold">categories</b> are required. Categories is a list in JSON, or separated by <code>|</code> in a CSV (<code>plumbing|electrical</code>). Use the trades on the{" "}
              <Link href="/hq/partners/trades" className="underline underline-offset-2">
                Trades
              </Link>{" "}
              page, by name or slug; an archived trade cannot be imported.
            </li>
            <li>Optional: primary_contact_name, phone, email, website, abn, service_suburbs, service_regions, notes, flags.</li>
            <li>
              Everyone imported is a <b className="font-semibold">prospect</b> and <b className="font-semibold">needs verifying</b>. Nothing is filled in that the file does not say, and a file cannot approve anyone.
            </li>
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
  review: ContractorImportReview;
  state: ContractorImportState;
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
        <p className="mt-1 text-[14px] text-grey-text">{plural(c.rows, "row")} in the file. Nothing has been added to HQ yet.</p>
      </div>

      <StatBand columns={3} label="What this import will do">
        <Stat label="Contractors to create" value={c.toCreate} hint="New prospects that need verifying." />
        <Stat label="Skipped" value={c.skipped} hint={`${c.duplicates} already in HQ, ${plural(toConfirm, "possible duplicate")} to confirm, ${c.invalid} invalid.`} />
        <Stat label="To check by hand" value={c.flagged} hint="Rows with a note for a person to verify, kept in the internal notes." />
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
                  Contractor
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
          hint="Stored with every row that is imported, so you can tell where each contractor came from."
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
            <SubmitButton name="intent" value="apply" disabled={blocked || c.toCreate === 0} icon="check" pendingLabel="Importing">
              {blocked ? "Fix the invalid rows first" : c.toCreate === 0 ? "Nothing new to import" : `Import ${plural(c.toCreate, "contractor")}`}
            </SubmitButton>
          )}
          <Button onClick={onCancel}>Start again</Button>
        </FormActions>
        {!blocked && c.toCreate === 0 ? (
          <p className="text-[14px] text-grey-text">Everyone in this file is already in HQ, or needs a decision above. Applying a file twice never adds anyone twice.</p>
        ) : null}
      </section>
    </form>
  );
}

function ReviewRow({ row, onChoice }: { row: ContractorReviewRow; onChoice: () => void }) {
  return (
    <tr className="max-md:block max-md:border-b max-md:border-line max-md:py-3">
      <td className="hq-td hq-td--nowrap tabular-nums text-grey-text max-md:inline-block max-md:border-0 max-md:py-0 max-md:pr-2">
        <span className="md:sr-only">Row </span>
        {row.line}
      </td>
      <th scope="row" className="hq-td hq-td--primary max-md:block max-md:border-0 max-md:py-0.5">
        {row.businessName || <span className="hq-cell-nil">Unnamed</span>}
        {row.flagged ? <span className="hq-cell-sub">Has a note to verify</span> : null}
      </th>
      <td className="hq-td hq-td--nowrap max-md:block max-md:border-0 max-md:py-1">
        <StatusChip tone={TONE[row.classification]}>{CONTRACTOR_CLASSIFICATION_LABEL[row.classification]}</StatusChip>
      </td>
      <td className="hq-td max-md:block max-md:border-0 max-md:py-0.5">
        <span className="block text-[13.5px]">{row.reason || <span className="hq-cell-nil">No further detail</span>}</span>
        {row.matchContractorId ? (
          <Link href={`/hq/partners/${row.matchContractorId}`} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-[13px] underline underline-offset-2">
            Open the existing contractor (new tab)
          </Link>
        ) : null}
        {row.matchRow ? <span className="mt-1 block text-[13px] text-grey-text">Matches row {row.matchRow} of this file.</span> : null}
        {row.classification === "possible_duplicate" ? (
          <Checkbox
            name="distinct"
            value={String(row.line)}
            idPrefix={`row-${row.line}`}
            label="Import as a separate contractor"
            hint="Tick this only if you have checked that they are not the same business."
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

function Outcome({ result, onAgain }: { result: NonNullable<ContractorImportState["result"]>; onAgain: () => void }) {
  const created = result.contractorsCreated;
  return (
    <div className="grid max-w-3xl gap-8" role="status">
      <div>
        <p className="hq-label">Import finished</p>
        <h2 className="mt-1 text-[20px] font-semibold">{created === 0 ? "Nothing new was added" : `${plural(created, "contractor")} added`}</h2>
        <p className="mt-1 text-[14px] text-grey-text">
          From {result.fileName} ({plural(result.rowsInFile, "row")}). Source: {result.source}.
        </p>
      </div>

      <StatBand columns={3} label="What the import did">
        <Stat label="Contractors created" value={result.contractorsCreated} />
        <Stat label="Already in HQ" value={result.alreadyInHq} hint={result.possibleDuplicates > 0 ? `${plural(result.possibleDuplicates, "possible duplicate")} left for you to decide.` : "Skipped, so nobody is added twice."} />
        <Stat label="To check by hand" value={result.flagged} hint="Rows with a note to verify." />
      </StatBand>

      {created === 0 ? (
        <InlineNote>
          {result.alreadyInHq > 0 ? `${plural(result.alreadyInHq, "row")} ${result.alreadyInHq === 1 ? "is" : "are"} already in HQ, so nothing was created.` : "Nothing in the file was new."}{" "}
          {result.possibleDuplicates > 0
            ? `${plural(result.possibleDuplicates, "row")} ${result.possibleDuplicates === 1 ? "looks" : "look"} like a contractor already in HQ. Load the file again and confirm them if they are different businesses.`
            : ""}
        </InlineNote>
      ) : (
        <InlineNote>Everyone imported is a prospect and is marked as needing verification until a person has checked them. Nobody is approved.</InlineNote>
      )}

      <FormActions align="start">
        <LinkButton href="/hq/partners" variant="primary">
          View contractors
        </LinkButton>
        <Button onClick={onAgain}>Import another file</Button>
      </FormActions>
    </div>
  );
}
