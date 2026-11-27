/** Deep check A18 (Nov 27, 2026): the page Tasks goes back to is only ever a Tasks page on this site. */
export function safeTasksBack(back: string, fallback: string): string {
  return /^\/admin\/tasks(?:[/?#][^\\]*)?$/.test(back) ? back : fallback;
}
