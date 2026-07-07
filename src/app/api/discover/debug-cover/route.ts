import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TEMPORARY admin-only diagnostic: calls EchoTik's cover-download endpoint server-side
// (credentials stay in the host env) and returns the RAW response so we can see its
// exact shape and finalize the image-URL parser. Safe to delete once images work.
export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not authorized." }, { status: 403 });

  const u = process.env.ECHOTIK_USERNAME || "";
  const p = process.env.ECHOTIK_PASSWORD || "";
  if (!u || !p) return NextResponse.json({ error: "EchoTik credentials not set." }, { status: 400 });

  const auth = "Basic " + Buffer.from(`${u}:${p}`).toString("base64");
  const sample =
    req.nextUrl.searchParams.get("u") ||
    "https://echosell-images.tos-ap-southeast-1.volces.com/product-cover/44/1729606769780232427_0.webp";
  const url = `https://open.echotik.live/api/v3/echotik/batch/cover/download?cover_urls=${encodeURIComponent(sample)}`;

  try {
    const r = await fetch(url, { headers: { Authorization: auth, Accept: "application/json" }, cache: "no-store" });
    const text = await r.text();
    return new NextResponse(text, {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Upstream-Status": String(r.status) },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "fetch failed" }, { status: 500 });
  }
}
