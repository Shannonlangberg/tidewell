import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { isUuid } from "@/lib/hq/forms";
import { getProject } from "@/lib/hq/projects/queries";
import { staffOptions, type Option } from "@/lib/hq/queries/options";
import { ErrorState, LinkButton, PageHeader } from "@/components/hq";
import { ProjectForm } from "@/components/hq/features/projects/ProjectForms";
import { ArchiveProject } from "@/components/hq/features/projects/ArchiveProject";
import { archiveProject, updateProject } from "../../actions";

export const metadata: Metadata = { title: "Edit project" };

type Params = Promise<{ id: string }>;

export default async function EditProjectPage({ params }: { params: Params }) {
  const { id } = await params;
  const { db } = await requireStaff("projects.write", false, isUuid(id) ? `/hq/projects/${id}/edit` : "/hq/projects");
  if (!isUuid(id)) notFound();

  const [found, people] = await Promise.all([getProject(db, id), staffOptions(db)]);
  if (!found.ok) {
    return (
      <>
        <PageHeader title="Edit project" />
        <ErrorState
          title="We could not load this project"
          action={
            <LinkButton href={`/hq/projects/${id}/edit`} size="sm">
              Try again
            </LinkButton>
          }
        />
      </>
    );
  }
  if (!found.data || found.data.archived) notFound();
  const p = found.data.project;
  // An owner who has since left is not in the active list: keep them selectable so saving does not silently change it.
  const owners: Option[] = !p.ownerId || people.some((o) => o.value === p.ownerId) ? people : [{ value: p.ownerId, label: p.ownerName ?? "Current owner" }, ...people];

  return (
    <>
      <PageHeader
        className="hq-prj-head"
        breadcrumbs={[{ label: "Projects", href: "/hq/projects" }, { label: p.ref, href: `/hq/projects/${p.id}` }, { label: "Edit" }]}
        title={p.name}
        eyebrow={`Edit ${p.ref}`}
        description="Every change is kept in the project's activity."
      />
      <ProjectForm
        mode="edit"
        action={updateProject}
        projectId={p.id}
        version={p.version}
        initial={{
          name: p.name,
          description: p.description ?? "",
          ownerId: p.ownerId ?? "",
          status: p.status,
          priority: p.priority,
          startDate: p.startDate ?? "",
          targetDate: p.targetDate ?? "",
          notes: p.notes ?? "",
        }}
        staff={owners}
        cancelHref={`/hq/projects/${p.id}`}
      />
      <section aria-labelledby="archive-h" className="mt-14 max-w-2xl border-t border-line pt-6">
        <h2 id="archive-h" className="hq-label">
          Archive
        </h2>
        <p className="mt-3 mb-4 text-[14px] text-grey-text">Archiving takes the project out of the list. Its tasks stay where they are, and it can be restored.</p>
        <ArchiveProject id={p.id} name={p.name} archive={archiveProject} />
      </section>
    </>
  );
}
