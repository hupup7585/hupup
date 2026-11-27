import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { csvCell } from "@/lib/csv-cell";

/* Deep check Nov 27, 2026: A16 CSV cells (tab and carriage return guarded, negative numbers stay numbers);
   A15 report and log dates are New York dates, never the UTC date. */
describe("A16: CSV cells", () => {
  it("guards formulas, tab and CR; numbers (negative too) stay numbers", () => {
    expect(csvCell("=SUM(A1)")).toBe(`"'=SUM(A1)"`);
    expect(csvCell("\t=1+1")).toBe(`"'\t=1+1"`);
    expect(csvCell("\r=1+1")).toBe(`"'\r=1+1"`);
    expect(csvCell("-12.50")).toBe(`"-12.50"`);
    expect(csvCell(-3)).toBe(`"-3"`);
    expect(csvCell("-cmd")).toBe(`"'-cmd"`);
    expect(csvCell('say "hi"')).toBe(`"say ""hi"""`);
  });
  it("every Admin CSV download uses the one guarded cell", () => {
    for (const f of ["src/app/api/admin/orders.csv/route.ts", "src/app/api/admin/export/[report]/route.ts", "src/app/api/admin/tasks/export/route.ts", "src/app/api/admin/books/export/route.ts"]) {
      const s = readFileSync(f, "utf8");
      expect(s).toContain('from "@/lib/csv-cell"');
      expect(s).not.toMatch(/\/\^\[=\+\\-@\]\//);
    }
  });
});

describe("A15: New York dates", () => {
  it("no UTC date defaults left in the reports, the books export and the time logs", () => {
    for (const f of ["src/lib/reports.ts", "src/app/api/admin/books/export/route.ts", "src/app/admin/tasks/actions.ts", "src/lib/tasks-reports.ts"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/new Date\(\)\.toISOString\(\)\.slice\(0, 10\)|startedAt\.toISOString\(\)\.slice\(0, 10\)|new Date\(\)\.getFullYear\(\)/);
    }
  });
});

describe("A18: Tasks go back only to a Tasks page", () => {
  it("other addresses fall back", async () => {
    const { safeTasksBack } = await import("@/lib/safe-back");
    expect(safeTasksBack("/admin/tasks?view=mine", "/admin/tasks")).toBe("/admin/tasks?view=mine");
    expect(safeTasksBack("/admin/tasks/12", "/x")).toBe("/admin/tasks/12");
    for (const bad of ["https://evil.example", "//evil.example", "/admin/tasks.evil", "/admin/orders", "/admin/tasks/\\evil", ""]) expect(safeTasksBack(bad, "/admin/tasks")).toBe("/admin/tasks");
  });
});
