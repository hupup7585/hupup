import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

type DB = NodePgDatabase<typeof schema>;

const g = globalThis as unknown as { __hupPool?: Pool; __hupDb?: DB };

function makePool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // DB_POOL_MAX: only for local end-to-end tests against the single-connection in-memory server.
  return new Pool({ connectionString: url, max: Number(process.env.DB_POOL_MAX) || 5, ...(process.env.DB_IDLE_MS ? { idleTimeoutMillis: Number(process.env.DB_IDLE_MS) } : {}) });
}

export function getDb(): DB {
  if (!g.__hupDb) {
    g.__hupPool = makePool();
    g.__hupDb = drizzle(g.__hupPool, { schema });
  }
  return g.__hupDb;
}

/** Lazy proxy so importing this module never connects at build time. */
export const db = new Proxy({} as DB, {
  get(_t, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const v = real[prop];
    return typeof v === "function" ? (v as Function).bind(real) : v;
  },
});

export async function closeDb() {
  await g.__hupPool?.end();
  g.__hupPool = undefined;
  g.__hupDb = undefined;
}

export { schema };
