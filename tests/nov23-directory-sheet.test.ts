import { beforeAll, describe, expect, it, vi } from "vitest";
import { inflateRawSync } from "node:zlib";

/* The Directory list as a sheet (Abraham, Nov 23, 2026). In-memory database. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { parseDirectoryCsv } from "@/lib/directory-list";
import { loadDirectory, lookupByPhone } from "@/lib/directory";
import { deleteRow, insertRow, restoreRow, saveCells, sheetRows, sheetTable, toCsv, toXlsx, SHEET_COLUMNS } from "@/lib/directory-sheet";
import { isSharedNumber } from "@/lib/shared-phones";

const FILE = [
  "Yiddish last name,Yiddish first name,last name,first name,house number,street,unit,town/state/zip,phone,area as printed",
  "שווארץ,אברהם,Schwartz,Abraham,10,D A WIEDER BLVD,,\"Monroe, NY 10950\",845-555-0101,Kiryas Joel",
  "קליין,שרה,Klein,Sara,12,FOREST RD,001A,\"Monroe, NY 10950\",555-0102,",
  "Weiss,Yossi,Weiss,Yossi,7,BAKERTOWN RD,,\"Monroe, NY 10950\",,",
].join("\n");

/** Reads one file out of a .xlsx (zip) without any package. */
function unzipEntry(buf: Buffer, name: string): string | null {
  for (let o = 0; o + 30 < buf.length; ) {
    if (buf.readUInt32LE(o) !== 0x04034b50) break;
    const method = buf.readUInt16LE(o + 8);
    const size = buf.readUInt32LE(o + 18);
    const nameLen = buf.readUInt16LE(o + 26);
    const extra = buf.readUInt16LE(o + 28);
    const n = buf.subarray(o + 30, o + 30 + nameLen).toString();
    const start = o + 30 + nameLen + extra;
    const data = buf.subarray(start, start + size);
    if (n === name) return (method === 8 ? inflateRawSync(data) : data).toString("utf8");
    o = start + size;
  }
  return null;
}

beforeAll(async () => {
  const { rows } = parseDirectoryCsv(FILE);
  await loadDirectory(rows);
});

describe("Load this list with the two Yiddish columns first", () => {
  it("keeps the Hebrew names and every other column as before; the old 8-column layout still loads", async () => {
    const r = parseDirectoryCsv(FILE);
    expect(r.issues).toEqual([]);
    expect(r.rows[0]).toMatchObject({ yiddishLastName: "שווארץ", yiddishFirstName: "אברהם", lastName: "Schwartz", firstName: "Abraham", house: "10", street: "D A WIEDER BLVD", town: "Monroe", zip: "10950", phone: "+18455550101", areaPrinted: "Kiryas Joel" });
    expect(r.rows[1]).toMatchObject({ unit: "001A", phone: "+18455550102" });
    const old = parseDirectoryCsv('last name,first name,house number,street,unit,town/state/zip,phone,area as printed\nKlein,Sara,12,FOREST RD,,"Monroe, NY 10950",8455550102,');
    expect(old.rows[0]).toMatchObject({ yiddishLastName: "", lastName: "Klein", phone: "+18455550102" });
    const rows = await sheetRows();
    expect(rows.map((x) => x.lastName)).toEqual(["Schwartz", "Klein", "Weiss"]); // the file's order
    expect(rows[0]).toMatchObject({ yiddishLastName: "שווארץ", place: "Monroe, NY 10950", phone: "(845) 555-0101" });
    expect(SHEET_COLUMNS.map((c) => c.label)).toEqual(["Yiddish last name", "Yiddish first name", "Last name", "First name", "House number", "Street", "Unit", "Town, state and zip", "Phone", "Area as printed"]);
  });
});

describe("the sheet", () => {
  it("edit a cell (a family moves): saved, and the phone lookup uses it right away", async () => {
    const [abraham] = await sheetRows();
    const r = await saveCells(abraham.id, { house: "14", street: "FOREST RD", place: "Monroe, NY 10950" }, { allowShared: false });
    expect(r.ok).toBe(true);
    expect((await lookupByPhone("+18455550101"))[0]).toMatchObject({ house: "14", street: "FOREST RD" });
    // a new phone number is found right away
    expect((await saveCells(abraham.id, { phone: "845 555 0199" }, { allowShared: false })).ok).toBe(true);
    expect((await lookupByPhone("+18455550199"))[0].lastName).toBe("Schwartz");
    // Yiddish letters saved as typed
    expect((await saveCells(abraham.id, { yiddishFirstName: "אברהם יצחק" }, { allowShared: false })).ok).toBe(true);
    expect((await sheetRows())[0].yiddishFirstName).toBe("אברהם יצחק");
  });

  it("a bad value is not saved and says why (the sheet puts the old value back)", async () => {
    const [abraham] = await sheetRows();
    expect(await saveCells(abraham.id, { phone: "555" }, { allowShared: false })).toEqual({ ok: false, error: "The phone number must be 10 digits (or 7, for 845)." });
    expect(await saveCells(abraham.id, { place: "Monroe" }, { allowShared: false })).toEqual({ ok: false, error: 'Write the town, state and zip like "Monroe, NY 10950".' });
    expect((await sheetRows())[0].phone).toBe("(845) 555-0199");
  });

  it("a phone number already in the directory: a warning first; saved anyway it becomes a shared number", async () => {
    const rows = await sheetRows();
    const weiss = rows.find((x) => x.lastName === "Weiss")!;
    const r = await saveCells(weiss.id, { phone: "8455550102" }, { allowShared: false });
    expect(r).toEqual({ ok: false, sharedWith: ["Klein, Sara (12 FOREST RD, unit 001A, Monroe)"] });
    expect(await isSharedNumber("+18455550102")).toBe(false);
    expect((await saveCells(weiss.id, { phone: "8455550102" }, { allowShared: true })).ok).toBe(true);
    expect(await isSharedNumber("+18455550102")).toBe(true);
    // undo the test change
    expect((await saveCells(weiss.id, { phone: "" }, { allowShared: false })).ok).toBe(true);
    expect(await isSharedNumber("+18455550102")).toBe(false);
  });

  it("insert a row above and below, add one at the end, delete and undo: the order holds", async () => {
    const rows = await sheetRows();
    const klein = rows.find((x) => x.lastName === "Klein")!;
    const above = await insertRow({ at: "above", id: klein.id });
    const below = await insertRow({ at: "below", id: klein.id });
    const end = await insertRow({ at: "end" });
    expect((await sheetRows()).map((x) => x.id)).toEqual([rows[0].id, above.id, klein.id, below.id, rows[2].id, end.id]);
    const gone = await deleteRow(klein.id);
    expect(gone?.lastName).toBe("Klein");
    expect((await sheetRows()).some((x) => x.id === klein.id)).toBe(false);
    expect(await lookupByPhone("+18455550102")).toHaveLength(0);
    await restoreRow(JSON.parse(JSON.stringify(gone)));
    expect((await sheetRows()).map((x) => x.id)).toEqual([rows[0].id, above.id, klein.id, below.id, rows[2].id, end.id]); // back in its place
    expect((await lookupByPhone("+18455550102"))[0].firstName).toBe("Sara");
    // undo the test rows
    for (const id of [above.id, below.id, end.id]) await deleteRow(id);
    expect((await sheetRows()).length).toBe(3);
  });

  it("Download: CSV and Excel with all ten columns, the Yiddish letters kept", async () => {
    const t = await sheetTable();
    const csv = toCsv(t);
    expect(csv.startsWith("﻿Yiddish last name,Yiddish first name,Last name,First name,House number,Street,Unit,Town, state and zip".replace("Town, state and zip", '"Town, state and zip"'))).toBe(true);
    expect(csv).toContain("שווארץ,אברהם יצחק,Schwartz,Abraham,14,FOREST RD,,\"Monroe, NY 10950\",(845) 555-0199,Kiryas Joel");
    const x = toXlsx(t);
    expect(x.subarray(0, 2).toString()).toBe("PK");
    const sheetXml = unzipEntry(x, "xl/worksheets/sheet1.xml") ?? "";
    expect(sheetXml).toContain("שווארץ");
    expect(sheetXml).toContain("Yiddish last name");
    expect(sheetXml).toContain("Area as printed");
  });
});
