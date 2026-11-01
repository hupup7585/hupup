import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { isValidISO, todayISO } from "@/lib/dates";
import PosForm from "./PosForm";

export default async function PosPage({ searchParams }: { searchParams: Promise<{ date?: string; product?: string }> }) {
  const sp = await searchParams;
  const [cats, prods] = await Promise.all([
    db.select().from(schema.categories).orderBy(asc(schema.categories.sortOrder), asc(schema.categories.id)),
    db.select().from(schema.products).where(eq(schema.products.active, true)).orderBy(asc(schema.products.sortOrder), asc(schema.products.id)),
  ]);
  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-5 text-2xl font-black sm:text-3xl">New booking</h1>
      <PosForm
        today={todayISO()}
        initialDate={sp.date && isValidISO(sp.date) ? sp.date : ""}
        initialProduct={sp.product ? Number(sp.product) : null}
        categories={cats.map((c) => ({ id: c.id, name: c.name }))}
        products={prods.map((p) => ({ id: p.id, categoryId: p.categoryId, name: p.name, priceCents: p.priceCents, quantity: p.quantity }))}
      />
    </div>
  );
}
