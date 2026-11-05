import { describe, expect, it } from "vitest";
import { createMemoryDb } from "./helpers/memory-db";

describe("all migrations apply cleanly (in-memory database only)", () => {
  it("0000-0009 apply and create the new tables", async () => {
    const { client } = await createMemoryDb();
    const r = await client.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public'");
    const names = r.rows.map((x) => x.table_name);
    for (const t of ["sms_consents", "messages", "terms_acceptances", "sms_reenroll_requests"]) expect(names).toContain(t);
  }, 60000);
});
