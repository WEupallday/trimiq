import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, createSessionToken, SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

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
  } catch (e) {
    console.error("SIGNUP ERROR:", e);
    const msg = e instanceof Error ? e.message : "Something went wrong. Please try again.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
