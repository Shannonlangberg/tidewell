import { SubmitButton } from "../../SubmitButton";
import { InlineNote } from "../../Primitives";

/*
 * The notice at the top of a record that is still a research lead. "Mark as verified" is a
 * deliberate act by a person who has checked the details; the database stamps who and when.
 * Without write access the notice still shows, but with no button.
 */
export function VerifyNotice({
  id,
  noun,
  action,
  canVerify,
}: {
  id: string;
  /** "contact" or "organisation". */
  noun: string;
  action: (formData: FormData) => Promise<void>;
  canVerify: boolean;
}) {
  return (
    <div className="mb-8">
      <InlineNote>
        <b>Needs verifying.</b> This {noun} came from research and has not been confirmed. Check the details before relying on them, then mark it as verified.
      </InlineNote>
      {canVerify ? (
        <form action={action} className="mt-3 pl-7">
          <input type="hidden" name="id" value={id} />
          <SubmitButton size="sm" variant="secondary" icon="check" pendingLabel={`Marking ${noun} as verified`}>
            Mark as verified
          </SubmitButton>
        </form>
      ) : null}
    </div>
  );
}
