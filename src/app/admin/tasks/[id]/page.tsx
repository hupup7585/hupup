import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { ArrowLeft, Circle, CircleCheck, History, Play, Square, Timer } from "lucide-react";
import { db, schema } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import DualDate from "@/components/DualDate";
import { PRIORITY_LABEL, STATUS_LABEL, canAccess, getTask, isOverdue, laborCents, minutesOf, seesMoney, staffList } from "@/lib/tasks";
import { addSubtaskAction, logHoursAction, setStatusAction, startTimerAction, stopTimerAction, updateTaskAction } from "../actions";

const FIELD_LABEL: Record<string, string> = { title: "Title", notes: "Notes", dueDate: "Deadline", dueTime: "Time", priority: "Priority", status: "Status", assignedTo: "Assigned to", orderId: "Booking", projectId: "Project" };

export default async function TaskPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  const staff = await requireStaff(["owner", "secretary", "delivery"]);
  const t = await getTask(Number((await params).id));
  if (!t || !(await canAccess(staff, t))) notFound();
  if (t.parentId) redirect(`/admin/tasks/${t.parentId}`);
  const sp = await searchParams;
  const people = await staffList();
  const names = new Map(people.map((p) => [p.id, p.name]));
  const projects = await db.select().from(schema.taskProjects).orderBy(desc(schema.taskProjects.id));
  const subs = await db.select().from(schema.tasks).where(eq(schema.tasks.parentId, t.id)).orderBy(asc(schema.tasks.dueDate), asc(schema.tasks.id));
  const taskIds = [t.id, ...subs.map((s) => s.id)];
  const logs = (await db.select().from(schema.timeLogs).orderBy(desc(schema.timeLogs.startedAt))).filter((l) => taskIds.includes(l.taskId));
  const visibleLogs = staff.role === "owner" ? logs : logs.filter((l) => l.userId === staff.userId);
  const myRunning = logs.find((l) => l.taskId === t.id && !l.endedAt && l.minutes === null && l.userId === staff.userId);
  const history = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.entityType, "task"), eq(schema.auditLog.entityId, String(t.id)))).orderBy(desc(schema.auditLog.createdAt));
  const users = new Map((await db.select({ id: schema.adminUsers.id, name: schema.adminUsers.name }).from(schema.adminUsers)).map((u) => [u.id, u.name]));
  const edit = staff.role !== "delivery";
  const overdue = isOverdue(t);
  const money = seesMoney(staff);
  const show = (k: string, v: unknown) => (k === "assignedTo" ? (v ? names.get(Number(v)) ?? `#${v}` : "Unassigned") : k === "status" ? STATUS_LABEL[String(v)] ?? v : k === "priority" ? PRIORITY_LABEL[String(v)] ?? v : v === null || v === "" ? "—" : String(v));
  return (
    <div className="mx-auto max-w-4xl" data-task-detail>
      <Link href="/admin/tasks" className="mb-3 inline-flex items-center gap-1 text-sm font-bold text-navy"><ArrowLeft className="h-4 w-4" aria-hidden /> All tasks</Link>
      <h1 className="mb-1 text-2xl font-black">{t.title}</h1>
      <p className={`mb-4 text-sm ${overdue ? "font-bold text-[#C83A2F]" : "text-muted"}`}>
        {STATUS_LABEL[t.status]} · {PRIORITY_LABEL[t.priority]} priority · {t.assignedTo ? names.get(t.assignedTo) : "Unassigned"}
        {t.dueDate && <> · Due <DualDate yi iso={t.dueDate} />{t.dueTime ? ` ${t.dueTime}` : ""}{overdue ? " · overdue" : ""}</>}
      </p>
      {sp.msg && <p className="mb-4 rounded-xl bg-[#E3F8EF] px-4 py-3 text-sm font-semibold text-[#13895C]" role="status">{sp.msg}</p>}
      {sp.err && <p className="mb-4 rounded-xl bg-[#FFE6E4] px-4 py-3 text-sm font-semibold text-[#C83A2F]" role="alert">{sp.err}</p>}

      <section className="card mb-5 p-5">
        <form action={updateTaskAction} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="id" value={t.id} />
          {edit && <label className="block text-sm sm:col-span-2"><span className="mb-1 block font-semibold text-muted">Title</span><input name="title" defaultValue={t.title} required className="input" /></label>}
          <label className="block text-sm"><span className="mb-1 block font-semibold text-muted">Status</span>
            <select name="status" defaultValue={t.status} className="input"><option value="todo">To do</option><option value="in_progress">In progress</option><option value="done">Done</option></select>
          </label>
          {edit && (
            <>
              <label className="block text-sm"><span className="mb-1 block font-semibold text-muted">Priority</span>
                <select name="priority" defaultValue={t.priority} className="input"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select>
              </label>
              <label className="block text-sm"><span className="mb-1 block font-semibold text-muted">Deadline</span><input type="date" name="dueDate" defaultValue={t.dueDate ?? ""} className="input" /></label>
              <label className="block text-sm"><span className="mb-1 block font-semibold text-muted">Time</span><input type="time" name="dueTime" defaultValue={t.dueTime ?? ""} className="input" /></label>
              <label className="block text-sm"><span className="mb-1 block font-semibold text-muted">Assigned to</span>
                <select name="assignedTo" defaultValue={t.assignedTo ?? ""} className="input"><option value="">Unassigned</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              </label>
              <label className="block text-sm"><span className="mb-1 block font-semibold text-muted">Booking #</span><input name="orderId" defaultValue={t.orderId ?? ""} inputMode="numeric" className="input" /></label>
              <label className="block text-sm"><span className="mb-1 block font-semibold text-muted">Project</span>
                <select name="projectId" defaultValue={t.projectId ?? ""} className="input"><option value="">None</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              </label>
              <label className="block text-sm sm:col-span-2"><span className="mb-1 block font-semibold text-muted">Notes</span><textarea name="notes" rows={3} defaultValue={t.notes ?? ""} className="input" /></label>
            </>
          )}
          {!edit && t.notes && <p className="text-sm sm:col-span-2">{t.notes}</p>}
          {t.orderId && <p className="text-sm sm:col-span-2">Booking: <Link className="font-bold text-navy underline" href={`/admin/orders/${t.orderId}`}>#{t.orderId}</Link></p>}
          <div><button className="btn-dark">Save</button></div>
        </form>
      </section>

      <section className="card mb-5 p-5">
        <h2 className="mb-3 text-lg font-bold">Subtasks</h2>
        <ul className="mb-3 space-y-1.5">
          {subs.map((s) => {
            const late = isOverdue(s);
            return (
              <li key={s.id} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${late ? "bg-[#FFF5F4]" : ""}`} data-subtask>
                <form action={setStatusAction}>
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="back" value={`/admin/tasks/${t.id}`} />
                  <input type="hidden" name="status" value={s.status === "done" ? "todo" : "done"} />
                  <button aria-label={s.status === "done" ? `Mark "${s.title}" not done` : `Check off "${s.title}"`} className="text-navy">
                    {s.status === "done" ? <CircleCheck className="h-5 w-5 text-[#13895C]" /> : <Circle className="h-5 w-5" />}
                  </button>
                </form>
                <span className={`min-w-0 flex-1 ${s.status === "done" ? "line-through opacity-60" : ""}`}>{s.title}</span>
                {s.dueDate && <span className={`text-xs ${late ? "font-bold text-[#C83A2F]" : "text-muted"}`}><DualDate yi iso={s.dueDate} style="short" />{s.dueTime ? ` ${s.dueTime}` : ""}{late ? " · overdue" : ""}</span>}
              </li>
            );
          })}
          {subs.length === 0 && <li className="text-sm text-muted">No subtasks.</li>}
        </ul>
        <form action={addSubtaskAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="parentId" value={t.id} />
          <label className="block min-w-[200px] flex-1 text-sm"><span className="mb-1 block font-semibold text-muted">New subtask</span><input name="title" required className="input" /></label>
          <label className="block text-sm"><span className="mb-1 block font-semibold text-muted">Deadline</span><input type="date" name="dueDate" className="input" /></label>
          <label className="block text-sm"><span className="mb-1 block font-semibold text-muted">Time</span><input type="time" name="dueTime" className="input" /></label>
          <button className="btn-dark">Add</button>
        </form>
      </section>

      <section className="card mb-5 p-5">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><Timer className="h-5 w-5 text-navy" aria-hidden /> Time</h2>
        <div className="mb-4 flex flex-wrap items-end gap-4">
          {myRunning ? (
            <form action={stopTimerAction}><input type="hidden" name="logId" value={myRunning.id} /><button className="btn-dark inline-flex items-center gap-2"><Square className="h-4 w-4" aria-hidden /> Stop timer</button></form>
          ) : (
            <form action={startTimerAction}><input type="hidden" name="taskId" value={t.id} /><button className="btn-dark inline-flex items-center gap-2"><Play className="h-4 w-4" aria-hidden /> Start timer</button></form>
          )}
          <form action={logHoursAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="taskId" value={t.id} />
            <label className="block text-sm"><span className="mb-1 block font-semibold text-muted">Or enter hours</span><input name="hours" inputMode="decimal" placeholder="1.5" className="input w-24" /></label>
            <label className="block text-sm"><span className="mb-1 block font-semibold text-muted">Day</span><input type="date" name="date" className="input" /></label>
            {staff.role === "owner" && (
              <label className="block text-sm"><span className="mb-1 block font-semibold text-muted">For</span>
                <select name="userId" className="input" defaultValue=""><option value="">Me</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              </label>
            )}
            <label className="block text-sm"><span className="mb-1 block font-semibold text-muted">Note</span><input name="note" className="input" /></label>
            <button className="btn-dark">Log</button>
          </form>
        </div>
        <ul className="divide-y divide-line text-sm">
          {visibleLogs.map((l) => (
            <li key={l.id} className="flex flex-wrap gap-x-4 py-1.5">
              <span>{l.userId ? names.get(l.userId) ?? "Staff" : "Owner"}</span>
              <span className="text-muted">{l.endedAt === null && l.minutes !== null ? <DualDate yi iso={l.startedAt.toISOString().slice(0, 10)} style="short" /> : <DualDate at={l.startedAt} />}</span>
              <span className="font-semibold">{l.endedAt || l.minutes !== null ? `${(minutesOf(l) / 60).toFixed(2)} h` : "running"}</span>
              {money && <span>{formatMoney(laborCents(l))}</span>}
              {l.note && <span className="text-muted">{l.note}</span>}
            </li>
          ))}
          {visibleLogs.length === 0 && <li className="py-1.5 text-muted">No time logged.</li>}
        </ul>
      </section>

      <section className="card p-5">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><History className="h-5 w-5 text-navy" aria-hidden /> History</h2>
        <ol className="space-y-1.5 text-sm" data-task-history>
          {history.map((h) => {
            const after = (h.after ?? {}) as Record<string, unknown>;
            const before = (h.before ?? {}) as Record<string, unknown>;
            const what = h.action.replace("task.", "");
            const detail =
              what === "updated"
                ? Object.keys(after).map((k) => `${FIELD_LABEL[k] ?? k}: ${show(k, before[k])} → ${show(k, after[k])}`).join("; ")
                : what === "created" ? "Created" : what === "subtask_added" ? `Added subtask "${after.subtask}"` : what === "subtask_status" ? `Subtask "${after.subtask}": ${show("status", after.status)}` : what === "time_logged" ? `Logged ${after.hours} h` : what === "timer_started" ? "Started the timer" : what === "timer_stopped" ? `Stopped the timer (${after.minutes} min)` : what;
            return (
              <li key={h.id} className="flex flex-wrap gap-x-3">
                <span className="text-muted"><DualDate at={h.createdAt} /></span>
                <span className="font-semibold">{h.userId ? users.get(h.userId) ?? "Staff" : "Owner"}</span>
                <span>{detail}</span>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
