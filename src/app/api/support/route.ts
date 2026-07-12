// In-app support: stores a ticket and pings the founder on Discord.
// Zero recurring cost - the helper bot is rule-based in the client widget;
// this endpoint only handles the human handoff.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { notify } from "@/lib/notify";
import { requireAdmin } from "@/lib/admin";
import { track } from "@/lib/analytics";

export const dynamic = "force-dynamic";

// Light in-memory rate limit: 5 tickets / 10 min per key (session or IP).
const g = globalThis as unknown as { __tiqSupport?: Map<string, number[]> };
if (!g.__tiqSupport) g.__tiqSupport = new Map();
const hits = g.__tiqSupport;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    // Admin reply: stored on the ticket and delivered as an in-app
    // notification via the dashboard poller (same pattern as batch alerts).
    if (body.ticketId && body.reply) {
      const admin = await requireAdmin();
      if (!admin) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
      const reply = String(body.reply).trim().slice(0, 2000);
      if (reply.length < 2) return NextResponse.json({ error: "Reply is too short." }, { status: 400 });
      await prisma.supportTicket.update({
        where: { id: String(body.ticketId) },
        data: { reply, repliedAt: new Date(), replySeen: false, status: "replied" },
      });
      return NextResponse.json({ ok: true });
    }
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

// Admin inbox: recent tickets with the requester’s account info.
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const tickets = await prisma.supportTicket.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  const emails = Array.from(new Set(tickets.map((t) => t.email).filter(Boolean))) as string[];
  const users = emails.length
    ? await prisma.user.findMany({ where: { email: { in: emails } }, select: { email: true, username: true, plan: true } })
    : [];
  const byEmail = new Map(users.map((u) => [u.email, u]));
  return NextResponse.json({
    tickets: tickets.map((t) => ({
      id: t.id,
      email: t.email,
      username: t.email ? byEmail.get(t.email)?.username ?? null : null,
      plan: t.email ? byEmail.get(t.email)?.plan ?? null : null,
      message: t.message,
      page: t.page,
      reply: t.reply,
      status: t.status,
      createdAt: t.createdAt,
    })),
  });
}
