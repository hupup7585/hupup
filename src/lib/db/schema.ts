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
  primaryKey,
  real,
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
    /** Null until the caller tells us (records are auto-created from caller ID). */
    name: text("name"),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    notes: text("notes"),
    /** Replied STOP: Twilio blocks every message from our number until START. */
    smsOptOut: boolean("sms_opt_out").notNull().default(false),
    marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
    marketingOptInAt: timestamp("marketing_opt_in_at", { withTimezone: true }),
    /** The customer's own time zone (IANA), as they told us; used for promotional quiet hours */
    timeZone: text("time_zone"),
    /** Where timeZone came from: web_form | phone | staff */
    timeZoneSource: text("time_zone_source"),
    timeZoneSetAt: timestamp("time_zone_set_at", { withTimezone: true }),
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
  /** Transactional SMS consent outcome for this call: yes | no | existing | stopped */
  smsConsent?: string;
  /** Order placed on this call (for the promotional question and goodbye) */
  placedOrderId?: number;
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
  userId: integer("user_id"),
  channel: text("channel").notNull(),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const adminSessions = pgTable("admin_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  method: text("method"),
  tokenHash: text("token_hash").notNull().unique(),
  userAgent: text("user_agent"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------- staff & permissions */

export const ROLES = ["owner", "secretary", "delivery"] as const;
export type Role = (typeof ROLES)[number];

export const adminUsers = pgTable("admin_users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone").notNull().unique(),
  email: text("email"),
  role: text("role").$type<Role>().notNull(),
  active: boolean("active").notNull().default(true),
  passwordHash: text("password_hash"),
  passwordSetAt: timestamp("password_set_at", { withTimezone: true }),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userPermissionOverrides = pgTable(
  "user_permission_overrides",
  {
    userId: integer("user_id").notNull().references(() => adminUsers.id),
    permission: text("permission").notNull(),
    allowed: boolean("allowed").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.permission] })],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_created_idx").on(t.createdAt), index("audit_entity_idx").on(t.entityType, t.entityId)],
);

/* ------------------------------------------------------------- messaging */

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    direction: text("direction").$type<"in" | "out">().notNull(),
    fromNumber: text("from_number"),
    toNumber: text("to_number"),
    /** The customer's number (other party), for threading. */
    contactPhone: text("contact_phone").notNull(),
    body: text("body").notNull().default(""),
    mediaUrls: jsonb("media_urls").$type<string[]>().notNull().default([]),
    /** transactional | marketing | system | inbound */
    kind: text("kind").notNull().default("transactional"),
    /** e.g. booking_confirmation, payment_link, delivery_completed, staff_reply, keyword_stop */
    event: text("event"),
    twilioSid: text("twilio_sid").unique(),
    status: text("status").notNull().default("queued"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    customerId: integer("customer_id").references(() => customers.id),
    orderId: integer("order_id").references(() => orders.id),
    callSid: text("call_sid"),
    userId: integer("user_id"),
    templateId: integer("template_id"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_contact_idx").on(t.contactPhone, t.createdAt), index("messages_customer_idx").on(t.customerId)],
);

export const smsConsents = pgTable(
  "sms_consents",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customer_id").references(() => customers.id),
    phone: text("phone").notNull(),
    /** transactional | marketing */
    scope: text("scope").notNull(),
    /** opt_in | opt_out | declined */
    action: text("action").notNull(),
    /** phone | pos | staff | keyword | web */
    source: text("source").notNull(),
    /** How the answer was given: keypad | speech | keyword | checkbox | staff */
    method: text("method"),
    /** Exact consent language presented (spoken or shown) */
    wording: text("wording"),
    /** Version id of that language: a dated default, or custom-<hash> when edited in admin */
    wordingVersion: text("wording_version"),
    /** What the person did: the key pressed, or the speech transcript */
    response: text("response"),
    /** Twilio speech-recognition confidence (0-1) for spoken answers */
    speechConfidence: real("speech_confidence"),
    /** Caller ID of the call the consent was given on (may differ from `phone`) */
    callerPhone: text("caller_phone"),
    orderId: integer("order_id"),
    /** Website sign-ups: request IP, browser user agent and the page the form was on */
    ip: text("ip"),
    userAgent: text("user_agent"),
    pageUrl: text("page_url"),
    /** Staff-recorded consent: staff confirmed they read the entire approved disclosure first */
    disclosureRead: boolean("disclosure_read"),
    /** Corrections never edit the original: they are new rows pointing at the row they correct */
    correctsConsentId: integer("corrects_consent_id"),
    correctionReason: text("correction_reason"),
    /** Re-enrollment: the opt-out row this new, separate consent follows (null for a first enrollment) */
    reenrollsAfterId: integer("reenrolls_after_id"),
    keyword: text("keyword"),
    callSid: text("call_sid"),
    userId: integer("user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Append-only (permanent compliance record): a DB trigger in migration 0004 rejects UPDATE and DELETE.
  (t) => [index("sms_consents_phone_idx").on(t.phone), index("sms_consents_phone_scope_idx").on(t.phone, t.scope, t.createdAt)],
);

/* ------------------------------------------------------------- settings & prompts */

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: integer("updated_by"),
});

export const voicePrompts = pgTable("voice_prompts", {
  key: text("key").primaryKey(),
  text: text("text"),
  audioUrl: text("audio_url"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: integer("updated_by"),
});

export type Category = typeof categories.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type AdminUser = typeof adminUsers.$inferSelect;
export type Message = typeof messages.$inferSelect;

/* ------------------------------------------------------------- rental terms acceptance */

/**
 * Evidence that a customer accepted the rental terms (NY electronic records and signatures): the exact terms
 * text and version shown, when, how, and on which order/phone. Append-only (DB trigger in migration 0008).
 */
export const termsAcceptances = pgTable(
  "terms_acceptances",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id").references(() => orders.id).notNull(),
    customerId: integer("customer_id").references(() => customers.id),
    phone: text("phone"),
    termsVersion: text("terms_version").notNull(),
    /** sha256 of termsText, so the exact wording can be proven */
    termsHash: text("terms_hash").notNull(),
    termsText: text("terms_text").notNull(),
    /** web_checkbox (accept page before payment) | staff_read (read to the customer by staff) */
    method: text("method").notNull(),
    /** The words the customer acted on, e.g. the checkbox label */
    acceptanceStatement: text("acceptance_statement").notNull(),
    amountCents: integer("amount_cents"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    pageUrl: text("page_url"),
    userId: integer("user_id"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("terms_acceptances_order_idx").on(t.orderId, t.acceptedAt)],
);
