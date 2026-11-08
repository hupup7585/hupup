"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { PRIORITIES, STATUSES, TaskError, canAccess, canCreate, getTask, rateFor, seesMoney, taskAudit, type Staff } from "@/lib/tasks";
import { assertNoCardNumber } from "@/lib/books";

/** Task Manager actions (Abraham CC, DD). Every change is written to the audit log (the task's history). */

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string) => (s(f, k) ? Number(s(f, k)) : null);
const iso = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const time = (v: string) => (/^\d{2}:\d{2}$/.test(v) ? v : null);

async function run(back: string, fn: (staff: Staff) => Promise<string | { msg: string; to: string }>) {
  const staff = await requireStaff(["owner", "secretary", "delivery"]);
  let out: string | { msg: string; to: string };
  try {
    out = await fn(staff);
  } catch (e) {
    const m = e instanceof TaskError ? e.message : e instanceof Error && /card number/.test(e.message) ? e.message : "Something went wrong. Nothing was saved.";
    if (!(e instanceof TaskError)) console.error("task action failed", e);
    redirect(`${back}${back.includes("?") ? "&" : "?"}err=${encodeURIComponent(m)}`);
  }
  revalidatePath("/admin/tasks", "layout");
  const to = typeof out === "string" ? back : out.to;
  const msg = typeof out === "string" ? out : out.msg;
  redirect(`${to}${to.includes("?") ? "&" : "?"}msg=${encodeURIComponent(msg)}`);
}

async function assignee(f: FormData) {
  const id = num(f, "assignedTo");
  if (!id) return null;
  const [u] = await db.select().from(schema.adminUsers).where(and(eq(schema.adminUsers.id, id), eq(schema.adminUsers.active, true)));
  if (!u) throw new TaskError("Choose an active staff member.");
  return id;
}

function fields(f: FormData) {
  const title = s(f, "title");
  if (!title || title.length > 200) throw new TaskError("Enter a title (up to 200 characters).");
  const priority = s(f, "priority") || "normal";
  if (!(PRIORITIES as readonly string[]).includes(priority)) throw new TaskError("Choose a priority.");
  const status = s(f, "status") || "todo";
  if (!(STATUSES as readonly string[]).includes(status)) throw new TaskError("Choose a status.");
  assertNoCardNumber(title, s(f, "notes"));
  return { title, notes: s(f, "notes") || null, dueDate: iso(s(f, "dueDate")), dueTime: time(s(f, "dueTime")), priority, status, orderId: num(f, "orderId"), projectId: num(f, "projectId") };
}

export async function createTaskAction(f: FormData) {
  return run(s(f, "back") || "/admin/tasks", async (staff) => {
    if (!canCreate(staff)) throw new TaskError("Your account can't create tasks.");
    const v = fields(f);
    const [t] = await db.insert(schema.tasks).values({ ...v, assignedTo: await assignee(f), createdBy: staff.userId, doneAt: v.status === "done" ? new Date() : null }).returning();
    await taskAudit(staff.userId, t.id, "created", { ...v, assignedTo: t.assignedTo });
    return { msg: "Task added.", to: `/admin/tasks/${t.id}` };
  });
}

export async function updateTaskAction(f: FormData) {
  const id = Number(s(f, "id"));
  return run(`/admin/tasks/${id}`, async (staff) => {
    const t = await getTask(id);
    if (!t || !(await canAccess(staff, t))) throw new TaskError("You can't change this task.");
    let patch: Partial<typeof schema.tasks.$inferInsert>;
    if (staff.role === "delivery") {
      // Delivery: status only (plus subtasks and time, separately)
      const status = s(f, "status");
      if (!(STATUSES as readonly string[]).includes(status)) throw new TaskError("Choose a status.");
      patch = { status };
    } else {
      patch = { ...fields(f), assignedTo: await assignee(f) };
    }
    patch.updatedAt = new Date();
    if (patch.status) patch.doneAt = patch.status === "done" ? (t.doneAt ?? new Date()) : null;
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, (t as Record<string, unknown>)[k]]));
    const changed = Object.fromEntries(Object.entries(patch).filter(([k, v]) => k !== "updatedAt" && k !== "doneAt" && String(v ?? "") !== String(before[k] ?? "")));
    await db.update(schema.tasks).set(patch).where(eq(schema.tasks.id, id));
    if (Object.keys(changed).length) await taskAudit(staff.userId, id, "updated", changed, Object.fromEntries(Object.keys(changed).map((k) => [k, before[k]])));
    return "Saved.";
  });
}

/** Quick status change (list checkboxes, subtask checkboxes). */
export async function setStatusAction(f: FormData) {
  const id = Number(s(f, "id"));
  return run(s(f, "back") || `/admin/tasks/${id}`, async (staff) => {
    const t = await getTask(id);
    if (!t || !(await canAccess(staff, t))) throw new TaskError("You can't change this task.");
    const status = s(f, "status");
    if (!(STATUSES as readonly string[]).includes(status)) throw new TaskError("Choose a status.");
    await db.update(schema.tasks).set({ status, updatedAt: new Date(), doneAt: status === "done" ? new Date() : null }).where(eq(schema.tasks.id, id));
    await taskAudit(staff.userId, t.parentId ?? id, t.parentId ? "subtask_status" : "updated", { status, ...(t.parentId ? { subtask: t.title } : {}) }, { status: t.status });
    return status === "done" ? "Checked off." : "Updated.";
  });
}

export async function addSubtaskAction(f: FormData) {
  const parentId = Number(s(f, "parentId"));
  return run(`/admin/tasks/${parentId}`, async (staff) => {
    const p = await getTask(parentId);
    if (!p || p.parentId || !(await canAccess(staff, p))) throw new TaskError("You can't add to this task.");
    const title = s(f, "title");
    if (!title || title.length > 200) throw new TaskError("Enter the subtask.");
    assertNoCardNumber(title);
    const [t] = await db.insert(schema.tasks).values({ title, parentId, dueDate: iso(s(f, "dueDate")), dueTime: time(s(f, "dueTime")), assignedTo: p.assignedTo, projectId: p.projectId, createdBy: staff.userId }).returning();
    await taskAudit(staff.userId, parentId, "subtask_added", { subtask: title, dueDate: t.dueDate });
    return "Subtask added.";
  });
}

/* ---- time ---- */

export async function startTimerAction(f: FormData) {
  const taskId = Number(s(f, "taskId"));
  return run(`/admin/tasks/${taskId}`, async (staff) => {
    const t = await getTask(taskId);
    if (!t || !(await canAccess(staff, t))) throw new TaskError("You can't log time on this task.");
    const running = await db.select().from(schema.timeLogs).where(and(eq(schema.timeLogs.taskId, taskId), staff.userId ? eq(schema.timeLogs.userId, staff.userId) : isNull(schema.timeLogs.userId), isNull(schema.timeLogs.endedAt), isNull(schema.timeLogs.minutes)));
    if (running.length) throw new TaskError("Your timer is already running on this task.");
    const [l] = await db.insert(schema.timeLogs).values({ taskId, userId: staff.userId, startedAt: new Date(), rateCents: await rateFor(staff.userId) }).returning();
    await taskAudit(staff.userId, taskId, "timer_started", { log: l.id });
    return "Timer started.";
  });
}

export async function stopTimerAction(f: FormData) {
  const id = Number(s(f, "logId"));
  const [l] = await db.select().from(schema.timeLogs).where(eq(schema.timeLogs.id, id));
  return run(`/admin/tasks/${l?.taskId ?? ""}`, async (staff) => {
    if (!l || l.endedAt || l.minutes !== null) throw new TaskError("That timer isn't running.");
    if (staff.role !== "owner" && l.userId !== staff.userId) throw new TaskError("You can only stop your own timer.");
    const ended = new Date();
    const minutes = Math.max(1, Math.round((ended.getTime() - l.startedAt.getTime()) / 60_000));
    await db.update(schema.timeLogs).set({ endedAt: ended, minutes }).where(eq(schema.timeLogs.id, id));
    await taskAudit(staff.userId, l.taskId, "timer_stopped", { log: id, minutes });
    return `Logged ${minutes} minutes.`;
  });
}

export async function logHoursAction(f: FormData) {
  const taskId = Number(s(f, "taskId"));
  return run(`/admin/tasks/${taskId}`, async (staff) => {
    const t = await getTask(taskId);
    if (!t || !(await canAccess(staff, t))) throw new TaskError("You can't log time on this task.");
    const hours = Number(s(f, "hours"));
    if (!(hours > 0 && hours <= 24)) throw new TaskError("Enter the hours worked (up to 24).");
    const day = iso(s(f, "date")) ?? new Date().toISOString().slice(0, 10);
    // The Owner may log for someone else; everyone else logs their own time
    const userId = staff.role === "owner" && num(f, "userId") ? num(f, "userId") : staff.userId;
    const [l] = await db
      .insert(schema.timeLogs)
      .values({ taskId, userId, startedAt: new Date(`${day}T12:00:00Z`), minutes: Math.round(hours * 60), rateCents: await rateFor(userId), note: s(f, "note") || null })
      .returning();
    await taskAudit(staff.userId, taskId, "time_logged", { log: l.id, hours, date: day, forUser: userId });
    return `Logged ${hours} hours.`;
  });
}

/* ---- projects and rates (Owner; Secretary may create projects) ---- */

const orderList = (v: string) => [...new Set(v.split(/[\s,#]+/).filter(Boolean).map(Number).filter((n) => Number.isInteger(n) && n > 0))];

export async function saveProjectAction(f: FormData) {
  return run("/admin/tasks?view=projects", async (staff) => {
    if (!canCreate(staff)) throw new TaskError("Your account can't manage projects.");
    const name = s(f, "name");
    if (!name) throw new TaskError("Enter a project name.");
    const v = { name, notes: s(f, "notes") || null, orderIds: orderList(s(f, "orderIds")), status: s(f, "status") === "closed" ? "closed" : "open" };
    const id = num(f, "id");
    if (id) {
      await db.update(schema.taskProjects).set(v).where(eq(schema.taskProjects.id, id));
      await taskAudit(staff.userId, `project-${id}`, "project_updated", v);
      return "Project saved.";
    }
    const [p] = await db.insert(schema.taskProjects).values({ ...v, createdBy: staff.userId }).returning();
    await taskAudit(staff.userId, `project-${p.id}`, "project_created", v);
    return "Project added.";
  });
}

export async function saveRateAction(f: FormData) {
  return run("/admin/tasks?view=labor", async (staff) => {
    if (!seesMoney(staff)) throw new TaskError("Only the Owner sets hourly rates.");
    const userId = Number(s(f, "userId"));
    const dollars = Number(s(f, "rate").replace(/[$,]/g, ""));
    if (!userId || !(dollars >= 0 && dollars < 1000)) throw new TaskError("Enter an hourly rate, for example 22.50.");
    const cents = Math.round(dollars * 100);
    const [old] = await db.select().from(schema.staffRates).where(eq(schema.staffRates.userId, userId));
    await db.insert(schema.staffRates).values({ userId, hourlyCents: cents, updatedBy: staff.userId }).onConflictDoUpdate({ target: schema.staffRates.userId, set: { hourlyCents: cents, updatedBy: staff.userId, updatedAt: new Date() } });
    await db.insert(schema.auditLog).values({ userId: staff.userId, action: "task.rate_set", entityType: "staff_rate", entityId: String(userId), before: old ? { hourlyCents: old.hourlyCents } : null, after: { hourlyCents: cents } });
    return "Rate saved. New time entries use it; earlier entries keep the rate they were logged at.";
  });
}
