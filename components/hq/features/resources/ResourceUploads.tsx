"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { createBrowserSupabase } from "@/lib/supabase/client";
import {
  ACCEPTED_TYPES_TEXT,
  CHANGE_NOTE_MAX,
  DESCRIPTION_MAX,
  MAX_RESOURCE_LABEL,
  NOTE_MAX,
  RESOURCE_ACCEPT,
  RESOURCE_BUCKET,
  RESOURCE_CATEGORIES,
  RESOURCE_CATEGORY_LABEL,
  TAGS_MAX,
  TITLE_MAX,
  VERSION_LABEL_MAX,
  mimeForFile,
  uploadProblem,
} from "@/lib/hq/resources/rules";
import { Button } from "../../Button";
import { Drawer } from "../../Drawer";
import { Field, FieldError } from "../../Field";
import { InlineNote } from "../../Primitives";
import { Select } from "../../Select";
import { useToast } from "../../Toast";
import { Textarea, TextInput } from "../../TextInput";
import { prepareAddResourceAction, prepareReplaceResourceAction, registerAddResourceAction, registerReplaceResourceAction } from "@/app/hq/(app)/resources/actions";

/*
 * "Add a file" and "Replace the file": the three-step flow of contractor documents.
 *
 *   1. prepare* (Server Action): validates the details, refuses a title or content already in the library,
 *      and returns a signed upload path and token made with this person's own session.
 *   2. The BROWSER uploads the file straight to Supabase Storage with that token. File bytes never pass
 *      through a Server Action or the Netlify function (which has a request-size limit). No upsert: the
 *      bucket has no update policy, so a replacement is always a NEW object.
 *   3. register* (Server Action): reads the stored file back, checks its size and SHA-256 against what this
 *      browser declared, and records it; the database checks the object again.
 *
 * The checks in this file are a courtesy so a wrong file fails quickly: the Server Actions, the bucket and the
 * database each repeat them. HQ does not scan files for malware.
 */

type Stage = "idle" | "checking" | "uploading" | "recording";

const STAGE_TEXT: Record<Exclude<Stage, "idle">, string> = {
  checking: "Checking the file",
  uploading: "Uploading",
  recording: "Adding it to the library",
};

/** The file's SHA-256 as lower-case hex, read in the browser. */
async function sha256Hex(file: File): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("no-subtle");
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Flow = {
  stage: Stage;
  error: string | null;
  fieldErrors: Record<string, string>;
};
const CLEAN: Flow = { stage: "idle", error: null, fieldErrors: {} };

/** Steps 1 to 3 for either flow. Returns the register result's data, or null after setting the error. */
async function sendFile(opts: {
  file: File;
  meta: FormData;
  prepare: (f: FormData) => ReturnType<typeof prepareAddResourceAction>;
  register: (f: FormData) => ReturnType<typeof registerAddResourceAction>;
  set: (patch: Partial<Flow>) => void;
}): Promise<{ message: string | undefined; data: Record<string, unknown> | undefined } | null> {
  const { file, meta, prepare, register, set } = opts;
  set({ stage: "checking", error: null, fieldErrors: {} });
  let sha: string;
  try {
    sha = await sha256Hex(file);
  } catch {
    set({ stage: "idle", fieldErrors: { file: "This browser cannot read the file here. Use a current browser on the HQ address." } });
    return null;
  }
  meta.set("file_name", file.name);
  meta.set("size_bytes", String(file.size));
  meta.set("sha256", sha);

  const prepared = await prepare(meta);
  const path = typeof prepared.data?.path === "string" ? prepared.data.path : null;
  const token = typeof prepared.data?.token === "string" ? prepared.data.token : null;
  if (!prepared.ok || !path || !token) {
    set({ stage: "idle", fieldErrors: prepared.fieldErrors ?? {}, error: prepared.message ?? "We could not start the upload." });
    return null;
  }

  set({ stage: "uploading" });
  // The type comes from the file name: a browser's guess is often empty for CSS, JSX or Markdown, and Storage
  // takes the type from the file part itself, so the bytes are wrapped in a File that carries the right one.
  const contentType = mimeForFile(file.name) ?? file.type;
  const body = file.type === contentType ? file : new File([file], file.name, { type: contentType });
  const { error: uploadError } = await createBrowserSupabase().storage.from(RESOURCE_BUCKET).uploadToSignedUrl(path, token, body, { contentType });
  if (uploadError) {
    set({ stage: "idle", error: "The upload did not finish. Check your connection and try again." });
    return null;
  }

  set({ stage: "recording" });
  meta.set("storage_path", path);
  if (typeof prepared.data?.resourceId === "string") meta.set("resource_id", prepared.data.resourceId);
  const registered = await register(meta);
  if (!registered.ok) {
    set({ stage: "idle", fieldErrors: registered.fieldErrors ?? {}, error: registered.message ?? "The file was uploaded but could not be added." });
    return null;
  }
  return { message: registered.message, data: registered.data };
}

const MISSING_SECURE = "Something went wrong and nothing was added. Try again in a moment.";

// ── add a file ───────────────────────────────────────────────

export function AddResource() {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const [flow, setFlow] = useState<Flow>(CLEAN);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { toast } = useToast();
  const busy = flow.stage !== "idle";
  const set = (patch: Partial<Flow>) => setFlow((f) => ({ ...f, ...patch }));

  const close = () => {
    if (!busy) setOpen(false);
  };

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = new FormData(e.currentTarget);
    const file = fileRef.current?.files?.[0];
    setFlow(CLEAN);
    if (!file) return set({ fieldErrors: { file: "Choose a file to add." } });
    const problem = uploadProblem({ fileName: file.name, sizeBytes: file.size });
    if (problem) return set({ fieldErrors: { file: problem } });

    const meta = new FormData();
    for (const k of ["title", "category", "description", "tags", "note"]) meta.set(k, String(form.get(k) ?? ""));
    try {
      const done = await sendFile({ file, meta, prepare: prepareAddResourceAction, register: registerAddResourceAction, set });
      if (!done) return;
      const id = typeof done.data?.id === "string" ? done.data.id : null;
      toast(done.message ?? "Added to the library.");
      set({ stage: "idle" });
      setOpen(false);
      setSession((n) => n + 1);
      router.push(id ? `/hq/resources/${id}` : "/hq/resources");
      router.refresh();
    } catch {
      set({ stage: "idle", error: MISSING_SECURE });
    }
  }

  return (
    <>
      <Button variant="primary" icon="plus" onClick={() => setOpen(true)}>
        Add a file
      </Button>
      <Drawer
        open={open}
        onClose={close}
        dismissible={!busy}
        title="Add a file"
        description="Brand files for everyone in HQ to view and download."
        footer={
          <>
            <Button onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" form="add-resource" loading={busy} pendingLabel={busy ? STAGE_TEXT[flow.stage as Exclude<Stage, "idle">] : undefined}>
              {busy ? STAGE_TEXT[flow.stage as Exclude<Stage, "idle">] : "Add to the library"}
            </Button>
          </>
        }
      >
        <form key={session} id="add-resource" onSubmit={onSubmit} noValidate className="grid gap-5">
          {flow.error ? (
            <div role="alert">
              <FieldError>{flow.error}</FieldError>
            </div>
          ) : null}

          <Field name="file" idPrefix="add-res" label="File" required error={flow.fieldErrors.file} hint={`${ACCEPTED_TYPES_TEXT}, up to ${MAX_RESOURCE_LABEL}.`}>
            {(a11y) => (
              <input
                {...a11y}
                ref={fileRef}
                name="file"
                type="file"
                accept={RESOURCE_ACCEPT}
                className="hq-input"
                disabled={busy}
                data-autofocus
                onChange={(e) => {
                  const f = e.currentTarget.files?.[0];
                  const title = e.currentTarget.form?.elements.namedItem("title") as HTMLInputElement | null;
                  if (f && title && !title.value.trim()) title.value = f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").slice(0, TITLE_MAX);
                }}
              />
            )}
          </Field>

          <TextInput name="title" idPrefix="add-res" label="Title" required maxLength={TITLE_MAX} error={flow.fieldErrors.title} disabled={busy} hint="How it is listed. Each title is used once." />

          <Select
            name="category"
            idPrefix="add-res"
            label="Category"
            required
            placeholder="Choose a category"
            options={RESOURCE_CATEGORIES.map((c) => ({ value: c, label: RESOURCE_CATEGORY_LABEL[c] }))}
            error={flow.fieldErrors.category}
            disabled={busy}
          />

          <Textarea name="description" idPrefix="add-res" label="Description" rows={3} maxLength={DESCRIPTION_MAX} hint="Optional. What it is and when to use it." error={flow.fieldErrors.description} disabled={busy} />

          <TextInput name="tags" idPrefix="add-res" label="Tags" hint={`Optional. Separate with commas, up to ${TAGS_MAX}.`} error={flow.fieldErrors.tags} disabled={busy} />

          <Textarea
            name="note"
            idPrefix="add-res"
            label="Note"
            rows={2}
            maxLength={NOTE_MAX}
            hint="Optional. Shown as a banner on the resource, for a warning such as part of it being out of date."
            error={flow.fieldErrors.note}
            disabled={busy}
          />

          <InlineNote>
            Files are kept in private storage and opened only through a link that lasts 60 seconds. HQ does not scan files for viruses, so only add files you trust. Anything you add can be read and downloaded by everyone in HQ.
          </InlineNote>
        </form>
      </Drawer>
    </>
  );
}

// ── replace the file ─────────────────────────────────────────

export function ReplaceFile({ id, title, version }: { id: string; title: string; version: string }) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const [flow, setFlow] = useState<Flow>(CLEAN);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { toast } = useToast();
  const busy = flow.stage !== "idle";
  const set = (patch: Partial<Flow>) => setFlow((f) => ({ ...f, ...patch }));

  const close = () => {
    if (!busy) setOpen(false);
  };

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = new FormData(e.currentTarget);
    const file = fileRef.current?.files?.[0];
    setFlow(CLEAN);
    if (!file) return set({ fieldErrors: { file: "Choose the new file." } });
    const problem = uploadProblem({ fileName: file.name, sizeBytes: file.size });
    if (problem) return set({ fieldErrors: { file: problem } });

    const meta = new FormData();
    meta.set("id", id);
    for (const k of ["version_label", "change_note"]) meta.set(k, String(form.get(k) ?? ""));
    try {
      const done = await sendFile({ file, meta, prepare: prepareReplaceResourceAction, register: registerReplaceResourceAction, set });
      if (!done) return;
      toast(done.message ?? "File replaced.");
      set({ stage: "idle" });
      setOpen(false);
      setSession((n) => n + 1);
      router.refresh();
    } catch {
      set({ stage: "idle", error: MISSING_SECURE });
    }
  }

  const formId = `replace-resource-${id}`;
  return (
    <>
      <Button icon="arrow-up" onClick={() => setOpen(true)}>
        Replace file
      </Button>
      <Drawer
        open={open}
        onClose={close}
        dismissible={!busy}
        title="Replace the file"
        description={`${title} is ${version} now. The new file becomes the next version; the old one is kept and stays downloadable from the history.`}
        footer={
          <>
            <Button onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" form={formId} loading={busy} pendingLabel={busy ? STAGE_TEXT[flow.stage as Exclude<Stage, "idle">] : undefined}>
              {busy ? STAGE_TEXT[flow.stage as Exclude<Stage, "idle">] : "Replace the file"}
            </Button>
          </>
        }
      >
        <form key={session} id={formId} onSubmit={onSubmit} noValidate className="grid gap-5">
          {flow.error ? (
            <div role="alert">
              <FieldError>{flow.error}</FieldError>
            </div>
          ) : null}

          <Field name="file" idPrefix="replace-res" label="New file" required error={flow.fieldErrors.file} hint={`${ACCEPTED_TYPES_TEXT}, up to ${MAX_RESOURCE_LABEL}.`}>
            {(a11y) => <input {...a11y} ref={fileRef} name="file" type="file" accept={RESOURCE_ACCEPT} className="hq-input" disabled={busy} data-autofocus />}
          </Field>

          <TextInput
            name="version_label"
            idPrefix="replace-res"
            label="Version label"
            maxLength={VERSION_LABEL_MAX}
            hint="Optional. Leave blank for the next number (v2, v3 and so on)."
            error={flow.fieldErrors.version_label}
            disabled={busy}
          />

          <Textarea name="change_note" idPrefix="replace-res" label="What changed" rows={2} maxLength={CHANGE_NOTE_MAX} hint="Optional. Kept in the version history." error={flow.fieldErrors.change_note} disabled={busy} />

          <InlineNote>The new file must be different from the current one. HQ does not scan files for viruses, so only add files you trust.</InlineNote>
        </form>
      </Drawer>
    </>
  );
}
