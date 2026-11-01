import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { CallData } from "@/lib/db/schema";

const { callSessions } = schema;

export type CallSession = typeof callSessions.$inferSelect;

export async function ensureSession(callSid: string, from: string | null): Promise<CallSession> {
  const [row] = await db
    .insert(callSessions)
    .values({ callSid, fromNumber: from })
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  const [existing] = await db.select().from(callSessions).where(eq(callSessions.callSid, callSid));
  return existing;
}

export async function getSession(callSid: string): Promise<CallSession | null> {
  const [s] = await db.select().from(callSessions).where(eq(callSessions.callSid, callSid));
  return s ?? null;
}

export async function updateSession(
  callSid: string,
  patch: Partial<Omit<CallSession, "callSid" | "data">> & { data?: Partial<CallData> },
  current?: CallSession | null,
) {
  const base = current ?? (await getSession(callSid));
  const data = patch.data ? { ...(base?.data ?? {}), ...patch.data } : undefined;
  const { data: _ignored, ...rest } = patch;
  await db
    .update(callSessions)
    .set({ ...rest, ...(data ? { data } : {}) })
    .where(eq(callSessions.callSid, callSid));
}
