import Link from "next/link";
import { AlertTriangle, Circle, CircleCheck } from "lucide-react";
import DualDate from "@/components/DualDate";
import { PRIORITY_LABEL, STATUS_LABEL, isOverdue, type Task } from "@/lib/tasks";
import { setStatusAction } from "./actions";

/** One task in a list: checkbox, title, deadline (with the Yiddish day and parsha), status, priority, assignee. */
export default function TaskLine({ t, names, back, subCount }: { t: Task; names: Map<number, string>; back: string; subCount?: [number, number] }) {
  const overdue = isOverdue(t);
  return (
    <li className={`flex min-w-0 items-start gap-3 rounded-xl border px-3 py-3 ${overdue ? "border-[#C83A2F]/40 bg-[#FFF5F4]" : "border-line bg-white"}`} data-task-row data-overdue={overdue ? "1" : undefined}>
      <form action={setStatusAction} className="pt-0.5">
        <input type="hidden" name="id" value={t.id} />
        <input type="hidden" name="back" value={back} />
        <input type="hidden" name="status" value={t.status === "done" ? "todo" : "done"} />
        <button aria-label={t.status === "done" ? `Mark "${t.title}" not done` : `Check off "${t.title}"`} className="text-navy">
          {t.status === "done" ? <CircleCheck className="h-5 w-5 text-[#13895C]" /> : <Circle className="h-5 w-5" />}
        </button>
      </form>
      <div className="min-w-0 flex-1">
        <Link href={`/admin/tasks/${t.id}`} className={`font-bold text-navy hover:underline ${t.status === "done" ? "line-through opacity-60" : ""}`}>
          {t.title}
        </Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {t.dueDate && (
            <span className={overdue ? "inline-flex items-center gap-1 font-bold text-[#C83A2F]" : ""}>
              {overdue && <AlertTriangle className="h-3.5 w-3.5" aria-hidden />}
              Due <DualDate yi iso={t.dueDate} style="short" />
              {t.dueTime ? ` ${t.dueTime}` : ""}
              {overdue ? " · overdue" : ""}
            </span>
          )}
          <span>{STATUS_LABEL[t.status]}</span>
          <span className={t.priority === "high" ? "font-bold text-[#C83A2F]" : ""}>{PRIORITY_LABEL[t.priority]} priority</span>
          <span>{t.assignedTo ? names.get(t.assignedTo) ?? "Staff" : "Unassigned"}</span>
          {t.orderId && <Link className="underline" href={`/admin/orders/${t.orderId}`}>Booking number {t.orderId}</Link>}
          {subCount && subCount[0] > 0 && <span>{subCount[1]}/{subCount[0]} subtasks done</span>}
        </div>
      </div>
    </li>
  );
}

