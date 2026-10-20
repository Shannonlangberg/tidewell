import { EmptyState, LinkButton, PageHeader } from "@/components/hq";

/*
 * Shown for a project that does not exist, is archived (for a reader), OR is not visible to this
 * person. They look identical on purpose.
 */
export default function ProjectNotFound() {
  return (
    <>
      <PageHeader title="Project not found" />
      <EmptyState
        title="We couldn't find that project"
        action={
          <LinkButton href="/hq/projects" variant="primary">
            Back to projects
          </LinkButton>
        }
      >
        It may have been archived, or the link may be out of date.
      </EmptyState>
    </>
  );
}
