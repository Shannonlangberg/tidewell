/**
 * The Tidewell holiday-home app (/app and /stay) is parked: PLANTED. replaced it, and the hosted
 * database is Planted HQ's, which holds none of the tables that app needs. Left on, /app would offer
 * a second sign-in in front of the HQ database and then fail on every page.
 *
 * It answers 404 everywhere unless ENABLE_PARKED_TIDEWELL_APP=1 is set on purpose (local work on the
 * parked app, against a project that has its schema: see supabase/parked-tidewell/README.md).
 */
export function parkedTidewellAppEnabled(): boolean {
  return process.env.ENABLE_PARKED_TIDEWELL_APP === "1";
}
