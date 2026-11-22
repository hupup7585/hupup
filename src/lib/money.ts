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
  // Abraham, Nov 22, 2026: exactly one is "1 dollar" and "1 cent"
  const d = `${dollars} ${dollars === 1 ? "dollar" : "dollars"}`;
  return c ? `${d} and ${c} ${c === 1 ? "cent" : "cents"}` : d;
}

export function parseMoneyToCents(input: string): number | null {
  const n = Number(String(input).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
