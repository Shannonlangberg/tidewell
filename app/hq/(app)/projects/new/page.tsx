import type { Metadata } from "next";
import { requireStaff } from "@/lib/hq/auth";
import { staffOptions } from "@/lib/hq/queries/options";
import { PageHeader } from "@/components/hq";
import { ProjectForm } from "@/components/hq/features/projects/ProjectForms";
import { createProject } from "../actions";

export const metadata: Metadata = { title: "New project" };

export default async function NewProjectPage() {
  // Creating needs projects.write: anyone else who opens this URL is sent back out before anything loads.
  const { db, staff } = await requireStaff("projects.write", false, "/hq/projects/new");
  const people = await staffOptions(db);
  return (
    <>
      <PageHeader
        className="hq-prj-head"
        breadcrumbs={[{ label: "Projects", href: "/hq/projects" }, { label: "New project" }]}
        title="New project"
        description="Give it a name and an owner. Milestones and tasks come next, on the project's page."
      />
      <ProjectForm
        mode="create"
        action={createProject}
        initial={{ name: "", description: "", ownerId: staff.id, status: "planning", priority: "normal", startDate: "", targetDate: "", notes: "" }}
        staff={people}
        cancelHref="/hq/projects"
      />
    </>
  );
}
