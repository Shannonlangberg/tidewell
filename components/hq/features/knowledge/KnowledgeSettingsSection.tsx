import { requireStaff } from "@/lib/hq/auth";
import { loadKnowledgeSettings } from "@/lib/hq/knowledge/queries";
import { ErrorState } from "../../EmptyState";
import { InlineNote, KeyValueList, SectionLabel } from "../../Primitives";
import { KnowledgeSettings } from "./KnowledgeSettings";

/*
 * The Knowledge base card on Settings > AI and connected apps: whether a knowledge draft may be approved
 * from a chat app. Directors (settings.admin) change it; administrators see it. Self-loading, so the AI
 * settings page mounts it with one line.
 */
export async function KnowledgeSettingsSection() {
  const { db, can } = await requireStaff();
  if (!can("settings.admin") && !can("audit.read")) return null;
  const loaded = await loadKnowledgeSettings(db);
  return (
    <section aria-labelledby="knowledge-h">
      <SectionLabel as="h2" id="knowledge-h" className="mb-3.5">
        Knowledge base
      </SectionLabel>
      <p className="mb-4 max-w-xl">Chat apps can read the knowledge base and write new drafts. Approved text never changes until someone approves a newer draft.</p>
      {!loaded.ok ? (
        <ErrorState />
      ) : can("settings.admin") ? (
        <KnowledgeSettings chatApprove={loaded.data.chatApprove} />
      ) : (
        <div className="max-w-xl">
          <KeyValueList items={[{ label: "Approving from chat", value: loaded.data.chatApprove ? "On" : "Off" }]} />
          <InlineNote className="mt-4">This is changed by a director.</InlineNote>
        </div>
      )}
    </section>
  );
}
