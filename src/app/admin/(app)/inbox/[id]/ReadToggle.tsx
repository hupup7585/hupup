"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setReadAction } from "../actions";

/** Opening an email marks it read; this puts it back to unread. */
export default function ReadToggle({ id }: { id: number }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      className="btn-ghost !py-1.5 text-sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await setReadAction(id, false);
          router.push("/admin/inbox");
        })
      }
    >
      Mark unread
    </button>
  );
}
