// Stripe billing helpers. Everything is keyed off STRIPE_SECRET_KEY (test mode).
// Products/prices are created on demand (idempotent via lookup_key), so no manual
// Stripe dashboard setup is required beyond providing the API keys.
import Stripe from "stripe";
import { prisma } from "./db";
import { getPlan, type PlanId } from "./plans";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  _stripe = new Stripe(key);
  return _stripe;
}

const priceCache: Record<string, string> = {};

// Ensure a recurring monthly Price exists for a paid plan; return its id.
export async function priceIdFor(stripe: Stripe, planId: PlanId): Promise<string> {
  const plan = getPlan(planId);
  if (priceCache[plan.lookupKey]) return priceCache[plan.lookupKey];

  const existing = await stripe.prices.list({ lookup_keys: [plan.lookupKey], active: true, limit: 1 });
  if (existing.data[0]) {
    priceCache[plan.lookupKey] = existing.data[0].id;
    return existing.data[0].id;
  }

  const product = await stripe.products.create({ name: `TrimIQ ${plan.name}`, metadata: { planId } });
  const price = await stripe.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: plan.price * 100,
    recurring: { interval: "month" },
    lookup_key: plan.lookupKey,
    metadata: { planId },
  });
  priceCache[plan.lookupKey] = price.id;
  return price.id;
}

export async function getOrCreateCustomer(stripe: Stripe, email: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (user?.stripeCustomerId) return user.stripeCustomerId;
  const customer = await stripe.customers.create({ email, metadata: { email } });
  await prisma.user.update({ where: { email }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}

// Sync a subscription's state onto the user record. resetEdits=true on new/renewed
// billing cycles.
export async function syncSubscription(sub: any, resetEdits: boolean) {
  const planId: string = sub?.metadata?.planId || planIdFromSub(sub) || "free";
  const email: string | undefined = sub?.metadata?.email;
  const customerId: string = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  const periodEnd = sub?.current_period_end ? new Date(sub.current_period_end * 1000) : null;
  const active = sub.status === "active" || sub.status === "trialing";

  const data: any = {
    plan: active ? planId : "free",
    stripeSubscriptionId: sub.id,
    subscriptionStatus: sub.status,
    currentPeriodEnd: periodEnd,
  };
  if (resetEdits) data.editsUsed = 0;

  // Find by email (preferred) or by customer id.
  if (email) {
    await prisma.user.update({ where: { email }, data }).catch(async () => {
      await prisma.user.updateMany({ where: { stripeCustomerId: customerId }, data });
    });
  } else if (customerId) {
    await prisma.user.updateMany({ where: { stripeCustomerId: customerId }, data });
  }
}

// Try to infer the plan from the subscription's price lookup_key.
function planIdFromSub(sub: any): string | null {
  const lk: string | undefined = sub?.items?.data?.[0]?.price?.lookup_key;
  if (!lk) return null;
  if (lk.includes("starter")) return "starter";
  if (lk.includes("pro")) return "pro";
  if (lk.includes("unlimited")) return "unlimited";
  return null;
}
