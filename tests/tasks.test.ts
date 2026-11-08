import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Task Manager (Abraham CC, DD). In-memory database; the signed-in staff member is switched per test. */
const h = vi.hoisted(() => ({ staff: { role: "owner", userId: null as number | null, name: "Owner", phone: "+18457777585" } as { role: "owner" | "secretary" | "delivery"; userId: number | null; name: string; phone: string } }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); }, notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({
  requireStaff: async (roles: string[]) => {
    if (!roles.includes(h.staff.role)) throw new Error("REDIRECT home");
    return h.staff;
  },
  currentStaff: async () => h.staff,
}));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import * as A from "@/app/admin/tasks/actions";
import { canAccess, getTask, isOverdue, myTaskBadge, projectProfit, visibleTasks } from "@/lib/tasks";
import { buildTaskReport } from "@/lib/tasks-reports";
import { addEntry } from "@/lib/books";

const form = (o: Record<string, string | number>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, String(v));
  return f;
};
/** Run a server action; return where it redirected (actions always redirect with msg= or err=). */
const act = async (fn: (f: FormData) => Promise<unknown>, o: Record<string, string | number>) => {
  try {
    await fn(form(o));
  } catch (e) {
    return String((e as Error).message).replace("REDIRECT ", "");
  }
  return "";
};
let sara = 0;
let dovid = 0;
const as = (role: "owner" | "secretary" | "delivery", userId: number | null) => (h.staff = { role, userId, name: role, phone: "" });

beforeAll(async () => {
  [{ id: sara }] = await db.insert(schema.adminUsers).values({ name: "Sara", phone: "+18455550101", role: "secretary", active: true }).returning();
  [{ id: dovid }] = await db.insert(schema.adminUsers).values({ name: "Dovid", phone: "+18455550102", role: "delivery", active: true }).returning();
});
beforeEach(() => as("owner", null));

describe("CC: tasks and who can do what", () => {
  it("Owner creates and assigns; title, notes, deadline, priority, status, booking link; history in the audit log", async () => {
    const to = await act(A.createTaskAction, { title: "Clean the castle bouncer", notes: "Use the mild soap", dueDate: "2026-11-01", priority: "high", assignedTo: dovid, orderId: 1001 });
    expect(to).toMatch(/^\/admin\/tasks\/\d+\?msg=Task%20added/);
    const id = Number(to.match(/tasks\/(\d+)/)![1]);
    const t = (await getTask(id))!;
    expect(t).toMatchObject({ title: "Clean the castle bouncer", priority: "high", status: "todo", assignedTo: dovid, orderId: 1001, dueDate: "2026-11-01" });
    expect(isOverdue(t, "2026-11-08")).toBe(true);
    await act(A.updateTaskAction, { id, title: "Clean the castle bouncer", status: "in_progress", priority: "normal", assignedTo: dovid, dueDate: "2026-11-01" });
    const hist = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, String(id)));
    expect(hist.map((x) => x.action)).toEqual(["task.created", "task.updated"]);
    expect(hist[1].before).toMatchObject({ status: "todo", priority: "high" });
    expect(hist[1].after).toMatchObject({ status: "in_progress", priority: "normal" });
  });

  it("Secretary creates, sees and updates all tasks", async () => {
    as("secretary", sara);
    const to = await act(A.createTaskAction, { title: "Call the school about Friday", assignedTo: sara });
    expect(to).toContain("msg=");
    const all = await visibleTasks(h.staff, { status: "all" });
    expect(all.length).toBeGreaterThanOrEqual(2);
    const other = all.find((t) => t.assignedTo === dovid)!;
    expect(await canAccess(h.staff, other)).toBe(true);
    expect(await act(A.setStatusAction, { id: other.id, status: "done" })).toContain("msg=Checked%20off");
    await act(A.setStatusAction, { id: other.id, status: "todo" });
  });

  it("Delivery sees and updates only their own tasks, and can't create, reassign or retitle", async () => {
    as("delivery", dovid);
    const mine = await visibleTasks(h.staff, { status: "all" });
    expect(mine.every((t) => t.assignedTo === dovid)).toBe(true);
    expect(mine.length).toBe(1);
    expect(await act(A.createTaskAction, { title: "x" })).toContain("err=");
    const notMine = (await db.select().from(schema.tasks).where(eq(schema.tasks.assignedTo, sara)))[0];
    expect(await canAccess(h.staff, notMine)).toBe(false);
    expect(await act(A.setStatusAction, { id: notMine.id, status: "done" })).toContain("err=");
    await act(A.updateTaskAction, { id: mine[0].id, status: "done", title: "Hacked", assignedTo: sara });
    expect(await getTask(mine[0].id)).toMatchObject({ status: "done", title: "Clean the castle bouncer", assignedTo: dovid });
  });

  it("My tasks badge counts my open tasks and overdue ones (on screen only; nothing is texted)", async () => {
    as("secretary", sara);
    await act(A.createTaskAction, { title: "Old job", dueDate: "2020-01-01", assignedTo: sara });
    const b = await myTaskBadge(h.staff);
    expect(b.open).toBe(2);
    expect(b.overdue).toBe(1);
    for (const f of ["src/app/admin/tasks/actions.ts", "src/lib/tasks.ts"]) expect(readFileSync(f, "utf8")).not.toMatch(/sendMessage|sendSms/);
    expect(readFileSync("src/components/Sidebar.tsx", "utf8")).toContain('["/admin/tasks", ListChecks, "Tasks", ALL]');
    for (const f of ["src/app/admin/(app)/page.tsx", "src/app/admin/(app)/calendar/page.tsx", "src/app/admin/deliveries/page.tsx"]) expect(readFileSync(f, "utf8")).toContain("<MyTasksCard staff={staff} />");
  });
});

describe("DD: subtasks, month view, projects, labor, exports", () => {
  it("subtasks have their own checkbox and deadline; Delivery can check off subtasks of their task", async () => {
    const [parent] = await db.select().from(schema.tasks).where(eq(schema.tasks.assignedTo, dovid));
    await act(A.addSubtaskAction, { parentId: parent.id, title: "Dry it in the sun", dueDate: "2026-11-02" });
    const [sub] = await db.select().from(schema.tasks).where(eq(schema.tasks.parentId, parent.id));
    expect(sub).toMatchObject({ title: "Dry it in the sun", dueDate: "2026-11-02", assignedTo: dovid });
    as("delivery", dovid);
    expect(await act(A.setStatusAction, { id: sub.id, status: "done" })).toContain("msg=");
    expect((await getTask(sub.id))!.status).toBe("done");
    expect(readFileSync("src/app/admin/tasks/page.tsx", "utf8")).toContain("data-task-month");
  });

  it("labor: Owner sets rates; time by timer or hours; cost = hours x rate (rate kept at the time); project profit", async () => {
    as("secretary", sara);
    expect(await act(A.saveRateAction, { userId: dovid, rate: "20" })).toContain("err="); // Owner only
    as("owner", null);
    await act(A.saveRateAction, { userId: dovid, rate: "20.00" });
    await act(A.saveProjectAction, { name: "Bais Yaakov Chanukkah party", orderIds: "1001" });
    const [p] = await db.select().from(schema.taskProjects);
    const [t] = await db.select().from(schema.tasks).where(eq(schema.tasks.assignedTo, dovid));
    await db.update(schema.tasks).set({ projectId: p.id }).where(eq(schema.tasks.id, t.id));
    as("delivery", dovid);
    await act(A.logHoursAction, { taskId: t.id, hours: "2.5", date: "2026-11-05" });
    await act(A.startTimerAction, { taskId: t.id });
    expect(await act(A.startTimerAction, { taskId: t.id })).toContain("err="); // already running
    const [running] = (await db.select().from(schema.timeLogs).where(eq(schema.timeLogs.taskId, t.id))).filter((l) => l.minutes === null);
    await db.update(schema.timeLogs).set({ startedAt: new Date(Date.now() - 30 * 60_000) }).where(eq(schema.timeLogs.id, running.id));
    await act(A.stopTimerAction, { logId: running.id });
    as("owner", null);
    await act(A.saveRateAction, { userId: dovid, rate: "30" }); // later rate doesn't change earlier entries
    // Income: the booking's paid amount (before tax) from the books; an expense tagged to the project
    const [o] = await db.insert(schema.orders).values({ id: 1001, status: "CONFIRMED", channel: "PHONE", eventDate: "2026-12-07", pickupDate: "2026-12-08" }).returning();
    await addEntry({ entryDate: "2026-11-06", kind: "income", amountCents: 54063, taxCents: 4063, method: "check", checkNo: "501", orderId: o.id }, null);
    await addEntry({ entryDate: "2026-11-06", kind: "expense", amountCents: 2000, method: "cash", projectId: p.id, category: "Supplies" }, null);
    const r = await projectProfit((await db.select().from(schema.taskProjects))[0]);
    expect(r.minutes).toBe(180); // 2.5 h + 30 min
    expect(r.laborCents).toBe(6000); // 3 h x $20
    expect(r).toMatchObject({ incomeCents: 50000, expensesCents: 2000, profitCents: 50000 - 2000 - 6000 });
  });

  it("exports: tasks, time and projects (CSV/Excel/PDF); costs only for the Owner", async () => {
    const tasks = await buildTaskReport("tasks", h.staff);
    expect(tasks[0].header).toContain("Yiddish day");
    expect(tasks[0].rows.some((r) => r[2] === "Dry it in the sun")).toBe(true);
    const time = await buildTaskReport("time", h.staff);
    expect(time[0].header).toContain("Labor cost");
    const projects = await buildTaskReport("projects", h.staff);
    expect(projects[0].rows[0]).toEqual(["Bais Yaakov Chanukkah party", "open", "1001", 2, 500, 20, 3, 60, 420]);
    as("secretary", sara);
    expect((await buildTaskReport("time", h.staff))[0].header).not.toContain("Labor cost");
    expect((await buildTaskReport("projects", h.staff))[0].rows).toEqual([]);
    const route = readFileSync("src/app/api/admin/tasks/export/route.ts", "utf8");
    expect(route).toContain('report === "projects" && s.role !== "owner"');
  });
});
