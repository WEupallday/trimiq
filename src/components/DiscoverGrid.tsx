"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const CATEGORIES = [
  { id: "all", label: "All" },
  { id: "beauty", label: "Beauty" },
  { id: "home", label: "Home" },
  { id: "fitness", label: "Fitness" },
];
const WINDOWS = [7, 30, 90];
const SORTS = [
  { id: "trend", label: "Trend score" },
  { id: "momentum", label: "Momentum" },
  { id: "gmv", label: "Est. GMV" },
  { id: "velocity", label: "Velocity" },
];

export type DiscoverInitial = { window: number; category: string; sort: string; breakout: boolean; q: string };

function money(n: number) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return "$" + (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000) return "$" + (v / 1_000).toFixed(1) + "K";
  return "$" + Math.round(v);
}
function compact(n: number) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(1) + "K";
  return String(Math.round(v));
}
function stateChip(state: string) {
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
  return "text-white/70";
}

export default function DiscoverGrid({ isAdmin, initial }: { isAdmin: boolean; initial: DiscoverInitial }) {
  const router = useRouter();
  const [window, setWindow] = useState(initial.window);
  const [category, setCategory] = useState(initial.category);
  const [sort, setSort] = useState(initial.sort);
  const [breakoutOnly, setBreakoutOnly] = useState(initial.breakout);
  const [q, setQ] = useState(initial.q);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [msg, setMsg] = useState("");
  const restored = useRef(false);

  const qs = useCallback(() => {
    const p = new URLSearchParams();
    p.set("window", String(window));
    p.set("category", category);
    p.set("sort", sort);
    if (breakoutOnly) p.set("breakout", "1");
    if (q.trim()) p.set("q", q.trim());
    return p.toString();
  }, [window, category, sort, breakoutOnly, q]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/discover?${qs()}`, { cache: "no-store" });
      const data = await res.json();
      setItems(Array.isArray(data.products) ? data.products : []);
      setMsg(data.products?.length ? "" : "No products loaded yet.");
    } catch {
      setMsg("Couldn't load products.");
    }
    setLoading(false);
  }, [qs]);

  // Debounced: keep the URL in sync (so Back-to-Discover restores state) + reload.
  useEffect(() => {
    const t = setTimeout(() => {
      router.replace(`/discover?${qs()}`, { scroll: false });
      load();
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [window, category, sort, breakoutOnly, q]);

  // Restore scroll position on return; save it as the user scrolls.
  useEffect(() => {
    const onScroll = () => sessionStorage.setItem("discoverScroll", String(globalThis.scrollY));
    globalThis.addEventListener("scroll", onScroll, { passive: true });
    return () => globalThis.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (!loading && items.length && !restored.current) {
      restored.current = true;
      const y = Number(sessionStorage.getItem("discoverScroll") || "0");
      if (y > 0) globalThis.scrollTo({ top: y });
    }
  }, [loading, items.length]);

  async function seed() {
    setSeeding(true);
    setMsg("Loading product data…");
    try {
      const res = await fetch("/api/discover?seed=1", { method: "POST" });
      const d = await res.json();
      setMsg(res.ok ? `Loaded ${d.products} products (source: ${d.provider}).` : d.error || "Refresh failed.");
      await load();
    } catch {
      setMsg("Refresh failed.");
    }
    setSeeding(false);
  }

  const breakingCount = items.filter((x) => x.isBreakout).length;

  return (
    <div>
      {/* Summary strip */}
      <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-white/50">
        <span><span className="font-semibold text-white">{items.length}</span> products</span>
        <span className="text-amber-300"><span className="font-semibold">{breakingCount}</span> breaking out 🚀</span>
        <span className="hidden sm:inline">US · updated continuously</span>
      </div>

      {/* Controls */}
      <div className="sticky top-0 z-10 -mx-2 mb-6 flex flex-wrap items-center gap-2 rounded-2xl bg-ink/70 px-2 py-2 backdrop-blur">
        <div className="flex rounded-xl border border-white/10 bg-white/[0.04] p-0.5">
          {WINDOWS.map((w) => (
            <button key={w} onClick={() => setWindow(w)}
              className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${window === w ? "bg-indigo-500/30 text-white" : "text-white/50 hover:text-white"}`}>
              {w}d
            </button>
          ))}
        </div>
        <div className="flex rounded-xl border border-white/10 bg-white/[0.04] p-0.5">
          {CATEGORIES.map((c) => (
            <button key={c.id} onClick={() => setCategory(c.id)}
              className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${category === c.id ? "bg-indigo-500/30 text-white" : "text-white/50 hover:text-white"}`}>
              {c.label}
            </button>
          ))}
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value)}
          className="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-sm outline-none">
          {SORTS.map((s) => <option key={s.id} value={s.id} className="bg-neutral-900">Sort: {s.label}</option>)}
        </select>
        <button onClick={() => setBreakoutOnly((v) => !v)}
          className={`rounded-xl border px-3.5 py-2 text-sm font-medium transition ${breakoutOnly ? "border-amber-400/50 bg-amber-500/15 text-amber-200" : "border-white/10 text-white/60 hover:text-white"}`}>
          🚀 Breaking out
        </button>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products…"
          className="min-w-[8rem] flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm outline-none transition focus:border-indigo-400/50 sm:max-w-xs" />
        {isAdmin && (
          <button onClick={seed} disabled={seeding}
            className="rounded-xl border border-white/10 px-3 py-2 text-sm text-white/70 transition hover:text-white disabled:opacity-50">
            {seeding ? "Loading…" : "Refresh data"}
          </button>
        )}
      </div>

      {msg && <p className="mb-4 text-sm text-white/50">{msg}{isAdmin && items.length === 0 ? " — click “Refresh data”." : ""}</p>}

      {/* Grid */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((x) => (
          <div key={x.id} className="glass group flex flex-col overflow-hidden rounded-3xl transition hover:border-white/20">
            <div className="relative aspect-[4/5] overflow-hidden bg-white/[0.03]">
              {x.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={x.imageUrl} alt={x.title} loading="lazy"
                  className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
              ) : null}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
              <span className={`absolute left-3 top-3 rounded-full border px-2.5 py-1 text-[11px] font-medium ${stateChip(x.state)}`}>
                {x.state === "breakout" ? "🚀 Breaking out" : x.state[0].toUpperCase() + x.state.slice(1)}
              </span>
              <span className="absolute right-3 top-3 rounded-full bg-black/50 px-2.5 py-1 text-[11px] capitalize text-white/80 backdrop-blur">
                {x.category}
              </span>
              <div className="absolute inset-x-3 bottom-3">
                <p className="line-clamp-2 text-[15px] font-semibold leading-snug text-white drop-shadow">{x.title}</p>
                <p className="mt-0.5 text-xs text-white/60">{x.sellerName}</p>
              </div>
            </div>

            <div className="flex flex-1 flex-col p-5">
              {/* Hero metrics — the numbers should catch the eye first */}
              <div className="grid grid-cols-2 gap-4">
                <Metric label="Trend score" value={String(x.trend)} valueClass={`text-3xl ${trendColor(x.trend)}`}
                  sub={<GrowthPill g={x.growth} />} />
                <Metric label="Momentum" value={String(x.momentum)} valueClass="text-3xl text-white" />
                <Metric label="Est. GMV" value={money(x.gmv)} valueClass="text-2xl text-emerald-300" />
                <Metric label="Sales" value={compact(x.sold)} valueClass="text-2xl text-white"
                  sub={<span className="text-[11px] text-white/40">~{compact(x.velocity)}/day · ${(Math.round(x.price * 100) / 100)}</span>} />
              </div>

              {x.confidence < 0.7 && <p className="mt-3 text-[11px] text-white/30">Estimated (sold count is rounded)</p>}

              <Link
                href={`/dashboard?product=${encodeURIComponent(x.id)}&title=${encodeURIComponent(x.title)}&from=${encodeURIComponent("/discover?" + qs())}`}
                className="mt-4 rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 py-3 text-center text-sm font-semibold shadow-lg shadow-indigo-500/20 transition hover:shadow-indigo-500/40">
                Create ad with TrimIQ →
              </Link>
            </div>
          </div>
        ))}
      </div>

      {loading && items.length === 0 && <p className="mt-6 text-sm text-white/40">Loading…</p>}
    </div>
  );
}

function Metric({ label, value, valueClass, sub }: { label: string; value: string; valueClass: string; sub?: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-white/40">{label}</div>
      <div className={`mt-0.5 font-bold leading-none ${valueClass}`}>{value}</div>
      {sub && <div className="mt-1">{sub}</div>}
    </div>
  );
}

function GrowthPill({ g }: { g: number }) {
  const up = g > 0, down = g < 0;
  const pct = Math.abs(Math.round(g * 100));
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${up ? "text-emerald-300" : down ? "text-red-300" : "text-white/40"}`}>
      {up ? "▲" : down ? "▼" : "—"} {pct}%
    </span>
  );
}
