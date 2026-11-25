import Link from "next/link";
import { placeTracks } from "@/lib/music";

/**
 * Batch 2 item 8 (Abraham, Nov 25, 2026): the payment line connects fastest (about 5 seconds) when at least one song
 * is chosen for it. With no song chosen, the Owner sees a clear warning on the payment line pages.
 */
export default async function PayMusicWarning() {
  const tracks = await placeTracks("pay").catch(() => []);
  if (tracks.length) return null;
  return (
    <p className="card mb-4 border-2 border-coral p-3 text-sm" role="alert" data-pay-music-warning>
      <strong>No song is chosen for the payment line.</strong> Callers wait in silence while we connect them to the card line, and the
      connection can take longer. Choose at least one song under{" "}
      <Link href="/admin/phone/music" className="font-semibold underline">Music, &ldquo;Connecting to the payment line&rdquo;</Link>.
    </p>
  );
}
