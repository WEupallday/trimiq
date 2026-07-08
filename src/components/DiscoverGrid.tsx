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
  { id: "trend", label: "Hottest" },
  { id: "momentum", label: "Momentum" },
  { id: "gmv", label: "Est. GMV" },
  { id: "velocity", label: "Sales" },
];
const PAGE = 12;
// Guests can browse this many pages free; the rest are locked behind sign-up.
const FREE_PAGES = 1;
const GRID = "grid grid-cols-1 gap-x-6 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

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
function pctStr(g: number) {
  const v = Math.round((Number(g) || 0) * 100);
  if (v > 999) return "+999%+"; // a 0→spike breakout produces huge ratios; the label carries the meaning
  if (v < -99) return "−99%+";
  return (v > 0 ? "+" : "") + v + "%";
}
// Route external product images through our proxy (TikTok/EchoTik CDNs block hotlinking).
function proxied(u?: string): string | undefined {
  if (!u) return undefined;
  if (u.charAt(0) === "/") return u; // already local
  return `/api/img?u=${encodeURIComponent(u)}`;
}

// ── Instant-read labels (UI layer only — numbers still drive sorting). ──
function trendLabel(x: any): { icon: string; text: string; cls: string } {
  const t = Number(x.trend ?? x.trend7) || 0;
  if (x.isBreakout || t >= 75) return { icon: "🔥", text: "Hot", cls: "border-orange-400/40 bg-orange-500/15 text-orange-200" };
  if (t >= 60) return { icon: "🚀", text: "Trending", cls: "border-amber-400/40 bg-amber-500/15 text-amber-200" };
  if (t >= 45) return { icon: "📈", text: "Rising", cls: "border-emerald-400/35 bg-emerald-500/15 text-emerald-200" };
  if (t >= 30) return { icon: "➖", text: "Stable", cls: "border-white/15 bg-white/[0.06] text-white/65" };
  return { icon: "❄️", text: "Cold", cls: "border-sky-400/30 bg-sky-500/10 text-sky-200" };
}
function momentumLabel(x: any): { icon: string; text: string; cls: string } {
  const g = Number(x.growth ?? x.growth7) || 0;
  if (g >= 0.5) return { icon: "🚀", text: "Accelerating", cls: "border-emerald-400/40 bg-emerald-500/15 text-emerald-200" };
  if (g > 0.15) return { icon: "📈", text: "Growing", cls: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" };
  if (g >= -0.15) return { icon: "➖", text: "Flat", cls: "border-white/15 bg-white/[0.06] text-white/65" };
  return { icon: "📉", text: "Slowing", cls: "border-orange-400/35 bg-orange-500/10 text-orange-200" };
}

function createAdHref(x: any, from: string, isGuest: boolean) {
  if (isGuest) return "/signup";
  return `/dashboard?product=${encodeURIComponent(x.id)}&title=${encodeURIComponent(x.title)}&from=${encodeURIComponent(from)}`;
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="4" y="11" width="16" height="10" rx="2.5" />
      <path d="M8 11V7a4 4 0 1 1 8 0v4" />
    </svg>
  );
}

export default function DiscoverGrid({ isAdmin, isGuest = false, initial }: { isAdmin: boolean; isGuest?: boolean; initial: DiscoverInitial }) {
  const router = useRouter();
  const [window, setWindow] = useState(initial.window);
  const [category, setCategory] = useState(initial.category);
  const [sort, setSort] = useState(initial.sort);
  const [breakoutOnly, setBreakoutOnly] = useState(initial.breakout);
  const [q, setQ] = useState(initial.q);

  const [items, setItems] = useState<any[]>([]);
  const [teasers, setTeasers] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [msg, setMsg] = useState("");

  const [watch, setWatch] = useState<string[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const restored = useRef(false);
  const topRef = useRef<HTMLDivElement | null>(null);

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
      setTeasers(Array.isArray(data.teasers) ? data.teasers : []);
      setTotal(Number(data.total) || list.length);
      setPage(1);
      setMsg(list.length ? "" : "No products loaded yet.");
    } catch {
      setMsg("Couldn't load products.");
    }
    setLoading(false);
  }, [qs]);

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

  useEffect(() => {
    const t = setTimeout(() => {
      router.replace(`/discover?${qs()}`, { scroll: false });
      load();
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [window, category, sort, breakoutOnly, q]);

  useEffect(() => {
    const onScroll = () => sessionStorage.setItem("discoverScroll", String(globalThis.scrollY));
    globalThis.addEventListener("scroll", onScroll, { passive: true });
    return () => globalThis.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (!loading && items.length && !restored.current) {
      restored.current = true;
      const y = Number(sessionStorage.getItem("discoverScroll") || "0");
      if (y > 0) setTimeout(() => globalThis.scrollTo({ top: y }), 60);
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

  // Pagination
  const totalPages = Math.max(1, Math.ceil(total / PAGE));
  const freePages = isGuest ? Math.min(FREE_PAGES, totalPages) : totalPages;
  const isLockedPage = isGuest && page > freePages;
  const lockedCount = isGuest ? Math.max(0, total - freePages * PAGE) : 0;

  function goToPage(p: number) {
    const next = Math.min(Math.max(1, p), totalPages);
    setPage(next);
    const el = topRef.current;
    if (el) globalThis.scrollTo({ top: el.getBoundingClientRect().top + globalThis.scrollY - 24, behavior: "smooth" });
  }

  const from = `/discover?${qs()}`;
  const hotCount = items.filter((x) => x.isBreakout || Number(x.trend) >= 75).length;
  const shown = isLockedPage ? [] : items.slice((page - 1) * PAGE, page * PAGE);
  const pageTeasers = isLockedPage ? teasers.slice((page - 1) * PAGE - items.length, page * PAGE - items.length) : [];

  return (
    <div ref={topRef}>
      <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-white/50">
        <span><span className="font-semibold text-white">{total}</span> products</span>
        <span className="text-orange-300"><span className="font-semibold">{hotCount}</span> hot 🔥</span>
        {watch.length > 0 && <span className="text-white/60">★ {watch.length} saved</span>}
      </div>

      <div className="sticky top-0 z-20 -mx-2 mb-6 flex flex-wrap items-center gap-2 rounded-2xl bg-ink/80 px-2 py-2 backdrop-blur">
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
          🔥 Hot
        </button>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products…"
          className="min-w-[8rem] flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm outline-none transition focus:border-indigo-400/50 sm:max-w-xs" />
        {isAdmin && (
          <button onClick={seed} disabled={seeding}
            className="rounded-xl border border-white/10 px-3 py-2 text-sm text-white/70 transition hover:text-white disabled:opacity-50">
            {seeding ? "…" : "Refresh"}
          </button>
        )}
      </div>

      {msg && <p className="mb-4 text-sm text-white/50">{msg}{isAdmin && items.length === 0 ? " — click “Refresh”." : ""}</p>}

      {loading && items.length === 0 ? (
        <div className={GRID}>{Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}</div>
      ) : isLockedPage ? (
        <LockedPage teasers={pageTeasers} lockedCount={lockedCount} />
      ) : (
        <div className={GRID}>
          {shown.map((x) => (
            <ProductCard key={x.id} x={x} from={from} isGuest={isGuest} saved={watch.includes(x.id)} onOpen={() => openDetail(x)} onSave={() => toggleWatch(x.id)} />
          ))}
        </div>
      )}

      {!loading && totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} freePages={freePages} isGuest={isGuest} onGo={goToPage} />
      )}

      {isGuest && !isLockedPage && lockedCount > 0 && (
        <p className="mt-4 text-center text-sm text-white/45">
          <LockIcon className="mr-1.5 inline-block h-3.5 w-3.5 align-[-2px]" />
          {lockedCount}+ more products available after free sign-up
        </p>
      )}

      {selected && (
        <DetailDrawer x={selected} detail={detail} loading={detailLoading} from={from} isGuest={isGuest}
          saved={watch.includes(selected.id)} onSave={() => toggleWatch(selected.id)} onClose={closeDetail} />
      )}
    </div>
  );
}

// Pagination bar
function pageList(current: number, total: number): (number | string)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | string)[] = [];
  let prev = 0;
  for (let i = 1; i <= total; i++) {
    if (i === 1 || i === total || Math.abs(i - current) <= 1) {
      if (i - prev > 1) out.push("...");
      out.push(i);
      prev = i;
    }
  }
  return out;
}

function Pagination({ page, totalPages, freePages, isGuest, onGo }: {
  page: number; totalPages: number; freePages: number; isGuest: boolean; onGo: (p: number) => void;
}) {
  const base = "grid h-10 min-w-[2.5rem] place-items-center rounded-xl border px-2 text-sm font-medium transition";
  return (
    <nav aria-label="Product pages" className="mt-10 flex flex-wrap items-center justify-center gap-2">
      <button onClick={() => onGo(page - 1)} disabled={page <= 1} aria-label="Previous page"
        className={`${base} border-white/10 bg-white/[0.04] text-white/60 hover:border-white/25 hover:text-white disabled:pointer-events-none disabled:opacity-35`}>
        ←
      </button>
      {pageList(page, totalPages).map((p, i) =>
        typeof p === "string" ? (
          <span key={`e${i}`} className="px-1 text-white/35">…</span>
        ) : (
          <button key={p} onClick={() => onGo(p)} aria-label={`Page ${p}`} aria-current={p === page ? "page" : undefined}
            className={`${base} ${
              p === page
                ? "border-transparent bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-white shadow-lg shadow-indigo-500/25"
                : "border-white/10 bg-white/[0.04] text-white/60 hover:border-white/25 hover:text-white"
            }`}>
            {isGuest && p > freePages ? (
              <span className="inline-flex items-center gap-1.5">{p}<LockIcon className="h-3.5 w-3.5 opacity-70" /></span>
            ) : (
              p
            )}
          </button>
        )
      )}
      <button onClick={() => onGo(page + 1)} disabled={page >= totalPages} aria-label="Next page"
        className={`${base} border-white/10 bg-white/[0.04] text-white/60 hover:border-white/25 hover:text-white disabled:pointer-events-none disabled:opacity-35`}>
        →
      </button>
    </nav>
  );
}

// Locked page (guest paywall)
function LockedPage({ teasers, lockedCount }: { teasers: any[]; lockedCount: number }) {
  const cards = teasers.length ? teasers : Array.from({ length: 8 }, () => ({}));
  return (
    <div className="relative">
      <div className={`${GRID} pointer-events-none select-none`} aria-hidden>
        {cards.map((t, i) => <TeaserCard key={i} t={t} />)}
      </div>
      <div className="absolute inset-0 z-10 flex justify-center bg-gradient-to-b from-ink/30 via-ink/70 to-ink/95">
        <div className="glass mx-4 mt-14 h-fit w-full max-w-md rounded-3xl p-8 text-center shadow-2xl shadow-indigo-500/10 animate-fade-up sm:mt-24">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 shadow-lg shadow-indigo-500/30">
            <LockIcon className="h-7 w-7 text-white" />
          </div>
          {lockedCount > 0 && (
            <span className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-indigo-400/30 bg-indigo-500/10 px-3 py-1 text-xs font-semibold text-indigo-200">
              ✨ {lockedCount}+ more products available after free sign-up
            </span>
          )}
          <h3 className="mt-3 text-2xl font-bold text-white">Unlock More Products</h3>
          <p className="mt-2 text-sm leading-relaxed text-white/60">
            Create your free account to access the rest of the Discover library, advanced features, and future updates.
          </p>
          <Link href="/signup"
            className="mt-6 block w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 py-3 text-center text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:shadow-indigo-500/45">
            Sign Up Free →
          </Link>
          <p className="mt-3 text-sm text-white/50">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-indigo-300 underline-offset-4 transition hover:text-indigo-200 hover:underline">
              Log in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

function TeaserCard({ t }: { t: any }) {
  return (
    <article className="glass relative flex flex-col overflow-hidden rounded-2xl">
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-gradient-to-br from-indigo-500/15 to-fuchsia-500/10">
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-4xl opacity-20">🛍️</div>
        {t.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={proxied(t.imageUrl)} alt="" loading="lazy"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
            className="relative h-full w-full scale-110 object-cover blur-lg" />
        ) : null}
        <div className="absolute inset-0 bg-black/30" />
        <span className="absolute right-2.5 top-2.5 grid h-7 w-7 place-items-center rounded-full bg-black/50 backdrop-blur">
          <LockIcon className="h-3.5 w-3.5 text-white/80" />
        </span>
      </div>
      <div className="space-y-3 p-4">
        <div className="flex gap-1.5">
          <div className="h-5 w-16 rounded-full bg-white/[0.06]" />
          <div className="h-5 w-20 rounded-full bg-white/[0.06]" />
        </div>
        <div className="flex gap-3">
          <div className="h-7 w-20 rounded bg-white/[0.06]" />
          <div className="h-7 w-14 rounded bg-white/[0.06]" />
        </div>
        <div className="h-9 w-full rounded-lg bg-white/[0.06]" />
      </div>
    </article>
  );
}

// ─────────────────────────── Product card (compact grid) ───────────────────────────
function ProductCard({ x, from, isGuest, saved, onOpen, onSave }: { x: any; from: string; isGuest: boolean; saved: boolean; onOpen: () => void; onSave: () => void }) {
  const trend = trendLabel(x);
  const mo = momentumLabel(x);
  return (
    <article className="glass flex flex-col overflow-hidden rounded-2xl transition hover:border-white/20">
      <button onClick={onOpen} className="group relative block w-full text-left">
        <div className="relative aspect-[4/5] w-full overflow-hidden bg-gradient-to-br from-indigo-500/15 to-fuchsia-500/10">
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-4xl opacity-25">🛍️</div>
          {x.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={proxied(x.imageUrl)} alt={x.title} loading="lazy"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
              className="relative h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]" />
          ) : null}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
          <span className="absolute right-2.5 top-2.5 rounded-full bg-black/50 px-2 py-0.5 text-[10px] capitalize text-white/80 backdrop-blur">{x.category}</span>
          <div className="absolute inset-x-3 bottom-2.5">
            <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-white drop-shadow">{x.title}</h3>
            <p className="mt-0.5 text-[11px] text-white/60">{x.sellerName}</p>
          </div>
        </div>
      </button>

      <div className="flex flex-1 flex-col p-4">
        <div className="flex flex-wrap gap-1.5">
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${trend.cls}`}><span>{trend.icon}</span> {trend.text}</span>
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${mo.cls}`}><span>{mo.icon}</span> {mo.text}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wide text-white/40">Est. GMV</div>
            <div className="mt-0.5 text-2xl font-bold leading-none text-emerald-300">{money(x.gmv)}</div>
          </div>
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wide text-white/40">Sales</div>
            <div className="mt-0.5 text-2xl font-bold leading-none text-white">{compact(x.sold)}</div>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Link href={createAdHref(x, from, isGuest)} className="flex-1 rounded-lg bg-gradient-to-r from-indigo-500 to-fuchsia-500 py-2.5 text-center text-xs font-semibold shadow-lg shadow-indigo-500/20 transition hover:shadow-indigo-500/40">Create ad →</Link>
          <button onClick={onSave} aria-label={saved ? "Remove from watchlist" : "Save to watchlist"}
            className={`rounded-lg border px-3 py-2.5 text-sm transition ${saved ? "border-amber-400/50 bg-amber-500/15 text-amber-200" : "border-white/12 text-white/50 hover:text-white"}`}>
            {saved ? "★" : "☆"}
          </button>
        </div>
      </div>
    </article>
  );
}

function SkeletonCard() {
  return (
    <div className="glass flex flex-col overflow-hidden rounded-2xl">
      <div className="aspect-[4/5] w-full animate-pulse bg-white/[0.05]" />
      <div className="space-y-3 p-4">
        <div className="flex gap-1.5"><div className="h-5 w-16 animate-pulse rounded-full bg-white/[0.06]" /><div className="h-5 w-20 animate-pulse rounded-full bg-white/[0.06]" /></div>
        <div className="flex gap-3"><div className="h-7 w-20 animate-pulse rounded bg-white/[0.06]" /><div className="h-7 w-14 animate-pulse rounded bg-white/[0.06]" /></div>
        <div className="h-9 w-full animate-pulse rounded-lg bg-white/[0.06]" />
      </div>
    </div>
  );
}

// ─────────────────────────── Rich Product Detail drawer ───────────────────────────
function DetailDrawer({ x, detail, loading, from, isGuest, saved, onSave, onClose }: {
  x: any; detail: any; loading: boolean; from: string; isGuest: boolean; saved: boolean; onSave: () => void; onClose: () => void;
}) {
  const trend = trendLabel(x);
  const mo = momentumLabel(x);
  const p = detail?.product;
  const series: { t: string; sold: number; price: number }[] = detail?.series || [];

  // Only real / derived values — fall back to the grid row before the detail loads.
  const price = p?.latestPrice ?? x.price;
  const units = p?.latestSoldCount ?? x.sold;
  const vel7 = p?.vel7 ?? x.velocity;
  const vel30 = p?.vel30;
  const growth7 = p?.growth7 ?? x.growth;
  const gmv7 = p?.gmv7 ?? x.gmv;
  const gmv30 = p?.gmv30;
  const gmv90 = p?.gmv90;
  const trendScore = p?.trend7 ?? x.trend;
  const momScore = p?.momentum7 ?? x.momentum;
  const region = p?.region ?? "US";
  const currency = p?.currency ?? "USD";
  const seller = x.sellerName ?? p?.sellerName;
  const storeUrl: string | undefined = p?.productUrl;
  const confidence = p?.confidence ?? x.confidence ?? 1;

  // Derived chart series from the real snapshot history.
  const soldSeries = series.map((s) => Number(s.sold) || 0);
  const priceSeries = series.map((s) => Number(s.price) || 0);
  const dailySeries: number[] = [];
  for (let i = 1; i < soldSeries.length; i++) dailySeries.push(Math.max(0, soldSeries[i] - soldSeries[i - 1]));

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-up" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-white/10 bg-panel shadow-2xl">
        {/* Hero */}
        <div className="relative aspect-video w-full shrink-0 overflow-hidden bg-gradient-to-br from-indigo-500/15 to-fuchsia-500/10">
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-5xl opacity-25">🛍️</div>
          {x.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={proxied(x.imageUrl)} alt={x.title}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
              className="relative h-full w-full object-cover" />
          ) : null}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 to-transparent" />
          <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-black/50 text-white/80 backdrop-blur transition hover:bg-black/70">✕</button>
          <div className="absolute inset-x-5 bottom-4">
            <div className="mb-2 flex flex-wrap gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${trend.cls}`}><span>{trend.icon}</span> {trend.text}</span>
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${mo.cls}`}><span>{mo.icon}</span> {mo.text}</span>
            </div>
            <h2 className="text-2xl font-bold leading-tight text-white drop-shadow">{x.title}</h2>
            <p className="mt-1 text-sm text-white/70">{seller} · <span className="capitalize">{x.category}</span> · {money(price).replace("$", currency === "USD" ? "$" : currency + " ")}</p>
          </div>
        </div>

        <div className="flex flex-col gap-6 p-6">
          {/* Primary actions up top */}
          <div className="flex gap-2">
            <Link href={createAdHref(x, from, isGuest)} className="flex-1 rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 py-3 text-center text-sm font-semibold shadow-lg shadow-indigo-500/25 transition hover:shadow-indigo-500/40">Create ad with TrimIQ →</Link>
            <button onClick={onSave} aria-label="Save" className={`rounded-xl border px-4 text-sm font-medium transition ${saved ? "border-amber-400/50 bg-amber-500/15 text-amber-200" : "border-white/12 text-white/75 hover:bg-white/[0.06] hover:text-white"}`}>{saved ? "★" : "☆"}</button>
          </div>

          {/* Key metrics */}
          <Section title="Product intelligence">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <MetricTile label="Est. GMV (30d)" value={money(gmv30 ?? gmv7)} accent="text-emerald-300" />
              <MetricTile label="Units sold" value={compact(units)} />
              <MetricTile label="Price" value={money(price)} />
              <MetricTile label="Sales velocity" value={compact(vel7)} sub="units / day (7d)" />
              <MetricTile label="Sales growth" value={pctStr(growth7)} accent={Number(growth7) >= 0 ? "text-emerald-300" : "text-orange-300"} sub="7d vs prior" />
              <MetricTile label="Trend / Momentum" value={`${Math.round(trendScore)} / ${Math.round(momScore)}`} sub="score out of 100" />
            </div>
          </Section>

          {/* GMV by timeframe */}
          <Section title="Estimated GMV by window">
            <div className="grid grid-cols-3 gap-3">
              <MetricTile label="Last 7 days" value={money(gmv7)} accent="text-emerald-300" />
              <MetricTile label="Last 30 days" value={money(gmv30 ?? gmv7)} accent="text-emerald-300" />
              <MetricTile label="Last 90 days" value={money(gmv90 ?? gmv30 ?? gmv7)} accent="text-emerald-300" />
            </div>
          </Section>

          {/* Historical charts */}
          <Section title="History">
            <ChartBlock title="Units sold (cumulative)" caption={compact(units) + " total"} loading={loading} values={soldSeries} color="rgb(52 211 153)" />
            <ChartBlock title="Daily sales" caption={"~" + compact(vel7) + " / day"} loading={loading} values={dailySeries} color="rgb(129 140 248)" />
            <ChartBlock title="Price history" caption={money(price)} loading={loading} values={priceSeries} color="rgb(251 191 36)" flat />
          </Section>

          {/* Store */}
          <Section title="Store">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm">
              <Row k="Seller" v={seller || "—"} />
              <Row k="Region" v={region} />
              <Row k="Currency" v={currency} />
              {storeUrl && (
                <a href={storeUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 rounded-lg border border-white/12 px-3 py-2 text-sm font-medium text-white/80 transition hover:bg-white/[0.06] hover:text-white">
                  View on TikTok Shop ↗
                </a>
              )}
            </div>
          </Section>

          {/* Creator videos — REAL data not yet connected (intentionally empty). */}
          <Section title="Creator videos">
            <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-4">
              <p className="text-sm font-medium text-white/80">Coming soon</p>
              <p className="mt-1 text-sm text-white/50">
                Public TikTok creators posting about this product will appear here once a real creator-data source is connected
                (official TikTok Shop / Affiliate API or a licensed provider). We don&apos;t show fabricated creator numbers.
              </p>
            </div>
          </Section>

          <p className="text-[11px] leading-relaxed text-white/35">
            Figures are estimates derived from public sold-count movement over time
            {confidence < 0.7 ? " (this product reports a bucketed/rounded sold count, so numbers are conservative)." : "."}
            {" "}Creator, competition, and video metrics will populate when real-data providers are connected.
          </p>
        </div>
      </aside>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-white/40">{title}</h3>
      {children}
    </div>
  );
}
function MetricTile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="text-[10px] font-medium uppercase tracking-wide text-white/40">{label}</div>
      <div className={`mt-1 text-xl font-bold leading-none ${accent || "text-white"}`}>{value}</div>
      {sub && <div className="mt-1 text-[10px] text-white/40">{sub}</div>}
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between border-b border-white/5 py-1.5 last:border-0">
      <span className="text-white/45">{k}</span>
      <span className="font-medium text-white/85">{v}</span>
    </div>
  );
}
function ChartBlock({ title, caption, values, color, loading, flat }: { title: string; caption: string; values: number[]; color: string; loading: boolean; flat?: boolean }) {
  return (
    <div className="mb-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 last:mb-0">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-white/60">{title}</span>
        <span className="text-xs font-semibold text-white/80">{caption}</span>
      </div>
      {loading ? (
        <div className="h-16 w-full animate-pulse rounded bg-white/[0.05]" />
      ) : (
        <AreaChart values={values} color={color} flat={flat} />
      )}
    </div>
  );
}
function AreaChart({ values, color, flat }: { values: number[]; color: string; flat?: boolean }) {
  if (!values || values.length < 2) return <p className="py-4 text-xs text-white/35">Not enough history yet.</p>;
  const w = 340, h = 64;
  const min = Math.min.apply(null, values);
  const max = Math.max.apply(null, values);
  const range = max - min || 1;
  const y = (v: number) => h - ((v - min) / range) * (h - 8) - 4;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${flat ? y(v) : y(v)}`).join(" ");
  const areaPts = `0,${h} ${pts} ${w},${h}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-full" preserveAspectRatio="none">
      <polygon points={areaPts} fill={color} fillOpacity={0.14} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
