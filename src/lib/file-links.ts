import { signingSecret } from "@/lib/secret";
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "@/lib/config";

/**
 * Large files by link (Abraham, Nov 18, 2026): a file over 18 MB, up to 100 MB, is not attached. It is kept in R2 (the
 * free storage already used for photos) in 3 MB pieces, and the email says, word for word:
 * "This file was too big to attach. Download it here: {link}". The link is signed and works for 30 days.
 */
export const LINK_FILE_MAX_BYTES = 100 * 1024 * 1024;
export const LINK_FILE_MAX_LABEL = "100 MB";
export const LINK_DAYS = 30;

export const linkPieceKey = (fileId: number, idx: number) => `inbox-files/${fileId}/${idx}`;

/** The approved line for one file. */
export const tooBigLine = (link: string) => `This file was too big to attach. Download it here: ${link}`;

const sig = (fileId: number, exp: number) => createHmac("sha256", signingSecret()).update(`file-link:${fileId}:${exp}`).digest("hex").slice(0, 32);

/** A download link that works for 30 days from now. */
export function fileLink(fileId: number, now = new Date()): string {
  const exp = Math.floor(now.getTime() / 1000) + LINK_DAYS * 86_400;
  return `${config.baseUrl()}/api/files/${fileId}?e=${exp}&s=${sig(fileId, exp)}`;
}

/** Signed by us and not past its 30 days. */
export function verifyFileLink(fileId: number, e: string | null, s: string | null, now = new Date()): boolean {
  const exp = Number(e);
  if (!fileId || !Number.isInteger(exp) || !s) return false;
  if (exp * 1000 < now.getTime()) return false;
  const want = Buffer.from(sig(fileId, exp));
  const got = Buffer.from(s);
  return want.length === got.length && timingSafeEqual(want, got);
}
