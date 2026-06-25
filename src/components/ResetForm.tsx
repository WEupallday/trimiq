"use client";

import { useState } from "react";
import Link from "next/link";
import Logo from "@/components/Logo";

// Two modes in one component:
//  - no token  -> request a reset link (enter email)
//  - token set -> choose a new password
export default function ResetForm({ token }: { token?: string }) {
  const hasToken = !!token;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = hasToken
        ? { action: "do_reset", token, password }
        : { action: "request_reset", email };
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: "Something went wrong." }));
        throw new Error(j.error || "Something went wrong.");
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6">
      <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 h-[420px] w-[420px] rounded-full bg-indigo-600/15 blur-[120px]" />

      <div className="relative z-10 w-full max-w-sm">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2 font-semibold">
          <Logo size={36} />
          <span className="text-xl">TrimIQ</span>
        </Link>

        <div className="glass rounded-2xl p-7">
          {done ? (
            hasToken ? (
              <>
                <h1 className="text-2xl font-bold tracking-tight">Password updated</h1>
                <p className="mt-2 text-sm text-white/60">
                  Your password has been changed. You can now log in with your new password.
                </p>
                <Link
                  href="/login"
                  className="mt-6 block rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 py-3 text-center font-medium transition hover:opacity-90"
                >
                  Go to login
                </Link>
              </>
            ) : (
              <>
                <h1 className="text-2xl font-bold tracking-tight">Check your email</h1>
                <p className="mt-2 text-sm text-white/60">
                  If an account exists for that address, we&apos;ve sent a link to reset your password.
                  The link expires in 1 hour.
                </p>
                <Link
                  href="/login"
                  className="mt-6 block rounded-xl border border-white/10 py-3 text-center text-sm font-medium text-white/80 transition hover:text-white"
                >
                  Back to login
                </Link>
              </>
            )
          ) : (
            <>
              <h1 className="text-2xl font-bold tracking-tight">
                {hasToken ? "Set a new password" : "Reset your password"}
              </h1>
              <p className="mt-2 text-sm text-white/60">
                {hasToken
                  ? "Choose a new password for your account."
                  : "Enter your email and we'll send you a reset link."}
              </p>

              <form onSubmit={submit} className="mt-6 space-y-4">
                {hasToken ? (
                  <div>
                    <label className="mb-1.5 block text-sm text-white/70">New password</label>
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 6 characters"
                      className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm outline-none transition focus:border-indigo-400/50"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="mb-1.5 block text-sm text-white/70">Email</label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm outline-none transition focus:border-indigo-400/50"
                    />
                  </div>
                )}

                {error && (
                  <div className="rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 py-3 font-medium shadow-lg shadow-indigo-500/25 transition hover:shadow-indigo-500/40 disabled:opacity-50"
                >
                  {busy ? "Please wait…" : hasToken ? "Update password" : "Send reset link"}
                </button>
              </form>
            </>
          )}
        </div>

        {!done && (
          <p className="mt-6 text-center text-sm text-white/50">
            <Link href="/login" className="text-indigo-300 hover:text-indigo-200">
              Back to login
            </Link>
          </p>
        )}
      </div>
    </main>
  );
}
