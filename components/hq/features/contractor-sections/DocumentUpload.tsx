"use client";

import { useRef, useState, type FormEvent } from "react";
import { createBrowserSupabase } from "@/lib/supabase/client";
import {
  DOCUMENT_ACCEPT,
  DOCUMENT_BUCKET,
  DOCUMENT_NOTE_MAX,
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABEL,
  MAX_DOCUMENT_LABEL,
  uploadProblem,
} from "@/lib/hq/contractors/documents-rules";
import { Button } from "@/components/hq/Button";
import { Drawer } from "@/components/hq/Drawer";
import { Field, FieldError } from "@/components/hq/Field";
import { InlineNote } from "@/components/hq/Primitives";
import { Select } from "@/components/hq/Select";
import { useToast } from "@/components/hq/Toast";
import { DateInput, Textarea } from "@/components/hq/TextInput";
import { prepareDocumentUploadAction, registerDocumentAction } from "./actions";

/*
 * "Upload a document": the three-step flow of docs/hq-phase-2.md 11.7.
 *
 *   1. prepareDocumentUploadAction (Server Action): validates the file's name, type and size and
 *      returns a signed upload path and token, made with this person's own session.
 *   2. The BROWSER uploads the file straight to Supabase Storage with that token. File bytes never
 *      pass through a Server Action or the Netlify function (which has a request-size limit).
 *   3. registerDocumentAction (Server Action): records the document; the database re-checks that the
 *      stored object exists and matches the declared size and type.
 *
 * The checks in this component are a courtesy so a wrong file fails quickly: the Server Actions,
 * the bucket and the database each repeat them. HQ does not scan files for malware.
 */

type Stage = "idle" | "checking" | "uploading" | "recording";

const STAGE_TEXT: Record<Exclude<Stage, "idle">, string> = {
  checking: "Checking the file",
  uploading: "Uploading",
  recording: "Recording the document",
};

export function DocumentUpload({ contractorId, businessName }: { contractorId: string; businessName: string }) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const busy = stage !== "idle";

  const close = () => {
    if (busy) return;
    setOpen(false);
  };

  function reset() {
    setError(null);
    setFieldErrors({});
    setStage("idle");
    setSession((n) => n + 1);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = new FormData(e.currentTarget);
    const file = fileRef.current?.files?.[0];
    setError(null);
    setFieldErrors({});

    if (!file) {
      setFieldErrors({ file: "Choose a file to upload." });
      return;
    }
    const problem = uploadProblem({ fileName: file.name, mimeType: file.type, sizeBytes: file.size });
    if (problem) {
      setFieldErrors({ file: problem });
      return;
    }

    const meta = new FormData();
    meta.set("contractor_id", contractorId);
    meta.set("document_type", String(form.get("document_type") ?? ""));
    meta.set("file_name", file.name);
    meta.set("mime_type", file.type);
    meta.set("size_bytes", String(file.size));
    meta.set("expires_on", String(form.get("expires_on") ?? ""));
    meta.set("notes", String(form.get("notes") ?? ""));

    try {
      setStage("checking");
      const prepared = await prepareDocumentUploadAction(meta);
      const path = typeof prepared.data?.path === "string" ? prepared.data.path : null;
      const token = typeof prepared.data?.token === "string" ? prepared.data.token : null;
      if (!prepared.ok || !path || !token) {
        setFieldErrors(prepared.fieldErrors ?? {});
        setError(prepared.message ?? "We could not start the upload.");
        setStage("idle");
        return;
      }

      // Step 2: straight to Storage. No upsert: the bucket has no update policy.
      setStage("uploading");
      const { error: uploadError } = await createBrowserSupabase().storage.from(DOCUMENT_BUCKET).uploadToSignedUrl(path, token, file, { contentType: file.type });
      if (uploadError) {
        setError("The upload did not finish. Check your connection and try again.");
        setStage("idle");
        return;
      }

      setStage("recording");
      meta.set("storage_path", path);
      const registered = await registerDocumentAction(meta);
      if (!registered.ok) {
        setFieldErrors(registered.fieldErrors ?? {});
        setError(registered.message ?? "The file was uploaded but could not be recorded.");
        setStage("idle");
        return;
      }
      toast("Document added. It is not verified until someone checks it.");
      setStage("idle");
      setOpen(false);
      reset();
    } catch {
      setError("Something went wrong and the document was not added. Try again in a moment.");
      setStage("idle");
    }
  }

  return (
    <>
      <Button size="sm" variant="secondary" icon="plus" onClick={() => setOpen(true)}>
        Upload a document
      </Button>
      <Drawer
        open={open}
        onClose={close}
        dismissible={!busy}
        title="Upload a document"
        description={businessName}
        footer={
          <>
            <Button onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" form={`upload-${contractorId}`} loading={busy} pendingLabel={stage === "idle" ? undefined : STAGE_TEXT[stage]}>
              {busy ? STAGE_TEXT[stage as Exclude<Stage, "idle">] : "Upload"}
            </Button>
          </>
        }
      >
        <form key={session} id={`upload-${contractorId}`} onSubmit={onSubmit} noValidate className="grid gap-5">
          {error ? (
            <div role="alert">
              <FieldError>{error}</FieldError>
            </div>
          ) : null}

          <Field name="file" idPrefix="upload" label="File" required error={fieldErrors.file} hint={`PDF, JPEG or PNG, up to ${MAX_DOCUMENT_LABEL}.`}>
            {(a11y) => <input {...a11y} ref={fileRef} name="file" type="file" accept={DOCUMENT_ACCEPT} className="hq-input" disabled={busy} data-autofocus />}
          </Field>

          <Select
            name="document_type"
            idPrefix="upload"
            label="What is it?"
            required
            placeholder="Choose a type"
            options={DOCUMENT_TYPES.map((t) => ({ value: t, label: DOCUMENT_TYPE_LABEL[t] }))}
            error={fieldErrors.document_type}
            disabled={busy}
          />

          <DateInput
            name="expires_on"
            idPrefix="upload"
            label="Expiry date"
            hint="Optional. Copy it from the document; HQ warns before it passes."
            error={fieldErrors.expires_on}
            disabled={busy}
          />

          <Textarea name="notes" idPrefix="upload" label="Note" rows={3} maxLength={DOCUMENT_NOTE_MAX} hint="Optional." error={fieldErrors.notes} disabled={busy} />

          <InlineNote>
            Documents are kept in private storage and opened only through a link that lasts 60 seconds. HQ does not scan files for viruses, so only upload files you trust. An uploaded document is not verified until someone checks it.
          </InlineNote>
        </form>
      </Drawer>
    </>
  );
}
