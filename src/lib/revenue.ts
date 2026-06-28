// Revenue analytics, computed live from Stripe (paid invoices + subscriptions).
// Nothing here is hardcoded — every figure traces back to Stripe data. Results
// are cached briefly so the auto-refreshing dashboard doesn't hammer the API.
import { getStripe } from "./stripe";

export interface DayPoint {
  date: string; // "MM-DD"
  value: number;
}

export interface RevenueAnalytics {
  available: boolean;
  currency: string;
  mrr: number;
  arpu: number;
  activePaying: number;
  revenueToday: number;
  revenueWeek: number;
  revenueMonth: number;
  revenueLifetime: number;
  newSubsToday: number;
  newSubsWeek: number;
  canceledWeek: number;
  revenueByDay: DayPoint[];
  newSubsByDay: DayPoint[];
  activeSubsByDay: DayPoint[];
}

const DAY = 86400;
const CACHE_TTL_MS = 60 * 1000;
// Cache the raw Stripe payloads (not the computed result) so the test-account
// exclusion is always re-applied freshly without re-hitting the API.
let _rawCache: { at: number; invoices: any[]; subs: any[] } | null = null;

function empty(available: boolean): RevenueAnalytics {
  return {
    available,
    currency: "usd",
    mrr: 0,
    arpu: 0,
    activePaying: 0,
    revenueToday: 0,
    revenueWeek: 0,
    revenueMonth: 0,
    revenueLifetime: 0,
    newSubsToday: 0,
    newSubsWeek: 0,
    canceledWeek: 0,
    revenueByDay: [],
    newSubsByDay: [],
    activeSubsByDay: [],
  };
}

// Normalize any recurring price to a monthly dollar amount.
function monthlyAmount(sub: any): number {
  const item = sub?.items?.data?.[0];
  const price = item?.price;
  if (!price || typeof price.unit_amount !== "number") return 0;
  const qty = item.quantity || 1;
  const dollars = (price.unit_amount * qty) / 100;
  const interval = price.recurring?.interval || "month";
  const count = price.recurring?.interval_count || 1;
  switch (interval) {
    case "year": return dollars / (12 * count);
    case "week": return (dollars * 52) / (12 * count);
    case "day": return (dollars * 365) / (12 * count);
    default: return dollars / count; // month
  }
}

const mmdd = (unixSec: number) => {
  const d = new Date(unixSec * 1000);
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${m}-${day}`;
};

async function listAllInvoices(stripe: any): Promise<any[]> {
  const out: any[] = [];
  let starting_after: string | undefined;
  for (let page = 0; page < 12; page++) {
    const res: any = await stripe.invoices.list({ status: "paid", limit: 100, starting_after });
    out.push(...res.data);
    if (!res.has_more || res.data.length === 0) break;
    starting_after = res.data[res.data.length - 1].id;
  }
  return out;
}

async function listAllSubs(stripe: any): Promise<any[]> {
  const out: any[] = [];
  let starting_after: string | undefined;
  for (let page = 0; page < 12; page++) {
    const res: any = await stripe.subscriptions.list({ status: "all", limit: 100, starting_after });
    out.push(...res.data);
    if (!res.has_more || res.data.length === 0) break;
    starting_after = res.data[res.data.length - 1].id;
  }
  return out;
}

export async function revenueAnalytics(excludeCustomerIds: Set<string> = new Set()): Promise<RevenueAnalytics> {
  const stripe = getStripe();
  if (!stripe) return empty(false);

  try {
    let raw = _rawCache;
    if (!raw || Date.now() - raw.at >= CACHE_TTL_MS) {
      const [inv, sub] = await Promise.all([listAllInvoices(stripe), listAllSubs(stripe)]);
      raw = { at: Date.now(), invoices: inv, subs: sub };
      _rawCache = raw;
    }

    // Exclude test/founder accounts (matched by Stripe customer id) from EVERY metric.
    const custId = (c: any) => (typeof c === "string" ? c : c?.id || "");
    const invoices = raw.invoices.filter((inv: any) => !excludeCustomerIds.has(custId(inv.customer)));
    const subs = raw.subs.filter((s: any) => !excludeCustomerIds.has(custId(s.customer)));

    // Time boundaries (UTC).
    const now = new Date();
    const startOfToday = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000);
    const dow = (now.getUTCDay() + 6) % 7; // 0 = Monday
    const startOfWeek = startOfToday - dow * DAY;
    const startOfMonth = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000);

    // ---- Revenue from paid invoices ----
    let revenueToday = 0, revenueWeek = 0, revenueMonth = 0, revenueLifetime = 0;
    let currency = "usd";
    const revByDayMap = new Map<string, number>();
    for (const inv of invoices) {
      const amt = (inv.amount_paid || 0) / 100;
      const ts = inv.status_transitions?.paid_at || inv.created || 0;
      revenueLifetime += amt;
      if (ts >= startOfToday) revenueToday += amt;
      if (ts >= startOfWeek) revenueWeek += amt;
      if (ts >= startOfMonth) revenueMonth += amt;
      if (inv.currency) currency = inv.currency;
      if (ts >= startOfToday - 29 * DAY) {
        const k = mmdd(ts);
        revByDayMap.set(k, (revByDayMap.get(k) || 0) + amt);
      }
    }

    // ---- Subscriptions ----
    const isActive = (s: any) => s.status === "active" || s.status === "trialing";
    const activeSubs = subs.filter(isActive);
    const activePaying = activeSubs.length;
    const mrr = activeSubs.reduce((sum, s) => sum + monthlyAmount(s), 0);
    const arpu = activePaying > 0 ? mrr / activePaying : 0;

    const newSubsToday = subs.filter((s) => (s.created || 0) >= startOfToday).length;
    const newSubsWeek = subs.filter((s) => (s.created || 0) >= startOfWeek).length;
    const canceledWeek = subs.filter((s) => (s.canceled_at || 0) >= startOfWeek).length;

    // ---- 30-day daily series ----
    const revenueByDay: DayPoint[] = [];
    const newSubsByDay: DayPoint[] = [];
    const activeSubsByDay: DayPoint[] = [];
    for (let i = 29; i >= 0; i--) {
      const dayStart = startOfToday - i * DAY;
      const dayEnd = dayStart + DAY;
      const key = mmdd(dayStart);
      revenueByDay.push({ date: key, value: Math.round((revByDayMap.get(key) || 0) * 100) / 100 });
      newSubsByDay.push({
        date: key,
        value: subs.filter((s) => (s.created || 0) >= dayStart && (s.created || 0) < dayEnd).length,
      });
      activeSubsByDay.push({
        date: key,
        value: subs.filter(
          (s) =>
            (s.created || 0) < dayEnd &&
            (!s.canceled_at || s.canceled_at >= dayEnd) &&
            s.status !== "incomplete" &&
            s.status !== "incomplete_expired"
        ).length,
      });
    }

    const round = (n: number) => Math.round(n * 100) / 100;
    const data: RevenueAnalytics = {
      available: true,
      currency,
      mrr: round(mrr),
      arpu: round(arpu),
      activePaying,
      revenueToday: round(revenueToday),
      revenueWeek: round(revenueWeek),
      revenueMonth: round(revenueMonth),
      revenueLifetime: round(revenueLifetime),
      newSubsToday,
      newSubsWeek,
      canceledWeek,
      revenueByDay,
      newSubsByDay,
      activeSubsByDay,
    };
    return data;
  } catch (e) {
    console.error("REVENUE ANALYTICS ERROR:", (e as any)?.message || e);
    return empty(true);
  }
}
