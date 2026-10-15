import { SubmitButton } from "../../SubmitButton";

/*
 * "Make primary": a small form that posts to the makePrimaryContact Server Action, which
 * demotes the old primary first (the database allows only one per organisation) and checks
 * growth.write itself. `returnTo` says which page to come back to.
 */
export function MakePrimaryButton({
  id,
  returnTo,
  action,
  name,
}: {
  id: string;
  returnTo: "contact" | "organisation";
  action: (formData: FormData) => Promise<void>;
  /** For the accessible name: "Make Tim Hosking the primary contact". */
  name: string;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="return_to" value={returnTo} />
      <SubmitButton size="sm" variant="secondary" pendingLabel="Changing the primary contact" aria-label={`Make ${name} the primary contact`}>
        Make primary
      </SubmitButton>
    </form>
  );
}
