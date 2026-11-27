/** Phone audit 22 (Nov 24, 2026): the waits (in seconds) in a PhonePay digits string, in order. Each "w" is half a
 * second; a run of w letters is one wait. Used only to describe the saved setting on the Sola PhonePay page. */
export function digitWaits(digits: string): number[] {
  return (digits.match(/w+/g) ?? []).map((run) => run.length / 2);
}
