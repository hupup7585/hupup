import Link from "next/link";
import { AlertTriangle, ListChecks } from "lucide-react";
import type { schema } from "@/lib/db";
import { isOverdue, myOpenTasks, type Staff } from "@/lib/tasks";
import DualDate from "@/components/DualDate";

/** "My tasks" on each staff dashboard (Abraham CC): my open tasks, overdue ones highlighted first. */
export default async function MyTasksCard({ staff }: { staff: Staff }) {
  let tasks: (typeof schema.tasks.$inferSelect)[] = [];
  try {
    tasks = await myOpenTasks(staff);
  } catch {
    tasks = [];
  }
  const overdue = tasks.filter((t) => isOverdue(t));
  const list = [...overdue, ...tasks.filter((t) => !isOverdue(t))].slice(0, 6);
  return (
    <section className="card mb-5 p-5" data-my-tasks>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <ListChecks className="h-5 w-5 text-navy" aria-hidden /> My tasks
          {overdue.length > 0 && <span className="rounded-full bg-[#C83A2F] px-2 py-0.5 text-xs font-bold text-white">{overdue.length} overdue</span>}
        </h2>
        <Link href="/admin/tasks" className="text-sm font-bold text-navy underline-offset-2 hover:underline">All tasks →</Link>
      </div>
      <ul className="space-y-1.5">
        {list.map((t) => {
          const late = isOverdue(t);
          return (
            <li key={t.id} className={`flex min-w-0 flex-wrap items-center gap-x-3 rounded-lg px-2 py-1.5 text-sm ${late ? "bg-[#FFF5F4]" : ""}`}>
              {late && <AlertTriangle className="h-4 w-4 shrink-0 text-[#C83A2F]" aria-label="Overdue" />}
              <Link href={`/admin/tasks/${t.id}`} className="min-w-0 flex-1 truncate font-semibold text-navy hover:underline">{t.title}</Link>
              {t.dueDate && <span className={`text-xs ${late ? "font-bold text-[#C83A2F]" : "text-muted"}`}><DualDate yi iso={t.dueDate} style="short" /></span>}
            </li>
          );
        })}
        {list.length === 0 && <li className="text-sm text-muted">Nothing open. Nice work!</li>}
      </ul>
    </section>
  );
}
