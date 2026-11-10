"use client";

import type { ReactNode } from "react";

/**
 * A submit button that asks "Are you sure?" first (Abraham, Admin cleanup: confirmations on risky buttons).
 * Works inside any form, including server-action forms. Cancel leaves everything as it was.
 */
export default function ConfirmSubmit({ message, className, disabled, title, children }: { message: string; className?: string; disabled?: boolean; title?: string; children: ReactNode }) {
  return (
    <button
      type="submit"
      data-confirm={message}
      className={className}
      disabled={disabled}
      title={title}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
