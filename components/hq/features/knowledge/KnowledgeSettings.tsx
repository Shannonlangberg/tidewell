"use client";

import { useState, useTransition } from "react";
import { setKnowledgeChatApproveAction } from "@/app/hq/(app)/knowledge/actions";
import { Button } from "../../Button";
import { ConfirmDialog } from "../../ConfirmDialog";
import { StatusChip } from "../../StatusChip";
import { useToast } from "../../Toast";

/*
 * The knowledge chat-approve switch, for directors (settings.admin). Off by default; switching it on is
 * confirmed first, with a plain warning; off is one click. Checked again by the server action and by the
 * database (row level security, the settings guard, and approve_knowledge_version itself).
 */
export function KnowledgeSettings({ chatApprove }: { chatApprove: boolean }) {
  const { toast } = useToast();
  const [confirmOn, setConfirmOn] = useState(false);
  const [pending, startTransition] = useTransition();

  async function change(on: boolean) {
    const result = await setKnowledgeChatApproveAction(on);
    toast(result.message ?? (result.ok ? "Saved." : "We could not do that."), { tone: result.ok ? "success" : "error" });
  }

  return (
    <div className="grid max-w-xl gap-3">
      <h3 className="font-semibold">Approving from chat</h3>
      <p>
        <StatusChip tone={chatApprove ? "warning" : "neutral"}>{chatApprove ? "On" : "Off"}</StatusChip>
      </p>
      <p className="hq-muted text-[14px]">
        {chatApprove
          ? "On: a director or administrator can approve a knowledge draft from ChatGPT or Claude after the chat shows what changed and they say yes. Every edit is still saved as a draft first, and every approval is recorded."
          : "Off: chat apps can write and change knowledge documents, but every change waits as a draft until a director or administrator approves it here in HQ."}
      </p>
      <div>
        {chatApprove ? (
          <Button variant="secondary" loading={pending} pendingLabel="Switching off" onClick={() => startTransition(() => change(false))}>
            Switch approving from chat off
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => setConfirmOn(true)}>
            Switch approving from chat on
          </Button>
        )}
      </div>
      <ConfirmDialog open={confirmOn} onClose={() => setConfirmOn(false)} title="Let directors and administrators approve from chat?" confirmLabel="Switch approving from chat on" tone="danger" onConfirm={() => change(true)}>
        <p>
          Once a draft is approved, every member of staff reads it as how PLANTED. does things. From chat, the approval happens on the strength of what the chat app shows, which can be
          shortened or misread, and nobody looks at the document in HQ first.
        </p>
        <p className="mt-2">Only directors and administrators can approve, the previous approved version is always kept, and you can switch this off at any time.</p>
      </ConfirmDialog>
    </div>
  );
}
