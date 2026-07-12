// In-app support: stores a ticket and pings the founder on Discord.
// Zero recurring cost - the helper bot is rule-based in the client widget;
// this endpoint only handles the human handoff.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { notify } from "@/lib/notify";
import { track } from "@/lib/analytics";

export const dynamic = "force-dynamic";

// Light in-memory rate limit: 5 tickets / 10 min per key (session or IP).
const g = globalThis as unknown as { __tiqSupport?: Map<string, number[]> };
if (!g.__tiqSupport) g.__tiqSupport = new Map();
const hits = g.__tiqSupport;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const message = String(body.message || "").trim().slice(0, 2000);
    if (message.length < 3) {
      return NextResponse.json({ error: "Please write a short message first." }, { status: 400 });
    }
    const session = await getSession().catch(() => null);
    const email =
      (session && session.email) ||
      String(body.email || "").trim().slice(0, 200) ||
      null;
    const page = String(body.page || "").slice(0, 200) || null;

    const key = email || req.headers.get("x-forwarded-for") || "anon";
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < 10 * 60 * 1000);
    if (recent.length >= 5) {
      return NextResponse.json({ error: "Too many messages - please wait a few minutes." }, { status: 429 });
    }
    recent.push(now);
    hits.set(key, recent);

    const ticket = await prisma.supportTicket.create({
      data: { email, message, page },
    });

    await notify("support_ticket", {
      from: email || "anonymous visitor",
      page: page || "unknown page",
      message: message.slice(0, 900),
      ticket: ticket.id,
    });
    await track("support_ticket", { email: email || undefined, props: { page } }).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("SUPPORT ERROR:", e);
    return NextResponse.json({ error: "Something went wrong - please try again." }, { status: 500 });
  }
}
