import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, createSessionToken, SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();
    const normalized = String(email || "").trim().toLowerCase();

    if (!normalized || !normalized.includes("@") || !password || String(password).length < 6) {
      return NextResponse.json(
        { error: "Enter a valid email and a password of at least 6 characters." },
        { status: 400 }
      );
    }

    const existing = await prisma.user.findUnique({ where: { email: normalized } });
    if (existing) {
      return NextResponse.json(
        { error: "An account with that email already exists — try logging in." },
        { status: 409 }
      );
    }

    const user = await prisma.user.create({
      data: { email: normalized, passwordHash: await hashPassword(String(password)) },
    });

    const token = await createSessionToken({ userId: user.id, email: user.email });
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return res;
  } catch {
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
