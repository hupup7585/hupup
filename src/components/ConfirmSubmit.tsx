"use client";

import type { ReactNode } from "react";

/**
 * A submit button that asks "Are you sure?" first (Abraham, Admin cleanup: confirmations on risky buttons).
 * Works inside any form, including server-action forms. Cancel leaves everything as it was.
 * `formAction` sends the same form to a different action (e.g. Put in Garbage inside an item's edit form).
 */
export default function ConfirmSubmit({
  message,
  className,
  disabled,
  title,
  formAction,
  children,
  ...rest
}: {
  message: string;
  className?: string;
  disabled?: boolean;
  title?: string;
  formAction?: (fd: FormData) => void | Promise<void>;
  children: ReactNode;
  "aria-label"?: string;
  "data-trash-in-form"?: boolean;
}) {
  return (
    <button
      type="submit"
      data-confirm={message}
      className={className}
      disabled={disabled}
      title={title}
      formAction={formAction}
      formNoValidate={formAction ? true : undefined}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
