import { asc, isNull } from "drizzle-orm";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { MUSIC_PLACES, type MusicPlace } from "@/lib/music";
import ConfirmSubmit from "@/components/ConfirmSubmit";
import MusicUpload from "./MusicUpload";
import PayMusicWarning from "@/components/PayMusicWarning";
import { savePlacesAction, trashTrackAction } from "./actions";

/** Music (Abraham, Nov 17, 2026): upload songs, and choose the songs for each place. Owner only. */
export default async function MusicPage() {
  await requireOwner();
  const tracks = await db.select().from(schema.musicTracks).where(isNull(schema.musicTracks.trashedAt)).orderBy(asc(schema.musicTracks.createdAt));
  const s = (await getSettings()) as Record<string, unknown>;
  const chosen = (place: MusicPlace) => String(s[MUSIC_PLACES[place].setting] ?? "").split(",").filter(Boolean);
  const mins = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  return (
    <div className="w-full">
      <h1 className="text-2xl font-black sm:text-3xl">Music</h1>
      <PayMusicWarning />
      <p className="mb-5 mt-1 text-muted">
        Songs play like a radio: callers waiting at the same time hear the same music, and when nobody is waiting it pauses and the next caller picks it up from there.
      </p>
      <section className="card mb-5 p-5">
        <h2 className="text-xl font-black">Songs</h2>
        <p className="mb-3 mt-1 text-sm text-muted">MP3 or WAV. Each song is saved in phone quality (the phone line carries only phone-quality sound).</p>
        <MusicUpload />
        <ul className="mt-4 divide-y divide-line" data-music-list>
          {tracks.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 py-3">
              <span className="flex-1 font-bold">{t.name}</span>
              <span className="text-sm text-muted">{t.complete ? mins(t.durationSec) : "Not finished"}</span>
              {/* The whole song (Abraham, Nov 18, 2026), and Download of the original file the Owner uploaded */}
              {t.complete && <audio controls preload="none" src={`/api/admin/music/${t.id}`} className="h-8" data-music-play={t.id} />}
              {t.complete && (
                <a className="btn-ghost px-3 py-1 text-sm" href={`/api/admin/music/${t.id}?download=1`} download={t.originalName ?? `${t.name} (phone quality).wav`} data-music-download={t.id}>
                  Download
                </a>
              )}
              <form action={trashTrackAction}>
                <input type="hidden" name="id" value={t.id} />
                <ConfirmSubmit message={`Remove "${t.name}"? It stops playing everywhere.`} className="btn-ghost px-3 py-1 text-sm text-coral">Remove</ConfirmSubmit>
              </form>
            </li>
          ))}
          {!tracks.length && <li className="py-3 text-muted">No songs yet.</li>}
        </ul>
      </section>
      <section className="card mb-5 p-5">
        <h2 className="text-xl font-black">Where each song plays</h2>
        <p className="mb-3 mt-1 text-sm text-muted">Tick the songs for each place; they play in the order shown. No song ticked: no music there, except while callers wait for staff, where the song "2 Phone Holding Music" plays when it is uploaded.</p>
        <form action={savePlacesAction} className="grid gap-5 sm:grid-cols-2" data-music-places>
          {(Object.keys(MUSIC_PLACES) as MusicPlace[]).map((place) => (
            <fieldset key={place}>
              <legend className="label">{MUSIC_PLACES[place].label}</legend>
              {tracks.filter((t) => t.complete).map((t) => (
                <label key={t.id} className="flex items-center gap-2 py-1">
                  <input type="checkbox" name={place} value={t.id} defaultChecked={chosen(place).includes(String(t.id))} /> {t.name}
                </label>
              ))}
            </fieldset>
          ))}
          <button className="btn-dark w-fit sm:col-span-2">Save</button>
        </form>
      </section>
    </div>
  );
}
