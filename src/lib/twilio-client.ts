import twilio from "twilio";

type Client = ReturnType<typeof twilio>;
let client: Client | null = null;
let override: Client | null | undefined;

/** Twilio REST client, or null when credentials aren't configured. */
export function getTwilio(): Client | null {
  if (override !== undefined) return override;
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) return null;
  client ??= twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  return client;
}

/** Tests: inject a fake client (or null). Pass undefined to restore. */
export function setTwilioForTests(c: unknown) {
  override = c as Client | null | undefined;
}
