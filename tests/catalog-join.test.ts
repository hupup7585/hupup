import { describe, expect, it, vi } from "vitest";

/* JOIN reply to the catalog text (Abraham, Nov 27, 2026, 1:52 AM). In-memory database with the real migrations. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { handleInboundSms } from "@/lib/sms-inbound";
import { SEASONAL_JOIN_CONFIRM_TEXT } from "@/lib/seasonal-confirm";
import { CATALOG_JOIN_CONFIRM_ON, CATALOG_JOIN_INVITE, CATALOG_JOIN_SOURCE } from "@/lib/catalog-join";

const gotCatalog = (to: string) => db.insert(schema.messages).values({ direction: "out", toNumber: to, contactPhone: to, body: "catalog", kind: "system", event: "catalog_reply", status: "sent" });
const text = (from: string, body: string, sid: string) => handleInboundSms({ From: from, To: "+18454157585", Body: body, MessageSid: sid });
const joins = (phone: string) => db.select().from(schema.smsConsents).where(and(eq(schema.smsConsents.phone, phone), eq(schema.smsConsents.source, CATALOG_JOIN_SOURCE)));

describe("JOIN reply to the catalog text", () => {
  it("JOIN from a new number (any case, spaces) = one opt-in record with the exact invite wording; the approved confirmation text once (Nov 27, 2026)", async () => {
    await gotCatalog("+18455550301");
    await text("+18455550301", "  join ", "SMj1");
    const rows = await joins("+18455550301");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ scope: "marketing", action: "opt_in", source: "catalog text JOIN reply", wording: CATALOG_JOIN_INVITE });
    expect(CATALOG_JOIN_INVITE).toBe("To join our seasonal offers, reply JOIN. You will never miss a deal, special, or new rentals, up to 5 messages a year.");
    const [c] = await db.select().from(schema.customers).where(eq(schema.customers.phone, "+18455550301"));
    expect(c.marketingOptIn).toBe(true);
    expect(CATALOG_JOIN_CONFIRM_ON).toBe(true);
    const out = (await db.select().from(schema.messages)).filter((m) => m.direction === "out" && m.toNumber === "+18455550301" && m.event !== "catalog_reply");
    expect(out.map((m) => m.body)).toEqual([SEASONAL_JOIN_CONFIRM_TEXT]);
  });
  it("JOIN twice = one record", async () => {
    await text("+18455550301", "JOIN", "SMj2");
    expect(await joins("+18455550301")).toHaveLength(1);
  });
  it("STOP then JOIN = no record", async () => {
    await gotCatalog("+18455550302");
    await text("+18455550302", "STOP", "SMj3");
    await text("+18455550302", "JOIN", "SMj4");
    expect(await joins("+18455550302")).toHaveLength(0);
  });
  it("STOP, then START, then JOIN = signed up", async () => {
    await gotCatalog("+18455550303");
    await text("+18455550303", "STOP", "SMj5");
    await text("+18455550303", "START", "SMj6");
    await text("+18455550303", "Join", "SMj7");
    expect(await joins("+18455550303")).toHaveLength(1);
  });
});
