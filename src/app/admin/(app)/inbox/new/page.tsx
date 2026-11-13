import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { repliesActive } from "@/lib/inbox";
import ReplyForm from "../[id]/ReplyForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "New email · Hup Up Attractions" };

/** New email from info@hupupattractions.com (Abraham, Nov 13, 2026). Owner only. */
export default async function NewEmailPage() {
  await requireOwner();
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/admin/inbox" className="text-sm font-bold text-navy underline-offset-2 hover:underline">← Inbox</Link>
      <h1 className="mt-2 text-2xl font-black sm:text-3xl">New email</h1>
      <ReplyForm active={repliesActive()} />
    </div>
  );
}
