import { verifyStripeSignature } from "@/lib/stripe";
import { handleStripeEvent } from "@/lib/stripe-ops";

export const dynamic = "force-dynamic";

/** Stripe's notices (disputes, refunds made in Stripe's dashboard). Checked with STRIPE_WEBHOOK_SECRET. */
export async function POST(req: Request) {
  const payload = await req.text();
  if (!verifyStripeSignature(payload, req.headers.get("stripe-signature"), process.env.STRIPE_WEBHOOK_SECRET)) return new Response("Bad signature", { status: 400 });
  const event = JSON.parse(payload) as { type: string; data: { object: Record<string, unknown> } };
  await handleStripeEvent(event);
  return new Response("ok");
}
