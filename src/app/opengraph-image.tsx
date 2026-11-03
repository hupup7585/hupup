import { ImageResponse } from "next/og";
import { theme } from "@/lib/theme";

export const alt = "Hup Up Attractions: Bringing something special to every occasion";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 80, background: theme.sky, color: theme.deep }}>
        <div style={{ display: "flex", fontSize: 44, fontWeight: 800 }}>
          Hup Up <span style={{ background: theme.yellow, padding: "0 12px", marginLeft: 12, borderRadius: 10 }}>Attractions</span>
        </div>
        <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.05, marginTop: 36, maxWidth: 1000 }}>BRINGING SOMETHING SPECIAL TO EVERY OCCASION</div>
        <div style={{ fontSize: 36, marginTop: 36, fontWeight: 700 }}>Call to book (845) 415-7585</div>
      </div>
    ),
    size,
  );
}
