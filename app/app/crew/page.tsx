"use client";

import Link from "next/link";
import { Header } from "@/components/app/Header";
import { useAppState } from "@/components/app/useAppState";
import { JOBS, PEOPLE, cap, dayFrom, greeting, property, words, type Job } from "@/lib/demo";

const dayLabel = (n: number) => (n === 0 ? "Today" : n === 1 ? "Tomorrow" : dayFrom(n).toLocaleDateString("en-AU", { weekday: "long", day: "numeric" }));

export default function CrewJobs() {
  const { state, ready } = useAppState();
  if (!ready) return <Header />;

  const me = PEOPLE.find((p) => p.id === state.person && p.role === "crew") ?? PEOPLE.find((p) => p.id === "kel")!;
  const mine = JOBS.filter((j) => j.crew === me.id);
  const todo = mine.filter((j) => !state.jobsDone.includes(j.id));
  const today = todo.filter((j) => j.dayOffset === 0);
  const days = [...new Set(mine.map((j) => j.dayOffset))].sort((a, b) => a - b);

  const status =
    me.kind === "tradie"
      ? `${cap(words(todo.length))} job${todo.length === 1 ? "" : "s"} open with us.`
      : today.length
        ? `${cap(words(today.length))} clean${today.length === 1 ? "" : "s"} today. Every room gets a photo before it's done.`
        : "Nothing left today. Nice work.";

  return (
    <>
      <Header title={me.name} />
      <main className="o-main">
        <div>
          <h1 className="o-title">{greeting()}, {me.first}</h1>
          <p className="o-status">{status}</p>
        </div>
        {days.map((day) => (
          <section key={day}>
            <p className="o-label" style={{ marginBottom: 12 }}>{dayLabel(day)}</p>
            <div className="o-list">
              {mine.filter((j) => j.dayOffset === day).map((j) => <JobRow key={j.id} job={j} done={state.jobsDone.includes(j.id)} rooms={state.photographed[j.id]?.length ?? 0} />)}
            </div>
          </section>
        ))}
      </main>
    </>
  );
}

function JobRow({ job, done, rooms }: { job: Job; done: boolean; rooms: number }) {
  const p = property(job.property);
  const total = p.rooms.length;
  return (
    <Link href={`/app/crew/job/${job.id}`} style={{ padding: "15px 0", display: "flex", gap: 13, color: "inherit" }}>
      <span style={{ width: 5, alignSelf: "stretch", flex: "none", background: done ? "var(--o-shallow)" : job.type === "trade" ? "var(--o-copper-text)" : "var(--o-copper)" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
          <span style={{ fontWeight: 600, fontSize: 19 }}>{p.name}</span>
          <span className="o-small">{job.window}</span>
        </div>
        <p className="o-small" style={{ marginTop: 3, color: "var(--o-body)" }}>
          {job.type === "clean" ? `Turnover · ${job.guestsIn ?? "no one in"}` : job.title}
        </p>
        <div style={{ marginTop: 7, display: "flex", gap: 8, alignItems: "center" }}>
          <span className="o-chip">{job.type === "clean" ? "Clean" : job.stage === "quote" ? "Quote" : "Trade"}</span>
          <span className="o-small" style={{ color: done ? "var(--o-shallow)" : undefined }}>
            {done ? "Done ✓" : job.type === "clean" ? `${rooms} of ${total} rooms photographed` : job.stage === "quote" ? "Needs a quote" : "Booked in"}
          </span>
        </div>
      </div>
    </Link>
  );
}
