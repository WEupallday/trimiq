import { NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { verifyPassword, hashPassword, createSessionToken, SESSION_COOKIE } from "@/lib/auth";
import { sendEmail, resetEmailHtml } from "@/lib/email";

export const runtime = "nodejs";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = String(body.action || "login");

    // ---- Request a password reset link --------------------------------------
    if (action === "request_reset") {
      const email = String(body.email || "").trim().toLowerCase();
      if (email && email.includes("@")) {
        const user = await prisma.user.findUnique({ where: { email } });
        if (user) {
          const raw = randomBytes(32).toString("hex");
          await prisma.passwordReset.deleteMany({ where: { email } });
          await prisma.passwordReset.create({
            data: { email, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
          });
          // Build the public origin (Render sits behind a proxy, so prefer forwarded headers).
          const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
          const proto = req.headers.get("x-forwarded-proto") || "https";
          const origin = process.env.APP_URL || (host ? `${proto}://${host}` : new URL(req.url).origin);
          const link = `${origin}/login?token=${raw}`;
          await sendEmail(email, "Reset your TrimIQ password", resetEmailHtml(link));
        }
      }
      // Always succeed so we never reveal whether an account exists.
      return NextResponse.json({ ok: true });
    }

    // ---- Complete a password reset ------------------------------------------
    if (action === "do_reset") {
      const token = String(body.token || "");
      const password = String(body.password || "");
      if (password.length < 6) {
        return NextResponse.json({ error: "Password must be at least 6 characters." }, { status: 400 });
      }
      const record = await prisma.passwordReset.findUnique({ where: { tokenHash: sha256(token) } });
      if (!record || record.expiresAt < new Date()) {
        return NextResponse.json(
          { error: "This reset link is invalid or has expired. Please request a new one." },
          { status: 400 }
        );
      }
      await prisma.user.update({
        where: { email: record.email },
        data: { passwordHash: await hashPassword(password) },
      });
      await prisma.passwordReset.deleteMany({ where: { email: record.email } });
      return NextResponse.json({ ok: true });
    }

    // ---- Normal login -------------------------------------------------------
    const email = String(body.email || "").trim().toLowerCase();
    const password = body.password;
    if (!email || !password) {
      return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
    }
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await verifyPassword(String(password), user.passwordHash))) {
      return NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });
    }
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
