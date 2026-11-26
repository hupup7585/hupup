import { verifyStripeSignature } from "@/lib/stripe";
import { handleStripeEvent } from "@/lib/stripe-ops";
import { withCallbackAlert } from "@/lib/ops-alerts";

export const dynamic = "force-dynamic";

/** Stripe's notices (disputes, refunds made in Stripe's dashboard). Checked with STRIPE_WEBHOOK_SECRET. A failure
 * emails the Owner and returns 500 so Stripe sends it again (gap review, Nov 26, 2026). */
export async function POST(req: Request) {
  return withCallbackAlert("Stripe", () => handle(req));
}

async function handle(req: Request): Promise<Response> {
  const payload = await req.text();
  if (!verifyStripeSignature(payload, req.headers.get("stripe-signature"), process.env.STRIPE_WEBHOOK_SECRET)) return new Response("Bad signature", { status: 400 });
  const event = JSON.parse(payload) as { type: string; data: { object: Record<string, unknown> } };
  await handleStripeEvent(event);
  return new Response("ok");
}
