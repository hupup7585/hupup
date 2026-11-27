/**
 * Extra check HP3 (Nov 27, 2026): the free database (Neon, 1 GB) must keep room for bookings, calls and payments.
 * Big files saved in the database (promo-picture originals, phone recordings) are refused once it passes the same
 * 800 MB stop the Inbox attachments use. A database that can't say its size is never blocked.
 */
export async function assertDatabaseRoom(addingBytes = 0): Promise<void> {
  const { ATTACHMENT_STORAGE_STOP_BYTES, databaseBytes } = await import("@/lib/inbox");
  const used = await databaseBytes();
  if (used > 0 && used + addingBytes > ATTACHMENT_STORAGE_STOP_BYTES) {
    throw new Error("The free database is almost full, so this file can't be saved. Remove old files or ask Hark.");
  }
}
