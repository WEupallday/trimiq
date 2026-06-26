// Subscription plans. Edit limits are per monthly billing cycle (free is a
// one-time trial allowance). Prices are USD/month.
export type PlanId = "free" | "starter" | "pro" | "unlimited";

export interface Plan {
  id: PlanId;
  name: string;
  price: number; // USD per month (0 for free)
  edits: number; // monthly edit allowance (Infinity = unlimited / fair use)
  lookupKey: string; // Stripe price lookup key
  blurb: string;
  features: string[];
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    price: 0,
    edits: 5,
    lookupKey: "trimiq_free",
    blurb: "Try it out",
    features: ["5 free edits", "No credit card needed", "Standard processing"],
  },
  starter: {
    id: "starter",
    name: "Starter",
    price: 19,
    edits: 100,
    lookupKey: "trimiq_starter_monthly",
    blurb: "For getting going",
    features: ["100 edits / month", "Batch editing", "Standard processing"],
  },
  pro: {
    id: "pro",
    name: "Pro",
    price: 49,
    edits: 300,
    lookupKey: "trimiq_pro_monthly",
    blurb: "For active sellers",
    features: ["300 edits / month", "Batch editing", "Faster processing"],
  },
  unlimited: {
    id: "unlimited",
    name: "Unlimited",
    price: 89,
    edits: Infinity,
    lookupKey: "trimiq_unlimited_monthly",
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
