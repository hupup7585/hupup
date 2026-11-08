import { asc, desc, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { PRIORITY_LABEL, STATUS_LABEL, isOverdue, laborCents, minutesOf, projectProfit, seesMoney, visibleTasks, type Staff } from "@/lib/tasks";
import { yiddishDay } from "@/lib/yiddish-day";
import type { Sheet } from "@/lib/xlsx";

/** Task Manager exports (Abraham DD): tasks, time logs, project profitability. Rates and costs only for the Owner. */
export const TASK_REPORTS = ["tasks", "time", "projects"] as const;
export type TaskReport = (typeof TASK_REPORTS)[number];
export const TASK_REPORT_LABEL: Record<TaskReport, string> = { tasks: "Tasks", time: "Time logs", projects: "Project profitability" };

export async function buildTaskReport(report: TaskReport, staff: Staff): Promise<Sheet[]> {
  const names = new Map((await db.select({ id: schema.adminUsers.id, name: schema.adminUsers.name }).from(schema.adminUsers)).map((u) => [u.id, u.name]));
  const who = (id: number | null) => (id ? names.get(id) ?? `#${id}` : "Owner");
  const money = seesMoney(staff);
  if (report === "tasks") {
    const top = await visibleTasks(staff, { status: "all" });
    const subs = top.length ? await db.select().from(schema.tasks).where(inArray(schema.tasks.parentId, top.map((t) => t.id))).orderBy(asc(schema.tasks.id)) : [];
    const rows = top.flatMap((t) => [t, ...subs.filter((s) => s.parentId === t.id)]);
    return [
      {
        name: "Tasks",
        header: ["#", "Subtask of", "Title", "Deadline", "Yiddish day", "Time", "Status", "Overdue", "Priority", "Assigned to", "Booking", "Project", "Notes"],
        rows: rows.map((t) => [t.id, t.parentId, t.title, t.dueDate, t.dueDate ? yiddishDay(t.dueDate) : "", t.dueTime, STATUS_LABEL[t.status], isOverdue(t) ? "yes" : "", PRIORITY_LABEL[t.priority], t.assignedTo ? who(t.assignedTo) : "Unassigned", t.orderId, t.projectId, t.notes]),
      },
    ];
  }
  if (report === "time") {
    const logs = (await db.select().from(schema.timeLogs).orderBy(desc(schema.timeLogs.startedAt))).filter((l) => money || l.userId === staff.userId);
    const titles = new Map(logs.length ? (await db.select({ id: schema.tasks.id, title: schema.tasks.title }).from(schema.tasks).where(inArray(schema.tasks.id, [...new Set(logs.map((l) => l.taskId))]))).map((t) => [t.id, t.title]) : []);
    return [
      {
        name: "Time logs",
        header: ["Date", "Person", "Task", "Hours", ...(money ? ["Rate", "Labor cost"] : []), "Note"],
        rows: logs.map((l) => [l.startedAt.toISOString().slice(0, 10), who(l.userId), titles.get(l.taskId) ?? `#${l.taskId}`, Math.round((minutesOf(l) / 60) * 100) / 100, ...(money ? [l.rateCents / 100, laborCents(l) / 100] : []), l.note]),
      },
    ];
  }
  if (!money) return [{ name: "Projects", header: ["Not allowed"], rows: [] }];
  const projects = await db.select().from(schema.taskProjects).orderBy(desc(schema.taskProjects.id));
  const rows = await Promise.all(projects.map(async (p) => ({ p, r: await projectProfit(p) })));
  return [
    {
      name: "Project profitability",
      header: ["Project", "Status", "Bookings", "Tasks", "Income", "Expenses", "Labor hours", "Labor cost", "Profit"],
      rows: rows.map(({ p, r }) => [p.name, p.status, p.orderIds.join(" "), r.taskCount, r.incomeCents / 100, r.expensesCents / 100, Math.round((r.minutes / 60) * 100) / 100, r.laborCents / 100, r.profitCents / 100]),
    },
  ];
}
