import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, createSessionToken, SESSION_COOKIE } from "@/lib/auth";
import { notify } from "@/lib/notify";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { sendTikTokEvent, newEventId } from "@/lib/tiktok"; // <-- ADDED

export const runtime = "nodejs";

// Tiny cookie reader for a plain Request (no NextRequest.cookies here).
function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie") || "";
  const m = raw.match(new RegExp("(?:^|; )" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

export async function POST(req: Request) {
  try {
    const { email, password, username } = await req.json();
    const normalized = String(email || "").trim().toLowerCase();
    const uname = String(username || "").trim();

    if (!normalized || !normalized.includes("@") || !password || String(password).length < 6) {
      return NextResponse.json(
        { error: "Enter a valid email and a password of at least 6 characters." },
        { status: 400 }
      );
    }
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(uname)) {
      return NextResponse.json(
        { error: "Choose a username of 3–20 letters, numbers, or underscores." },
        { status: 400 }
      );
    }

    if (!rateLimit("signup:" + clientIp(req), 5, 60 * 60 * 1000)) {
      return NextResponse.json(
        { error: "Too many signups from this network - please try again later." },
        { status: 429 }
      );
    }

    const existing = await prisma.user.findUnique({ where: { email: normalized } });
    if (existing) {
      return NextResponse.json(
        { error: "An account with that email already exists — try logging in." },
        { status: 409 }
      );
    }
    const takenName = await prisma.user.findUnique({ where: { username: uname } });
    if (takenName) {
      return NextResponse.json({ error: "That username is already taken." }, { status: 409 });
    }

    const user = await prisma.user.create({
      data: { email: normalized, username: uname, passwordHash: await hashPassword(String(password)) },
    });

    // Founder notification (fire-and-forget; never blocks signup).
    void notify("signup", { email: user.email, username: uname });

    // ---- TikTok CompleteRegistration (server side, deduped with the pixel) ----
    // Generate the shared id here, send the server event, and hand the id back
    // so the browser fires the SAME event_id. Never awaited on the hot path.
    const ttEventId = newEventId();
    const xf = req.headers.get("x-forwarded-for") || "";
    void sendTikTokEvent({
      event: "CompleteRegistration",
      event_id: ttEventId,
      email: user.email,
      externalId: user.id,
      ip: xf.split(",")[0].trim() || req.headers.get("x-real-ip") || null,
      userAgent: req.headers.get("user-agent"),
      referrer: req.headers.get("referer") || undefined,
      ttp: readCookie(req, "_ttp"),
      ttclid: readCookie(req, "ttclid"),
      properties: { content_name: "TrimIQ account", status: "registered" },
    });

    const token = await createSessionToken({ userId: user.id, email: user.email });
    const res = NextResponse.json({ ok: true, ttEventId }); // <-- ttEventId returned for pixel dedup
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return res;
  } catch (e) {
    console.error("SIGNUP ERROR:", e);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
