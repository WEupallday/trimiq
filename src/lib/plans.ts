// Subscription plans.
//
// IMPORTANT: there are NO hardcoded dollar prices in this file (or anywhere in
// the codebase). All pricing is controlled entirely by Stripe — each paid plan
// points at a Stripe Price via an environment variable (STRIPE_PRICE_*), and the
// live dollar amount is read from Stripe at runtime. To change a price, change it
// in Stripe (or point the env var at a new Price ID); no code change required.
//
// `edits` here is a product feature limit (edits allowed per billing cycle), not
// pricing — it stays in code.
export type PlanId = "free" | "starter" | "pro" | "unlimited";

export interface Plan {
  id: PlanId;
  name: string;
  edits: number; // monthly edit allowance (Infinity = unlimited / fair use)
  priceEnvVar: string | null; // env var holding this plan's Stripe Price ID (null for free)
  blurb: string;
  features: string[];
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    edits: 5,
    priceEnvVar: null,
    blurb: "Try it out",
    features: ["5 free edits", "No credit card needed", "Standard processing"],
  },
  starter: {
    id: "starter",
    name: "Starter",
    edits: 100,
    priceEnvVar: "STRIPE_PRICE_STARTER",
    blurb: "For getting going",
    features: ["100 edits / month", "Batch editing", "Standard processing"],
  },
  pro: {
    id: "pro",
    name: "Pro",
    edits: 300,
    priceEnvVar: "STRIPE_PRICE_PRO",
    blurb: "For active sellers",
    features: ["300 edits / month", "Batch editing", "Faster processing"],
  },
  unlimited: {
    id: "unlimited",
    name: "Unlimited",
    edits: Infinity,
    priceEnvVar: "STRIPE_PRICE_UNLIMITED",
    blurb: "For power users",
    features: ["Unlimited edits (fair use)", "Batch editing", "Highest priority"],
  },
};

export const PAID_PLAN_IDS: PlanId[] = ["starter", "pro", "unlimited"];
export const PAID_PLANS: Plan[] = PAID_PLAN_IDS.map((id) => PLANS[id]);
export const ALL_PLANS: Plan[] = ["free", "starter", "pro", "unlimited"].map((id) => PLANS[id as PlanId]);

export function getPlan(id: string | null | undefined): Plan {
  return (id && (PLANS as Record<string, Plan>)[id]) || PLANS.free;
}

export function editLimitFor(planId: string | null | undefined): number {
  return getPlan(planId).edits;
}

// The env var name that holds a plan's Stripe Price ID (null for free).
export function priceEnvVarFor(planId: string | null | undefined): string | null {
  return getPlan(planId).priceEnvVar;
}
