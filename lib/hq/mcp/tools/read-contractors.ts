/*
 * Contractor reads: the directory search, one contractor in full, and the expiry watch list.
 * All need contractors.read (RLS enforces it again on every view). Documents are described
 * (count, insurance and licence state) but never opened: files stay on the HQ screen.
 */
import { CONTRACTOR_EXPIRY_STATE_LABEL, CONTRACTOR_STATUS_LABEL, type ContractorStatus } from "../../constants";
import { searchTerm } from "../../growth/params";
import { HQ_PATHS, LIMITS, clean, plural, rowLimit } from "./core";
import { day, dbFailure, defineTool, link, resolveContractor, respond } from "./kit";
import { contractorRecord, tradeCats } from "./records";
import { contractorExpiriesShape, getContractorShape, searchContractorsShape } from "./schemas";

const statusText = (s: string | null) => (s && s in CONTRACTOR_STATUS_LABEL ? CONTRACTOR_STATUS_LABEL[s as ContractorStatus] : (s ?? ""));
const stateText = (s: string | null) => (s && s in CONTRACTOR_EXPIRY_STATE_LABEL ? CONTRACTOR_EXPIRY_STATE_LABEL[s as keyof typeof CONTRACTOR_EXPIRY_STATE_LABEL] : (s ?? ""));

export const searchContractors = defineTool({
  name: "search_contractors",
  title: "Search contractors",
  description:
    "Lists maintenance contractors from the HQ contractor directory, filtered by words, trade, suburb serviced, region, status, cleared (approved or preferred) or emergency availability. Example: approved plumbers who service Moonta = trade plumbing, suburb Moonta, cleared_only true. Shows status, vetting progress, insurance and licence state and rating (only when there is enough feedback). Read-only. It never approves, prefers or suspends anyone: those stay on the HQ screen.",
  inputSchema: searchContractorsShape,
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: "contractors.read",
  kind: "read",
  handler: async (args, ctx) => {
    const n = rowLimit(args.limit);
    let q = ctx.db
      .from("contractor_directory")
      .select("id, business_name, categories, service_suburbs, status, vetting_done_count, insurance_state, licence_state, rating, rated_review_count, rating_threshold, emergency_available, phone", { count: "exact" });
    const term = searchTerm(args.query);
    if (term) q = q.or(`business_name.ilike."*${term}*",primary_contact_name.ilike."*${term}*",service_suburb_keys.cs.{"${term.toLowerCase()}"}`);
    if (args.trade) q = q.contains("categories", [args.trade]);
    const suburb = searchTerm(args.suburb);
    if (suburb) q = q.contains("service_suburb_keys", [suburb.toLowerCase()]);
    const region = searchTerm(args.region);
    if (region) q = q.contains("service_region_keys", [region.toLowerCase()]);
    if (args.status) q = q.eq("status", args.status);
    if (args.cleared_only) q = q.in("status", ["approved", "preferred"]);
    if (args.emergency) q = q.eq("emergency_available", true);
    const { data, error, count } = await q.order("business_name").limit(n);
    if (error) return dbFailure("search_contractors", error);
    const rows = data ?? [];
    const filters = [
      term && `matching "${term}"`,
      args.trade && `trade ${args.trade.replace(/_/g, " ")}`,
      suburb && `servicing ${suburb}`,
      region && `in region ${region}`,
      args.status && `status ${args.status}`,
      args.cleared_only && "approved or preferred",
      args.emergency && "emergency call-outs",
    ].filter(Boolean);
    const what = filters.length ? ` (${filters.join(", ")})` : "";
    if (rows.length === 0) {
      return respond("empty", `No contractors found${what}. HQ only knows the suburbs and trades that have been recorded: a contractor whose service areas are not recorded will not match a suburb.`, null, { count: 0 });
    }
    const total = count ?? rows.length;
    const lines = rows.map((r) => {
      const rating = r.rating !== null && (r.rated_review_count ?? 0) >= (r.rating_threshold ?? 3) ? `rating ${Number(r.rating).toFixed(1)}/5` : "not enough feedback for a rating";
      const subs = r.service_suburbs?.length ? `${r.service_suburbs.slice(0, 4).join(", ")}${r.service_suburbs.length > 4 ? ` +${r.service_suburbs.length - 4}` : ""}` : "service areas not recorded";
      return `- ${clean(r.business_name)} [id: ${r.id}] - ${tradeCats(r.categories)} - ${statusText(r.status)} - vetting ${r.vetting_done_count ?? 0}/9 - insurance ${stateText(r.insurance_state)}, licence ${stateText(r.licence_state)} - ${clean(subs, LIMITS.short)} - ${rating}${r.emergency_available ? " - emergency call-outs" : ""}${r.phone ? ` - ${clean(r.phone, 40)}` : ""}`;
    });
    return respond("ok", `${plural(total, "contractor")}${what}${total > rows.length ? `, showing the first ${rows.length}` : ""}. Directory: ${link(ctx, HQ_PATHS.partners())}`, lines, {
      count: total,
      ids: rows.map((r) => r.id),
    });
  },
});

export const getContractor = defineTool({
  name: "get_contractor",
  title: "Get a contractor",
  description:
    "Shows one contractor in full by business name or id: status, trades, contact details, service areas, rates (in dollars; unknown says Not recorded), insurance and licence state, the nine-step vetting checklist, latest feedback, recent contact and open tasks, with the HQ link. If the name matches several contractors you get the candidates instead. Read-only; document files are never opened.",
  inputSchema: getContractorShape,
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: "contractors.read",
  kind: "read",
  handler: async ({ contractor }, ctx) => {
    const found = await resolveContractor(ctx, contractor, "read");
    if (!found.ok) return found.result;
    const rec = await contractorRecord(ctx, found.record.id);
    if (!rec) return respond("not_found", "That contractor could not be found. It may have been archived.");
    return respond("ok", [found.note ?? "", `${clean(rec.title)}: ${rec.url}`], rec.lines, { id: rec.id, url: rec.url, ...rec.metadata });
  },
});

export const contractorExpiries = defineTool({
  name: "contractor_expiries",
  title: "Contractor expiries",
  description:
    "Lists contractor licences, insurance and documents that have expired or expire within the warning window (from the HQ expiry watch), soonest first, with days remaining. Expiry never changes a contractor's status by itself; an approved contractor with expired insurance stays approved until a person decides on the HQ screen. Read-only: it does not create reminder tasks.",
  inputSchema: contractorExpiriesShape,
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: "contractors.read",
  kind: "read",
  handler: async ({ state, limit }, ctx) => {
    const n = rowLimit(limit, LIMITS.listMax);
    let q = ctx.db.from("contractor_expiry_watch").select("contractor_id, business_name, contractor_status, kind, document_type, expires_on, days_remaining, state, verified", { count: "exact" });
    if (state && state !== "all") q = q.eq("state", state);
    const { data, error, count } = await q.order("days_remaining", { ascending: true }).order("business_name").limit(n);
    if (error) return dbFailure("contractor_expiries", error);
    const rows = data ?? [];
    if (rows.length === 0) {
      return respond("empty", state === "expired" ? "No contractor licence, insurance or document has expired." : state === "expiring_soon" ? "Nothing is expiring within the warning window." : "No contractor licence, insurance or document has expired or is expiring within the warning window.", null, { count: 0 });
    }
    const total = count ?? rows.length;
    const lines = rows.map((r) => {
      const what = r.kind === "document" ? `${(r.document_type ?? "document").replace(/_/g, " ")} document` : r.kind;
      const days = r.days_remaining ?? 0;
      const rel = days < 0 ? `expired ${-days} day${days === -1 ? "" : "s"} ago` : days === 0 ? "expires today" : `expires in ${days} day${days === 1 ? "" : "s"}`;
      const cleared = r.contractor_status === "approved" || r.contractor_status === "preferred";
      return `- ${clean(r.business_name)} [id: ${r.contractor_id}] (${statusText(r.contractor_status)}${cleared && days < 0 ? ", STILL CLEARED: needs a decision" : ""}): ${what} ${rel} (${day(ctx, r.expires_on)})${r.verified ? "" : ", not verified"}`;
    });
    return respond("ok", `${plural(total, "expiry item")}${total > rows.length ? `, showing ${rows.length}` : ""}. Reminder tasks can be created from the HQ dashboard.`, lines, { count: total });
  },
});
