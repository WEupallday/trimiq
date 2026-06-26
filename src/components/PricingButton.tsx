"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function PricingButton({
  planId,
  label,
  loggedIn,
  highlight,
}: {
  planId: string;
  label: string;
  loggedIn: boolean;
  highlight?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function go() {
    setErr("");
    if (!loggedIn) {
      router.push("/signup");
      return;
    }
    if (planId === "free") {
      router.push("/dashboard");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/process?stripe=checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      if (data.changed || data.ok) {
        router.push("/dashboard?upgraded=1");
        router.refresh();
        return;
      }
      setErr(data.error || "Couldn't start checkout. Please try again.");
    } catch {
      setErr("Network problem — please try again.");
    }
    setBusy(false);
  }

  const base = highlight
    ? "bg-gradient-to-r from-indigo-500 to-fuchsia-500 hover:opacity-90"
    : "glass hover:text-white";

  return (
    <div className="mt-8">
      <button
        onClick={go}
        disabled={busy}
        className={`w-full rounded-xl py-3 text-center font-medium transition disabled:opacity-60 ${base}`}
      >
        {busy ? "Starting…" : label}
      </button>
      {err && <p className="mt-2 text-center text-xs text-red-300">{err}</p>}
    </div>
  );
}
