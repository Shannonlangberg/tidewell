import { EmptyState, LinkButton, PageHeader } from "@/components/hq";

/*
 * Shown for a document that does not exist, is archived (for anyone who cannot restore it), OR is not
 * visible to this person. They look identical on purpose.
 */
export default function KnowledgeNotFound() {
  return (
    <>
      <PageHeader title="Document not found" />
      <EmptyState
        title="We couldn't find that document"
        action={
          <LinkButton href="/hq/knowledge" variant="primary">
            Back to Knowledge
          </LinkButton>
        }
      >
        It may have been archived, or the link may be out of date.
      </EmptyState>
    </>
  );
}
