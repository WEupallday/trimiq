"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  { id: "trend", label: "Hottest" },
  { id: "momentum", label: "Momentum" },
  { id: "gmv", label: "Est. GMV" },
  { id: "velocity", label: "Sales" },
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

// ── Instant-read labels (UI layer only — the numbers still drive sorting). ──
// Trend = "How popular is this right now?"
function trendLabel(x: any): { icon: string; text: string; cls: string } {
  const t = Number(x.trend) || 0;
  if (x.isBreakout || t >= 75) return { icon: "🔥", text: "Hot", cls: "border-orange-400/40 bg-orange-500/15 text-orange-200" };
  if (t >= 60) return { icon: "🚀", text: "Trending", cls: "border-amber-400/40 bg-amber-500/15 text-amber-200" };
  if (t >= 45) return { icon: "📈", text: "Rising", cls: "border-emerald-400/35 bg-emerald-500/15 text-emerald-200" };
  if (t >= 30) return { icon: "➖", text: "Stable", cls: "border-white/15 bg-white/[0.06] text-white/65" };
  return { icon: "❄️", text: "Cold", cls: "border-sky-400/30 bg-sky-500/10 text-sky-200" };
}
// Momentum = "Is this speeding up or slowing down?"
function momentumLabel(x: any): { icon: string; text: string; cls: string } {
  const g = Number(x.growth) || 0;
  if (g >= 0.5) return { icon: "🚀", text: "Accelerating", cls: "border-emerald-400/40 bg-emerald-500/15 text-emerald-200" };
  if (g > 0.15) return { icon: "📈", text: "Growing", cls: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" };
  if (g >= -0.15) return { icon: "➖", text: "Flat", cls: "border-white/15 bg-white/[0.06] text-white/65" };
  return { icon: "📉", text: "Slowing", cls: "border-orange-400/35 bg-orange-500/10 text-orange-200" };
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

  const hotCount = items.filter((x) => x.isBreakout || Number(x.trend) >= 75).length;

  return (
    <div>
      {/* Summary strip */}
      <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-white/50">
        <span><span className="font-semibold text-white">{items.length}</span> products</span>
        <span className="text-orange-300"><span className="font-semibold">{hotCount}</span> hot 🔥</span>
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
          className={`rounded-xl border px-3.5 py-2 text-sm font-medium transition ${breakoutOnly ? "border-orange-400/50 bg-orange-500/15 text-orange-200" : "border-white/10 text-white/60 hover:text-white"}`}>
          🔥 Hot only
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

      {/* Grid — each card reads in under 2 seconds: name, two labels, GMV, Sales. */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((x) => {
          const trend = trendLabel(x);
          const mo = momentumLabel(x);
          return (
            <div key={x.id} className="glass group flex flex-col overflow-hidden rounded-3xl transition hover:border-white/20">
              <div className="relative aspect-[4/5] overflow-hidden bg-white/[0.03]">
                {x.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={x.imageUrl} alt={x.title} loading="lazy"
                    className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
                ) : null}
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent" />
                <span className="absolute right-3 top-3 rounded-full bg-black/50 px-2.5 py-1 text-[11px] capitalize text-white/80 backdrop-blur">
                  {x.category}
                </span>
                <div className="absolute inset-x-4 bottom-4">
                  <p className="line-clamp-2 text-base font-semibold leading-snug text-white drop-shadow">{x.title}</p>
                  <p className="mt-0.5 text-xs text-white/60">{x.sellerName}</p>
                </div>
              </div>

              <div className="flex flex-1 flex-col p-5">
                {/* Instant meaning: two labels, no numbers to interpret */}
                <div className="flex flex-wrap gap-2">
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold ${trend.cls}`}>
                    <span>{trend.icon}</span> {trend.text}
                  </span>
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold ${mo.cls}`}>
                    <span>{mo.icon}</span> {mo.text}
                  </span>
                </div>

                {/* The two numbers that matter, big */}
                <div className="mt-5 grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-wide text-white/40">Est. GMV</div>
                    <div className="mt-1 text-3xl font-bold leading-none text-emerald-300">{money(x.gmv)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-wide text-white/40">Sales</div>
                    <div className="mt-1 text-3xl font-bold leading-none text-white">{compact(x.sold)}</div>
                  </div>
                </div>

                <Link
                  href={`/dashboard?product=${encodeURIComponent(x.id)}&title=${encodeURIComponent(x.title)}&from=${encodeURIComponent("/discover?" + qs())}`}
                  className="mt-5 rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 py-3 text-center text-sm font-semibold shadow-lg shadow-indigo-500/20 transition hover:shadow-indigo-500/40">
                  Create ad with TrimIQ →
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      {loading && items.length === 0 && <p className="mt-6 text-sm text-white/40">Loading…</p>}
    </div>
  );
}
