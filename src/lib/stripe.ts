// Stripe billing helpers.
//
// PRICING IS 100% STRIPE-DRIVEN. Each paid plan's price lives in Stripe and is
// referenced by a Price ID stored in an environment variable:
//   STRIPE_PRICE_STARTER, STRIPE_PRICE_PRO, STRIPE_PRICE_UNLIMITED
// Nothing in this codebase hardcodes a dollar amount. To change a price, change
// it in Stripe (or repoint the env var) — no deploy needed.
import Stripe from "stripe";
import { prisma } from "./db";
import { priceEnvVarFor, PAID_PLAN_IDS, type PlanId } from "./plans";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  _stripe = new Stripe(key);
  return _stripe;
}

// The Stripe Price ID configured for a plan (from its env var). null = not set.
export function priceIdForPlan(planId: string | null | undefined): string | null {
  const envVar = priceEnvVarFor(planId);
  if (!envVar) return null;
  const id = (process.env[envVar] || "").trim();
  return id || null;
}

// Reverse lookup: which plan does a given Stripe Price ID belong to?
export function planFromPriceId(priceId: string | null | undefined): PlanId | null {
  if (!priceId) return null;
  for (const id of PAID_PLAN_IDS) {
    if (priceIdForPlan(id) === priceId) return id;
  }
  return null;
}

// ----- Live prices (read dollar amounts straight from Stripe) ----------------
export interface LivePrice {
  amount: number | null; // dollars/month (null if not configured / unavailable)
  currency: string;
  interval: string;
}
export type LivePrices = Record<PlanId, LivePrice>;

let _priceCache: { at: number; data: LivePrices } | null = null;
const PRICE_TTL_MS = 5 * 60 * 1000;

export async function getLivePrices(): Promise<LivePrices> {
  if (_priceCache && Date.now() - _priceCache.at < PRICE_TTL_MS) return _priceCache.data;

  const blank: LivePrice = { amount: null, currency: "usd", interval: "month" };
  const data: LivePrices = {
    free: { amount: 0, currency: "usd", interval: "month" },
    starter: { ...blank },
    pro: { ...blank },
    unlimited: { ...blank },
  };

  const stripe = getStripe();
  if (stripe) {
    await Promise.all(
      PAID_PLAN_IDS.map(async (id) => {
        const priceId = priceIdForPlan(id);
        if (!priceId) return;
        try {
          const price = await stripe.prices.retrieve(priceId);
          data[id] = {
            amount: typeof price.unit_amount === "number" ? price.unit_amount / 100 : null,
            currency: price.currency || "usd",
            interval: price.recurring?.interval || "month",
          };
        } catch (e) {
          console.error(`PRICE FETCH ERROR for ${id} (${priceId}):`, (e as any)?.message || e);
        }
      })
    );
  }

  _priceCache = { at: Date.now(), data };
  return data;
}

export async function getOrCreateCustomer(stripe: Stripe, email: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (user?.stripeCustomerId) return user.stripeCustomerId;
  const customer = await stripe.customers.create({ email, metadata: { email } });
  await prisma.user.update({ where: { email }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}

// Determine a subscription's plan using ONLY the Stripe subscription object:
//   1) the Price ID on the subscription item -> our configured plan, then
//   2) the subscription metadata.planId we set at checkout/upgrade, then
//   3) (migration safety) the price's lookup_key from the old price scheme.
export function planFromSub(sub: any): PlanId | null {
  const priceId: string | undefined = sub?.items?.data?.[0]?.price?.id;
  const byPrice = planFromPriceId(priceId);
  if (byPrice) return byPrice;

  const meta = sub?.metadata?.planId;
  if (meta && ["starter", "pro", "unlimited", "free"].includes(meta)) return meta as PlanId;

  const lk: string | undefined = sub?.items?.data?.[0]?.price?.lookup_key;
  if (lk) {
    if (lk.includes("starter")) return "starter";
    if (lk.includes("unlimited")) return "unlimited";
    if (lk.includes("pro")) return "pro";
  }
  return null;
}

// Sync a subscription's state onto the user record. resetEdits=true on new/renewed
// billing cycles. The plan is derived purely from the Stripe subscription.
export async function syncSubscription(sub: any, resetEdits: boolean) {
  const active = sub.status === "active" || sub.status === "trialing";
  const planId: string = (active ? planFromSub(sub) : null) || "free";
  const email: string | undefined = sub?.metadata?.email;
  const customerId: string = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  const periodEnd = sub?.current_period_end ? new Date(sub.current_period_end * 1000) : null;

  const data: any = {
    plan: active ? planId : "free",
    stripeSubscriptionId: sub.id,
    subscriptionStatus: sub.status,
    currentPeriodEnd: periodEnd,
  };
  if (resetEdits) data.editsUsed = 0;

  if (email) {
    await prisma.user.update({ where: { email }, data }).catch(async () => {
      await prisma.user.updateMany({ where: { stripeCustomerId: customerId }, data });
    });
  } else if (customerId) {
    await prisma.user.updateMany({ where: { stripeCustomerId: customerId }, data });
  }
}
