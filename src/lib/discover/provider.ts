// Data-provider adapter for Discover. The system is provider-AGNOSTIC: to plug in
// a real TikTok Shop data provider (e.g. an Apify actor or Bright Data feed),
// implement DiscoverProvider.fetchProducts() to return this same normalized shape
// and select it in getProvider() via the DISCOVER_PROVIDER env var. Until then we
// run on a realistic MockProvider so the whole pipeline + UI work end-to-end.

export type ProviderSnap = { capturedAt: Date; price: number; soldLo: number; confidence: number };

// ── Future: creator/video intelligence (NOT yet populated by any provider). ──
// The Product Detail page renders a "coming soon" section for this. A future
// provider backed by the official TikTok Shop / Affiliate API or a licensed data
// source (e.g. Kalodata / FastMoss / Shoplus) can fill `creators` with REAL public
// videos; each videoUrl is embeddable via TikTok's public oEmbed. Until a real
// source exists this stays undefined — we never fabricate creator data.
export type CreatorVideo = {
  creatorHandle: string; // @handle
  videoUrl: string;      // public TikTok video URL
  postedAt?: string;     // ISO date
  views?: number;
  likes?: number;
};

export type ProductRecord = {
  tiktokProductId: string;
  title: string;
  imageUrl?: string;
  productUrl?: string;
  sellerName?: string;
  category: string;   // beauty | home | fitness
  region: string;     // US
  currency: string;   // USD
  creatorSpread: number;
  snapshots: ProviderSnap[];
  creators?: CreatorVideo[]; // optional; populated only when a real source is connected
};

export interface DiscoverProvider {
  name: string;
  fetchProducts(opts: { region: string; categories: string[] }): Promise<ProductRecord[]>;
}

// ------------------------------ Mock provider ------------------------------
const DAY = 24 * 60 * 60 * 1000;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

const TITLES: Record<string, string[]> = {
  beauty: ["Glow Serum Vitamin C", "Lip Oil Tint Set", "Matte Powder Cushion", "Lash Growth Serum", "Snail Mucin Essence", "Blurring Primer Stick", "Under-Eye Brightener", "Peptide Night Cream"],
  home: ["LED Sunset Lamp", "Mini Portable Blender", "Non-Stick Egg Pan", "Silicone Sink Organizer", "Cordless Vacuum Mop", "Smart Motion Night Light", "Reusable Food Storage Set", "Aroma Diffuser 500ml"],
  fitness: ["Resistance Band Kit", "Adjustable Dumbbell 25lb", "Massage Gun Mini", "Smart Jump Rope", "Ab Roller Wheel Pro", "Posture Corrector Belt", "Grip Strength Trainer", "Insulated Gym Bottle 1L"],
};
const SELLERS = ["Aurora Beauty Co", "HomeNest", "FitForge", "Lume Labs", "DailyKit", "PeakPerform", "Nordic Home", "GlowUp Studio"];
const ARCHES = ["breakout", "rising", "steady", "cooling", "noisy"] as const;

// Daily units for 100 days following an archetype.
function history(arch: string): { units: number; conf: number }[] {
  const N = 100;
  const out: { units: number; conf: number }[] = [];
  for (let d = 0; d < N; d++) {
    let u = 0, conf = 1;
    if (arch === "breakout") {
      const base = rnd(3, 9);
      u = d < 88 ? base + rnd(-2, 3) : base * Math.pow(1.6, d - 88) + rnd(0, 20);
    } else if (arch === "rising") {
      u = 20 + d * rnd(1.2, 2.2) + rnd(-8, 8);
    } else if (arch === "steady") {
      u = rnd(90, 200) * 0 + 140 + rnd(-25, 25);
    } else if (arch === "cooling") {
      u = Math.max(2, 320 * Math.exp(-d / 28) + rnd(-10, 10));
    } else { // noisy, low volume, bucketed sold count
      u = rnd(8, 34); conf = 0.6;
    }
    out.push({ units: Math.max(0, Math.round(u)), conf });
  }
  return out;
}

function makeProduct(category: string, i: number): ProductRecord {
  const arch = pick(ARCHES as unknown as string[]);
  const price = Math.round(rnd(8, 49)) - 0.01 + 0.0; // e.g. 23.99
  const priceR = Math.round(price * 100) / 100;
  const h = history(arch);
  let sold = Math.round(rnd(200, 3000));
  const now = Date.now();
  const snapshots: ProviderSnap[] = h.map((row, d) => {
    sold += row.units;
    return { capturedAt: new Date(now - (h.length - 1 - d) * DAY), price: priceR, soldLo: sold, confidence: row.conf };
  });
  const creatorSpread =
    arch === "breakout" ? Math.round(rnd(6, 13)) :
    arch === "rising" ? Math.round(rnd(3, 8)) :
    arch === "steady" ? Math.round(rnd(2, 6)) :
    arch === "cooling" ? Math.round(rnd(0, 3)) : Math.round(rnd(0, 2));
  const id = `mock_${category}_${i}`;
  return {
    tiktokProductId: id,
    title: TITLES[category][i % TITLES[category].length],
    imageUrl: `https://picsum.photos/seed/${id}/320/320`,
    productUrl: "https://shop.tiktok.com/",
    sellerName: pick(SELLERS),
    category, region: "US", currency: "USD",
    creatorSpread,
    snapshots,
  };
}

class MockProvider implements DiscoverProvider {
  name = "mock";
  async fetchProducts({ categories }: { region: string; categories: string[] }): Promise<ProductRecord[]> {
    const out: ProductRecord[] = [];
    for (const cat of categories) {
      const n = TITLES[cat]?.length ?? 8;
      for (let i = 0; i < n; i++) out.push(makeProduct(cat, i));
    }
    return out;
  }
}

export function getProvider(): DiscoverProvider {
  // switch on env when a real provider is added, e.g.:
  // if (process.env.DISCOVER_PROVIDER === "apify") return new ApifyProvider();
  return new MockProvider();
}
