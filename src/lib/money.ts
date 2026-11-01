export function formatMoney(cents: number, opts: { cents?: boolean } = {}): string {
  const showCents = opts.cents ?? cents % 100 !== 0;
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  });
}

/** Phone-friendly: "230 dollars" / "230 dollars and 50 cents" */
export function spokenMoney(cents: number): string {
  const dollars = Math.floor(cents / 100);
  const c = cents % 100;
  return c ? `${dollars} dollars and ${c} cents` : `${dollars} dollars`;
}

export function parseMoneyToCents(input: string): number | null {
  const n = Number(String(input).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
