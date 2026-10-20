import type { Metadata } from "next";
import { requireStaff } from "@/lib/hq/auth";
import { todayIn } from "@/lib/hq/format";
import { isKnowledgeCategory } from "@/lib/hq/knowledge/rules";
import { staffOptions } from "@/lib/hq/queries/options";
import { PageHeader } from "@/components/hq";
import { KnowledgeForm } from "@/components/hq/features/knowledge/KnowledgeForm";
import { createKnowledgeAction } from "../actions";

export const metadata: Metadata = { title: "Write a document" };

const STARTER = "Purpose: \n\n## Who this is for\n\n\n## Steps\n1. \n\n## Checklist\n- [ ] \n";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function NewKnowledgePage({ searchParams }: { searchParams: SearchParams }) {
  // Writing needs knowledge.write: anyone else who opens this URL is sent back out before anything loads.
  const { db, staff } = await requireStaff("knowledge.write", false, "/hq/knowledge/new");
  const sp = await searchParams;
  const cat = typeof sp.category === "string" && isKnowledgeCategory(sp.category) ? sp.category : "";
  const people = await staffOptions(db);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Knowledge", href: "/hq/knowledge" }, { label: "Write a document" }]}
        title="Write a document"
        description="It is saved as a draft. A director or administrator approves it before it counts as how we do things."
      />
      <KnowledgeForm
        mode="create"
        action={createKnowledgeAction}
        initial={{ title: "", category: cat, summary: "", ownerId: staff.id, reviewDue: "", body: STARTER }}
        staff={people}
        today={todayIn(staff.timezone)}
        cancelHref="/hq/knowledge"
      />
    </>
  );
}
