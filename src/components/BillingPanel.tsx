"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function BillingPanel({
  planName,
  creditsLeft,
  unlimited,
  paid,
  renewalISO,
}: {
  planName: string;
  creditsLeft: number;
  unlimited: boolean;
  paid: boolean;
  renewalISO: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const renewal = renewalISO
    ? new Date(renewalISO).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : null;

  async function cancel() {
    if (!confirm("Cancel your subscription? You'll keep access until the end of the current period.")) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/process?stripe=cancel", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      setMsg(res.ok ? data.message || "Subscription canceled." : data.error || "Couldn't cancel.");
      router.refresh();
    } catch {
      setMsg("Network problem — please try again.");
    }
    setBusy(false);
  }

  return (
    <div className="glass mb-8 rounded-2xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-white/40">Your plan</p>
          <p className="mt-0.5 text-lg font-semibold">{planName}</p>
          <p className="mt-1 text-sm text-white/60">
            {unlimited ? "Unlimited edits (fair use)" : `${creditsLeft} ${creditsLeft === 1 ? "edit" : "edits"} remaining`}
            {paid && renewal ? ` · renews ${renewal}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/#pricing"
            className="rounded-lg bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-4 py-2 text-sm font-medium transition hover:opacity-90"
          >
            {paid ? "Change plan" : "Upgrade"}
          </Link>
          {paid && (
            <button
              onClick={cancel}
              disabled={busy}
              className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/70 transition hover:text-white disabled:opacity-50"
            >
              {busy ? "…" : "Cancel"}
            </button>
          )}
        </div>
      </div>
      {msg && <p className="mt-3 text-sm text-emerald-300">{msg}</p>}
    </div>
  );
}
