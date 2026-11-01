export const BUSINESS_NAME = "Hup Up Attractions";

export const config = {
  baseUrl: () => (process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/$/, ""),
  hotlineDisplay: process.env.NEXT_PUBLIC_HOTLINE_DISPLAY || "(845) 000-0000",
  hotlineE164: process.env.NEXT_PUBLIC_HOTLINE_E164 || "+18450000000",
  voice: () => process.env.IVR_VOICE || "Polly.Matthew-Neural",
  adminEmail: () => process.env.ADMIN_EMAIL || "",
  adminPhone: () => process.env.ADMIN_PHONE || "",
  forwardPhone: () => process.env.FORWARD_PHONE || process.env.ADMIN_PHONE || "",
  twilioConfigured: () => Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
  resendConfigured: () => Boolean(process.env.RESEND_API_KEY),
  solaConfigured: () => Boolean(process.env.SOLA_PAYMENTSITE_NAME),
  isProd: () => process.env.NODE_ENV === "production",
};
