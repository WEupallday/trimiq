// ===========================================================================
// TrimIQ plan configuration - THE single source of truth for every plan
// limit and feature gate. Nothing else in the codebase hardcodes a limit:
// routes call the helpers below, so changing a number here changes the app.
//
// PRICING: there are NO dollar prices in code. Each paid plan points at a
// Stripe Price via an env var (STRIPE_PRICE_*); live prices are read from
// Stripe at runtime. Change prices in Stripe - no code change required.
// ===========================================================================
export type PlanId = "free" | "starter" | "pro" | "unlimited";

export interface Plan {
  id: PlanId;
  name: string;
  blurb: string;
  priceEnvVar: string | null; // env var holding the Stripe Price ID (null = free)

  // ---- credits & size limits ----
  edits: number;         // monthly edit credits (Infinity = fair use)
  fairUseSoftCap: number | null; // unlimited only: past this, priority drops to standard
  batchSize: number;     // max videos per batch upload
  maxVideoMin: number;   // max length of a single video
  maxUploadMB: number;   // max upload size of a single video

  // ---- feature gates ----
  captions: boolean;         // AI captions + full customization
  instructions: boolean;     // natural-language Edit Instructions
  zooms: boolean;            // AI zoom effects
  regensPerEdit: number;     // regenerations allowed per edit (0 = none)
  bulkDownload: boolean;     // "download all" for completed batches
  llmInstructions: boolean;  // Edit Instructions v2 (LLM) when it ships
  keelzStyle: boolean;       // "Keelz style" 3-point creator preset (Unlimited-only)
  allFutureFeatures: boolean;

  // ---- processing ----
  priority: number;      // queue weight: 0 free, 1 starter, 2 pro, 3 unlimited
  slots: number;         // concurrent processing slots per user
  retentionHours: number; // how long originals are kept for regenerate

  features: string[];    // marketing bullets (pricing page)
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free", name: "Free", blurb: "Try TrimIQ",
    priceEnvVar: null,
    edits: 5, fairUseSoftCap: null, batchSize: 2, maxVideoMin: 5, maxUploadMB: 250,
    captions: false, instructions: false, zooms: false,
regensPerEdit: 0, bulkDownload: false, llmInstructions: false, keelzStyle: false, allFutureFeatures: false,
    priority: 0, slots: 1, retentionHours: 24,
    features: [
      "5 TrimIQ edits / month",
      "Full-quality export - no watermark",
      "All 3 editing styles",
      "See exactly what TrimIQ improved",
    ],
  },
  starter: {
    id: "starter", name: "Starter", blurb: "For creators posting weekly",
    priceEnvVar: "STRIPE_PRICE_STARTER",
    edits: 80, fairUseSoftCap: null, batchSize: 5, maxVideoMin: 15, maxUploadMB: 1024,
    captions: true, instructions: true, zooms: false,
regensPerEdit: 3, bulkDownload: true, llmInstructions: false, keelzStyle: false, allFutureFeatures: false,
    priority: 1, slots: 1, retentionHours: 72,
    features: [
      "80 TrimIQ edits / month",
      "Auto captions with full styling",
      "Natural-language Edit Instructions",
      "Batch upload - 5 videos at once",
      "Regenerate without re-uploading",
      "Bulk download",
    ],
  },
  pro: {
    id: "pro", name: "Pro", blurb: "For serious creators",
    priceEnvVar: "STRIPE_PRICE_PRO",
    edits: 250, fairUseSoftCap: null, batchSize: 10, maxVideoMin: 30, maxUploadMB: 2048,
    captions: true, instructions: true, zooms: true,
regensPerEdit: 10, bulkDownload: true, llmInstructions: true, keelzStyle: false, allFutureFeatures: false,
    priority: 2, slots: 2, retentionHours: 72,
    features: [
      "250 TrimIQ edits / month",
      "Everything in Starter",
      "Smart zoom effects",
      "Priority processing",
      "Batch upload - 10 videos at once",
      "2 videos processed at once",
    ],
  },
  unlimited: {
    id: "unlimited", name: "Unlimited", blurb: "For power users & agencies",
    priceEnvVar: "STRIPE_PRICE_UNLIMITED",
    edits: Infinity, fairUseSoftCap: 800, batchSize: 20, maxVideoMin: 60, maxUploadMB: 4096,
    captions: true, instructions: true, zooms: true,
regensPerEdit: Infinity, bulkDownload: true, llmInstructions: true, keelzStyle: true, allFutureFeatures: true,
    priority: 3, slots: 3, retentionHours: 168,
    features: [
      "Fair-use unlimited edits",
      "Highest processing priority",
      "Batch upload - 20 videos at once",
      "3 videos processed at once",
      "7-day regenerate window",
      "Every current & future premium feature",
    ],
  },
};

export const PAID_PLAN_IDS: PlanId[] = ["starter", "pro", "unlimited"];
export const PAID_PLANS: Plan[] = PAID_PLAN_IDS.map((id) => PLANS[id]);
export const ALL_PLANS: Plan[] = ["free", "starter", "pro", "unlimited"].map((id) => PLANS[id as PlanId]);

export function getPlan(id: string | null | undefined): Plan {
  return (id && (PLANS as Record<string, Plan>)[id]) || PLANS.free;
}

// Resolve either a plan id or an already-resolved Plan object. Lets the
// enforcement helpers below accept the effective per-user plan (which may be
// the Creator Beta grant) without changing any call sites that pass ids.
function resolvePlan(p: Plan | string | null | undefined): Plan {
  return p && typeof p === "object" ? p : getPlan(p as string | null | undefined);
}

// Creator Beta: invite-only testers get every premium feature (captions,
// instructions, zooms, phrase-zooms) with tight limits. Flag-driven via the
// user's isCreatorBeta bit - never sold and never shown on the pricing page.
export const CREATOR_BETA_PLAN: Plan = {
  id: "unlimited", // gates like the top tier; identified by name, not id
  name: "Creator Beta",
  blurb: "Invite-only creator testers",
  priceEnvVar: null,
  edits: 15, fairUseSoftCap: null, batchSize: 10, maxVideoMin: 15, maxUploadMB: 2048,
  captions: true, instructions: true, zooms: true,
regensPerEdit: 10, bulkDownload: true, llmInstructions: true, keelzStyle: true, allFutureFeatures: true,
  priority: 2, slots: 2, retentionHours: 72,
  features: ["Every premium feature", "15 edits / month", "Videos up to 15 min"],
};

// The plan that actually applies to a user. Creator Beta upgrades the feature
// gates, but a broader PAID plan always wins so the grant never downgrades a
// real subscriber.
export function planForUser(planId: string | null | undefined, isCreatorBeta?: boolean | null): Plan {
  const base = getPlan(planId);
  if (!isCreatorBeta) return base;
  if (base.zooms && (!isFinite(base.edits) || base.edits > CREATOR_BETA_PLAN.edits)) return base;
  return CREATOR_BETA_PLAN;
}

export function editLimitFor(planId: string | null | undefined): number {
  return getPlan(planId).edits;
}

// The env var name that holds a plan's Stripe Price ID (null for free).
export function priceEnvVarFor(planId: string | null | undefined): string | null {
  return getPlan(planId).priceEnvVar;
}

// ---------------------------------------------------------------------------
// Server-side enforcement helpers. ALL feature gating goes through here so
// there are no scattered plan checks around the codebase.
// ---------------------------------------------------------------------------

// Queue priority for a user, honoring the Unlimited fair-use soft cap:
// past the cap the account keeps editing but at standard priority.
export function priorityFor(plan: Plan | string, editsUsedThisCycle: number): number {
  const p = resolvePlan(plan);
  if (p.fairUseSoftCap != null && editsUsedThisCycle >= p.fairUseSoftCap) return 0;
  return p.priority;
}

// Strip plan-gated features out of parsed Edit Instruction overrides.
// Returns what was locked so the UI can upsell instead of silently ignoring.
// (EditOverrides is structurally typed here to avoid an import cycle.)
export function applyPlanGates<T extends { captions?: unknown; zoom?: unknown }>(
  plan: Plan | string,
  overrides: T,
): { overrides: T; locked: string[] } {
  const p = resolvePlan(plan);
  const locked: string[] = [];
  const out = { ...overrides };
  if (!p.captions && out.captions) {
    delete out.captions;
    locked.push("Auto captions (Starter and up)");
  }
  if (!p.zooms && out.zoom) {
    delete out.zoom;
    locked.push("Smart zoom effects (Pro and up)");
  } else if (out.zoom && (out.zoom as { keelz?: boolean }).keelz && !p.keelzStyle) {
    // Keelz preset is Unlimited-only; downgrade to normal zooms for others.
    delete (out.zoom as { keelz?: boolean }).keelz;
    locked.push("Keelz style is an Unlimited-plan feature");
  }
  return { overrides: out, locked };
}

export function maxUploadBytesFor(plan: Plan | string): number {
  return resolvePlan(plan).maxUploadMB * 1024 * 1024;
}

export function maxVideoSecondsFor(plan: Plan | string): number {
  return resolvePlan(plan).maxVideoMin * 60;
}

// Client-safe summary of a user's plan for the dashboard (no secrets).
export function planSummary(plan: Plan | string) {
  const p = resolvePlan(plan);
  return {
    id: p.id, name: p.name,
    edits: isFinite(p.edits) ? p.edits : null,
    batchSize: p.batchSize, maxVideoMin: p.maxVideoMin, maxUploadMB: p.maxUploadMB,
    captions: p.captions, instructions: p.instructions, zooms: p.zooms,
    regensPerEdit: isFinite(p.regensPerEdit) ? p.regensPerEdit : null,
bulkDownload: p.bulkDownload, priority: p.priority, slots: p.slots,
    keelzStyle: p.keelzStyle,
    retentionHours: p.retentionHours,
  };
}
