// Authentication helpers: password hashing + signed session cookies.
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";

export const SESSION_COOKIE = "trimiq_session";

function secretKey() {
  const s = process.env.AUTH_SECRET || "dev-only-insecure-secret-change-me";
  return new TextEncoder().encode(s);
}

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

export type Session = { userId: string; email: string };

export async function createSessionToken(payload: Session): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secretKey());
}

// Read + verify the current user's session from the cookie (server-side).
export async function getSession(): Promise<Session | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return { userId: String(payload.userId), email: String(payload.email) };
  } catch {
    return null;
  }
}
