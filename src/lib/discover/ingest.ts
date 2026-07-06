// Ingest + compute pipeline for Discover. Pulls from the provider, scores the
// products, and writes ShopProduct (with per-window metrics) + the append-only
// ProductSnapshot series. Idempotent: re-running refreshes existing products.
import { prisma } from "@/lib/db";
import { getProvider } from "./provider";
import { scoreProducts } from "./scoring";

export async function ingestDiscover(): Promise<{ products: number; provider: string }> {
  const provider = getProvider();
  const records = await provider.fetchProducts({ region: "US", categories: ["beauty", "home", "fitness"] });

  const scored = scoreProducts(
    records.map((r) => ({ id: r.tiktokProductId, category: r.category, creatorSpread: r.creatorSpread, snapshots: r.snapshots }))
  );
  const byId = new Map(scored.map((s) => [s.id, s]));

  for (const r of records) {
    const s = byId.get(r.tiktokProductId);
    if (!s) continue;
    const data = {
      title: r.title,
      imageUrl: r.imageUrl ?? null,
      productUrl: r.productUrl ?? null,
      sellerName: r.sellerName ?? null,
      category: r.category,
      region: r.region,
      currency: r.currency,
      latestPrice: s.latestPrice,
      latestSoldCount: s.latestSoldCount,
      trend7: s.trend7, trend30: s.trend30, trend90: s.trend90, momentum7: s.momentum7,
      vel7: s.vel7, vel30: s.vel30, gmv7: s.gmv7, gmv30: s.gmv30, gmv90: s.gmv90,
      growth7: s.growth7, state: s.state, isBreakout: s.isBreakout,
      creatorSpread: s.creatorSpread, confidence: s.confidence,
    };
    const product = await prisma.shopProduct.upsert({
      where: { tiktokProductId: r.tiktokProductId },
      update: data,
      create: { tiktokProductId: r.tiktokProductId, ...data },
    });
    // Replace snapshot series (keeps mock re-seeds clean; a real feed would append).
    await prisma.productSnapshot.deleteMany({ where: { productId: product.id } });
    await prisma.productSnapshot.createMany({
      data: r.snapshots.map((sn) => ({
        productId: product.id, capturedAt: sn.capturedAt, price: sn.price, soldLo: sn.soldLo, confidence: sn.confidence,
      })),
    });
  }
  return { products: records.length, provider: provider.name };
}
