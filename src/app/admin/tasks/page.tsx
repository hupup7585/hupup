import Link from "next/link";
import { desc, inArray, sql } from "drizzle-orm";
import { AlertTriangle, CalendarDays, CircleCheck, Circle, Clock, FolderKanban, ListChecks, Timer } from "lucide-react";
import { db, schema } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { todayISO } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import DualDate, { HebrewDay } from "@/components/DualDate";
import { PRIORITY_LABEL, STATUS_LABEL, canCreate, isOverdue, laborCents, minutesOf, projectProfit, seesMoney, staffList, visibleTasks, type Task } from "@/lib/tasks";
import { createTaskAction, saveProjectAction, saveRateAction } from "./actions";
import TaskLine from "./TaskLine";

type SP = { view?: string; status?: string; mine?: string; m?: string; msg?: string; err?: string; project?: string };

const VIEWS: [string, string, typeof ListChecks][] = [
  ["list", "Tasks", ListChecks],
  ["month", "Month", CalendarDays],
  ["projects", "Projects", FolderKanban],
  ["time", "Time", Timer],
];

/** Task Manager (Abraham CC, DD). */
export default async function TasksPage({ searchParams }: { searchParams: Promise<SP> }) {
  const staff = await requireStaff(["owner", "secretary", "delivery"]);
  const sp = await searchParams;
  const view = [...VIEWS.map((v) => v[0]), "labor"].includes(sp.view ?? "") ? sp.view! : "list";
  const people = await staffList();
  const names = new Map(people.map((p) => [p.id, p.name]));
  const projects = await db.select().from(schema.taskProjects).orderBy(desc(schema.taskProjects.id));
  const views = VIEWS.filter(([k]) => staff.role !== "delivery" || k === "list" || k === "month" || k === "time");
  return (
    <div className="mx-auto max-w-6xl" data-tasks>
      <h1 className="mb-1 text-2xl font-black sm:text-3xl">Tasks</h1>
      <p className="mb-4 text-muted">{staff.role === "delivery" ? "Your tasks. Check them off as you go." : "Add, assign and check off jobs. No texts are sent for tasks."}</p>
      <nav className="mb-5 flex flex-wrap gap-2" aria-label="Task views">
        {views.map(([k, label, Icon]) => (
          <Link key={k} href={`/admin/tasks?view=${k}`} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold ${k === view ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-line hover:bg-bg"}`}>
            <Icon className="h-4 w-4" aria-hidden /> {label}
          </Link>
        ))}
        {seesMoney(staff) && (
          <Link href="/admin/tasks?view=labor" className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold ${view === "labor" ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-line hover:bg-bg"}`}>
            <Clock className="h-4 w-4" aria-hidden /> Rates
          </Link>
        )}
      </nav>
      {sp.msg && <p className="mb-4 rounded-xl bg-[#E3F8EF] px-4 py-3 text-sm font-semibold text-[#13895C]" role="status">{sp.msg}</p>}
      {sp.err && <p className="mb-4 rounded-xl bg-[#FFE6E4] px-4 py-3 text-sm font-semibold text-[#C83A2F]" role="alert">{sp.err}</p>}
      {view === "list" && <ListView staff={staff} sp={sp} people={people} names={names} projects={projects} />}
      {view === "month" && <MonthView staff={staff} m={sp.m} names={names} />}
      {view === "projects" && staff.role !== "delivery" && <ProjectsView staff={staff} projects={projects} />}
      {view === "time" && <TimeView staff={staff} names={names} />}
      {view === "labor" && seesMoney(staff) && <RatesView people={people} />}
    </div>
  );
}

async function subCounts(ids: number[]) {
  const m = new Map<number, [number, number]>();
  if (!ids.length) return m;
  const subs = await db.select({ parentId: schema.tasks.parentId, status: schema.tasks.status }).from(schema.tasks).where(inArray(schema.tasks.parentId, ids));
  for (const s of subs) {
    const c = m.get(s.parentId!) ?? [0, 0];
    m.set(s.parentId!, [c[0] + 1, c[1] + (s.status === "done" ? 1 : 0)]);
  }
  return m;
}

async function ListView({ staff, sp, people, names, projects }: { staff: Awaited<ReturnType<typeof requireStaff>>; sp: SP; people: { id: number; name: string }[]; names: Map<number, string>; projects: (typeof schema.taskProjects.$inferSelect)[] }) {
  const status = sp.status ?? "open";
  const list = await visibleTasks(staff, { status, mine: sp.mine === "1", projectId: Number(sp.project) || undefined });
  const subs = await subCounts(list.map((t) => t.id));
  const back = `/admin/tasks?status=${status}${sp.mine ? "&mine=1" : ""}`;
  return (
    <>
      {canCreate(staff) && (
        <details className="card mb-5 p-5" open={list.length === 0}>
          <summary className="cursor-pointer text-lg font-bold">Add a task</summary>
          <form action={createTaskAction} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-sm sm:col-span-2"><span className="mb-1 block font-semibold text-muted">Title</span><input name="title" required maxLength={200} className="input" /></label>
            <label className="block text-sm"><span className="mb-1 block font-semibold text-muted">Deadline</span><input type="date" name="dueDate" className="input" /></label>
            <label className="block text-sm"><span className="mb-1 block font-semibold text-muted">Time (optional)</span><input type="time" name="dueTime" className="input" /></label>
            <label className="block text-sm"><span className="mb-1 block font-semibold text-muted">Assign to</span>
              <select name="assignedTo" className="input" defaultValue=""><option value="">Unassigned</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            </label>
            <label className="block text-sm"><span className="mb-1 block font-semibold text-muted">Priority</span>
              <select name="priority" className="input" defaultValue="normal"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select>
            </label>
            <label className="block text-sm"><span className="mb-1 block font-semibold text-muted">Booking # (optional)</span><input name="orderId" inputMode="numeric" className="input" /></label>
            <label className="block text-sm"><span className="mb-1 block font-semibold text-muted">Project</span>
              <select name="projectId" className="input" defaultValue=""><option value="">None</option>{projects.filter((p) => p.status === "open").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            </label>
            <label className="block text-sm sm:col-span-2 lg:col-span-4"><span className="mb-1 block font-semibold text-muted">Notes</span><textarea name="notes" rows={2} className="input" /></label>
            <div><button className="btn-dark">Add task</button></div>
          </form>
        </details>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {[["open", "Open"], ["done", "Done"], ["all", "All"]].map(([k, l]) => (
          <Link key={k} href={`/admin/tasks?status=${k}${sp.mine ? "&mine=1" : ""}`} className={`rounded-full px-3 py-1 font-semibold ${status === k ? "bg-sky/30 text-navy" : "text-muted hover:text-navy"}`}>{l}</Link>
        ))}
        {staff.role !== "delivery" && (
          <Link href={`/admin/tasks?status=${status}${sp.mine ? "" : "&mine=1"}`} className={`rounded-full px-3 py-1 font-semibold ${sp.mine ? "bg-sky/30 text-navy" : "text-muted hover:text-navy"}`}>Only mine</Link>
        )}
        <span className="ml-auto flex gap-3">
          <a className="font-semibold text-navy underline" href={`/api/admin/tasks/export?report=tasks&format=csv`}>CSV</a>
          <a className="font-semibold text-navy underline" href={`/admin/tasks/print?report=tasks`} target="_blank">PDF</a>
        </span>
      </div>
      <ul className="space-y-2">
        {list.map((t) => <TaskLine key={t.id} t={t} names={names} back={back} subCount={subs.get(t.id)} />)}
        {list.length === 0 && <li className="rounded-xl bg-white p-8 text-center text-muted">No tasks here.</li>}
      </ul>
    </>
  );
}

/** "Task months" read as a monthly task calendar: tasks on their deadline day. */
async function MonthView({ staff, m, names }: { staff: Awaited<ReturnType<typeof requireStaff>>; m?: string; names: Map<number, string> }) {
  const today = todayISO();
  const month = /^\d{4}-\d{2}$/.test(m ?? "") ? m! : today.slice(0, 7);
  const first = `${month}-01`;
  const start = new Date(`${first}T12:00:00Z`);
  const offset = start.getUTCDay();
  const daysIn = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  const all = (await visibleTasks(staff, { status: "all" })).filter((t) => t.dueDate?.startsWith(month));
  const last = `${month}-${String(daysIn).padStart(2, "0")}`;
  const subs = await db.select().from(schema.tasks).where(sql`${schema.tasks.parentId} IS NOT NULL AND ${schema.tasks.dueDate} BETWEEN ${first} AND ${last}`);
  const visibleIds = new Set((await visibleTasks(staff, { status: "all" })).map((t) => t.id));
  const items = [...all, ...subs.filter((s) => visibleIds.has(s.parentId!))];
  const byDay = new Map<string, Task[]>();
  for (const t of items) byDay.set(t.dueDate!, [...(byDay.get(t.dueDate!) ?? []), t]);
  const shift = (n: number) => {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + n, 1));
    return d.toISOString().slice(0, 7);
  };
  const label = start.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const cells: (string | null)[] = [...Array(offset).fill(null), ...Array.from({ length: daysIn }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];
  return (
    <div className="card p-4" data-task-month>
      <div className="mb-3 flex items-center justify-between">
        <Link className="font-bold text-navy" href={`/admin/tasks?view=month&m=${shift(-1)}`}>‹ Previous</Link>
        <h2 className="text-lg font-black">{label}</h2>
        <Link className="font-bold text-navy" href={`/admin/tasks?view=month&m=${shift(1)}`}>Next ›</Link>
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[760px] grid-cols-7 gap-1 text-xs">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Shabbos"].map((d) => <div key={d} className="px-1 py-1 font-bold text-muted">{d}</div>)}
          {cells.map((iso, i) => (
            <div key={i} className={`min-h-[96px] rounded-lg border p-1 ${iso === today ? "border-navy" : "border-line"} ${iso ? "bg-white" : "bg-transparent"}`}>
              {iso && (
                <>
                  <div className="mb-1 font-bold">{Number(iso.slice(8))} <HebrewDay yi iso={iso} className="font-normal text-muted" /></div>
                  {(byDay.get(iso) ?? []).map((t) => (
                    <Link key={t.id} href={`/admin/tasks/${t.parentId ?? t.id}`} className={`mb-0.5 block truncate rounded px-1 py-0.5 ${t.status === "done" ? "bg-bg text-muted line-through" : isOverdue(t) ? "bg-[#FFE6E4] font-semibold text-[#C83A2F]" : "bg-sky/20 text-navy"}`} title={`${t.title}${t.assignedTo ? ` (${names.get(t.assignedTo) ?? ""})` : ""}`}>
                      {t.parentId ? "↳ " : ""}{t.title}
                    </Link>
                  ))}
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

async function ProjectsView({ staff, projects }: { staff: Awaited<ReturnType<typeof requireStaff>>; projects: (typeof schema.taskProjects.$inferSelect)[] }) {
  const money = seesMoney(staff);
  const profits = money ? await Promise.all(projects.map((p) => projectProfit(p))) : [];
  const counts = new Map(
    ((await db.execute(sql`SELECT project_id AS id, count(*)::int AS n, count(*) FILTER (WHERE status = 'done')::int AS d FROM tasks WHERE project_id IS NOT NULL AND parent_id IS NULL GROUP BY 1`)).rows as { id: number; n: number; d: number }[]).map((r) => [Number(r.id), r]),
  );
  return (
    <>
      <section className="card mb-5 p-5">
        <h2 className="mb-3 text-lg font-bold">New project</h2>
        <form action={saveProjectAction} className="grid gap-3 sm:grid-cols-3">
          <label className="block text-sm"><span className="mb-1 block font-semibold text-muted">Name (an event or a booking)</span><input name="name" required className="input" /></label>
          <label className="block text-sm"><span className="mb-1 block font-semibold text-muted">Booking numbers (income)</span><input name="orderIds" placeholder="e.g. 1001, 1002" className="input" /></label>
          <label className="block text-sm"><span className="mb-1 block font-semibold text-muted">Notes</span><input name="notes" className="input" /></label>
          <div><button className="btn-dark">Add project</button></div>
        </form>
      </section>
      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">Projects</h2>
          {money && (
            <span className="flex gap-3 text-sm">
              <a className="font-semibold text-navy underline" href="/api/admin/tasks/export?report=projects&format=csv">CSV</a>
              <a className="font-semibold text-navy underline" href="/admin/tasks/print?report=projects" target="_blank">PDF</a>
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr>
                <th className="th">Project</th><th className="th">Tasks</th><th className="th">Booking numbers</th>
                {money && <><th className="th">Income</th><th className="th">Expenses</th><th className="th">Labor</th><th className="th">Profit</th></>}
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p, i) => {
                const c = counts.get(p.id);
                return (
                  <tr key={p.id}>
                    <td className="td"><Link className="font-bold text-navy underline" href={`/admin/tasks?project=${p.id}&status=all`}>{p.name}</Link>{p.status === "closed" && <span className="ml-2 text-xs text-muted">closed</span>}</td>
                    <td className="td">{c ? `${c.d}/${c.n} done` : "—"}</td>
                    <td className="td">{p.orderIds.length ? p.orderIds.map((o) => <Link key={o} className="mr-1 underline" href={`/admin/orders/${o}`}>{o}</Link>) : "—"}</td>
                    {money && (
                      <>
                        <td className="td">{formatMoney(profits[i].incomeCents)}</td>
                        <td className="td">{formatMoney(profits[i].expensesCents)}</td>
                        <td className="td">{formatMoney(profits[i].laborCents)} <span className="text-xs text-muted">({(profits[i].minutes / 60).toFixed(1)} h)</span></td>
                        <td className={`td font-bold ${profits[i].profitCents < 0 ? "text-[#C83A2F]" : ""}`}>{profits[i].profitCents < 0 ? `-${formatMoney(-profits[i].profitCents)}` : formatMoney(profits[i].profitCents)}</td>
                      </>
                    )}
                    <td className="td">
                      <form action={saveProjectAction} className="flex flex-wrap gap-1">
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="name" value={p.name} />
                        <input type="hidden" name="notes" value={p.notes ?? ""} />
                        <input name="orderIds" defaultValue={p.orderIds.join(", ")} className="input w-28 py-1 text-xs" aria-label="Booking numbers" />
                        <select name="status" defaultValue={p.status} className="input w-24 py-1 text-xs"><option value="open">Open</option><option value="closed">Closed</option></select>
                        <button className="text-xs font-bold text-navy">Save</button>
                      </form>
                    </td>
                  </tr>
                );
              })}
              {projects.length === 0 && <tr><td colSpan={money ? 8 : 4} className="py-6 text-center text-muted">No projects yet.</td></tr>}
            </tbody>
          </table>
        </div>
        {money && <p className="mt-3 text-xs text-muted">Income: paid amounts of the linked bookings before sales tax (from Bookkeeping). Expenses: Bookkeeping expenses marked with this project. Labor: hours logged on the project&rsquo;s tasks times each person&rsquo;s rate.</p>}
      </section>
    </>
  );
}

async function TimeView({ staff, names }: { staff: Awaited<ReturnType<typeof requireStaff>>; names: Map<number, string> }) {
  const money = seesMoney(staff);
  const logs = await db.select().from(schema.timeLogs).orderBy(desc(schema.timeLogs.startedAt)).limit(300);
  const mine = staff.role === "owner" ? logs : logs.filter((l) => l.userId === staff.userId);
  const taskIds = [...new Set(mine.map((l) => l.taskId))];
  const titles = new Map(taskIds.length ? (await db.select({ id: schema.tasks.id, title: schema.tasks.title }).from(schema.tasks).where(inArray(schema.tasks.id, taskIds))).map((t) => [t.id, t.title]) : []);
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold">{staff.role === "owner" ? "Time logged" : "My time"}</h2>
        <span className="flex gap-3 text-sm">
          <a className="font-semibold text-navy underline" href="/api/admin/tasks/export?report=time&format=csv">CSV</a>
          <a className="font-semibold text-navy underline" href="/admin/tasks/print?report=time" target="_blank">PDF</a>
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead><tr><th className="th">When</th><th className="th">Who</th><th className="th">Task</th><th className="th">Time</th>{money && <th className="th">Labor cost</th>}<th className="th">Note</th></tr></thead>
          <tbody>
            {mine.map((l) => (
              <tr key={l.id}>
                <td className="td">{l.endedAt === null && l.minutes !== null ? <DualDate yi iso={l.startedAt.toISOString().slice(0, 10)} style="short" /> : <DualDate yi at={l.startedAt} />}</td>
                <td className="td">{l.userId ? names.get(l.userId) ?? "Staff" : "Owner"}</td>
                <td className="td"><Link className="text-navy underline" href={`/admin/tasks/${l.taskId}`}>{titles.get(l.taskId) ?? `Number ${l.taskId}`}</Link></td>
                <td className="td">{l.endedAt || l.minutes !== null ? `${(minutesOf(l) / 60).toFixed(2)} h` : <b>Running…</b>}</td>
                {money && <td className="td">{formatMoney(laborCents(l))}</td>}
                <td className="td">{l.note ?? ""}</td>
              </tr>
            ))}
            {mine.length === 0 && <tr><td colSpan={money ? 6 : 5} className="py-6 text-center text-muted">No time logged yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

async function RatesView({ people }: { people: { id: number; name: string; role: string }[] }) {
  const rates = new Map((await db.select().from(schema.staffRates)).map((r) => [r.userId, r.hourlyCents]));
  return (
    <section className="card p-5">
      <h2 className="mb-1 text-lg font-bold">Hourly rates</h2>
      <p className="mb-3 text-sm text-muted">Owner only. Labor cost = hours x rate. A new rate applies to time logged from now on.</p>
      <ul className="divide-y divide-line">
        {people.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 py-2">
            <span className="min-w-[160px] font-semibold">{p.name} <span className="text-xs capitalize text-muted">{p.role}</span></span>
            <form action={saveRateAction} className="flex items-center gap-2">
              <input type="hidden" name="userId" value={p.id} />
              <span className="text-muted">$</span>
              <input name="rate" defaultValue={rates.has(p.id) ? (rates.get(p.id)! / 100).toFixed(2) : ""} placeholder="0.00" className="input w-24 py-1" aria-label={`Hourly rate for ${p.name}`} />
              <span className="text-muted">/ hour</span>
              <button className="text-sm font-bold text-navy">Save</button>
            </form>
          </li>
        ))}
        {people.length === 0 && <li className="py-4 text-muted">Add staff accounts first (Staff page).</li>}
      </ul>
    </section>
  );
}

