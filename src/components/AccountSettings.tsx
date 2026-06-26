"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AccountSettings({
  currentUsername,
  email,
  currentTiktok,
}: {
  currentUsername: string;
  email: string;
  currentTiktok: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const [username, setUsername] = useState(currentUsername);
  const [uBusy, setUBusy] = useState(false);
  const [uMsg, setUMsg] = useState("");
  const [uErr, setUErr] = useState("");

  const [tiktok, setTiktok] = useState(currentTiktok);
  const [tBusy, setTBusy] = useState(false);
  const [tMsg, setTMsg] = useState("");
  const [tErr, setTErr] = useState("");

  async function saveUsername() {
    setUBusy(true);
    setUMsg("");
    setUErr("");
    try {
      const res = await fetch("/api/process?account=username", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't update username.");
      setUMsg("Username updated.");
      router.refresh();
    } catch (e) {
      setUErr(e instanceof Error ? e.message : "Something went wrong.");
    }
    setUBusy(false);
  }

  async function saveTiktok(value: string, removing = false) {
    setTBusy(true);
    setTMsg("");
    setTErr("");
    try {
      const res = await fetch("/api/process?account=tiktok", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tiktokUsername: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't update TikTok username.");
      setTiktok(removing ? "" : value.replace(/^@+/, ""));
      setTMsg(removing ? "TikTok handle removed." : "TikTok handle saved.");
      router.refresh();
    } catch (e) {
      setTErr(e instanceof Error ? e.message : "Something went wrong.");
    }
    setTBusy(false);
  }

  return (
    <div className="glass mb-8 rounded-2xl p-5">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between text-left">
        <div>
          <p className="text-xs uppercase tracking-wide text-white/40">Account</p>
          <p className="mt-0.5 text-sm">
            <span className="font-medium">{currentUsername || "Set a username"}</span>
            <span className="text-white/40"> · {email}</span>
            {currentTiktok && <span className="text-white/40"> · TikTok @{currentTiktok}</span>}
          </p>
        </div>
        <span className="text-white/40">{open ? "Close" : "Edit"}</span>
      </button>

      {open && (
        <div className="mt-4 space-y-5 border-t border-white/10 pt-4">
          {/* Username */}
          <div>
            <label className="mb-1.5 block text-sm text-white/70">Username</label>
            <div className="flex gap-2">
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="yourname"
                className="flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm outline-none transition focus:border-indigo-400/50"
              />
              <button
                onClick={saveUsername}
                disabled={uBusy || !username}
                className="rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-5 py-2.5 text-sm font-medium transition hover:opacity-90 disabled:opacity-50"
              >
                {uBusy ? "…" : "Save"}
              </button>
            </div>
            <p className="mt-1.5 text-xs text-white/30">3–20 letters, numbers, or underscores.</p>
            {uMsg && <p className="mt-2 text-sm text-emerald-300">{uMsg}</p>}
            {uErr && <p className="mt-2 text-sm text-red-300">{uErr}</p>}
          </div>

          {/* TikTok handle (optional) */}
          <div>
            <label className="mb-1.5 block text-sm text-white/70">TikTok username <span className="text-white/40">(optional)</span></label>
            <div className="flex gap-2">
              <div className="flex flex-1 items-center rounded-xl border border-white/10 bg-white/[0.03] px-3 focus-within:border-indigo-400/50">
                <span className="text-sm text-white/40">@</span>
                <input
                  value={tiktok}
                  onChange={(e) => setTiktok(e.target.value.replace(/^@+/, ""))}
                  placeholder="yourhandle"
                  className="w-full bg-transparent px-1.5 py-2.5 text-sm outline-none"
                />
              </div>
              <button
                onClick={() => saveTiktok(tiktok)}
                disabled={tBusy || !tiktok}
                className="rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-5 py-2.5 text-sm font-medium transition hover:opacity-90 disabled:opacity-50"
              >
                {tBusy ? "…" : "Save"}
              </button>
              {currentTiktok && (
                <button
                  onClick={() => saveTiktok("", true)}
                  disabled={tBusy}
                  className="rounded-xl border border-white/10 px-3 py-2.5 text-sm text-white/70 transition hover:text-white disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </div>
            <p className="mt-1.5 text-xs text-white/30">Helps us tailor TrimIQ to your content. You can change or remove it anytime.</p>
            {tMsg && <p className="mt-2 text-sm text-emerald-300">{tMsg}</p>}
            {tErr && <p className="mt-2 text-sm text-red-300">{tErr}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
