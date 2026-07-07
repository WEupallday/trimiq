// Data-provider adapter for Discover. The system is provider-AGNOSTIC: to plug in
// a real TikTok Shop data provider (e.g. an Apify actor or Bright Data feed),
// implement DiscoverProvider.fetchProducts() to return this same normalized shape
// and select it in getProvider() via the DISCOVER_PROVIDER env var. A realistic
// MockProvider remains the default so the pipeline + UI work end-to-end offline.

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
  category: string;   // beauty | home | fitness | other
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

// ------------------------------ EchoTik provider ------------------------------
// Real TikTok Shop market intelligence via EchoTik's offline (T+1) OpenAPI.
// Docs: https://opendocs.echotik.live   Auth: HTTP Basic (username:password).
// We read the product list + per-product trend snapshots and normalize them into
// ProductRecord — nothing downstream (ingest, scoring, UI) changes. Selected when
// DISCOVER_PROVIDER=echotik and credentials are present.
//
// Env knobs (all optional except credentials):
//   ECHOTIK_USERNAME / ECHOTIK_PASSWORD   (required — set in the host env, never in code)
//   ECHOTIK_BASE_URL      default https://open.echotik.live
//   ECHOTIK_MAX_PRODUCTS  default 20   (list pages are 10/page)
//   ECHOTIK_TREND_DAYS    default 30   (trend pages are 10 days/page)
//   ECHOTIK_SORT_FIELD    default 7    (7 = last-30d GMV, desc)
const ECHOTIK_BASE = process.env.ECHOTIK_BASE_URL || "https://open.echotik.live";
const ECHOTIK_MAX_PRODUCTS = Math.max(1, Number(process.env.ECHOTIK_MAX_PRODUCTS || 20));
const ECHOTIK_TREND_DAYS = Math.max(7, Number(process.env.ECHOTIK_TREND_DAYS || 30));
const ECHOTIK_SORT_FIELD = Number(process.env.ECHOTIK_SORT_FIELD || 7);

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function classifyCategory(name: string): string {
  const s = (name || "").toLowerCase();
  if (/(beauty|personal care|makeup|skin|cosmetic|fragrance|hair|nail)/.test(s)) return "beauty";
  if (/(home|kitchen|household|furniture|garden|living|decor|appliance)/.test(s)) return "home";
  if (/(sport|fitness|outdoor|exercise|athletic|gym|workout)/.test(s)) return "fitness";
  return "other";
}
function firstCoverUrl(raw: any): string | undefined {
  if (!raw) return undefined;
  try {
    const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(arr) && arr.length && arr[0] && arr[0].url) return String(arr[0].url);
  } catch { /* fall through */ }
  return typeof raw === "string" && raw.indexOf("http") === 0 ? raw : undefined;
}
// Fallback series if a product has no usable trend history: reconstruct coarse
// cumulative points from the list's windowed increments (real numbers, lower
// confidence because the spacing is not daily).
function snapshotsFromList(it: any): ProviderSnap[] {
  const T = Number(it.total_sale_cnt) || 0;
  const price = Number(it.spu_avg_price) || 0;
  const now = Date.now();
  const pts = [
    { days: 90, inc: Number(it.total_sale_90d_cnt) || 0 },
    { days: 60, inc: Number(it.total_sale_60d_cnt) || 0 },
    { days: 30, inc: Number(it.total_sale_30d_cnt) || 0 },
    { days: 15, inc: Number(it.total_sale_15d_cnt) || 0 },
    { days: 7, inc: Number(it.total_sale_7d_cnt) || 0 },
    { days: 1, inc: Number(it.total_sale_1d_cnt) || 0 },
    { days: 0, inc: 0 },
  ];
  const snaps: ProviderSnap[] = [];
  for (let i = 0; i < pts.length; i++) {
    snaps.push({ capturedAt: new Date(now - pts[i].days * DAY), price, soldLo: Math.max(0, T - pts[i].inc), confidence: 0.7 });
  }
  return snaps;
}

class EchoTikProvider implements DiscoverProvider {
  name = "echotik";
  private auth: string;
  constructor() {
    const u = process.env.ECHOTIK_USERNAME || "";
    const p = process.env.ECHOTIK_PASSWORD || "";
    this.auth = "Basic " + Buffer.from(`${u}:${p}`).toString("base64");
  }

  private async get(path: string, params: Record<string, string | number>): Promise<any> {
    const qs = new URLSearchParams();
    const keys = Object.keys(params);
    for (let i = 0; i < keys.length; i++) qs.set(keys[i], String(params[keys[i]]));
    const url = `${ECHOTIK_BASE}${path}?${qs.toString()}`;
    const res = await fetch(url, { headers: { Authorization: this.auth, Accept: "application/json" }, cache: "no-store" });
    if (res.status === 401) throw new Error("EchoTik auth failed (401) — check ECHOTIK_USERNAME / ECHOTIK_PASSWORD.");
    if (!res.ok) throw new Error(`EchoTik ${path} HTTP ${res.status}`);
    const json: any = await res.json();
    if (json && json.code !== undefined && json.code !== 0 && json.code !== 200) {
      throw new Error(`EchoTik ${path} code=${json.code} ${json.message || ""}`);
    }
    return json;
  }

  private async categoryMap(): Promise<Record<string, string>> {
    try {
      const j = await this.get("/api/v3/echotik/category/l1", { language: "en-US" });
      const data: any[] = Array.isArray(j.data) ? j.data : [];
      const map: Record<string, string> = {};
      for (let i = 0; i < data.length; i++) map[String(data[i].category_id)] = String(data[i].category_name || "");
      return map;
    } catch {
      return {};
    }
  }

  private async trendSnapshots(productId: string, listItem: any): Promise<ProviderSnap[]> {
    const end = new Date();
    const start = new Date(end.getTime() - ECHOTIK_TREND_DAYS * DAY);
    const rows: any[] = [];
    const pages = Math.max(1, Math.ceil(ECHOTIK_TREND_DAYS / 10));
    for (let page = 1; page <= pages; page++) {
      let j: any;
      try {
        j = await this.get("/api/v3/echotik/product/trend", {
          product_id: productId, start_date: ymd(start), end_date: ymd(end), page_num: page, page_size: 10,
        });
      } catch {
        break;
      }
      const data: any[] = Array.isArray(j.data) ? j.data : [];
      for (let i = 0; i < data.length; i++) rows.push(data[i]);
      if (data.length < 10) break;
    }
    if (rows.length >= 2) {
      const snaps = rows.map((r) => ({
        capturedAt: new Date(String(r.dt) + "T00:00:00Z"),
        price: Number(r.spu_avg_price) || Number(listItem.spu_avg_price) || 0,
        soldLo: Number(r.total_sale_cnt) || 0,
        confidence: 1,
      }));
      snaps.sort((a, b) => +a.capturedAt - +b.capturedAt);
      return snaps;
    }
    return snapshotsFromList(listItem);
  }

  async fetchProducts({ region }: { region: string; categories: string[] }): Promise<ProductRecord[]> {
    const reg = region || "US";
    const cats = await this.categoryMap();

    // 1) Collect the top products by recent GMV.
    const items: any[] = [];
    const pages = Math.max(1, Math.ceil(ECHOTIK_MAX_PRODUCTS / 10));
    for (let page = 1; page <= pages && items.length < ECHOTIK_MAX_PRODUCTS; page++) {
      const j = await this.get("/api/v3/echotik/product/list", {
        region: reg, page_num: page, page_size: 10, product_sort_field: ECHOTIK_SORT_FIELD, sort_type: 1, off_mark: 0,
      });
      const data: any[] = Array.isArray(j.data) ? j.data : [];
      for (let i = 0; i < data.length; i++) items.push(data[i]);
      if (data.length < 10) break;
    }
    const chosen = items.slice(0, ECHOTIK_MAX_PRODUCTS);

    // 2) Attach real trend history (bounded concurrency to be gentle on the API).
    const out: ProductRecord[] = [];
    const CONC = 4;
    for (let i = 0; i < chosen.length; i += CONC) {
      const batch = chosen.slice(i, i + CONC);
      const recs = await Promise.all(
        batch.map(async (it) => {
          const pid = String(it.product_id);
          const snapshots = await this.trendSnapshots(pid, it);
          const catName = cats[String(it.category_id)] || "";
          const rec: ProductRecord = {
            tiktokProductId: pid,
            title: String(it.product_name || "Untitled product"),
            imageUrl: firstCoverUrl(it.cover_url),
            productUrl: `https://shop.tiktok.com/view/product/${pid}`,
            sellerName: undefined, // list only exposes seller_id; enrich via seller/detail later
            category: classifyCategory(catName),
            region: String(it.region || reg),
            currency: "USD",
            creatorSpread: Number(it.total_ifl_cnt) || 0,
            snapshots,
          };
          return rec;
        })
      );
      for (let k = 0; k < recs.length; k++) out.push(recs[k]);
    }
    return out;
  }
}

export function getProvider(): DiscoverProvider {
  if (
    (process.env.DISCOVER_PROVIDER || "").toLowerCase() === "echotik" &&
    process.env.ECHOTIK_USERNAME &&
    process.env.ECHOTIK_PASSWORD
  ) {
    return new EchoTikProvider();
  }
  return new MockProvider();
}
