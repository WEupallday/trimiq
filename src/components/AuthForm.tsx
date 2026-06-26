"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Logo from "@/components/Logo";

export default function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const isSignup = mode === "signup";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/auth/${isSignup ? "signup" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isSignup ? { email, password, username } : { email, password }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: "Something went wrong." }));
        throw new Error(j.error || "Something went wrong.");
      }
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
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
          <h1 className="text-2xl font-bold tracking-tight">
            {isSignup ? "Create your account" : "Welcome back"}
          </h1>
          <p className="mt-2 text-sm text-white/60">
            {isSignup ? "Start cleaning videos in seconds." : "Log in to your TrimIQ account."}
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            {isSignup && (
              <div>
                <label className="mb-1.5 block text-sm text-white/70">Username</label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="yourname"
                  className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm outline-none transition focus:border-indigo-400/50"
                />
              </div>
            )}
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
            <div>
              <label className="mb-1.5 block text-sm text-white/70">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isSignup ? "At least 6 characters" : "Your password"}
                className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm outline-none transition focus:border-indigo-400/50"
              />
              {!isSignup && (
                <div className="mt-1.5 text-right">
                  <Link href="/login?reset=1" className="text-xs text-indigo-300 hover:text-indigo-200">
                    Forgot password?
                  </Link>
                </div>
              )}
            </div>

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
              {busy ? "Please wait…" : isSignup ? "Create account" : "Log in"}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-white/50">
          {isSignup ? (
            <>
              Already have an account?{" "}
              <Link href="/login" className="text-indigo-300 hover:text-indigo-200">
                Log in
              </Link>
            </>
          ) : (
            <>
              New to TrimIQ?{" "}
              <Link href="/signup" className="text-indigo-300 hover:text-indigo-200">
                Create an account
              </Link>
            </>
          )}
        </p>
      </div>
    </main>
  );
}
