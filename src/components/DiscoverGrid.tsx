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
const PAGE = 8; // how many feed items to reveal per scroll batch

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

// ── Instant-read labels (UI layer only — numbers still drive sorting). ──
function trendLabel(x: any): { icon: string; text: string; cls: string } {
  const t = Number(x.trend) || 0;
  if (x.isBreakout || t >= 75) return { icon: "🔥", text: "Hot", cls: "border-orange-400/40 bg-orange-500/15 text-orange-200" };
  if (t >= 60) return { icon: "🚀", text: "Trending", cls: "border-amber-400/40 bg-amber-500/15 text-amber-200" };
  if (t >= 45) return { icon: "📈", text: "Rising", cls: "border-emerald-400/35 bg-emerald-500/15 text-emerald-200" };
  if (t >= 30) return { icon: "➖", text: "Stable", cls: "border-white/15 bg-white/[0.06] text-white/65" };
  return { icon: "❄️", text: "Cold", cls: "border-sky-400/30 bg-sky-500/10 text-sky-200" };
}
function momentumLabel(x: any): { icon: string; text: string; cls: string } {
  const g = Number(x.growth) || 0;
  if (g >= 0.5) return { icon: "🚀", text: "Accelerating", cls: "border-emerald-400/40 bg-emerald-500/15 text-emerald-200" };
  if (g > 0.15) return { icon: "📈", text: "Growing", cls: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" };
  if (g >= -0.15) return { icon: "➖", text: "Flat", cls: "border-white/15 bg-white/[0.06] text-white/65" };
  return { icon: "📉", text: "Slowing", cls: "border-orange-400/35 bg-orange-500/10 text-orange-200" };
}

function createAdHref(x: any, from: string) {
  return `/dashboard?product=${encodeURIComponent(x.id)}&title=${encodeURIComponent(x.title)}&from=${encodeURIComponent(from)}`;
}

export default function DiscoverGrid({ isAdmin, initial }: { isAdmin: boolean; initial: DiscoverInitial }) {
  const router = useRouter();
  const [window, setWindow] = useState(initial.window);
  const [category, setCategory] = useState(initial.category);
  const [sort, setSort] = useState(initial.sort);
  const [breakoutOnly, setBreakoutOnly] = useState(initial.breakout);
  const [q, setQ] = useState(initial.q);

  const [items, setItems] = useState<any[]>([]);
  const [visible, setVisible] = useState(PAGE);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [msg, setMsg] = useState("");

  const [watch, setWatch] = useState<string[]>([]);
  const [selected, setSelected] = useState<any>(null); // grid row for the open drawer
  const [detail, setDetail] = useState<any>(null); // { product, series }
  const [detailLoading, setDetailLoading] = useState(false);

  const restored = useRef(false);
  const sentinel = useRef<HTMLDivElement | null>(null);

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
      const list = Array.isArray(data.products) ? data.products : [];
      setItems(list);
      setVisible(PAGE);
      setMsg(list.length ? "" : "No products loaded yet.");
    } catch {
      setMsg("Couldn't load products.");
    }
    setLoading(false);
  }, [qs]);

  // Load watchlist once (client-side only — no backend change).
  useEffect(() => {
    try { setWatch(JSON.parse(localStorage.getItem("trimiqWatch") || "[]")); } catch {}
  }, []);
  function toggleWatch(id: string) {
    setWatch((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : prev.concat(id);
      try { localStorage.setItem("trimiqWatch", JSON.stringify(next)); } catch {}
      return next;
    });
  }

  // Debounced URL sync (so Back-to-Discover restores state) + reload.
  useEffect(() => {
    const t = setTimeout(() => {
      router.replace(`/discover?${qs()}`, { scroll: false });
      load();
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [window, category, sort, breakoutOnly, q]);

  // Infinite scroll: reveal more as the sentinel nears the viewport.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) setVisible((v) => Math.min(v + PAGE, items.length)); },
      { rootMargin: "700px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [items.length]);

  // Save + restore scroll position across the Create-Ad round trip.
  useEffect(() => {
    const onScroll = () => sessionStorage.setItem("discoverScroll", String(globalThis.scrollY));
    globalThis.addEventListener("scroll", onScroll, { passive: true });
    return () => globalThis.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (!loading && items.length && !restored.current) {
      restored.current = true;
      const y = Number(sessionStorage.getItem("discoverScroll") || "0");
      if (y > 0) {
        const need = Math.ceil((y + 1200) / 520);
        setVisible((v) => Math.max(v, Math.min(need, items.length)));
        setTimeout(() => globalThis.scrollTo({ top: y }), 40);
      }
    }
  }, [loading, items.length]);

  async function openDetail(x: any) {
    setSelected(x);
    setDetail(null);
    setDetailLoading(true);
    try {
      const r = await fetch(`/api/discover?id=${encodeURIComponent(x.id)}`, { cache: "no-store" });
      setDetail(await r.json());
    } catch {}
    setDetailLoading(false);
  }
  function closeDetail() { setSelected(null); setDetail(null); }

  // Lock body scroll + close on Escape while the drawer is open.
  useEffect(() => {
    if (!selected) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeDetail(); };
    globalThis.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; globalThis.removeEventListener("keydown", onKey); };
  }, [selected]);

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

  const from = `/discover?${qs()}`;
  const hotCount = items.filter((x) => x.isBreakout || Number(x.trend) >= 75).length;
  const shown = items.slice(0, visible);

  return (
    <div>
      {/* Summary strip */}
      <div className="mx-auto mb-5 flex max-w-2xl flex-wrap items-center gap-x-6 gap-y-2 text-sm text-white/50">
        <span><span className="font-semibold text-white">{items.length}</span> products</span>
        <span className="text-orange-300"><span className="font-semibold">{hotCount}</span> hot 🔥</span>
        {watch.length > 0 && <span className="text-white/60">★ {watch.length} saved</span>}
      </div>

      {/* Filter bar */}
      <div className="sticky top-0 z-20 mx-auto mb-6 flex max-w-2xl flex-wrap items-center gap-2 rounded-2xl bg-ink/80 px-2 py-2 backdrop-blur">
        <div className="flex rounded-xl border border-white/10 bg-white/[0.04] p-0.5">
          {WINDOWS.map((w) => (
            <button key={w} onClick={() => setWindow(w)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${window === w ? "bg-indigo-500/30 text-white" : "text-white/50 hover:text-white"}`}>
              {w}d
            </button>
          ))}
        </div>
        <div className="flex rounded-xl border border-white/10 bg-white/[0.04] p-0.5">
          {CATEGORIES.map((c) => (
            <button key={c.id} onClick={() => setCategory(c.id)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${category === c.id ? "bg-indigo-500/30 text-white" : "text-white/50 hover:text-white"}`}>
              {c.label}
            </button>
          ))}
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value)}
          className="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-sm outline-none">
          {SORTS.map((s) => <option key={s.id} value={s.id} className="bg-neutral-900">Sort: {s.label}</option>)}
        </select>
        <button onClick={() => setBreakoutOnly((v) => !v)}
          className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${breakoutOnly ? "border-orange-400/50 bg-orange-500/15 text-orange-200" : "border-white/10 text-white/60 hover:text-white"}`}>
          🔥 Hot
        </button>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
          className="min-w-[6rem] flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm outline-none transition focus:border-indigo-400/50" />
        {isAdmin && (
          <button onClick={seed} disabled={seeding}
            className="rounded-xl border border-white/10 px-3 py-2 text-sm text-white/70 transition hover:text-white disabled:opacity-50">
            {seeding ? "…" : "Refresh"}
          </button>
        )}
      </div>

      {msg && <p className="mx-auto mb-4 max-w-2xl text-sm text-white/50">{msg}{isAdmin && items.length === 0 ? " — click “Refresh”." : ""}</p>}

      {/* The feed */}
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        {loading && items.length === 0
          ? Array.from({ length: 4 }).map((_, i) => <SkeletonTile key={i} />)
          : shown.map((x) => (
              <FeedTile
                key={x.id}
                x={x}
                from={from}
                saved={watch.includes(x.id)}
                onOpen={() => openDetail(x)}
                onSave={() => toggleWatch(x.id)}
              />
            ))}

        {/* Infinite-scroll sentinel */}
        {visible < items.length && (
          <div ref={sentinel} className="flex flex-col gap-6">
            <SkeletonTile />
          </div>
        )}
      </div>

      {selected && (
        <DetailDrawer
          x={selected}
          detail={detail}
          loading={detailLoading}
          from={from}
          saved={watch.includes(selected.id)}
          onSave={() => toggleWatch(selected.id)}
          onClose={closeDetail}
        />
      )}
    </div>
  );
}

// ─────────────────────────── Feed tile ───────────────────────────
function FeedTile({ x, from, saved, onOpen, onSave }: { x: any; from: string; saved: boolean; onOpen: () => void; onSave: () => void }) {
  const trend = trendLabel(x);
  const mo = momentumLabel(x);
  return (
    <article className="glass overflow-hidden rounded-3xl transition hover:border-white/20">
      <button onClick={onOpen} className="group relative block w-full text-left">
        <div className="relative aspect-video w-full overflow-hidden bg-white/[0.03]">
          {x.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={x.imageUrl} alt={x.title} loading="lazy"
              className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
          ) : null}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
          <span className="absolute right-3 top-3 rounded-full bg-black/50 px-2.5 py-1 text-[11px] capitalize text-white/80 backdrop-blur">{x.category}</span>
          <div className="absolute inset-x-4 bottom-3 flex items-end justify-between gap-3">
            <div>
              <h3 className="line-clamp-2 text-lg font-bold leading-tight text-white drop-shadow">{x.title}</h3>
              <p className="mt-0.5 text-xs text-white/60">{x.sellerName}</p>
            </div>
            <span className="shrink-0 rounded-full bg-black/50 px-2.5 py-1 text-xs font-medium text-white/80 opacity-0 backdrop-blur transition group-hover:opacity-100">View →</span>
          </div>
        </div>
      </button>

      <div className="p-5">
        <div className="flex flex-wrap gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold ${trend.cls}`}><span>{trend.icon}</span> {trend.text}</span>
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold ${mo.cls}`}><span>{mo.icon}</span> {mo.text}</span>
        </div>

        <div className="mt-4 flex items-end gap-8">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-white/40">Est. GMV</div>
            <div className="mt-1 text-4xl font-bold leading-none text-emerald-300">{money(x.gmv)}</div>
          </div>
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-white/40">Sales</div>
            <div className="mt-1 text-3xl font-bold leading-none text-white">{compact(x.sold)}</div>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-2">
          <Link href={createAdHref(x, from)}
            className="flex-1 rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 py-3 text-center text-sm font-semibold shadow-lg shadow-indigo-500/20 transition hover:shadow-indigo-500/40">
            Create ad with TrimIQ →
          </Link>
          <button onClick={onOpen} className="rounded-xl border border-white/12 px-4 py-3 text-sm font-medium text-white/75 transition hover:bg-white/[0.06] hover:text-white">Details</button>
          <button onClick={onSave} aria-label={saved ? "Remove from watchlist" : "Save to watchlist"}
            className={`rounded-xl border px-3.5 py-3 text-sm transition ${saved ? "border-amber-400/50 bg-amber-500/15 text-amber-200" : "border-white/12 text-white/50 hover:text-white"}`}>
            {saved ? "★" : "☆"}
          </button>
        </div>
      </div>
    </article>
  );
}

function SkeletonTile() {
  return (
    <div className="glass overflow-hidden rounded-3xl">
      <div className="aspect-video w-full animate-pulse bg-white/[0.05]" />
      <div className="space-y-4 p-5">
        <div className="flex gap-2">
          <div className="h-7 w-20 animate-pulse rounded-full bg-white/[0.06]" />
          <div className="h-7 w-24 animate-pulse rounded-full bg-white/[0.06]" />
        </div>
        <div className="flex gap-8">
          <div className="h-9 w-24 animate-pulse rounded bg-white/[0.06]" />
          <div className="h-9 w-16 animate-pulse rounded bg-white/[0.06]" />
        </div>
        <div className="h-11 w-full animate-pulse rounded-xl bg-white/[0.06]" />
      </div>
    </div>
  );
}

// ─────────────────────────── Detail drawer ───────────────────────────
function DetailDrawer({ x, detail, loading, from, saved, onSave, onClose }: {
  x: any; detail: any; loading: boolean; from: string; saved: boolean; onSave: () => void; onClose: () => void;
}) {
  const trend = trendLabel(x);
  const mo = momentumLabel(x);
  const product = detail?.product;
  const series: { t: string; sold: number }[] = detail?.series || [];
  const storeUrl: string | undefined = product?.productUrl;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-up" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-white/10 bg-panel shadow-2xl">
        <div className="relative aspect-video w-full shrink-0 overflow-hidden bg-white/[0.03]">
          {x.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={x.imageUrl} alt={x.title} className="h-full w-full object-cover" />
          ) : null}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
          <button onClick={onClose} aria-label="Close"
            className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-black/50 text-white/80 backdrop-blur transition hover:bg-black/70">✕</button>
          <div className="absolute inset-x-5 bottom-4">
            <h2 className="text-2xl font-bold leading-tight text-white drop-shadow">{x.title}</h2>
            <p className="mt-1 text-sm text-white/70">{x.sellerName} · <span className="capitalize">{x.category}</span></p>
          </div>
        </div>

        <div className="flex flex-col gap-6 p-6">
          <div className="flex flex-wrap gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold ${trend.cls}`}><span>{trend.icon}</span> {trend.text}</span>
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold ${mo.cls}`}><span>{mo.icon}</span> {mo.text}</span>
          </div>

          <div className="flex items-end gap-8">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-white/40">Est. GMV</div>
              <div className="mt-1 text-4xl font-bold leading-none text-emerald-300">{money(x.gmv)}</div>
            </div>
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-white/40">Sales</div>
              <div className="mt-1 text-3xl font-bold leading-none text-white">{compact(x.sold)}</div>
            </div>
          </div>

          <div>
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-white/40">Sales trend</div>
            {loading ? (
              <div className="h-20 w-full animate-pulse rounded-xl bg-white/[0.05]" />
            ) : series.length > 1 ? (
              <Sparkline series={series} />
            ) : (
              <p className="text-sm text-white/40">Not enough history yet.</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Link href={createAdHref(x, from)}
              className="rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 py-3.5 text-center text-sm font-semibold shadow-lg shadow-indigo-500/25 transition hover:shadow-indigo-500/40">
              Create ad with TrimIQ →
            </Link>
            <div className="flex gap-2">
              <button onClick={onSave}
                className={`flex-1 rounded-xl border py-3 text-sm font-medium transition ${saved ? "border-amber-400/50 bg-amber-500/15 text-amber-200" : "border-white/12 text-white/75 hover:bg-white/[0.06] hover:text-white"}`}>
                {saved ? "★ Saved" : "☆ Save to watchlist"}
              </button>
              {storeUrl && (
                <a href={storeUrl} target="_blank" rel="noopener noreferrer"
                  className="rounded-xl border border-white/12 px-4 py-3 text-sm font-medium text-white/75 transition hover:bg-white/[0.06] hover:text-white">
                  View on store ↗
                </a>
              )}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function Sparkline({ series }: { series: { t: string; sold: number }[] }) {
  const vals = series.map((s) => Number(s.sold) || 0);
  const min = Math.min.apply(null, vals);
  const max = Math.max.apply(null, vals);
  const range = max - min || 1;
  const w = 340, h = 80, n = vals.length;
  const pts = vals.map((v, i) => `${(i / (n - 1)) * w},${h - ((v - min) / range) * (h - 8) - 4}`).join(" ");
  const areaPts = `0,${h} ${pts} ${w},${h}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-20 w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(52 211 153)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="rgb(52 211 153)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPts} fill="url(#spark)" />
      <polyline points={pts} fill="none" stroke="rgb(52 211 153)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
