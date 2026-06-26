"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AccountSettings({ currentUsername, email }: { currentUsername: string; email: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState(currentUsername);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function save() {
    setBusy(true);
    setMsg("");
    setErr("");
    try {
      const res = await fetch("/api/process?account=username", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't update username.");
      setMsg("Username updated.");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
    }
    setBusy(false);
  }

  return (
    <div className="glass mb-8 rounded-2xl p-5">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between text-left">
        <div>
          <p className="text-xs uppercase tracking-wide text-white/40">Account</p>
          <p className="mt-0.5 text-sm">
            <span className="font-medium">{currentUsername || "Set a username"}</span>
            <span className="text-white/40"> · {email}</span>
          </p>
        </div>
        <span className="text-white/40">{open ? "Close" : "Edit"}</span>
      </button>

      {open && (
        <div className="mt-4 border-t border-white/10 pt-4">
          <label className="mb-1.5 block text-sm text-white/70">Username</label>
          <div className="flex gap-2">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="yourname"
              className="flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm outline-none transition focus:border-indigo-400/50"
            />
            <button
              onClick={save}
              disabled={busy || !username}
              className="rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-5 py-2.5 text-sm font-medium transition hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "…" : "Save"}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-white/30">3–20 letters, numbers, or underscores.</p>
          {msg && <p className="mt-2 text-sm text-emerald-300">{msg}</p>}
          {err && <p className="mt-2 text-sm text-red-300">{err}</p>}
        </div>
      )}
    </div>
  );
}
