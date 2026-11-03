import { PROMPTS, type PromptDef } from "@/lib/ivr/prompts";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/config";
import PromptEditor from "./PromptEditor";

export const metadata = { title: "Hotline prompts · Hup Up Attractions" };

export default async function PromptsPage() {
  const rows = await db.select().from(schema.voicePrompts);
  const overrides = Object.fromEntries(rows.map((r) => [r.key, r.text ?? ""]));
  const groups = new Map<string, { key: string; def: PromptDef }[]>();
  for (const [key, def] of Object.entries(PROMPTS) as [string, PromptDef][]) {
    groups.set(def.group, [...(groups.get(def.group) ?? []), { key, def }]);
  }
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-black sm:text-3xl">Hotline prompts</h1>
      <p className="mb-6 mt-1 text-muted">
        Everything the phone line says. Voice: <b className="text-navy">{config.voice()}</b>. Use plain text — commas and periods make natural pauses. Words in
        {" {curly braces} "} are filled in automatically. Leave a box empty and save to go back to the default.
      </p>
      {[...groups.entries()].map(([group, items]) => (
        <section key={group} className="card mb-5 p-5">
          <h2 className="mb-3 text-lg font-bold">{group}</h2>
          <div className="space-y-4">
            {items.map(({ key, def }) => (
              <PromptEditor key={key} promptKey={key} label={def.label} defaultText={def.text} vars={def.vars ?? []} current={overrides[key] ?? ""} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
