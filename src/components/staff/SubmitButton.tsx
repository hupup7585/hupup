"use client";

import { useFormStatus } from "react-dom";

/**
 * A form's submit button that shows "Saving..." while the form is being sent, so it cannot be pressed twice (Hark's
 * review L1). It is never greyed out for any other reason.
 */
export function SubmitButton({ children, className = "btn-dark", pendingLabel = "Saving..." }: { children: React.ReactNode; className?: string; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <button className={className} disabled={pending} aria-busy={pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}
