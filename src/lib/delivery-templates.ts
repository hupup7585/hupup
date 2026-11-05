/** Approved delivery texts (Abram's exact wording, Round 7). Sent only with order-text consent. */
export const DELIVERY_TEMPLATES = {
  on_the_way: { label: "Driver on the way", body: "Hello, this is Hup Up Attractions. Your delivery driver is on the way with your rental order. Thank you!" },
  delivered: { label: "Delivery completed", body: "Hello, your Hup Up Attractions delivery has been completed. Your rental items have been delivered. Thank you for choosing Hup Up Attractions!" },
  delay: { label: "Delivery delay", body: "Hello, this is Hup Up Attractions. Your delivery is experiencing a delay. We will update you as soon as possible. Thank you for your patience." },
  pickup_reminder: { label: "Pickup reminder", body: "Hello, this is Hup Up Attractions. This is a reminder that your rental pickup is scheduled. Thank you!" },
} as const;

export type TemplateKey = keyof typeof DELIVERY_TEMPLATES;
