import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  date,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  /** Spoken in the phone menu, e.g. "Laser Tag and Inflatable Mazes" */
  spokenName: text("spoken_name").notNull().default(""),
  /** Keypad digit on the main phone menu (1-8). Null = hidden from phone menu. */
  ivrDigit: integer("ivr_digit").unique(),
  emoji: text("emoji").notNull().default("🎉"),
  imageUrl: text("image_url"),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const products = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    /** What the phone voice reads when the caller presses "hear description" */
    spokenDescription: text("spoken_description").notNull().default(""),
    priceCents: integer("price_cents").notNull(),
    /** Units owned */
    quantity: integer("quantity").notNull().default(1),
    imageUrl: text("image_url"),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("products_category_idx").on(t.categoryId)],
);

export const customers = pgTable(
  "customers",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("customers_phone_idx").on(t.phone)],
);

export const ORDER_STATUSES = [
  "HOLD",
  "PENDING_PAYMENT",
  "CONFIRMED",
  "DELIVERED",
  "PICKED_UP",
  "CANCELLED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const CHANNELS = ["PHONE", "POS"] as const;
export type Channel = (typeof CHANNELS)[number];

export const orders = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    status: text("status").$type<OrderStatus>().notNull().default("HOLD"),
    channel: text("channel").$type<Channel>().notNull(),
    customerId: integer("customer_id").references(() => customers.id),
    /** Delivery day (the booked day). */
    eventDate: date("event_date", { mode: "string" }).notNull(),
    /** Pickup day = eventDate + 1. */
    pickupDate: date("pickup_date", { mode: "string" }).notNull(),
    deliveryAddress: text("delivery_address"),
    deliveryTime: text("delivery_time"),
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    paidCents: integer("paid_cents").notNull().default(0),
    /** sola | cash | check | other */
    paymentMethod: text("payment_method"),
    solaRefNum: text("sola_ref_num"),
    notes: text("notes"),
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
    callSid: text("call_sid"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("orders_event_date_idx").on(t.eventDate),
    index("orders_status_idx").on(t.status),
    index("orders_call_sid_idx").on(t.callSid),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id),
    qty: integer("qty").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
  },
  (t) => [index("order_items_order_idx").on(t.orderId), index("order_items_product_idx").on(t.productId)],
);

export type CallData = {
  /** Product being added (between date & quantity prompts) */
  productId?: number;
  /** Pending date awaiting confirmation */
  pendingDate?: string;
  /** Checkout answers */
  name?: string;
  address?: string;
  email?: string;
  phone?: string;
  /** Value heard but not yet confirmed */
  heard?: string;
  retries?: number;
};

export const callSessions = pgTable("call_sessions", {
  callSid: text("call_sid").primaryKey(),
  fromNumber: text("from_number"),
  orderId: integer("order_id").references(() => orders.id),
  data: jsonb("data").$type<CallData>().notNull().default({}),
  /** in_progress | completed */
  status: text("status").notNull().default("in_progress"),
  /** browsing | carted | checked_out | dropped | forwarded */
  outcome: text("outcome").notNull().default("browsing"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const loginCodes = pgTable("login_codes", {
  id: serial("id").primaryKey(),
  channel: text("channel").notNull(),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const adminSessions = pgTable("admin_sessions", {
  id: serial("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  userAgent: text("user_agent"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Category = typeof categories.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type Customer = typeof customers.$inferSelect;
