import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { todayISO } from "@/lib/dates";
import type { Role } from "@/lib/db/schema";

/**
 * Task Manager (Abraham CC, DD). No texts are sent for tasks (on-screen badge only). Every change is in the audit log.
 *  Owner:     everything, including hourly rates, labor cost and project profitability.
 *  Secretary: creates tasks, sees and updates all tasks (no rates or costs).
 *  Delivery:  sees and updates only tasks assigned to them (status, subtasks, time); can't create or reassign.
 */

export type Staff = { role: Role; userId: number | null; name?: string };
export type Task = typeof schema.tasks.$inferSelect;

export const PRIORITIES = ["low", "normal", "high"] as const;
export const STATUSES = ["todo", "in_progress", "done"] as const;
export const STATUS_LABEL: Record<string, string> = { todo: "To do", in_progress: "In progress", done: "Done" };
export const PRIORITY_LABEL: Record<string, string> = { low: "Low", normal: "Normal", high: "High" };

export class TaskError extends Error {}

export const canCreate = (s: Staff) => s.role === "owner" || s.role === "secretary";
export const seesMoney = (s: Staff) => s.role === "owner";

/** Can this person see / update this task? (A subtask follows its parent's assignment.) */
export async function canAccess(s: Staff, t: Task): Promise<boolean> {
  if (s.role === "owner" || s.role === "secretary") return true;
  const root = t.parentId ? (await db.select().from(schema.tasks).where(eq(schema.tasks.id, t.parentId)))[0] ?? t : t;
  return !!s.userId && (root.assignedTo === s.userId || t.assignedTo === s.userId);
}

export async function getTask(id: number) {
  const [t] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id));
  return t ?? null;
}

/** Top-level tasks this person can see. */
export async function visibleTasks(s: Staff, filter: { status?: string; mine?: boolean; projectId?: number } = {}) {
  const conds = [isNull(schema.tasks.parentId)];
  if (s.role === "delivery") conds.push(eq(schema.tasks.assignedTo, s.userId ?? -1));
  else if (filter.mine) conds.push(eq(schema.tasks.assignedTo, s.userId ?? -1));
  if (filter.status === "open") conds.push(sql`${schema.tasks.status} <> 'done'`);
  else if (filter.status && (STATUSES as readonly string[]).includes(filter.status)) conds.push(eq(schema.tasks.status, filter.status));
  if (filter.projectId) conds.push(eq(schema.tasks.projectId, filter.projectId));
  return db
    .select()
    .from(schema.tasks)
    .where(and(...conds))
    .orderBy(sql`${schema.tasks.status} = 'done'`, sql`${schema.tasks.dueDate} NULLS LAST`, sql`CASE ${schema.tasks.priority} WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END`, asc(schema.tasks.id));
}

export const isOverdue = (t: Pick<Task, "dueDate" | "status">, today = todayISO()) => t.status !== "done" && !!t.dueDate && t.dueDate < today;

/** "My tasks": open tasks assigned to me (Owner without an account: unassigned tasks too). */
export async function myOpenTasks(s: Staff) {
  const mine = s.userId ? eq(schema.tasks.assignedTo, s.userId) : isNull(schema.tasks.assignedTo);
  return db
    .select()
    .from(schema.tasks)
    .where(and(mine, isNull(schema.tasks.parentId), sql`${schema.tasks.status} <> 'done'`))
    .orderBy(sql`${schema.tasks.dueDate} NULLS LAST`, asc(schema.tasks.id));
}

/** Sidebar badge: my open tasks and how many are overdue. */
export async function myTaskBadge(s: Staff) {
  try {
    const t = await myOpenTasks(s);
    return { open: t.length, overdue: t.filter((x) => isOverdue(x)).length };
  } catch {
    return { open: 0, overdue: 0 };
  }
}

export const minutesOf = (l: typeof schema.timeLogs.$inferSelect, now = new Date()) =>
  l.minutes ?? Math.max(0, Math.round(((l.endedAt ?? now).getTime() - l.startedAt.getTime()) / 60_000));
export const laborCents = (l: typeof schema.timeLogs.$inferSelect, now = new Date()) => Math.round((minutesOf(l, now) * l.rateCents) / 60);

export async function rateFor(userId: number | null) {
  if (!userId) return 0;
  const [r] = await db.select().from(schema.staffRates).where(eq(schema.staffRates.userId, userId));
  return r?.hourlyCents ?? 0;
}

/** All task ids of a project, including subtasks. */
async function projectTaskIds(projectId: number) {
  const top = await db.select({ id: schema.tasks.id }).from(schema.tasks).where(eq(schema.tasks.projectId, projectId));
  const ids = top.map((t) => t.id);
  if (!ids.length) return [];
  const subs = await db.select({ id: schema.tasks.id }).from(schema.tasks).where(inArray(schema.tasks.parentId, ids));
  return [...ids, ...subs.map((s) => s.id)];
}

/**
 * Project profitability (Owner only): income from the linked bookings (paid, before sales tax, from the books),
 * minus expenses entered for the project, minus labor (hours x the rate at the time).
 */
export async function projectProfit(p: typeof schema.taskProjects.$inferSelect) {
  const orderIds = p.orderIds ?? [];
  const tasks = await projectTaskIds(p.id);
  const income = orderIds.length
    ? Number(
        (
          await db.execute(
            sql`SELECT coalesce(sum(CASE WHEN kind = 'refund' THEN -(amount_cents - tax_cents) ELSE amount_cents - tax_cents END), 0)::int AS n FROM book_entries WHERE order_id IN (${sql.join(orderIds.map((i) => sql`${i}`), sql`, `)}) AND kind IN ('income', 'deposit', 'cancellation_fee', 'refund')`,
          )
        ).rows[0]?.n ?? 0,
      )
    : 0;
  const expenses = Number(
    (await db.execute(sql`SELECT coalesce(sum(amount_cents), 0)::int AS n FROM book_entries WHERE project_id = ${p.id} AND kind IN ('expense', 'processor_fee', 'contractor')`)).rows[0]?.n ?? 0,
  );
  const logs = tasks.length ? await db.select().from(schema.timeLogs).where(inArray(schema.timeLogs.taskId, tasks)) : [];
  const minutes = logs.reduce((s, l) => s + minutesOf(l), 0);
  const labor = logs.reduce((s, l) => s + laborCents(l), 0);
  return { incomeCents: income, expensesCents: expenses, laborCents: labor, minutes, profitCents: income - expenses - labor, taskCount: tasks.length };
}

export async function taskAudit(userId: number | null, taskId: number | string, action: string, after: Record<string, unknown>, before?: Record<string, unknown>) {
  await db.insert(schema.auditLog).values({ userId, action: `task.${action}`, entityType: "task", entityId: String(taskId), after, before: before ?? null });
}

/** Staff list for assigning (active accounts). */
export async function staffList() {
  return db.select({ id: schema.adminUsers.id, name: schema.adminUsers.name, role: schema.adminUsers.role }).from(schema.adminUsers).where(eq(schema.adminUsers.active, true)).orderBy(asc(schema.adminUsers.name));
}
