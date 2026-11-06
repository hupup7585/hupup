import { describe, expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { buildXlsx, sheetName } from "@/lib/xlsx";

/** Read every file out of the zip (local headers), checking each CRC-free size field round-trips. */
function unzip(buf: Buffer) {
  const out: Record<string, string> = {};
  let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8);
    const csize = buf.readUInt32LE(i + 18);
    const usize = buf.readUInt32LE(i + 22);
    const nlen = buf.readUInt16LE(i + 26);
    const xlen = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nlen).toString("utf8");
    const data = buf.subarray(i + 30 + nlen + xlen, i + 30 + nlen + xlen + csize);
    const raw = method === 8 ? inflateRawSync(data) : data;
    expect(raw.length).toBe(usize);
    out[name] = raw.toString("utf8");
    i += 30 + nlen + xlen + csize;
  }
  expect(buf.readUInt32LE(buf.length - 22)).toBe(0x06054b50); // end of central directory
  return out;
}

describe(".xlsx export", () => {
  const file = buildXlsx([
    { name: "Bookings", header: ["Order", "Customer", "Paid ($)"], rows: [["#1001", "=HYPERLINK(\"x\")", 125.5], ["#1002", "Kiryas Joel & <Monroe>", 0]] },
    { name: "Bookings", header: ["A"], rows: [] },
  ]);
  const files = unzip(file);

  it("is a valid workbook with one tab per sheet and unique tab names", () => {
    expect(Object.keys(files)).toEqual(expect.arrayContaining(["[Content_Types].xml", "xl/workbook.xml", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]));
    expect(files["xl/workbook.xml"]).toContain('name="Bookings"');
    expect(files["xl/workbook.xml"]).toContain('name="Bookings 2"');
  });
  it("keeps numbers as numbers, escapes XML, bolds and freezes the header", () => {
    const s = files["xl/worksheets/sheet1.xml"];
    expect(s).toContain('<c r="C2"><v>125.5</v></c>');
    expect(s).toContain("Kiryas Joel &amp; &lt;Monroe&gt;");
    expect(s).toMatch(/<c r="A1" t="inlineStr" s="1">/);
    expect(s).toContain('state="frozen"');
  });
  it("never writes formulas: text that looks like one stays plain text", () => {
    const s = files["xl/worksheets/sheet1.xml"];
    expect(s).not.toContain("<f>");
    expect(s).toContain('t="inlineStr"><is><t xml:space="preserve">=HYPERLINK(&quot;x&quot;)</t>');
  });
  it("cleans sheet names Excel would reject", () => {
    expect(sheetName("Q1/Q2: [draft]?", new Set())).toBe("Q1 Q2 draft");
    expect(sheetName("x".repeat(40), new Set()).length).toBe(31);
  });
});

describe("report access", () => {
  it("money reports are Owner-only; lists staff use are Owner and Secretary; Delivery gets none", async () => {
    const { REPORTS, reportFor } = await import("@/lib/reports");
    for (const k of ["bookings", "payments", "dashboard"]) expect(REPORTS[k].roles).toEqual(["owner"]);
    for (const k of ["customers", "deliveries", "calls"]) expect(REPORTS[k].roles).toEqual(["owner", "secretary"]);
    for (const k of Object.keys(REPORTS)) expect(reportFor(k, "delivery")).toMatchObject({ status: 403 });
    expect(reportFor("nope", "owner")).toMatchObject({ status: 404 });
  });
  it("the export route checks sign-in and role; buttons are on the mock-up only until Abraham approves", async () => {
    const route = readFileSync("src/app/api/admin/export/[report]/route.ts", "utf8");
    expect(route).toContain("currentStaff()");
    expect(route).toContain("reportFor(");
    const real = ["src/app/admin/(app)/orders/page.tsx", "src/app/admin/(app)/page.tsx", "src/app/admin/(app)/calls/page.tsx", "src/app/admin/deliveries/page.tsx", "src/app/admin/(app)/customers/page.tsx"].map((f) => readFileSync(f, "utf8")).join("\n");
    expect(real).not.toContain("ExportButtons");
    const mock = readFileSync("src/app/mockups/admin-export/page.tsx", "utf8");
    for (const label of ["Bookings", "Customers", "Dashboard report", "Payments", "Call log", "Deliveries and pickups"]) expect(mock).toContain(`<Buttons label="${label}" />`);
    expect(mock).toContain("Open in Google Sheets");
  });
});
