/** Normalize US numbers to E.164 (+1XXXXXXXXXX). Returns null if it can't. */
export function toE164(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (input.trim().startsWith("+") && digits.length >= 8) return `+${digits}`;
  return null;
}

export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const d = e164.replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (ten.length !== 10) return e164;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

export function last4(e164: string | null | undefined): string {
  return (e164 || "").replace(/\D/g, "").slice(-4);
}

/** Speak digits one by one: "8 4 5, 5 5 5, 0 1 2 3" */
export function spokenDigits(s: string): string {
  return s.replace(/\D/g, "").split("").join(" ");
}
