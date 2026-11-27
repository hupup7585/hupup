import Link from "next/link";
import { asc } from "drizzle-orm";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { CATEGORY_KINDS, CATEGORY_KIND_LABEL, LASER_ROLES, LASER_ROLE_LABEL, categoryKind, guessCategoryKind, guessLaserRole, parseItemTypes } from "@/lib/item-types";
import TypesForm from "./TypesForm";

export const dynamic = "force-dynamic";

/**
 * Catalog > Item types (Owner, Admin handoff Phase 4, Nov 27, 2026): what each category and laser tag item is, instead
 * of guessing from words in the names. Every choice starts at what the name gives today.
 */
export default async function ItemTypesPage() {
  await requireOwner();
  const [cats, prods, s] = await Promise.all([
    db.select().from(schema.categories).orderBy(asc(schema.categories.sortOrder), asc(schema.categories.id)),
    db.select().from(schema.products).orderBy(asc(schema.products.sortOrder), asc(schema.products.id)),
    getSettings(),
  ]);
  const types = parseItemTypes((s as { itemTypes?: unknown }).itemTypes);
  return (
    <div className="w-full space-y-5">
      <div>
        <Link href="/admin/catalog" className="text-sm font-bold text-navy">&larr; Catalog</Link>
        <h1 className="text-2xl font-black sm:text-3xl">Item types</h1>
        <p className="mt-1 text-sm text-muted">
          Until now the system worked out what an item is from words in its name (for example &ldquo;laser&rdquo;, &ldquo;maze&rdquo;, &ldquo;6&rdquo;). Here you can
          say it directly, so renaming an item never changes how it is booked. Each choice starts at what the name gives today; leave it as it is
          and nothing changes. New booking uses these now; the phone line and the prices still work it out from the names until they are
          connected to this list.
        </p>
      </div>
      <TypesForm>
        {cats.map((c) => {
          const guess = guessCategoryKind(c.name);
          const kind = categoryKind(c, types);
          const laser = kind === "laser_tag" || kind === "laser_addons";
          const items = prods.filter((p) => p.categoryId === c.id);
          return (
            <div key={c.id} className="card p-4" data-type-category={c.id}>
              <label className="block">
                <span className="label">{c.name}{!c.active ? " (hidden)" : ""}</span>
                <select name={`cat:${c.id}`} defaultValue={kind} className="input">
                  {CATEGORY_KINDS.map((k) => (
                    <option key={k} value={k}>{CATEGORY_KIND_LABEL[k]}{k === guess ? " (from the name)" : ""}</option>
                  ))}
                </select>
              </label>
              {laser && items.length > 0 && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {items.map((p) => {
                    const g = guessLaserRole(p.name, kind);
                    return (
                      <label key={p.id} className="block" data-type-product={p.id}>
                        <span className="label">{p.name}{!p.active ? " (hidden)" : ""}</span>
                        <select name={`prod:${p.id}`} defaultValue={types.products[String(p.id)] ?? g} className="input">
                          {LASER_ROLES.map((r) => (
                            <option key={r} value={r}>{LASER_ROLE_LABEL[r]}{r === g ? " (from the name)" : ""}</option>
                          ))}
                        </select>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </TypesForm>
    </div>
  );
}
