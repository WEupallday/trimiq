import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-side image proxy. Product cover images from TikTok Shop / EchoTik CDNs are
// hotlink-protected (they check the Referer) or otherwise block direct browser loads,
// so we fetch them server-side with a proper Referer and stream the bytes back. This
// keeps the UI's <img> tags simple and works for any provider's image URLs.
// Locked to an allowlist of known image hosts to prevent it being used as an open proxy.
const ALLOW = [
  "tiktokcdn.com",
  "tiktokcdn-us.com",
  "ibyteimg.com",
  "byteimg.com",
  "ttpstatic.com",
  "isnssdk.com",
  "cloudfront.net",
  "volces.com",       // EchoTik's own hosted covers (…volces.com)
  "picsum.photos",    // legacy mock images
];

export async function GET(req: NextRequest) {
  const u = req.nextUrl.searchParams.get("u");
  if (!u) return new NextResponse(null, { status: 400 });

  let target: URL;
  try {
    target = new URL(u);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (target.protocol !== "https:") return new NextResponse(null, { status: 400 });

  const host = target.hostname.toLowerCase();
  const allowed = ALLOW.some((d) => host === d || host.endsWith("." + d));
  if (!allowed) return new NextResponse(null, { status: 400 });

  try {
    const r = await fetch(target.toString(), {
      headers: {
        // A browser-like UA + TikTok referer defeats the common hotlink checks.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Referer: "https://www.tiktok.com/",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
      cache: "no-store",
    });
    if (!r.ok) return new NextResponse(null, { status: 404 });
    const buf = await r.arrayBuffer();
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": r.headers.get("content-type") || "image/jpeg",
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
