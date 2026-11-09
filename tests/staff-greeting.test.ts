import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { greetingFor, staffFirstName } from "@/components/StaffGreeting";

/* Admin greeting (Abraham): capitalized, the signed-in person's first name, a clear yellow waving-hand icon; no "Abram" shown to staff. */
const at = (hhmm: string) => new Date(`2026-11-09T${hhmm}:00-05:00`); // New York (EST)

describe("staff greeting", () => {
  it("capitalizes both words by time of day in New York", () => {
    expect(greetingFor(at("08:00"))).toBe("Good Morning");
    expect(greetingFor(at("11:59"))).toBe("Good Morning");
    expect(greetingFor(at("12:00"))).toBe("Good Afternoon");
    expect(greetingFor(at("17:59"))).toBe("Good Afternoon");
    expect(greetingFor(at("18:00"))).toBe("Good Evening");
    expect(greetingFor(at("00:30"))).toBe("Good Morning");
  });

  it("shows the signed-in staff member's first name; the Owner is Abraham", () => {
    expect(staffFirstName({ role: "owner", name: "Owner" })).toBe("Abraham");
    expect(staffFirstName({ role: "owner", name: "" })).toBe("Abraham");
    expect(staffFirstName({ role: "owner", name: "Abraham Weiss" })).toBe("Abraham");
    expect(staffFirstName({ role: "secretary", name: "Sara Klein" })).toBe("Sara");
    expect(staffFirstName({ role: "delivery", name: "  Dovid  " })).toBe("Dovid");
  });

  it("uses the yellow line icon (no emoji) on every staff landing page", () => {
    const c = readFileSync("src/components/StaffGreeting.tsx", "utf8");
    expect(c).toContain('fill="#FFD84D"');
    expect(c).toContain('stroke="#123D73"');
    expect(c).toContain("h-[1em] w-[1em]");
    const dash = readFileSync("src/app/admin/(app)/page.tsx", "utf8");
    expect(dash).toContain("<StaffGreeting staff={staff} />");
    expect(dash).not.toContain("👋");
    expect(readFileSync("src/app/admin/(app)/calendar/page.tsx", "utf8")).toContain("<StaffGreeting staff={staff}");
    expect(readFileSync("src/app/admin/deliveries/page.tsx", "utf8")).toContain("<StaffGreeting staff={staff}");
  });

  it("no screen shows 'Abram' (code comments aside)", () => {
    const files: string[] = [];
    const walk = (d: string) => readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : /\.tsx?$/.test(f) && files.push(join(d, f))));
    walk("src");
    for (const f of files) {
      const code = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect(code, f).not.toMatch(/\bAbram\b/);
    }
  });
});

describe("sidebar top (Abraham)", () => {
  it("centered under the logo: STAFF PORTAL, full name, role; the Owner's name becomes Abraham Schwartz (update only)", () => {
    const s = readFileSync("src/components/Sidebar.tsx", "utf8");
    expect(s).toContain('className="mb-8 flex flex-col items-center px-1 text-center" data-sidebar-head');
    expect(s).not.toMatch(/hidden[^"]*data-sidebar-head/); // shown in the phone menu too
    for (const t of ["Staff portal</div>", "{name}</div>", "{role}</div>"]) expect(s.slice(s.indexOf(t) - 120, s.indexOf(t))).toContain("w-full text-center");
    expect(s).not.toContain("{name} · ");
    const m = readFileSync("drizzle/0024_owner_name.sql", "utf8");
    expect(m).toContain(`SET "name" = 'Abraham Schwartz' WHERE "role" = 'owner'`);
    expect(m).not.toMatch(/\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i);
    expect(readFileSync("src/lib/auth.ts", "utf8")).not.toMatch(/name: "Owner"/);
  });
});
