import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createMemoryDb } from "./helpers/memory-db";

/*
 * Migration 0013: key 8 takes over the staff list key 2 had; key 2 starts with its own empty list.
 * Runs on a throwaway in-memory Postgres only.
 */
const SQL = readFileSync("drizzle/0013_menu_key8_takes_key2_list.sql", "utf8").split("--> statement-breakpoint");

async function setup() {
  const { client } = await createMemoryDb(); // every migration applied (0013 is a no-op on an empty settings table)
  const run = async () => {
    for (const stmt of SQL) await client.exec(stmt);
  };
  const get = async () =>
    Object.fromEntries((await client.query<{ key: string; value: unknown }>(`SELECT key, value FROM app_settings WHERE key ~ '^ring(Targets|Mode|Accept)[28]$'`)).rows.map((r) => [r.key, r.value]));
  return { client, run, get };
}

describe("main menu key 8 takes key 2's staff list", () => {
  it("moves the numbers, order and press-1 setting to key 8, resets key 2 to empty, and logs it", async () => {
    const { client, run, get } = await setup();
    await client.exec(`INSERT INTO app_settings (key, value) VALUES
      ('ringTargets2', '"Corporate desk | +18455550102 | 25"'), ('ringMode2', '"simultaneous"'), ('ringAccept2', 'false')`);
    await run();
    expect(await get()).toEqual({
      ringTargets8: "Corporate desk | +18455550102 | 25",
      ringMode8: "simultaneous",
      ringAccept8: false,
      ringTargets2: "",
      ringMode2: "sequential",
      ringAccept2: true,
    });
    const audit = (await client.query<{ action: string; before: unknown; after: unknown }>(`SELECT action, before, after FROM audit_log WHERE action = 'settings.menu_key2_list_moved_to_key8'`)).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0].after).toEqual({ key8: { ringTargets8: "Corporate desk | +18455550102 | 25", ringMode8: "simultaneous", ringAccept8: false } });
  });

  it("running it again changes nothing, and a list saved for key 2 later is never wiped", async () => {
    const { client, run, get } = await setup();
    await client.exec(`INSERT INTO app_settings (key, value) VALUES ('ringTargets2', '"Corporate desk | +18455550102 | 25"')`);
    await run();
    await client.exec(`UPDATE app_settings SET value = '"Equipment help | +18455550123 | 20"' WHERE key = 'ringTargets2'`);
    await run();
    const s = await get();
    expect(s.ringTargets8).toBe("Corporate desk | +18455550102 | 25");
    expect(s.ringTargets2).toBe("Equipment help | +18455550123 | 20");
    expect((await client.query(`SELECT 1 FROM audit_log WHERE action = 'settings.menu_key2_list_moved_to_key8'`)).rows).toHaveLength(1);
  });

  it("nothing saved for key 2: nothing to move, nothing logged", async () => {
    const { run, get, client } = await setup();
    await run();
    expect(await get()).toEqual({});
    expect((await client.query(`SELECT 1 FROM audit_log WHERE action = 'settings.menu_key2_list_moved_to_key8'`)).rows).toHaveLength(0);
  });
});
