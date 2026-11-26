import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { CallData } from "@/lib/db/schema";
import { isPreviewCall } from "@/lib/ivr/preview";

const { callSessions } = schema;

export type CallSession = typeof callSessions.$inferSelect;

export async function ensureSession(callSid: string, from: string | null): Promise<CallSession> {
  // Admin preview (Test this screen): nothing is saved
  if (isPreviewCall(callSid)) return { callSid, fromNumber: from, orderId: null, data: {}, status: "in_progress", outcome: null, startedAt: new Date() } as unknown as CallSession;
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
  if (isPreviewCall(callSid)) return null;
  const [s] = await db.select().from(callSessions).where(eq(callSessions.callSid, callSid));
  return s ?? null;
}

export async function updateSession(
  callSid: string,
  patch: Partial<Omit<CallSession, "callSid" | "data">> & { data?: Partial<CallData> },
  current?: CallSession | null,
) {
  if (isPreviewCall(callSid)) return;
  const base = current ?? (await getSession(callSid));
  const data = patch.data ? { ...(base?.data ?? {}), ...patch.data } : undefined;
  const { data: _ignored, ...rest } = patch;
  await db
    .update(callSessions)
    .set({ ...rest, ...(data ? { data } : {}) })
    .where(eq(callSessions.callSid, callSid));
}
