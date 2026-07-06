"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

const CATEGORIES = [
  { id: "all", label: "All" },
  { id: "beauty", label: "Beauty" },
  { id: "home", label: "Home" },
  { id: "fitness", label: "Fitness" },
];
const WINDOWS = [7, 30, 90];

function money(n: number) {
  const v = Number(n) || 0;
  if (v >= 1000) return "$" + Math.round(v).toLocaleString("en-US");
  return "$" + (Math.round(v * 100) / 100).toLocaleString("en-US");
}
function stateBadge(state: string) {
  const map: Record<string, string> = {
    breakout: "bg-amber-500/20 text-amber-200 border-amber-400/40",
    rising: "bg-emerald-500/15 text-emerald-200 border-emerald-400/30",
    stable: "bg-white/10 text-white/60 border-white/15",
    cooling: "bg-red-500/15 text-red-200 border-red-400/30",
  };
  return map[state] || map.stable;
}
function trendColor(t: number) {
  if (t >= 70) return "text-amber-300";
  if (t >= 50) return "text-emerald-300";
  return "text-white/60";
}

export default function DiscoverGrid({ isAdmin }: { isAdmin: boolean }) {
  const [window, setWindow] = useState(7);
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState("trend");
  const [breakoutOnly, setBreakoutOnly] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ window: String(window), category, sort });
      if (breakoutOnly) params.set("breakout", "1");
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/discover?${params}`, { cache: "no-store" });
      const data = await res.json();
      setItems(Array.isArray(data.products) ? data.products : []);
      setMsg(data.products?.length ? "" : "No products yet.");
    } catch {
      setMsg("Couldn't load products.");
    }
    setLoading(false);
  }, [window, category, sort, breakoutOnly, q]);

  useEffect(() => { load(); }, [load]);

  async function seed() {
    setSeeding(true);
    setMsg("Loading product data…");
    try {
      const res = await fetch("/api/discover?seed=1", { method: "POST" });
      const d = await res.json();
      setMsg(res.ok ? `Loaded ${d.products} products (source: ${d.provider}).` : d.error || "Seed failed.");
      await load();
    } catch {
      setMsg("Seed failed.");
    }
    setSeeding(false);
  }

  return (
    <div>
      {/* Controls */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-white/10 bg-white/[0.03] p-0.5">
          {WINDOWS.map((w) => (
            <button key={w} onClick={() => setWindow(w)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${window === w ? "bg-indigo-500/25 text-white" : "text-white/50 hover:text-white"}`}>
              {w}d
            </button>
          ))}
        </div>
        <div className="flex rounded-xl border border-white/10 bg-white/[0.03] p-0.5">
          {CATEGORIES.map((c) => (
            <button key={c.id} onClick={() => setCategory(c.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${category === c.id ? "bg-indigo-500/25 text-white" : "text-white/50 hover:text-white"}`}>
              {c.label}
            </button>
          ))}
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value)}
          className="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-xs outline-none">
          <option value="trend" className="bg-neutral-900">Sort: Trend score</option>
          <option value="momentum" className="bg-neutral-900">Sort: Momentum</option>
          <option value="velocity" className="bg-neutral-900">Sort: Velocity</option>
          <option value="gmv" className="bg-neutral-900">Sort: Est. GMV</option>
        </select>
        <button onClick={() => setBreakoutOnly((v) => !v)}
          className={`rounded-xl border px-3 py-2 text-xs font-medium transition ${breakoutOnly ? "border-amber-400/50 bg-amber-500/15 text-amber-200" : "border-white/10 text-white/60 hover:text-white"}`}>
          🚀 Breaking out
        </button>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products…"
          className="flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm outline-none transition focus:border-indigo-400/50 sm:max-w-xs" />
        {isAdmin && (
          <button onClick={seed} disabled={seeding}
            className="rounded-xl border border-white/10 px-3 py-2 text-xs text-white/70 transition hover:text-white disabled:opacity-50">
            {seeding ? "Loading…" : "Refresh data"}
          </button>
        )}
      </div>

      {msg && <p className="mb-4 text-sm text-white/50">{msg}{isAdmin && items.length === 0 ? " — click “Refresh data” to load." : ""}</p>}

      {/* Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((x) => (
          <div key={x.id} className="glass flex flex-col overflow-hidden rounded-2xl">
            <div className="relative aspect-square bg-white/[0.03]">
              {x.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={x.imageUrl} alt={x.title} className="h-full w-full object-cover" loading="lazy" />
              ) : null}
              <span className={`absolute left-2 top-2 rounded-full border px-2 py-0.5 text-[10px] font-medium ${stateBadge(x.state)}`}>
                {x.state === "breakout" ? "🚀 Breaking out" : x.state}
              </span>
              <span className="absolute right-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-white/80 backdrop-blur">
                {x.category}
              </span>
            </div>
            <div className="flex flex-1 flex-col p-4">
              <p className="line-clamp-2 text-sm font-medium">{x.title}</p>
              <p className="mt-0.5 text-xs text-white/40">{x.sellerName}</p>
              <div className="mt-3 flex items-end justify-between">
                <div>
                  <div className={`text-2xl font-bold ${trendColor(x.trend)}`}>{x.trend}</div>
                  <div className="text-[10px] uppercase tracking-wide text-white/40">Trend score</div>
                </div>
                <div className="text-right text-xs text-white/60">
                  <div>{money(x.price)} · {Number(x.sold).toLocaleString("en-US")} sold</div>
                  <div className="text-white/40">~{Math.round(x.velocity)}/day · {money(x.gmv)} GMV</div>
                  <div className={x.growth > 0 ? "text-emerald-300" : x.growth < 0 ? "text-red-300" : "text-white/40"}>
                    {x.growth > 0 ? "▲" : x.growth < 0 ? "▼" : "—"} {Math.abs(Math.round(x.growth * 100))}% vs prev
                  </div>
                </div>
              </div>
              {x.confidence < 0.7 && (
                <p className="mt-2 text-[10px] text-white/30">Estimate (sold count is rounded)</p>
              )}
              <Link
                href={`/dashboard?product=${encodeURIComponent(x.id)}&title=${encodeURIComponent(x.title)}`}
                className="mt-3 rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 py-2.5 text-center text-sm font-medium transition hover:opacity-90">
                Create ad with TrimIQ
              </Link>
            </div>
          </div>
        ))}
      </div>

      {loading && items.length === 0 && <p className="mt-6 text-sm text-white/40">Loading…</p>}
    </div>
  );
}
