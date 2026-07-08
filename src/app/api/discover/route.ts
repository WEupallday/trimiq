import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin";
import { ingestDiscover } from "@/lib/discover/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOWS = new Set([7, 30, 90]);

// Grid limits. Guests can browse the first FREE_LIMIT products (1 page of 12);
// everything past that is returned only as image-teasers so the UI can show
// blurred previews behind the sign-up overlay without leaking real data.
const MAX = 200;
const FREE_LIMIT = 12;

// GET /api/discover                 -> product grid (filters/sort/window)
// GET /api/discover?id=<productId>  -> single product + snapshot series (for detail)
export async function GET(req: NextRequest) {
  const session = await getSession();
  const isGuest = !session;

  const p = req.nextUrl.searchParams;

  // --- detail ---
  const id = p.get("id");
  if (id) {
    const product = await prisma.shopProduct.findUnique({ where: { id } });
    if (!product) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (isGuest) {
      // Guests get identity/context only. The high-value analytics (velocity,
      // growth, GMV windows, history series, store link) never leave the server.
      const x: any = product;
      return NextResponse.json({
        locked: true,
        product: {
          id: x.id, title: x.title, imageUrl: x.imageUrl, sellerName: x.sellerName,
          category: x.category, latestPrice: x.latestPrice, latestSoldCount: x.latestSoldCount,
          region: x.region, currency: x.currency, state: x.state,
          isBreakout: x.isBreakout, confidence: x.confidence,
        },
        series: [],
      });
    }
    const snaps = await prisma.productSnapshot.findMany({
      where: { productId: id }, orderBy: { capturedAt: "asc" }, take: 120,
    });
    return NextResponse.json({
      product,
      series: snaps.map((s) => ({ t: s.capturedAt.toISOString().slice(0, 10), sold: s.soldLo, price: s.price })),
    });
  }

  // --- grid ---
  const window = WINDOWS.has(Number(p.get("window"))) ? Number(p.get("window")) : 7;
  const category = p.get("category") || "all";
  const region = p.get("region") || "US";
  const sort = p.get("sort") || "trend";
  const breakoutOnly = p.get("breakout") === "1";
  const q = (p.get("q") || "").trim();

  const where: any = { region };
  if (category !== "all") where.category = category;
  if (breakoutOnly) where.isBreakout = true;
  if (q) where.title = { contains: q, mode: "insensitive" };

  const orderField =
    sort === "gmv" ? `gmv${window}` :
    sort === "velocity" ? (window === 7 ? "vel7" : "vel30") :
    sort === "momentum" ? "momentum7" :
    `trend${window}`;

  const [products, matching] = await Promise.all([
    prisma.shopProduct.findMany({
      where, orderBy: { [orderField]: "desc" } as any, take: MAX,
    }),
    prisma.shopProduct.count({ where }),
  ]);

  const total = Math.min(matching, MAX);

  const mapRow = (x: any) => ({
    id: x.id, title: x.title, imageUrl: x.imageUrl, sellerName: x.sellerName,
    category: x.category, price: x.latestPrice, sold: x.latestSoldCount,
    trend: (x as any)[`trend${window}`], momentum: x.momentum7,
    velocity: window === 7 ? x.vel7 : x.vel30,
    gmv: (x as any)[`gmv${window}`],
    growth: x.growth7, state: x.state, isBreakout: x.isBreakout, confidence: x.confidence,
  });

  // Guests: quantize the label-driving scores to coarse buckets (the same
  // information the visible badges convey) and drop precise analytics entirely.
  const mapRowGuest = (x: any) => {
    const row = mapRow(x);
    const t = Number(row.trend) || 0;
    const g = Number(row.growth) || 0;
    return {
      ...row,
      trend: x.isBreakout || t >= 75 ? 80 : t >= 60 ? 65 : t >= 45 ? 50 : t >= 30 ? 35 : 15,
      growth: g >= 0.5 ? 0.6 : g > 0.15 ? 0.3 : g >= -0.15 ? 0 : -0.3,
      momentum: null, velocity: null,
    };
  };

  if (isGuest) {
    const free = products.slice(0, FREE_LIMIT);
    return NextResponse.json({
      window, category, region, sort,
      guest: true,
      freeLimit: FREE_LIMIT,
      total,
      count: free.length,
      products: free.map(mapRowGuest),
      // Image-only teasers for the locked pages (no titles, sellers, categories, or metrics).
      teasers: products.slice(FREE_LIMIT).map((x) => ({ imageUrl: x.imageUrl })),
    });
  }

  return NextResponse.json({
    window, category, region, sort, total, count: products.length,
    products: products.map(mapRow),
  });
}

// POST /api/discover?seed=1  -> (admin) run ingest+scoring to (re)populate data
export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get("seed") === "1") {
    const admin = await requireAdmin();
    if (!admin) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
    try {
      const result = await ingestDiscover();
      return NextResponse.json({ ok: true, ...result });
    } catch (e: any) {
      console.error("DISCOVER INGEST ERROR:", e);
      return NextResponse.json({ error: e?.message || "Ingest failed." }, { status: 500 });
    }
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
