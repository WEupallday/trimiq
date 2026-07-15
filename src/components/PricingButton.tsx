"use client";

import { useState, useEffect } from "react";
import { ttTrack } from "@/components/TikTokPixel";
import { useRouter } from "next/navigation";

let ttViewContentFired = false; // fire ViewContent once per page load
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

  // ViewContent: pricing seen (browser-only; no server dedup needed).
  useEffect(() => {
    if (ttViewContentFired) return;
    ttViewContentFired = true;
    ttTrack("ViewContent", { content_type: "product", content_name: "Pricing" });
  }, []);

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
      // InitiateCheckout (browser side; deduped with the server via ttEventId).
      if (data.ttEventId) ttTrack("InitiateCheckout", { content_name: label, plan: planId }, data.ttEventId);
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
