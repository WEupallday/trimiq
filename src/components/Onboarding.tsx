"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Onboarding() {
  const router = useRouter();
  const [tiktok, setTiktok] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function go() {
    router.push("/dashboard");
    router.refresh();
  }

  async function save() {
    if (!tiktok.trim()) return go();
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/process?account=tiktok", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tiktokUsername: tiktok }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't save that handle.");
      go();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div className="glass w-full max-w-md rounded-2xl p-7">
      <h1 className="text-2xl font-bold tracking-tight">You&apos;re in! 🎉</h1>
      <p className="mt-2 text-sm text-white/60">
        One quick optional step — add your TikTok handle so we can tailor TrimIQ to your content. You can skip this and add it later.
      </p>

      <label className="mb-1.5 mt-6 block text-sm text-white/70">TikTok username <span className="text-white/40">(optional)</span></label>
      <div className="flex items-center rounded-xl border border-white/10 bg-white/[0.03] px-3 focus-within:border-indigo-400/50">
        <span className="text-sm text-white/40">@</span>
        <input
          autoFocus
          value={tiktok}
          onChange={(e) => setTiktok(e.target.value.replace(/^@+/, ""))}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder="yourhandle"
          className="w-full bg-transparent px-1.5 py-3 text-sm outline-none"
        />
      </div>
      {err && <p className="mt-2 text-sm text-red-300">{err}</p>}

      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={save}
          disabled={busy}
          className="flex-1 rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 py-3 font-medium shadow-lg shadow-indigo-500/25 transition hover:shadow-indigo-500/40 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Add & continue"}
        </button>
        <button
          onClick={go}
          disabled={busy}
          className="rounded-xl px-5 py-3 text-sm text-white/60 transition hover:text-white disabled:opacity-50"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
