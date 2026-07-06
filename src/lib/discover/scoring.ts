// Viral Product Intelligence scoring. Operates on the ONLY honest signal:
// changes in the public sold-count over time. Validated against breakout /
// steady / cooling / noisy archetypes before shipping.

export type Snap = { capturedAt: Date; price: number; soldLo: number; confidence?: number };
export type RawProduct = { id: string; category: string; creatorSpread?: number; snapshots: Snap[] };

// ─────────────────────────────────────────────────────────────────────────────
// SCORING CONFIG — the ONLY place to recalibrate. These weights/thresholds are
// deliberately simple placeholders tuned on mock data; once REAL provider data
// is flowing, adjust everything here (it can later be moved to env/DB so tuning
// needs no deploy). The scoring functions read exclusively from this object.
// ─────────────────────────────────────────────────────────────────────────────
export const SCORING = {
  windows: [7, 30, 90] as number[],
  ewmaAlpha: 0.3,                 // EWMA smoothing for the breakout baseline
  breakout: {
    minPoints: 8,                 // need at least this many daily deltas
    recentDays: 3,                // "spike" window compared to the baseline
    sigmaK: 2,                    // spike must exceed baseline + k·σ
    growthMin: 0.5,               // ...and >50% acceleration vs the prior window
  },
  state: {
    coolingGrowth: -0.3,          // growth below this => "cooling"
    stableAbsGrowth: 0.15,        // |growth| below this => "stable"
  },
  viral: { wVel: 0.25, wGrowth: 0.35, wSpread: 0.20, wConfidencePenalty: 0.30 },
  momentum: { wGrowth: 0.6, wVel: 0.4 },
};

const WINDOWS = SCORING.windows;
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const log1p = (x: number) => Math.log(1 + Math.max(0, x));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

// Parse a displayed sold count -> { lo, confidence 0..1 }.
export function parseSoldCount(raw: string | number | null | undefined): { lo: number; confidence: number } {
  if (raw == null) return { lo: 0, confidence: 0 };
  let s = String(raw).trim().toLowerCase().replace(/,/g, "").replace(/\s+/g, "");
  const bucketed = s.includes("+");
  s = s.replace(/\+/g, "");
  let mult = 1;
  if (s.endsWith("k")) { mult = 1e3; s = s.slice(0, -1); }
  else if (s.endsWith("m")) { mult = 1e6; s = s.slice(0, -1); }
  const n = parseFloat(s);
  if (!isFinite(n)) return { lo: 0, confidence: 0 };
  let confidence = 1;
  if (bucketed) confidence -= 0.4;
  if (mult >= 1e3) confidence -= 0.2;
  return { lo: Math.floor(n * mult), confidence: Math.max(0.2, confidence) };
}

// Sorted daily units = clamped positive deltas of the cumulative sold count.
function dailyUnits(snaps: Snap[]): { units: number; price: number }[] {
  const s = [...snaps].sort((a, b) => +new Date(a.capturedAt) - +new Date(b.capturedAt));
  const out: { units: number; price: number }[] = [];
  for (let i = 1; i < s.length; i++) out.push({ units: Math.max(0, s[i].soldLo - s[i - 1].soldLo), price: s[i].price });
  return out;
}

type WinFeat = { velRecent: number; velPrev: number; growthRate: number; gmv: number };
type Raw = {
  id: string; category: string; creatorSpread: number; confidence: number;
  latestPrice: number; latestSoldCount: number; isBreakout: boolean; state: string;
  win: Record<number, WinFeat>;
};

function rawFeatures(p: RawProduct): Raw {
  const sorted = [...p.snapshots].sort((a, b) => +new Date(a.capturedAt) - +new Date(b.capturedAt));
  const units = dailyUnits(sorted);
  const conf = avg(sorted.map((s) => s.confidence ?? 1));
  const win: Record<number, WinFeat> = {};
  for (const W of WINDOWS) {
    const recent = units.slice(-W);
    const prev = units.slice(-2 * W, -W);
    const velRecent = avg(recent.map((u) => u.units));
    const velPrev = avg(prev.map((u) => u.units));
    const growthRate = (velRecent - velPrev) / Math.max(velPrev, 1);
    const gmv = avg(recent.map((u) => u.price)) * recent.reduce((s, u) => s + u.units, 0);
    win[W] = { velRecent, velPrev, growthRate, gmv };
  }

  // Breakout detection on the 7d window, baseline computed from history BEFORE
  // the recent window so a fresh spike can't inflate (and hide within) its own variance.
  const B = SCORING.breakout;
  const history = units.slice(0, -B.recentDays);
  const alpha = SCORING.ewmaAlpha;
  let ewma = 0, ewvar = 0; let init = false;
  for (const u of history) {
    if (!init) { ewma = u.units; init = true; continue; }
    const diff = u.units - ewma;
    ewma += alpha * diff;
    ewvar = (1 - alpha) * (ewvar + alpha * diff * diff);
  }
  const sigma = Math.sqrt(ewvar);
  const lastSpike = avg(units.slice(-B.recentDays).map((u) => u.units));
  const g7 = win[7].growthRate;
  const isBreakout = units.length >= B.minPoints && lastSpike > ewma + B.sigmaK * sigma && g7 > B.growthMin;

  let state = "stable";
  if (isBreakout) state = "breakout";
  else if (g7 < SCORING.state.coolingGrowth) state = "cooling";
  else if (Math.abs(g7) < SCORING.state.stableAbsGrowth) state = "stable";
  else if (g7 > 0) state = "rising";

  return {
    id: p.id, category: p.category, creatorSpread: p.creatorSpread ?? 0, confidence: conf,
    latestPrice: sorted.length ? sorted[sorted.length - 1].price : 0,
    latestSoldCount: sorted.length ? sorted[sorted.length - 1].soldLo : 0,
    isBreakout, state, win,
  };
}

export type Scored = {
  id: string; category: string; latestPrice: number; latestSoldCount: number;
  confidence: number; state: string; isBreakout: boolean; creatorSpread: number;
  trend7: number; trend30: number; trend90: number; momentum7: number;
  vel7: number; vel30: number; gmv7: number; gmv30: number; gmv90: number; growth7: number;
};

function zscorer(vals: number[]) {
  const m = avg(vals);
  const sd = Math.sqrt(avg(vals.map((v) => (v - m) ** 2))) || 1;
  return (x: number) => (x - m) / sd;
}

// Score all products together; z-scores are category-relative for fairness.
export function scoreProducts(products: RawProduct[]): Scored[] {
  const feats = products.map(rawFeatures);
  const groups: Record<string, Raw[]> = {};
  for (const f of feats) (groups[f.category] ||= []).push(f);

  const out: Scored[] = [];
  for (const cat of Object.keys(groups)) {
    const group = groups[cat];
    const V = SCORING.viral, M = SCORING.momentum;
    const trendFor = (W: number, f: Raw) => {
      const zVel = zscorer(group.map((x) => log1p(x.win[W].velRecent)));
      const zGrow = zscorer(group.map((x) => x.win[W].growthRate));
      const zSpread = zscorer(group.map((x) => x.creatorSpread));
      const raw =
        V.wVel * zVel(log1p(f.win[W].velRecent)) +
        V.wGrowth * zGrow(f.win[W].growthRate) +
        V.wSpread * zSpread(f.creatorSpread) -
        V.wConfidencePenalty * (1 - f.confidence);
      return Math.round(100 * sigmoid(raw));
    };
    const momentumFor = (W: number, f: Raw) => {
      const zVel = zscorer(group.map((x) => log1p(x.win[W].velRecent)));
      const zGrow = zscorer(group.map((x) => x.win[W].growthRate));
      return Math.round(100 * sigmoid(M.wGrowth * zGrow(f.win[W].growthRate) + M.wVel * zVel(log1p(f.win[W].velRecent))));
    };
    for (const f of group) {
      out.push({
        id: f.id, category: f.category, latestPrice: f.latestPrice, latestSoldCount: f.latestSoldCount,
        confidence: Math.round(f.confidence * 100) / 100, state: f.state, isBreakout: f.isBreakout,
        creatorSpread: f.creatorSpread,
        trend7: trendFor(7, f), trend30: trendFor(30, f), trend90: trendFor(90, f), momentum7: momentumFor(7, f),
        vel7: Math.round(f.win[7].velRecent), vel30: Math.round(f.win[30].velRecent),
        gmv7: Math.round(f.win[7].gmv), gmv30: Math.round(f.win[30].gmv), gmv90: Math.round(f.win[90].gmv),
        growth7: Math.round(f.win[7].growthRate * 100) / 100,
      });
    }
  }
  return out;
}
