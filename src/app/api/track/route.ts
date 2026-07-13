// Client-side event ingestion for self-hosted analytics. Anonymous visitors
// are identified by a stable first-party cookie; no third-party services.
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getSession } from "@/lib/auth";
import { track } from "@/lib/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Only allow a known event vocabulary from the client.
const ALLOWED = new Set([
  "page_view",
  "guest_lock_viewed",
  "guest_signup_click",
  "preview_viewed",
  "download_clicked",
  "reedit_clicked",
  "mode_selected",
  "instructions_used",
]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = String(body.name || "");
    if (!ALLOWED.has(name)) return NextResponse.json({ ok: false }, { status: 400 });

    const session = await getSession();
    let anonId = req.cookies.get("trimiq_anon")?.value || null;
    const res = NextResponse.json({ ok: true });
    if (!anonId) {
      anonId = randomUUID();
      res.cookies.set("trimiq_anon", anonId, { maxAge: 60 * 60 * 24 * 365, sameSite: "lax", path: "/" });
    }
    let props = body.props && typeof body.props === "object" ? body.props : undefined;
    // Cap stored payload size so the events table can't be flooded.
    if (props && JSON.stringify(props).length > 2000) props = undefined;
    await track(name, { email: session?.email ?? null, anonId, props });
    return res;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
