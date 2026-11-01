"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, ne } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { parseMoneyToCents } from "@/lib/money";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

function done(msg: string, isError = false): never {
  revalidatePath("/admin", "layout");
  revalidatePath("/");
  redirect(`/admin/catalog?${isError ? "error" : "ok"}=${encodeURIComponent(msg)}`);
}

export async function saveCategoryAction(fd: FormData) {
  await requireAdmin();
  const id = Number(fd.get("id") || 0);
  const name = s(fd, "name");
  if (!name) done("Category name is required", true);
  const digitRaw = s(fd, "ivrDigit");
  const ivrDigit = digitRaw ? Number(digitRaw) : null;
  if (ivrDigit !== null && !(ivrDigit >= 1 && ivrDigit <= 8)) done("Phone key must be 1-8 (9 = cart, 0 = operator)", true);
  if (ivrDigit !== null) {
    const clash = await db
      .select()
      .from(schema.categories)
      .where(id ? and(eq(schema.categories.ivrDigit, ivrDigit), ne(schema.categories.id, id)) : eq(schema.categories.ivrDigit, ivrDigit));
    if (clash.length) done(`Phone key ${ivrDigit} is already used by "${clash[0].name}"`, true);
  }
  const values = {
    name,
    spokenName: s(fd, "spokenName") || name.replace(/&/g, "and"),
    description: s(fd, "description"),
    emoji: s(fd, "emoji") || "🎉",
    imageUrl: s(fd, "imageUrl") || null,
    ivrDigit,
    sortOrder: Number(fd.get("sortOrder") || 0),
    active: fd.get("active") === "on",
  };
  if (id) await db.update(schema.categories).set(values).where(eq(schema.categories.id, id));
  else await db.insert(schema.categories).values(values);
  done(id ? "Category saved" : "Category added");
}

export async function saveProductAction(fd: FormData) {
  await requireAdmin();
  const id = Number(fd.get("id") || 0);
  const name = s(fd, "name");
  const priceCents = parseMoneyToCents(s(fd, "price"));
  const quantity = Number(fd.get("quantity"));
  const categoryId = Number(fd.get("categoryId"));
  if (!name || priceCents === null || !Number.isInteger(quantity) || quantity < 0 || !categoryId) {
    done("Name, category, price and units owned are required", true);
  }
  const values = {
    name,
    categoryId,
    priceCents: priceCents!,
    quantity,
    description: s(fd, "description"),
    spokenDescription: s(fd, "spokenDescription"),
    imageUrl: s(fd, "imageUrl") || null,
    sortOrder: Number(fd.get("sortOrder") || 0),
    active: fd.get("active") === "on",
  };
  if (id) await db.update(schema.products).set(values).where(eq(schema.products.id, id));
  else await db.insert(schema.products).values(values);
  done(id ? "Item saved" : "Item added");
}
