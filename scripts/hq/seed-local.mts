/*
 * Local development seed for Planted HQ.  npm run hq:seed
 *
 * Creates a handful of clearly fake `.test` staff logins (never real addresses), makes
 * Shannon the first director through the same bootstrap function a real launch uses,
 * adds the rest through the add_staff RPC as that director, creates the Copper Coast
 * pod, switches MFA off for local convenience, imports the research leads from
 * hq/seed/referral-contacts.json through the duplicate-safe partner import, and the
 * maintenance contractor prospects from hq/seed/maintenance-contractors.json through the
 * duplicate-safe contractor import (as the director: import.run + contractors.write).
 *
 * Idempotent: run it again and nothing is duplicated.
 * Never runs against anything but the local stack. For a real launch use
 * scripts/hq/bootstrap-director.mts instead.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { adminClient, asUser, findUserId, requireLocal, sessionFor } from "./lib.mts";

requireLocal();
const admin = adminClient();

type Person = { email: string; full: string; first: string; role: string; note: string };
const PEOPLE: Person[] = [
  { email: "shannon@planted.test", full: "Shannon Langberg", first: "Shannon", role: "director", note: "Founder, Director, Business Development" },
  { email: "courtney@planted.test", full: "Courtney Langberg", first: "Courtney", role: "director", note: "Co-founder, Property Management, Operations" },
  // Test personas so permissions can be exercised. Clearly not real people.
  { email: "va@planted.test", full: "Test Virtual Assistant", first: "Test", role: "virtual_assistant", note: "dev persona" },
  { email: "readonly@planted.test", full: "Test Read-Only", first: "Test", role: "read_only", note: "dev persona" },
  { email: "junior@planted.test", full: "Test Junior PM", first: "Test", role: "junior_property_manager", note: "dev persona" },
];

async function ensureUser(p: Person): Promise<string> {
  const existing = await findUserId(p.email);
  if (existing) return existing;
  const { data, error } = await admin.auth.admin.createUser({
    email: p.email,
    email_confirm: true,
    user_metadata: { full_name: p.full, first_name: p.first },
  });
  if (error || !data.user) throw new Error(`createUser ${p.email}: ${error?.message}`);
  return data.user.id;
}

function sql(statement: string): void {
  // Local database only (the guard above). Used for the one setting a director cannot
  // change before being able to sign in.
  execFileSync("docker", ["exec", "supabase_db_Tidewell", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-c", statement], { stdio: "pipe" });
}

async function main() {
  const ids = new Map<string, string>();
  for (const p of PEOPLE) ids.set(p.email, await ensureUser(p));

  // MFA off for local development. Production keeps it on (the migration default).
  sql("update hq.settings set value = 'false'::jsonb where key = 'require_mfa'");

  // The first director: only possible while nobody exists, and only via the service role.
  const existing = await admin.schema("hq").from("staff_profiles").select("id", { count: "exact", head: true });
  if ((existing.count ?? 0) === 0) {
    const first = PEOPLE[0];
    const { error } = await admin.schema("hq").rpc("bootstrap_first_director", {
      p_user_id: ids.get(first.email)!,
      p_email: first.email,
      p_full_name: first.full,
      p_first_name: first.first,
    });
    if (error) throw new Error(`bootstrap_first_director: ${error.message}`);
    console.log(`Bootstrapped first director: ${first.full}`);
  }

  // Everyone else is added the way a real administrator would add them.
  const session = await sessionFor(PEOPLE[0].email);
  const db = asUser(session.access_token);

  for (const p of PEOPLE.slice(1)) {
    const id = ids.get(p.email)!;
    const have = await db.from("staff_profiles").select("id").eq("id", id).maybeSingle();
    if (have.data) continue;
    const { error } = await db.rpc("add_staff", { p_user_id: id, p_email: p.email, p_full_name: p.full, p_role: p.role, p_first_name: p.first, p_responsibilities: p.note });
    if (error) throw new Error(`add_staff ${p.email}: ${error.message}`);
    console.log(`Added ${p.full} (${p.role})`);
  }

  // The first pod, and the two founders in it.
  let pod = await db.from("pods").select("id").eq("name", "Copper Coast").maybeSingle();
  if (!pod.data) {
    const ins = await db.from("pods").insert({ name: "Copper Coast", region: "Copper Coast, South Australia" }).select("id").single();
    if (ins.error) throw new Error(`pods insert: ${ins.error.message}`);
    pod = { data: ins.data, error: null, count: null, status: 201, statusText: "Created" } as typeof pod;
  }
  for (const p of PEOPLE.slice(0, 2)) {
    const { error } = await db.rpc("update_staff", { p_staff_id: ids.get(p.email)!, p_pod: pod.data!.id, p_responsibilities: p.note });
    if (error) throw new Error(`update_staff ${p.email}: ${error.message}`);
  }

  // The research leads, through the duplicate-safe import.
  const file = JSON.parse(readFileSync("hq/seed/referral-contacts.json", "utf8")) as { source: string; rows: Record<string, unknown>[] };
  const imp = await db.rpc("apply_partner_import", { p_rows: file.rows, p_source: file.source, p_file_name: "referral-contacts.json" });
  if (imp.error) throw new Error(`apply_partner_import: ${imp.error.message}`);
  const counts = (imp.data as { counts: Record<string, number> }).counts;
  console.log(`Import: ${counts.organisations_created} organisations and ${counts.contacts_created} contacts created, ${counts.skipped} skipped, ${counts.possible_duplicate} possible duplicates reported.`);

  // The maintenance contractor prospects, through the duplicate-safe contractor import. Every row
  // arrives as a prospect that needs verification; a second run creates nothing (duplicates).
  const prospects = JSON.parse(readFileSync("hq/seed/maintenance-contractors.json", "utf8")) as { source: string; rows: Record<string, unknown>[] };
  const cimp = await db.rpc("apply_contractor_import", { p_rows: prospects.rows, p_source: prospects.source, p_file_name: "maintenance-contractors.json" });
  if (cimp.error) throw new Error(`apply_contractor_import: ${cimp.error.message}`);
  const ccounts = (cimp.data as { counts: Record<string, number> }).counts;
  console.log(`Contractor import: ${ccounts.contractors_created} contractors created, ${ccounts.skipped} skipped, ${ccounts.possible_duplicate} possible duplicates reported (${ccounts.rows} rows).`);

  await seedSampleProjects(db, ids);
  await seedCommandCenterSample(db, ids);

  console.log("\nLocal HQ logins (fake .test addresses; MFA is off locally):");
  for (const p of PEOPLE) console.log(`  ${p.email.padEnd(24)} ${p.role.padEnd(26)} ${p.full}`);
  console.log("\nSign in at http://localhost:3210/hq/sign-in (codes appear in Mailpit, http://127.0.0.1:54324),");
  console.log("or skip the email with: npm run hq:session -- shannon@planted.test");
}

/*
 * Two clearly labelled SAMPLE projects so the project screens have something to show locally:
 * milestones, subtasks, a dependency chain, checklists, an overdue task and tasks for the test
 * personas (so the restricted views can be checked). The names say "Sample" and the tasks are
 * generic placeholders, not Planted's real plan. Created through the same RPCs a person or a
 * connected app uses (create_project, create_milestone, bulk_create_tasks). Dates are relative to
 * today. Skipped when a project with that name already exists, so a rerun adds nothing.
 */
async function seedSampleProjects(db: ReturnType<typeof asUser>, ids: Map<string, string>) {
  const day = (offset: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  const shannon = ids.get("shannon@planted.test")!;
  const courtney = ids.get("courtney@planted.test")!;
  const va = ids.get("va@planted.test")!;

  type Plan = {
    name: string;
    description: string;
    status: string;
    priority: string;
    start: number;
    target: number;
    owner: string;
    notes: string;
    milestones: { name: string; due: number }[];
    tasks: Record<string, unknown>[];
  };
  const plans: Plan[] = [
    {
      name: "Sample: launch preparation",
      description: "Local sample data for trying the project screens. Not a real plan.",
      status: "active",
      priority: "high",
      start: -21,
      target: 40,
      owner: shannon,
      notes: "## About this sample\n\nCreated by `npm run hq:seed` so the **Overview**, **List**, **Board** and **Timeline** views have something to show.\n\n- Placeholder tasks only\n- Safe to archive",
      milestones: [
        { name: "Groundwork", due: -3 },
        { name: "Ready to open", due: 21 },
        { name: "First month", due: 40 },
      ],
      tasks: [
        { ref: "a", title: "Sample task: write the opening checklist", milestone: "Groundwork", assignee: shannon, priority: "high", status: "completed", due_date: day(-10) },
        { ref: "b", title: "Sample task: review the document templates", milestone: "Groundwork", assignee: courtney, priority: "normal", due_date: day(-5), checklist: ["First pass", "Second reader", "Final copy"] },
        { ref: "b1", title: "Sample subtask: first template", parent_ref: "b", assignee: courtney, status: "completed", due_date: day(-6) },
        { ref: "b2", title: "Sample subtask: second template", parent_ref: "b", assignee: courtney, due_date: day(-5) },
        { ref: "c", title: "Sample task: set up the shared folder", milestone: "Ready to open", assignee: va, priority: "normal", status: "in_progress", due_date: day(3), checklist: ["Create the folder", "Share it with the team"] },
        { ref: "d", title: "Sample task: confirm the opening date", milestone: "Ready to open", assignee: shannon, priority: "urgent", due_date: day(7), depends_on: ["b"] },
        { ref: "e", title: "Sample task: prepare the welcome note", milestone: "Ready to open", assignee: va, priority: "normal", due_date: day(14), depends_on: ["d"] },
        { ref: "f", title: "Sample task: plan the first-month check-in", milestone: "First month", assignee: courtney, priority: "low", due_date: day(35), depends_on: ["e"] },
        { ref: "g", title: "Sample task: note ideas for later", assignee: shannon, priority: "low", status: "waiting" },
      ],
    },
    {
      name: "Sample: tidy the office systems",
      description: "A second, smaller sample so the project list has more than one row.",
      status: "planning",
      priority: "normal",
      start: 5,
      target: 60,
      owner: courtney,
      notes: "",
      milestones: [{ name: "Agreed approach", due: 30 }],
      tasks: [
        { ref: "a", title: "Sample task: list what we use today", milestone: "Agreed approach", assignee: courtney, due_date: day(12) },
        { ref: "b", title: "Sample task: suggest what to change", milestone: "Agreed approach", assignee: va, due_date: day(25), depends_on: ["a"] },
      ],
    },
  ];

  for (const plan of plans) {
    const have = await db.from("projects").select("id").eq("name", plan.name).is("deleted_at", null).maybeSingle();
    if (have.data) continue;
    const created = await db.rpc("create_project", {
      p_name: plan.name,
      p_description: plan.description,
      p_owner: plan.owner,
      p_status: plan.status,
      p_priority: plan.priority,
      p_start: day(plan.start),
      p_target: day(plan.target),
      p_notes: plan.notes || undefined,
    } as never);
    const projectId = (created.data as { project_id?: string } | null)?.project_id;
    if (created.error || !projectId) throw new Error(`create_project ${plan.name}: ${created.error?.message}`);
    for (const m of plan.milestones) {
      const r = await db.rpc("create_milestone", { p_project: projectId, p_name: m.name, p_due: day(m.due) } as never);
      if (r.error) throw new Error(`create_milestone ${m.name}: ${r.error.message}`);
    }
    const bulk = await db.rpc("bulk_create_tasks", {
      p_tasks: plan.tasks,
      p_idempotency_key: `seed-${projectId}`,
      p_project: projectId,
      p_atomic: true,
    } as never);
    if (bulk.error) throw new Error(`bulk_create_tasks ${plan.name}: ${bulk.error.message}`);
    const out = bulk.data as { created_count?: number; failed_count?: number };
    console.log(`Sample project "${plan.name}": ${plan.milestones.length} milestone(s), ${out.created_count ?? 0} task(s) (${out.failed_count ?? 0} failed).`);
  }
}

/*
 * A labelled SAMPLE for the command center (/hq): a "Sample: business launch" project with launch
 * requirements, tasks in every Workboard lane, outside waits (with and without dates) and a SAMPLE
 * funding planning item that three tasks wait on. Local only: the names say "Sample" and nothing here
 * is Planted's real plan or real money (the planning figure is the founder's own anticipated round
 * number, marked anticipated and not confirmed). Created through the real RPCs (save_planning_item,
 * create_project, bulk_create_tasks, set_task_waiting, set_milestone_launch_gate, update_project_task).
 * Skipped when the project already exists.
 */
async function seedCommandCenterSample(db: ReturnType<typeof asUser>, ids: Map<string, string>) {
  const day = (offset: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  const shannon = ids.get("shannon@planted.test")!;
  const courtney = ids.get("courtney@planted.test")!;
  const name = "Sample: business launch";
  const have = await db.from("projects").select("id").eq("name", name).is("deleted_at", null).maybeSingle();
  if (have.data) return;
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const r = await db.rpc(fn as never, args as never);
    if (r.error) throw new Error(`${fn}: ${r.error.message}`);
    return r.data as Record<string, unknown>;
  };
  const funding = await rpc("save_planning_item", {
    p_kind: "funding",
    p_title: "Sample: business funding",
    p_detail: "Local sample. Anticipated, not confirmed and not received: a planning figure, never a balance.",
    p_amount: 25000,
    p_expected_text: "within about a month (founder's estimate)",
  });
  await rpc("save_planning_item", { p_kind: "context", p_title: "Sample: HQ development is nearly finished", p_detail: "Local sample context note." });
  const project = await rpc("create_project", { p_name: name, p_description: "Local sample for the command center. Not a real plan.", p_owner: shannon, p_status: "active", p_priority: "high", p_start: day(-30), p_target: day(60) });
  const projectId = project.project_id as string;
  const gates = ["Registered to trade", "Systems ready"];
  const milestones = [
    { name: "Registered to trade", due: 35 },
    { name: "Systems ready", due: 21 },
    { name: "Brand and website", due: -5 },
    { name: "First landlords", due: 75 },
  ];
  const mids = new Map<string, string>();
  for (const m of milestones) {
    const r = await rpc("create_milestone", { p_project: projectId, p_name: m.name, p_due: day(m.due) });
    mids.set(m.name, (r.milestone_id ?? r.id) as string);
  }
  for (const g of gates) await rpc("set_milestone_launch_gate", { p_id: mids.get(g), p_gate: true });
  await rpc("complete_milestone", { p_id: mids.get("Brand and website"), p_force: true });
  const tasks = [
    { ref: "site", title: "Sample task: publish the website", milestone: "Brand and website", assignee: shannon, priority: "high", status: "completed", due_date: day(-6) },
    { ref: "logo", title: "Sample task: final logo files", milestone: "Brand and website", assignee: courtney, status: "completed", due_date: day(-8) },
    { ref: "hq", title: "Sample task: finish Planted HQ", milestone: "Systems ready", assignee: shannon, priority: "high", status: "in_progress", due_date: day(4) },
    { ref: "ailo", title: "Sample task: Ailo demo follow-up", milestone: "Systems ready", assignee: shannon, priority: "high", due_date: day(6) },
    { ref: "trust", title: "Sample task: open the trust account", milestone: "Registered to trade", assignee: shannon, priority: "high", due_date: day(20), depends_on: ["acct"] },
    { ref: "train", title: "Sample task: enrol in paid property management training", milestone: "Registered to trade", assignee: shannon, priority: "high" },
    { ref: "acct", title: "Sample task: engage an accountant", milestone: "Registered to trade", assignee: shannon, priority: "normal" },
    { ref: "regs", title: "Sample task: pay the registrations", milestone: "Registered to trade", assignee: shannon, priority: "normal" },
    { ref: "refs", title: "Sample task: research referral partners in Kadina", milestone: "First landlords", assignee: shannon, priority: "high", due_date: day(1) },
    { ref: "intro", title: "Sample task: call three local conveyancers", milestone: "First landlords", assignee: shannon, priority: "normal", due_date: day(0) },
    { ref: "pack", title: "Sample task: draft the landlord welcome pack", milestone: "First landlords", assignee: courtney, priority: "normal", due_date: day(18) },
    { ref: "prospect", title: "Sample task: prospecting list for Wallaroo", milestone: "First landlords", assignee: shannon, priority: "normal", due_date: day(9) },
    { ref: "policy", title: "Sample task: write the maintenance policy", milestone: "Systems ready", assignee: shannon, priority: "low", due_date: day(-2) },
  ];
  const bulk = await rpc("bulk_create_tasks", { p_tasks: tasks, p_idempotency_key: `seed-cc-${projectId}`, p_project: projectId, p_atomic: true });
  const refs = new Map(((bulk.created as { ref: string; id: string }[]) ?? []).map((c) => [c.ref, c.id]));
  const fundingId = funding.id as string;
  await rpc("set_task_waiting", { p_task: refs.get("ailo"), p_waiting_on: "Ailo to reply after the demo", p_note: "Sample note: demo done, waiting on their reply." });
  for (const r of ["train", "acct", "regs"]) await rpc("set_task_waiting", { p_task: refs.get(r), p_planning_item: fundingId });
  await rpc("update_project_task", { p_id: refs.get("prospect"), p_patch: { planned_for: day(5) } });
  console.log(`Sample command center: "${name}" with ${milestones.length} milestones (${gates.length} required to open), ${refs.size} tasks, 1 sample funding item.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
