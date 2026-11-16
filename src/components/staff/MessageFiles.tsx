import { FileText } from "lucide-react";

type F = { id: number; contentType: string; fileName: string | null; sizeBytes: number; direction?: string };

/** Pictures and files sent or received with a text (Abraham, Nov 16, 2026): pictures as thumbnails, others as links. */
export default function MessageFiles({ files, dark = false }: { files: F[]; dark?: boolean }) {
  if (!files.length) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-2" data-message-files>
      {files.map((f) => {
        const href = `/api/admin/message-files/${f.id}`;
        const name = f.fileName || (f.contentType === "application/pdf" ? "PDF" : "File");
        return (
          <li key={f.id}>
            <a href={href} target="_blank" rel="noopener noreferrer" title={`${name} (${(f.sizeBytes / 1024).toFixed(0)} KB)`}>
              {f.contentType.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={href} alt={name} loading="lazy" className="h-28 w-28 rounded-lg object-cover" />
              ) : (
                <span className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold underline-offset-2 hover:underline ${dark ? "bg-white/15 text-white" : "bg-white text-navy"}`}>
                  <FileText className="h-4 w-4" aria-hidden /> {name}
                </span>
              )}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
