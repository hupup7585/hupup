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
  customType,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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
    /** Size within its category (1 = smallest); the phone line offers the next size up or down when an item is booked */
    sizeOrder: integer("size_order"),
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
    /** A test entry (Abraham marks these instead of deleting them); left out of campaigns */
    isTest: boolean("is_test").notNull().default(false),
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
  /** Paid after its hold ended and the items were taken by someone else (Abraham, Nov 13, 2026): never confirmed by itself. */
  "NEEDS_ATTENTION",
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
    /** Driver for the delivery and for the pickup (Abraham, Nov 12, 2026); a Delivery login sees only its own stops. */
    deliveryDriverId: integer("delivery_driver_id"),
    pickupDriverId: integer("pickup_driver_id"),
    deliveryTime: text("delivery_time"),
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    /** Delivery zone at checkout: kj ($10) | area ($15). Set when the order is priced. */
    deliveryZone: text("delivery_zone"),
    deliveryFeeCents: integer("delivery_fee_cents").notNull().default(0),
    /** Sales tax rate used (percent, e.g. "8.125") and amount, on items + delivery */
    taxPercent: text("tax_percent"),
    taxCents: integer("tax_cents").notNull().default(0),
    /** Items + delivery + tax: what the payment link charges. Null for orders priced before this existed. */
    totalCents: integer("total_cents"),
    paidCents: integer("paid_cents").notNull().default(0),
    /** Orders paid together with one charge (several rental days on one call) share the first order's id here */
    paymentGroupId: integer("payment_group_id"),
    /** sola | cash | check | other */
    paymentMethod: text("payment_method"),
    solaRefNum: text("sola_ref_num"),
    /** Sola's last answer for this order (Abraham, Nov 12, 2026): "approved" | "declined", when, and the card's last 4 only */
    paymentResult: text("payment_result"),
    paymentResultAt: timestamp("payment_result_at", { withTimezone: true }),
    cardLast4: text("card_last4"),
    /** Phone keypad payment through Stripe (Twilio Pay in the payment subaccount): Stripe's payment ID */
    stripePaymentId: text("stripe_payment_id"),
    /** Refunded through Stripe from Admin (or Stripe's dashboard): Refunded / Partly refunded */
    refundedCents: integer("refunded_cents").notNull().default(0),
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
  /** Caller pressed # to accept the Terms and Conditions on this call */
  termsAccepted?: boolean;
  /** Main-menu keys pressed on this call, in order (call analytics: which departments callers choose) */
  menuKeys?: string[];
  /** A department or operator was asked for and no one took the call: "closed" (office closed / no one on the list) or "no_answer" */
  missed?: "closed" | "no_answer" | "rejected";
  /** A voicemail was left on this call / the missed-call alert went out (once per call) */
  leftMessage?: boolean;
  missedAlerted?: boolean;
  /** Call recording (only when the Owner has turned it on): started, and the finished recording */
  recording?: boolean;
  recordingSid?: string;
  recordingUrl?: string | null;
  /** Key 1 booking: the rental day being shopped for now (date first, then items) */
  day?: string;
  /** Key 1 booking: every held order on this call, one per rental day (paid together with one charge) */
  dayOrderIds?: number[];
  /** Key 8 catalog: the number to text, the two parts of the email, and keys typed so far */
  catPhone?: string;
  catLocal?: string;
  /** The catalog email letters came from speech to text (read back in the Google voice). */
  catStt?: number;
  /** Staff voicemail access: signed in with the voicemail PIN on this call. */
  vmaOk?: number;
  catDomain?: string;
  catKeys?: string;
  /** When the caller last pressed a key or said something (Abraham's idle rule inside a booking) */
  lastKeyAt?: number;
  /** Staff pressed 2 on the announcement (Abraham): the caller goes to that extension's voicemail. */
  rejectedAt?: number;
  /** Voicemail review menu: the latest recording on this call, its link, box and menu key */
  vmSid?: string;
  vmUrl?: string;
  vmBox?: number;
  vmKey?: string;
  /** Promo texts by phone (keys only): the mobile number typed in Step 3, waiting for the caller to confirm */
  promoHeard?: string;
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

/**
 * The caller's full journey (Abraham S): one row per thing that happened on a hotline call, in order.
 * kind: step (a menu or question the caller reached, with the key pressed / words said) | category_heard |
 * item_heard | item_details | item_added | date_asked | date_closed | date_unclear | unavailable | typed | said |
 * booking_finished | hung_up. Card numbers and security codes are never taken on a call; any long digit run is
 * removed before saving as a safeguard.
 */
export const callEvents = pgTable(
  "call_events",
  {
    id: serial("id").primaryKey(),
    callSid: text("call_sid").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    step: text("step"),
    kind: text("kind").notNull(),
    label: text("label").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index("call_events_call_idx").on(t.callSid, t.id), index("call_events_kind_idx").on(t.kind, t.at)],
);

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
    /** Held promotional text (blocked by quiet hours): earliest time it may be sent. Consent is rechecked then. */
    sendAfter: timestamp("send_after", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_contact_idx").on(t.contactPhone, t.createdAt), index("messages_customer_idx").on(t.customerId), index("messages_held_idx").on(t.status, t.sendAfter)],
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
  /** The uploaded recording that plays now (Abraham, Phone Recordings); null = the Google voice. */
  recordingId: integer("recording_id"),
  /** Owner's OK for a line marked "Waiting for approval" (until then it never plays). */
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedBy: integer("approved_by"),
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
    /** Phone acceptances: the number the call came from (caller ID) and the Twilio call id */
    callerPhone: text("caller_phone"),
    callSid: text("call_sid"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("terms_acceptances_order_idx").on(t.orderId, t.acceptedAt)],
);

/* ------------------------------------------------------------- START -> YES re-enrollment */

/**
 * A customer who opted out (STOP) texts START: we create one pending confirmation (24 hours) and ask them to reply
 * YES. Only YES to an active pending confirmation restores order/service consent. STOP cancels it. Never deleted.
 */
export const smsReenrollRequests = pgTable(
  "sms_reenroll_requests",
  {
    id: serial("id").primaryKey(),
    phone: text("phone").notNull(),
    customerId: integer("customer_id").references(() => customers.id),
    /** "transactional" (START -> YES; START never restores promotions) or "marketing" (SMS Terms v2 promotional confirmation -> YES) */
    scope: text("scope").notNull().default("transactional"),
    /** pending | confirmed | expired | canceled */
    status: text("status").notNull().default("pending"),
    /** The exact START confirmation text sent to the customer */
    promptText: text("prompt_text").notNull(),
    startMessage: text("start_message"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    /** e.g. "stop", "expired", or the consent row id that confirmed it */
    resolution: text("resolution"),
    confirmConsentId: integer("confirm_consent_id"),
  },
  (t) => [index("sms_reenroll_phone_idx").on(t.phone, t.status)],
);

/** A stored copy of every Terms and Conditions version customers can accept (append-only; migration 0011). */
export const termsVersions = pgTable("terms_versions", {
  version: text("version").primaryKey(),
  /** Effective date as shown on /terms, or "draft" while the Terms are preview-only */
  effectiveDate: text("effective_date").notNull(),
  text: text("text").notNull(),
  textHash: text("text_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Voicemail boxes (migration 0012). One Main box is used by the hotline (option 0 when no one answers or the
 * office is closed); more boxes (per extension) can be added later. Notification recipients are per box.
 */
export const voicemailBoxes = pgTable("voicemail_boxes", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  isMain: boolean("is_main").notNull().default(false),
  /** The main-menu key this box belongs to (2, 4, 5, 6, 8); null for the Main box and older boxes */
  extensionKey: text("extension_key").unique(),
  /** Spoken before the beep (text to speech). Empty = the default prompt from the prompts catalog. */
  greetingText: text("greeting_text"),
  /** Off by default: Twilio charges extra per minute for transcription (Abraham approves before turning on). */
  transcribe: boolean("transcribe").notNull().default(false),
  maxLengthSec: integer("max_length_sec").notNull().default(120),
  enabled: boolean("enabled").notNull().default(true),
  /** E.164 numbers texted for each new message */
  notifySms: text("notify_sms").array().notNull().default(sql`'{}'::text[]`),
  notifyEmail: text("notify_email").array().notNull().default(sql`'{}'::text[]`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One caller message. Audio stays in Twilio and is played through a signed-in admin route (no public link). */
export const voicemails = pgTable(
  "voicemails",
  {
    id: serial("id").primaryKey(),
    boxId: integer("box_id").notNull().references(() => voicemailBoxes.id),
    callSid: text("call_sid"),
    fromNumber: text("from_number"),
    recordingSid: text("recording_sid").notNull().unique(),
    recordingUrl: text("recording_url").notNull(),
    durationSec: integer("duration_sec").notNull().default(0),
    transcription: text("transcription"),
    /** pending | completed | failed | off */
    transcriptionStatus: text("transcription_status").notNull().default("pending"),
    urgent: boolean("urgent").notNull().default(false),
    heardAt: timestamp("heard_at", { withTimezone: true }),
    heardBy: integer("heard_by").references(() => adminUsers.id),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    /** Hidden from the list (Delete). The recording is kept (Abraham, Nov 13, 2026). */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** Deleted for good by the Owner: the Twilio recording was removed. */
    purgedAt: timestamp("purged_at", { withTimezone: true }),
    /**
     * recording (call still on) | reviewing (caller pressed #, deciding) | submitted | replaced (caller re-recorded).
     * Only submitted messages show in Admin and send alerts.
     */
    state: text("state").notNull().default("submitted"),
    /** Twilio says the audio file is ready (the recording status callback arrived) */
    ready: boolean("ready").notNull().default(true),
    /** Shown in the alert, e.g. the caller hung up without confirming */
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("voicemails_box_idx").on(t.boxId, t.createdAt)],
);

/* ---------------- Bookkeeping (Abraham T): Owner only. Nothing is ever deleted; corrections are new entries. ---------------- */

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/**
 * The money ledger. Money in: income, deposit, cancellation_fee. Money out: expense, refund, processor_fee, contractor.
 * Income from paid bookings is written automatically (source "auto") with its split into rental, delivery, tax and tip.
 * A correction is a new row pointing at the original (correctsId) with the opposite amounts; rows are never edited.
 */
export const bookEntries = pgTable(
  "book_entries",
  {
    id: serial("id").primaryKey(),
    entryDate: date("entry_date", { mode: "string" }).notNull(),
    kind: text("kind").notNull(),
    category: text("category"),
    amountCents: integer("amount_cents").notNull(),
    rentalCents: integer("rental_cents").notNull().default(0),
    deliveryCents: integer("delivery_cents").notNull().default(0),
    taxCents: integer("tax_cents").notNull().default(0),
    tipCents: integer("tip_cents").notNull().default(0),
    /** cash | check | zelle | card | sola | bank | other */
    method: text("method"),
    checkNo: text("check_no"),
    /** Vendor, customer, school or person paid */
    party: text("party"),
    orderId: integer("order_id"),
    invoiceId: integer("invoice_id"),
    billId: integer("bill_id"),
    productId: integer("product_id"),
    /** Staff/contractor payments: who (for 1099 totals) */
    personName: text("person_name"),
    county: text("county"),
    taxExempt: boolean("tax_exempt").notNull().default(false),
    /** For Sola payments: the payment reference, so fees and bank deposits can be matched */
    ref: text("ref"),
    notes: text("notes"),
    fileId: integer("file_id"),
    /** Task Manager project this expense belongs to (Abraham DD) */
    projectId: integer("project_id"),
    /** auto | manual */
    source: text("source").notNull().default("manual"),
    correctsId: integer("corrects_id"),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("book_entries_date_idx").on(t.entryDate), index("book_entries_order_idx").on(t.orderId), index("book_entries_kind_idx").on(t.kind, t.entryDate)],
);

export const bookCategories = pgTable("book_categories", {
  id: serial("id").primaryKey(),
  /** expense | income */
  kind: text("kind").notNull().default("expense"),
  name: text("name").notNull().unique(),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

/** Invoices for schools and institutions (often paid by check). Payments are income entries with invoiceId. */
export const bookInvoices = pgTable("book_invoices", {
  id: serial("id").primaryKey(),
  customerName: text("customer_name").notNull(),
  customerId: integer("customer_id"),
  orderId: integer("order_id"),
  issueDate: date("issue_date", { mode: "string" }).notNull(),
  dueDate: date("due_date", { mode: "string" }).notNull(),
  amountCents: integer("amount_cents").notNull(),
  taxExempt: boolean("tax_exempt").notNull().default(false),
  exemptCertNo: text("exempt_cert_no"),
  exemptFileId: integer("exempt_file_id"),
  notes: text("notes"),
  /** draft | open (sent / issued) | void (never deleted). Paid, partly paid and overdue are worked out from payments. */
  status: text("status").notNull().default("open"),
  /** Bookkeeping spec 3.1: INV-1001, Q-1001 (quote), CN-1001 (credit note). Older invoices show their id. */
  number: text("number").unique(),
  /** invoice | quote | credit_note */
  kind: text("kind").notNull().default("invoice"),
  customerEmail: text("customer_email"),
  customerPhone: text("customer_phone"),
  billingAddress: text("billing_address"),
  subtotalCents: integer("subtotal_cents"),
  discountCents: integer("discount_cents").notNull().default(0),
  /** Tax entered or copied from the booking; never calculated by guesswork (accountant rules) */
  taxCents: integer("tax_cents").notNull().default(0),
  depositRequiredCents: integer("deposit_required_cents").notNull().default(0),
  /** Payment terms in days (due date = issue date + terms) */
  termsDays: integer("terms_days"),
  /** disputed | written_off | refunded (set by the Owner; otherwise worked out from payments and dates) */
  manualStatus: text("manual_status"),
  /** A credit note applies to this invoice; a quote turned into this invoice */
  relatedInvoiceId: integer("related_invoice_id"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bookInvoiceLines = pgTable(
  "book_invoice_lines",
  {
    id: serial("id").primaryKey(),
    invoiceId: integer("invoice_id").notNull(),
    description: text("description").notNull(),
    qty: integer("qty").notNull().default(1),
    unitCents: integer("unit_cents").notNull(),
    lineCents: integer("line_cents").notNull(),
    productId: integer("product_id"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("book_invoice_lines_inv_idx").on(t.invoiceId)],
);

/** Bills the business owes. Payments are expense entries with billId. */
export const bookBills = pgTable("book_bills", {
  id: serial("id").primaryKey(),
  vendor: text("vendor").notNull(),
  category: text("category"),
  billDate: date("bill_date", { mode: "string" }).notNull(),
  dueDate: date("due_date", { mode: "string" }).notNull(),
  amountCents: integer("amount_cents").notNull(),
  notes: text("notes"),
  fileId: integer("file_id"),
  /** open | void */
  status: text("status").notNull().default("open"),
  recurringId: integer("recurring_id"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Recurring expenses and subscriptions: each due date creates a bill (or the Owner records it). */
export const bookRecurring = pgTable("book_recurring", {
  id: serial("id").primaryKey(),
  vendor: text("vendor").notNull(),
  category: text("category"),
  amountCents: integer("amount_cents").notNull(),
  method: text("method"),
  /** weekly | monthly | quarterly | yearly */
  frequency: text("frequency").notNull().default("monthly"),
  nextDate: date("next_date", { mode: "string" }).notNull(),
  active: boolean("active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Bank or card statement lines (CSV upload), matched to ledger entries or bookings. */
export const bookBankLines = pgTable(
  "book_bank_lines",
  {
    id: serial("id").primaryKey(),
    /** bank | card */
    account: text("account").notNull().default("bank"),
    importName: text("import_name"),
    lineDate: date("line_date", { mode: "string" }).notNull(),
    description: text("description").notNull(),
    /** + money in, - money out */
    amountCents: integer("amount_cents").notNull(),
    /** unmatched | matched | ignored */
    status: text("status").notNull().default("unmatched"),
    matchedEntryIds: jsonb("matched_entry_ids").$type<number[]>().notNull().default([]),
    matchNote: text("match_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("book_bank_date_idx").on(t.lineDate)],
);

/** Equipment purchases (rental items), for profit per item and the depreciation list. */
export const bookEquipment = pgTable("book_equipment", {
  id: serial("id").primaryKey(),
  productId: integer("product_id"),
  name: text("name").notNull(),
  purchaseDate: date("purchase_date", { mode: "string" }).notNull(),
  costCents: integer("cost_cents").notNull(),
  qty: integer("qty").notNull().default(1),
  /** Straight-line years for the accountant's list (the accountant decides the actual tax method) */
  lifeYears: integer("life_years").notNull().default(5),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bookMileage = pgTable("book_mileage", {
  id: serial("id").primaryKey(),
  tripDate: date("trip_date", { mode: "string" }).notNull(),
  vehicle: text("vehicle"),
  driver: text("driver"),
  /** Miles in tenths (123 = 12.3 miles) */
  milesTenths: integer("miles_tenths").notNull(),
  purpose: text("purpose"),
  orderId: integer("order_id"),
  notes: text("notes"),
  correctsId: integer("corrects_id"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A locked month (YYYY-MM): no entries dated in it can be added. */
export const bookLocks = pgTable("book_locks", {
  month: text("month").primaryKey(),
  lockedBy: integer("locked_by"),
  lockedAt: timestamp("locked_at", { withTimezone: true }).notNull().defaultNow(),
  /** locked | reopened (only the Owner reopens, with a reason; every change is in the audit log) */
  status: text("status").notNull().default("locked"),
  reopenedBy: integer("reopened_by"),
  reopenedAt: timestamp("reopened_at", { withTimezone: true }),
  reopenReason: text("reopen_reason"),
});

/** Receipts and tax-exempt certificates, stored privately in the database (Owner-only download). */
export const bookFiles = pgTable("book_files", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  data: bytea("data").notNull(),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ---------------- Task Manager (Abraham CC, DD) ---------------- */

/** A job for staff. A subtask has parentId. Deadline = dueDate (+ optional dueTime "HH:MM"). */
export const tasks = pgTable(
  "tasks",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    notes: text("notes"),
    dueDate: date("due_date", { mode: "string" }),
    dueTime: text("due_time"),
    /** low | normal | high */
    priority: text("priority").notNull().default("normal"),
    /** todo | in_progress | done */
    status: text("status").notNull().default("todo"),
    assignedTo: integer("assigned_to"),
    orderId: integer("order_id"),
    projectId: integer("project_id"),
    parentId: integer("parent_id"),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    doneAt: timestamp("done_at", { withTimezone: true }),
  },
  (t) => [index("tasks_assigned_idx").on(t.assignedTo, t.status), index("tasks_due_idx").on(t.dueDate), index("tasks_parent_idx").on(t.parentId), index("tasks_project_idx").on(t.projectId)],
);

/** A group of tasks (an event or a booking), with its own profitability. */
export const taskProjects = pgTable("task_projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  notes: text("notes"),
  /** Bookings whose income counts toward this project */
  orderIds: jsonb("order_ids").$type<number[]>().notNull().default([]),
  /** open | closed */
  status: text("status").notNull().default("open"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Hourly rate per staff member (Owner only sets and sees it). */
export const staffRates = pgTable("staff_rates", {
  userId: integer("user_id").primaryKey(),
  hourlyCents: integer("hourly_cents").notNull(),
  updatedBy: integer("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Time worked on a task: a running timer (endedAt null) or entered hours. The rate is copied at the time it's logged. */
export const timeLogs = pgTable(
  "time_logs",
  {
    id: serial("id").primaryKey(),
    taskId: integer("task_id").notNull(),
    userId: integer("user_id"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    minutes: integer("minutes"),
    rateCents: integer("rate_cents").notNull().default(0),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("time_logs_task_idx").on(t.taskId), index("time_logs_user_idx").on(t.userId)],
);

/* ---------------- General ledger (Bookkeeping spec step 1): double entry, accountant-approved chart ---------------- */

/** Chart of accounts. Entered or approved by the accountant; nothing is pre-filled. */
export const glAccounts = pgTable("gl_accounts", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  /** asset | liability | equity | income | cogs | expense | other_income | other_expense */
  type: text("type").notNull(),
  parentId: integer("parent_id"),
  active: boolean("active").notNull().default(true),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A journal entry: draft -> pending approval -> posted (-> reversed by a new entry). Never deleted. */
export const journalEntries = pgTable(
  "journal_entries",
  {
    id: serial("id").primaryKey(),
    entryDate: date("entry_date", { mode: "string" }).notNull(),
    memo: text("memo").notNull(),
    /** manual | books (posted from a Bookkeeping entry) | reversal */
    source: text("source").notNull().default("manual"),
    /** e.g. "book_entry:123", unique per source so nothing posts twice */
    sourceRef: text("source_ref").unique(),
    /** draft | pending | posted | reversed */
    status: text("status").notNull().default("draft"),
    totalCents: integer("total_cents").notNull().default(0),
    preparedBy: integer("prepared_by"),
    approvedBy: integer("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    reversesId: integer("reverses_id"),
    fileId: integer("file_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("journal_entries_date_idx").on(t.entryDate)],
);

export const journalLines = pgTable(
  "journal_lines",
  {
    id: serial("id").primaryKey(),
    entryId: integer("entry_id").notNull(),
    accountId: integer("account_id").notNull(),
    debitCents: integer("debit_cents").notNull().default(0),
    creditCents: integer("credit_cents").notNull().default(0),
    memo: text("memo"),
    projectId: integer("project_id"),
  },
  (t) => [index("journal_lines_entry_idx").on(t.entryId), index("journal_lines_account_idx").on(t.accountId)],
);

/** Seasonal promo campaigns (Abraham, Nov 9, 2026): the Owner approves the wording; Owner or Secretary sends to eligible customers only. */
export const smsCampaigns = pgTable("sms_campaigns", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  body: text("body").notNull(),
  /** draft | approved | sent | canceled */
  status: text("status").notNull().default("draft"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  approvedBy: integer("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  sentBy: integer("sent_by"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  eligibleCount: integer("eligible_count"),
  sentCount: integer("sent_count"),
  heldCount: integer("held_count"),
  skippedCount: integer("skipped_count"),
  /** Up to two promo_pictures ids (sent as MMS); empty = plain SMS */
  pictureIds: jsonb("picture_ids").$type<number[]>().notNull().default([]),
  /** Add the Rentals page link to the end of the offer */
  rentalsLink: boolean("rentals_link").notNull().default(false),
});

/** Promo pictures: the phone-ready JPG (about 1080 px wide, at most about 500 KB) and the full-size original in chunks. */
export const promoPictures = pgTable("promo_pictures", {
  id: serial("id").primaryKey(),
  /** Unguessable id in the public picture link Twilio fetches */
  token: text("token").notNull().unique(),
  /** upload | catalog */
  source: text("source").notNull(),
  productId: integer("product_id"),
  fileName: text("file_name"),
  jpg: bytea("jpg").notNull(),
  jpgBytes: integer("jpg_bytes").notNull(),
  width: integer("width"),
  height: integer("height"),
  originalType: text("original_type"),
  originalBytes: integer("original_bytes"),
  originalComplete: boolean("original_complete").notNull().default(false),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const promoPictureChunks = pgTable("promo_picture_chunks", {
  pictureId: integer("picture_id").notNull().references(() => promoPictures.id),
  idx: integer("idx").notNull(),
  data: bytea("data").notNull(),
}, (t) => [primaryKey({ columns: [t.pictureId, t.idx] })]);

/** One row per customer per campaign (never twice). */
export const smsCampaignSends = pgTable("sms_campaign_sends", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull().references(() => smsCampaigns.id),
  customerId: integer("customer_id").notNull(),
  phone: text("phone").notNull(),
  messageId: integer("message_id"),
  /** sent | held | skipped */
  status: text("status").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Abraham's catalog PDF (Phone Menu v3, section 9): one current file, replaced in Admin; old files kept. */
export const catalogFiles = pgTable("catalog_files", {
  id: serial("id").primaryKey(),
  fileName: text("file_name").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  complete: boolean("complete").notNull().default(false),
  current: boolean("current").notNull().default(false),
  uploadedBy: integer("uploaded_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const catalogFileChunks = pgTable(
  "catalog_file_chunks",
  {
    fileId: integer("file_id").notNull().references(() => catalogFiles.id),
    idx: integer("idx").notNull(),
    data: bytea("data").notNull(),
  },
  (t) => [primaryKey({ columns: [t.fileId, t.idx] })],
);

/** Emails to info@ asking for the catalog (subject "Catalog"): who, when, and whether a reply went out. */
export const catalogEmailRequests = pgTable("catalog_email_requests", {
  id: serial("id").primaryKey(),
  sender: text("sender").notNull(),
  subject: text("subject"),
  replied: boolean("replied").notNull().default(false),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Phone line recordings (Abraham, Phone Recordings): uploads (MP3/WAV) and Google voice recordings. Never deleted. */
export const promptRecordings = pgTable("prompt_recordings", {
  id: serial("id").primaryKey(),
  promptKey: text("prompt_key").notNull(),
  /** "upload" | "google" */
  source: text("source").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  /** The wording at the time (for Google recordings: the exact text spoken). */
  wording: text("wording"),
  complete: boolean("complete").notNull().default(false),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const promptRecordingChunks = pgTable(
  "prompt_recording_chunks",
  {
    recordingId: integer("recording_id").notNull().references(() => promptRecordings.id),
    idx: integer("idx").notNull(),
    data: bytea("data").notNull(),
  },
  (t) => [primaryKey({ columns: [t.recordingId, t.idx] })],
);

/* info@ Inbox (Abraham, Nov 12, 2026). Nothing here is ever deleted. */
export const inboxRaw = pgTable("inbox_raw", {
  uploadId: text("upload_id").primaryKey(),
  parts: integer("parts").notNull(),
  emailId: integer("email_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const inboxRawChunks = pgTable(
  "inbox_raw_chunks",
  {
    uploadId: text("upload_id").notNull().references(() => inboxRaw.uploadId),
    idx: integer("idx").notNull(),
    data: bytea("data").notNull(),
  },
  (t) => [primaryKey({ columns: [t.uploadId, t.idx] })],
);

export const inboxEmails = pgTable("inbox_emails", {
  id: serial("id").primaryKey(),
  messageId: text("message_id").unique(),
  uploadId: text("upload_id"),
  fromAddress: text("from_address").notNull(),
  fromName: text("from_name"),
  toAddress: text("to_address"),
  subject: text("subject"),
  textBody: text("text_body"),
  htmlBody: text("html_body"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  readAt: timestamp("read_at", { withTimezone: true }),
  customerId: integer("customer_id").references(() => customers.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const inboxFiles = pgTable("inbox_files", {
  id: serial("id").primaryKey(),
  emailId: integer("email_id").references(() => inboxEmails.id),
  replyId: integer("reply_id"),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  complete: boolean("complete").notNull().default(false),
  tooBig: boolean("too_big").notNull().default(false),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const inboxFileChunks = pgTable(
  "inbox_file_chunks",
  {
    fileId: integer("file_id").notNull().references(() => inboxFiles.id),
    idx: integer("idx").notNull(),
    data: bytea("data").notNull(),
  },
  (t) => [primaryKey({ columns: [t.fileId, t.idx] })],
);

export const inboxReplies = pgTable("inbox_replies", {
  id: serial("id").primaryKey(),
  /** The email being answered; null for a new email written in Admin (Abraham, Nov 13, 2026). */
  emailId: integer("email_id").references(() => inboxEmails.id),
  toAddress: text("to_address").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  sent: boolean("sent").notNull().default(false),
  error: text("error"),
  userId: integer("user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* Stripe refunds, disputes, fees and payouts (Abraham, Nov 12, 2026). Nothing is ever deleted. */
export const orderRefunds = pgTable("order_refunds", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => orders.id),
  amountCents: integer("amount_cents").notNull(),
  stripeRefundId: text("stripe_refund_id").unique(),
  /** succeeded | pending | failed */
  status: text("status").notNull(),
  error: text("error"),
  /** admin | stripe_dashboard */
  source: text("source").notNull().default("admin"),
  /** stripe | sola */
  provider: text("provider").notNull().default("stripe"),
  userId: integer("user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orderDisputes = pgTable("order_disputes", {
  id: serial("id").primaryKey(),
  stripeDisputeId: text("stripe_dispute_id").notNull().unique(),
  orderId: integer("order_id").references(() => orders.id),
  amountCents: integer("amount_cents").notNull(),
  reason: text("reason"),
  status: text("status").notNull(),
  evidenceDueBy: timestamp("evidence_due_by", { withTimezone: true }),
  evidenceSentAt: timestamp("evidence_sent_at", { withTimezone: true }),
  evidenceSentBy: integer("evidence_sent_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const stripeBalanceLines = pgTable("stripe_balance_lines", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  amountCents: integer("amount_cents").notNull(),
  feeCents: integer("fee_cents").notNull().default(0),
  netCents: integer("net_cents").notNull(),
  description: text("description"),
  sourceId: text("source_id"),
  orderId: integer("order_id"),
  payoutId: text("payout_id"),
  happenedAt: timestamp("happened_at", { withTimezone: true }).notNull(),
  availableOn: timestamp("available_on", { withTimezone: true }),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});

export const stripePayouts = pgTable("stripe_payouts", {
  id: text("id").primaryKey(),
  amountCents: integer("amount_cents").notNull(),
  status: text("status").notNull(),
  arrivalDate: timestamp("arrival_date", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Every version of a phone line or message (Abraham, Nov 13, 2026): draft -> live -> replaced. Never deleted. */
export const promptVersions = pgTable("prompt_versions", {
  id: serial("id").primaryKey(),
  promptKey: text("prompt_key").notNull(),
  text: text("text").notNull(),
  /** draft | live | replaced | discarded */
  status: text("status").notNull(),
  note: text("note"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  approvedBy: integer("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
});

/** Spoken answers recorded and typed up (speech to text), kept on the order and contact (Abraham, Nov 13, 2026). */
export const spokenAnswers = pgTable("spoken_answers", {
  id: serial("id").primaryKey(),
  callSid: text("call_sid").notNull(),
  /** name | address | email | catalog-local | catalog-domain */
  field: text("field").notNull(),
  recordingSid: text("recording_sid"),
  recordingUrl: text("recording_url"),
  durationSec: integer("duration_sec"),
  text: text("text"),
  /** pending | done | failed */
  status: text("status").notNull().default("pending"),
  error: text("error"),
  orderId: integer("order_id"),
  customerId: integer("customer_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Staff voicemail access by phone (Abraham, Nov 13, 2026): every PIN sign-in and lockout. result: ok | wrong_pin | locked | refused_locked | no_pin */
export const vmAccessLog = pgTable(
  "vm_access_log",
  {
    id: serial("id").primaryKey(),
    callSid: text("call_sid"),
    fromNumber: text("from_number"),
    result: text("result").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("vm_access_log_created_idx").on(t.createdAt)],
);
